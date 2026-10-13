import { describe, it, expect } from "vitest";
import { computeCounts, pruneStale, isValidStat, canTrackStat, type SwarmStat } from "./stats";

describe("computeCounts", () => {
  it("counts an empty swarm as all zeroes", () => {
    expect(computeCounts([])).toEqual({ streaming: 0, watching: 0, recording: 0, total: 0 });
  });

  it("counts a lone streamer (self only)", () => {
    expect(computeCounts([{ role: "streamer", recording: false }])).toEqual({
      streaming: 1,
      watching: 0,
      recording: 0,
      total: 1,
    });
  });

  it("counts collectors as watchers", () => {
    const stats: SwarmStat[] = [
      { role: "streamer", recording: false },
      { role: "collector", recording: false },
      { role: "collector", recording: false },
    ];
    expect(computeCounts(stats)).toEqual({ streaming: 1, watching: 2, recording: 0, total: 3 });
  });

  it("counts anyone recording, streamer or collector", () => {
    const stats: SwarmStat[] = [
      { role: "streamer", recording: true },
      { role: "collector", recording: true },
      { role: "collector", recording: false },
    ];
    expect(computeCounts(stats)).toMatchObject({ streaming: 1, watching: 2, recording: 2, total: 3 });
  });

  it("accepts any iterable (e.g. a Map's values)", () => {
    const map = new Map<string, SwarmStat>([
      ["a", { role: "streamer", recording: false }],
      ["b", { role: "collector", recording: true }],
    ]);
    expect(computeCounts(map.values())).toEqual({ streaming: 1, watching: 1, recording: 1, total: 2 });
  });
});

describe("pruneStale", () => {
  it("drops peers older than the TTL and keeps fresh ones", () => {
    const now = 100_000;
    const map = new Map<string, SwarmStat>([
      ["fresh", { role: "collector", recording: false, lastSeen: now - 1_000 }],
      ["stale", { role: "collector", recording: false, lastSeen: now - 20_000 }],
    ]);
    pruneStale(map, now, 12_000);
    expect([...map.keys()]).toEqual(["fresh"]);
  });

  it("keeps entries that have no lastSeen (e.g. self)", () => {
    const map = new Map<string, SwarmStat>([["self", { role: "streamer", recording: false }]]);
    pruneStale(map, 999_999, 1);
    expect(map.has("self")).toBe(true);
  });
});

describe("isValidStat", () => {
  it("accepts well-formed wire messages", () => {
    expect(isValidStat({ role: "streamer", recording: false })).toBe(true);
    expect(isValidStat({ role: "collector", recording: true })).toBe(true);
  });

  it("rejects malformed or hostile input", () => {
    expect(isValidStat(null)).toBe(false);
    expect(isValidStat("hi")).toBe(false);
    expect(isValidStat({ role: "admin", recording: true })).toBe(false);
    expect(isValidStat({ role: "collector" })).toBe(false);
    expect(isValidStat({ role: "collector", recording: "yes" })).toBe(false);
    expect(isValidStat({})).toBe(false);
  });
});

describe("canTrackStat", () => {
  it("admits new peers until the cap, always allows updates", () => {
    const map = new Map<string, unknown>([["a", 1], ["b", 1]]);
    expect(canTrackStat(map, "c", 3)).toBe(true);
    map.set("c", 1);
    expect(canTrackStat(map, "d", 3)).toBe(false); // at capacity, new peer
    expect(canTrackStat(map, "a", 3)).toBe(true); // known peer updates pass
  });
});
