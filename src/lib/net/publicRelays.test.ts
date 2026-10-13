import { describe, it, expect } from "vitest";
import {
  PUBLIC_RELAY_CANDIDATES,
  EXTRA_STUN_CANDIDATES,
  getPublicRelays,
  setPublicRelays,
  getExtraStun,
  setExtraStun,
  parseStunList,
  spreadPick,
  testAll,
} from "./publicRelays";
import { getRelaySetup, hasRelay, resolveRtcConfig, relayShareParams } from "./iceConfig";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("built-in candidate lists", () => {
  it("public relays carry TURN urls with shared credentials", () => {
    for (const c of PUBLIC_RELAY_CANDIDATES) {
      const urls = Array.isArray(c.server.urls) ? c.server.urls : [c.server.urls];
      expect(urls.every((u) => /^turns?:/.test(u))).toBe(true);
      expect(typeof c.server.username).toBe("string");
      expect(c.label.length).toBeGreaterThan(0);
    }
  });

  it("extra STUN servers are STUN urls — and never the dead Open Relay host", () => {
    expect(EXTRA_STUN_CANDIDATES.every((u) => /^stun:/.test(u))).toBe(true);
    expect(JSON.stringify([PUBLIC_RELAY_CANDIDATES, EXTRA_STUN_CANDIDATES])).not.toContain("openrelay");
  });
});

describe("opt-in storage", () => {
  it("round-trips tested public relays and drops junk", () => {
    const s = memoryStorage();
    setPublicRelays([PUBLIC_RELAY_CANDIDATES[0].server, { urls: "https://evil" } as any], s);
    expect(getPublicRelays(s)).toEqual([PUBLIC_RELAY_CANDIDATES[0].server]);
    setPublicRelays([], s);
    expect(getPublicRelays(s)).toEqual([]);
  });

  it("keeps at most four extra STUN servers", () => {
    const s = memoryStorage();
    setExtraStun(["stun:a:1", "stun:b:1", "stun:c:1", "stun:d:1", "stun:e:1", "turn:x"], s);
    expect(getExtraStun(s)).toEqual(["stun:a:1", "stun:b:1", "stun:c:1", "stun:d:1"]);
  });
});

describe("feeding them into connections", () => {
  it("public relays count as a relay but are never put into share links", () => {
    const s = memoryStorage();
    expect(hasRelay(getRelaySetup({}, s))).toBe(false);
    setPublicRelays([PUBLIC_RELAY_CANDIDATES[0].server], s);
    const setup = getRelaySetup({}, s);
    expect(hasRelay(setup)).toBe(true);
    expect(relayShareParams(setup, s)).toEqual({});
  });

  it("extra STUN and public relays reach the RTCConfiguration", async () => {
    const s = memoryStorage();
    setExtraStun(["stun:stun.t-online.de:3478"], s);
    setPublicRelays([PUBLIC_RELAY_CANDIDATES[0].server], s);
    const config = await resolveRtcConfig({ storage: s });
    const all = JSON.stringify(config.iceServers);
    expect(all).toContain("stun.t-online.de");
    expect(all).toContain("freestun.net");
  });
});

describe("helpers", () => {
  it("parses the always-online-stun list format", () => {
    expect(parseStunList("stun.l.google.com:19302\n\nbad line\nstun.nextcloud.com:443\nstun.l.google.com:19302\nx:99999")).toEqual([
      "stun:stun.l.google.com:19302",
      "stun:stun.nextcloud.com:443",
    ]);
  });

  it("spreads picks across the list", () => {
    const list = Array.from({ length: 100 }, (_, i) => i);
    const picked = spreadPick(list, 4, 0);
    expect(picked).toEqual([0, 25, 50, 75]);
    expect(spreadPick([1, 2], 5)).toEqual([1, 2]);
  });

  it("tests every candidate and survives a tester that throws", async () => {
    const results = await testAll(["a", "b", "c"], async (c) => {
      if (c === "b") throw new Error("boom");
      return { ok: c === "a", detail: c };
    });
    expect(results.map((r) => [r.candidate, r.ok])).toEqual([
      ["a", true],
      ["b", false],
      ["c", false],
    ]);
    expect(results[1].detail).toBe("boom");
  });
});
