// Keep something flowing on a starved link.
//
// WebRTC's congestion control already lowers the bitrate when a link gets
// worse. What it does not do is decide that a link is too slow for video at
// all: on a throttled connection (2G-like speeds are a common way to stifle a
// protest without cutting the network) the encoder keeps sending a smeared,
// stalling picture that also crowds out the sound. Here each viewer's link
// steps through a ladder instead — full, reduced (≈360p), minimal (≈180p),
// and sound only — from what the connection itself measures, and climbs back
// when it recovers. Pure logic; the WebRTC part is in linkShaping.ts.

export type Tier = "full" | "reduced" | "minimal" | "audio";

export const LADDER: Tier[] = ["full", "reduced", "minimal", "audio"];

export interface TierSettings {
  /** Video sending at all. */
  active: boolean;
  maxBitrate?: number;
  scaleResolutionDownBy?: number;
  maxFramerate?: number;
  /** Estimated available bitrate (bps) this tier needs to hold. */
  needBps: number;
}

export const TIERS: Record<Tier, TierSettings> = {
  full: { active: true, maxBitrate: 1_200_000, scaleResolutionDownBy: 1, needBps: 800_000 },
  reduced: { active: true, maxBitrate: 450_000, scaleResolutionDownBy: 2, maxFramerate: 24, needBps: 280_000 },
  minimal: { active: true, maxBitrate: 130_000, scaleResolutionDownBy: 4, maxFramerate: 12, needBps: 95_000 },
  audio: { active: false, needBps: 0 },
};

export interface LinkSample {
  at: number;
  /** The connection's own estimate of what it can send (bps), if it has one yet. */
  availableBps: number | null;
  /** Share of our video packets the receiver reports lost (0…1), if known. */
  loss: number | null;
}

export interface ShaperOptions {
  /** Consecutive samples below a tier before stepping down. */
  downAfter?: number;
  /** Consecutive samples with room for the next tier before stepping up. */
  upAfter?: number;
  /** In a lowered tier, try one step up after this long with a quiet link… */
  probeAfterMs?: number;
  /** …doubling after each failed try, up to this. */
  maxProbeMs?: number;
  /** Never above this tier (e.g. a data-saving choice). */
  ceiling?: Tier;
}

/** Loss at which a link counts as overloaded whatever its estimate says. */
export const HEAVY_LOSS = 0.12;

const rank = (t: Tier) => LADDER.indexOf(t);
const better = (t: Tier) => LADDER[Math.max(0, rank(t) - 1)];
const worse = (t: Tier) => LADDER[Math.min(LADDER.length - 1, rank(t) + 1)];
const worstOf = (a: Tier, b: Tier) => (rank(a) > rank(b) ? a : b);

/** The best tier an estimate supports (never above the ceiling). */
export function tierFor(availableBps: number, ceiling: Tier = "full"): Tier {
  const t = LADDER.find((x) => TIERS[x].needBps <= availableBps) ?? "audio";
  return worstOf(t, ceiling);
}

/**
 * Where a link at `current` belongs, given a sample: what the estimate holds,
 * and under heavy loss at most one step below where it is — one burst of
 * loss (a keyframe hitting a policer) must not throw a picture away.
 */
export function fitFor(current: Tier, availableBps: number, loss: number | null, ceiling: Tier = "full"): Tier {
  const byEstimate = tierFor(availableBps, ceiling);
  return loss !== null && loss >= HEAVY_LOSS ? worstOf(rank(byEstimate) > rank(current) ? byEstimate : worse(current), ceiling) : byEstimate;
}

export function createShaper(opts: ShaperOptions = {}) {
  const downAfter = opts.downAfter ?? 2;
  const upAfter = opts.upAfter ?? 4;
  const probeBase = opts.probeAfterMs ?? 15_000;
  const maxProbe = opts.maxProbeMs ?? 120_000;
  let ceiling: Tier = opts.ceiling ?? "full";

  let tier: Tier = ceiling;
  let below = 0;
  let above = 0;
  /** When the tier last changed. */
  let since = 0;
  /**
   * How long to stay before stepping up: nothing after a passing dip, then
   * twice the trial time after a step up failed, doubling with each failure.
   */
  let upWait = 0;
  /**
   * Every step up is on trial: congestion estimates run ahead of what a
   * throttled link really carries, and only grow with what is sent. A step
   * up fails on repeated heavy loss, or when, given time, the estimate does
   * not hold it.
   */
  let trial: { from: Tier; until: number; lossy: number } | null = null;

  function moveTo(next: Tier, at: number) {
    tier = next;
    below = 0;
    above = 0;
    since = at;
  }

  function stepUp(at: number) {
    const from = tier;
    moveTo(better(tier), at);
    trial = { from, until: at + probeBase, lossy: 0 };
  }

  function judgeTrial(s: LinkSample, fits: Tier): void {
    const t = trial!;
    t.lossy = s.loss !== null && s.loss >= HEAVY_LOSS ? t.lossy + 1 : 0;
    if (t.lossy >= 2 || (s.at >= t.until && rank(fits) > rank(tier))) {
      trial = null;
      upWait = Math.min(maxProbe, upWait ? upWait * 2 : 2 * probeBase);
      moveTo(worstOf(fits, t.from), s.at);
    } else if (s.at >= t.until) {
      trial = null; // it held: settle here a while before trying higher
      upWait = probeBase;
      since = s.at;
    }
  }

  /** Feed one sample; returns the new tier when it changes, else null. */
  function observe(s: LinkSample): Tier | null {
    if (since === 0) since = s.at;
    if (s.availableBps === null) return null;
    const prev = tier;
    const fits = fitFor(tier, s.availableBps, s.loss, ceiling);
    if (trial) {
      judgeTrial(s, fits);
      return tier !== prev ? tier : null;
    }
    const settled = s.at - since >= upWait;

    if (rank(fits) > rank(tier)) {
      above = 0;
      if (++below >= downAfter) moveTo(fits, s.at); // straight down, as far as the estimate says
    } else if (rank(fits) < rank(tier)) {
      below = 0;
      // Up one step at a time. A link that recovered by two tiers or more
      // has plainly changed: it does not sit out the back-off from earlier
      // failed tries (that wait is for estimates running one tier ahead).
      const strong = rank(tier) - rank(fits) >= 2;
      if (++above >= upAfter && (settled || strong)) stepUp(s.at);
    } else {
      below = 0;
      above = 0;
      // A lowered link that stays quiet is tried one step up now and then:
      // its estimate cannot grow past what it is allowed to send.
      const quiet = s.loss === null || s.loss < 0.02;
      if (tier !== ceiling && quiet && s.at - since >= Math.max(upWait, probeBase)) stepUp(s.at);
    }
    return tier !== prev ? tier : null;
  }

  return {
    observe,
    get tier() {
      return tier;
    },
    setCeiling(next: Tier): Tier | null {
      ceiling = next;
      if (rank(tier) < rank(ceiling)) {
        trial = null;
        moveTo(ceiling, since);
        return tier;
      }
      return null;
    },
  };
}
