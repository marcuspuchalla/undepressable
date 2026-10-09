// The WebRTC side of linkShaper.ts: read what a connection measures, and set
// each video sender's encoding to the tier the link can hold.

import { createShaper, TIERS, type LinkSample, type Tier } from "./linkShaper";

export interface ShapedLink {
  readonly tier: Tier;
  stop(): void;
}

const SAMPLE_MS = 2000;
const running = new WeakMap<RTCPeerConnection, ShapedLink>();

/** What the connection measured just now (null fields when it has no figure yet). */
export function readLinkSample(report: RTCStatsReport | null, at: number, videoActive: boolean): LinkSample {
  let availableBps: number | null = null;
  let selectedPair: string | null = null;
  const loss: Record<string, number> = {};
  report?.forEach((e: any) => {
    if (e.type === "transport" && e.selectedCandidatePairId) selectedPair = e.selectedCandidatePairId;
  });
  report?.forEach((e: any) => {
    if (e.type === "candidate-pair" && typeof e.availableOutgoingBitrate === "number") {
      const selected = selectedPair ? e.id === selectedPair : e.nominated && e.state === "succeeded";
      if (selected) availableBps = e.availableOutgoingBitrate;
    }
    if (e.type === "remote-inbound-rtp" && typeof e.fractionLost === "number") {
      loss[e.kind] = Math.max(loss[e.kind] ?? 0, e.fractionLost);
    }
  });
  // With video switched off its last loss report goes stale: judge by the sound.
  const l = videoActive ? loss.video ?? loss.audio : loss.audio;
  return { at, availableBps, loss: l ?? null };
}

function encodingFor(e: RTCRtpEncodingParameters, tier: Tier): RTCRtpEncodingParameters {
  const t = TIERS[tier];
  const out: RTCRtpEncodingParameters = { ...e, active: t.active, scaleResolutionDownBy: t.scaleResolutionDownBy ?? 1 };
  if (t.maxBitrate) out.maxBitrate = t.maxBitrate;
  if (t.maxFramerate) out.maxFramerate = t.maxFramerate;
  else delete out.maxFramerate;
  return out;
}

/** Set every video sender on the connection to a tier; sound gets priority. */
export async function applyTier(pc: RTCPeerConnection, tier: Tier): Promise<void> {
  for (const sender of pc.getSenders()) {
    const kind = sender.track?.kind;
    if (!kind) continue;
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) continue;
      if (kind === "video") {
        params.encodings = params.encodings.map((e) => encodingFor(e, tier));
      } else if (kind === "audio") {
        if (params.encodings.every((e: any) => e.priority === "high")) continue;
        params.encodings = params.encodings.map((e) => ({ ...e, priority: "high", networkPriority: "high" }) as RTCRtpEncodingParameters);
      }
      await sender.setParameters(params);
    } catch {
      /* not negotiated yet, or gone: the next round applies it */
    }
  }
}

/** Does a video sender still disagree with the tier (new sender, or reset by renegotiation)? */
function drifted(pc: RTCPeerConnection, tier: Tier): boolean {
  const t = TIERS[tier];
  return pc.getSenders().some((s) => {
    if (s.track?.kind !== "video") return false;
    const e = s.getParameters().encodings?.[0];
    return !!e && ((e.active ?? true) !== t.active || (t.maxBitrate !== undefined && e.maxBitrate !== t.maxBitrate));
  });
}

/**
 * Watch one connection and keep its video at what the link holds. One per
 * connection; stops by itself when the connection closes.
 */
export function shapeLink(pc: RTCPeerConnection, onChange?: (tier: Tier) => void): ShapedLink {
  const existing = running.get(pc);
  if (existing) return existing;
  const shaper = createShaper();
  let busy = false;
  const timer = setInterval(async () => {
    if (pc.connectionState === "closed" || pc.connectionState === "failed") {
      link.stop();
      return;
    }
    if (busy) return;
    busy = true;
    try {
      const report = await pc.getStats().catch(() => null);
      const next = shaper.observe(readLinkSample(report, Date.now(), TIERS[shaper.tier].active));
      if (next) {
        await applyTier(pc, next);
        onChange?.(next);
      } else if (drifted(pc, shaper.tier)) {
        await applyTier(pc, shaper.tier);
      }
    } finally {
      busy = false;
    }
  }, SAMPLE_MS);
  const link: ShapedLink = {
    get tier() {
      return shaper.tier;
    },
    stop() {
      clearInterval(timer);
      running.delete(pc);
    },
  };
  running.set(pc, link);
  void applyTier(pc, shaper.tier);
  return link;
}

/** What a tier means, for people. */
export const TIER_LABEL: Record<Tier, string> = {
  full: "full picture",
  reduced: "reduced picture",
  minimal: "small picture",
  audio: "sound only",
};
