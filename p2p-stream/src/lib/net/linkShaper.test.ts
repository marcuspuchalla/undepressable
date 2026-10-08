import { describe, it, expect } from "vitest";
import { createShaper, tierFor, fitFor, TIERS, type Tier, type LinkSample } from "./linkShaper";

/** Feed samples every 2 s; returns the tier after each. */
function run(shaper: ReturnType<typeof createShaper>, samples: Omit<LinkSample, "at">[], t0 = 1000): Tier[] {
  return samples.map((s, i) => {
    shaper.observe({ ...s, at: t0 + i * 2000 });
    return shaper.tier;
  });
}
const est = (kbps: number, loss: number | null = 0) => ({ availableBps: kbps * 1000, loss });
const repeat = <T>(x: T, n: number) => Array.from({ length: n }, () => x);

describe("tierFor / fitFor", () => {
  it("picks the best tier the estimate holds", () => {
    expect(tierFor(2_000_000)).toBe("full");
    expect(tierFor(500_000)).toBe("reduced");
    expect(tierFor(120_000)).toBe("minimal");
    expect(tierFor(40_000)).toBe("audio");
  });
  it("under heavy loss goes one step below where the link is — not further on loss alone", () => {
    expect(fitFor("full", 2_000_000, 0.2)).toBe("reduced");
    expect(fitFor("reduced", 280_000, 0.2)).toBe("minimal"); // not straight to sound only
    expect(fitFor("reduced", 40_000, 0.2)).toBe("audio"); // the estimate itself says so
    expect(fitFor("minimal", 2_000_000, 0.01)).toBe("full");
  });
  it("never goes above the ceiling", () => {
    expect(tierFor(5_000_000, "reduced")).toBe("reduced");
    expect(fitFor("reduced", 5_000_000, 0, "reduced")).toBe("reduced");
  });
  it("orders the ladder by what each tier needs", () => {
    expect(TIERS.full.needBps).toBeGreaterThan(TIERS.reduced.needBps);
    expect(TIERS.reduced.needBps).toBeGreaterThan(TIERS.minimal.needBps);
    expect(TIERS.audio.active).toBe(false);
  });
});

describe("createShaper", () => {
  it("stays put without an estimate, and on a good link", () => {
    const s = createShaper();
    expect(run(s, [{ availableBps: null, loss: null }, ...repeat(est(2000), 10)])).toEqual(repeat("full", 11));
  });

  it("steps straight down to what a throttled link holds — not on a single dip", () => {
    const s = createShaper();
    expect(run(s, [est(2000), est(40), est(2000), est(40), est(40)])).toEqual(["full", "full", "full", "full", "audio"]);
  });

  it("climbs back one step at a time once the link recovers, each step on trial", () => {
    const s = createShaper({ probeAfterMs: 10_000 });
    run(s, repeat(est(120), 3)); // down to minimal
    expect(s.tier).toBe("minimal");
    const after = run(s, repeat(est(2000), 20), 10_000);
    expect(after.slice(0, 3)).toEqual(["minimal", "minimal", "minimal"]);
    expect(after[3]).toBe("reduced");
    // Held for its 10 s trial, then up again.
    expect(after.slice(3, 8)).toEqual(repeat("reduced", 5));
    expect(after).toContain("full");
  });

  it("after a failed step up, waits longer before the next", () => {
    const s = createShaper({ probeAfterMs: 10_000, maxProbeMs: 40_000 });
    run(s, repeat(est(120), 3)); // minimal
    // The estimate runs ahead (a policer gives no delay signal): up to reduced…
    run(s, repeat(est(500), 4), 10_000);
    expect(s.tier).toBe("reduced");
    // …where the link drops packets: back to minimal.
    run(s, [est(500, 0.3), est(500, 0.3)], 18_000);
    expect(s.tier).toBe("minimal");
    // Optimistic estimates again: no new try for 20 s after the failure…
    expect(run(s, repeat(est(500), 4), 22_000)).toEqual(repeat("minimal", 4));
    // …then one.
    expect(run(s, repeat(est(500), 6), 30_000)).toContain("reduced");
  });

  it("probes upward on a quiet lowered link, and backs off when the probe fails", () => {
    const s = createShaper({ probeAfterMs: 10_000, maxProbeMs: 40_000 });
    run(s, repeat(est(40), 2)); // sound only
    expect(s.tier).toBe("audio");
    // Quiet, but the estimate stays low (nothing is sent to grow it): a probe after 10 s.
    const tiers = run(s, repeat(est(40), 6), 4000);
    expect(tiers).toContain("minimal");
    // Sending video overloads the link: heavy loss twice → back to sound only.
    const back = run(s, [est(40, 0.3), est(40, 0.3)], 20_000);
    expect(back[1]).toBe("audio");
    // The next probe waits twice as long (20 s): none within the next 18 s.
    expect(run(s, repeat(est(40), 9), 24_000)).toEqual(repeat("audio", 9));
  });

  it("keeps a probe that holds", () => {
    const s = createShaper({ probeAfterMs: 10_000 });
    run(s, repeat(est(40), 2));
    run(s, repeat(est(40), 6), 4000); // probe to minimal
    expect(s.tier).toBe("minimal");
    // The estimate grows with what is now sent; no loss. It holds, and the
    // link settles there before the next try.
    expect(run(s, repeat(est(150), 9), 16_000)).toEqual(repeat("minimal", 9));
  });

  it("does not sit out the back-off when the link recovers by two tiers or more", () => {
    const s = createShaper({ probeAfterMs: 10_000, maxProbeMs: 120_000 });
    run(s, repeat(est(40), 2)); // sound only
    // Three failed tries: estimates one tier ahead, loss when video is sent → back-off grows to 80 s.
    let t = 4000;
    for (let i = 0; i < 3; i++) {
      run(s, repeat(est(120), 4), t); // steps up to minimal
      t += 8000;
      run(s, [est(120, 0.3), est(120, 0.3)], t); // fails
      t += 4000;
      t += 200_000; // wait out the back-off each time
    }
    expect(s.tier).toBe("audio");
    // The throttle is lifted: the estimate says "full" — two tiers and more above. Up after 4 samples, not minutes.
    const tiers = run(s, repeat(est(2000), 4), t);
    expect(tiers[3]).toBe("minimal");
  });

  it("respects a ceiling, and lowering it applies at once", () => {
    const s = createShaper({ ceiling: "reduced" });
    expect(s.tier).toBe("reduced");
    expect(run(s, repeat(est(5000), 10))).toEqual(repeat("reduced", 10));
    expect(s.setCeiling("minimal")).toBe("minimal");
  });
});
