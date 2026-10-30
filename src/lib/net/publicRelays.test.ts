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
  turnRestPassword,
  credentialsFor,
  refreshMintedRelays,
  MINTED_TTL_MS,
} from "./publicRelays";
import { getRelaySetup, hasRelay, resolveRtcConfig, relayShareParams, setPublicStunWithRelay } from "./iceConfig";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("built-in candidate lists", () => {
  it("public relays carry TURN urls with fixed credentials or a published shared secret", () => {
    for (const c of PUBLIC_RELAY_CANDIDATES) {
      const urls = Array.isArray(c.server.urls) ? c.server.urls : [c.server.urls];
      expect(urls.every((u) => /^turns?:/.test(u))).toBe(true);
      expect(typeof c.server.username === "string" || typeof c.sharedSecret === "string").toBe(true);
      expect(c.label.length).toBeGreaterThan(0);
    }
  });

  it("extra STUN servers are STUN urls on 3478 — never the dead fixed-credential Open Relay host, never port 443", () => {
    expect(EXTRA_STUN_CANDIDATES.every((u) => /^stun:.*:3478$/.test(u))).toBe(true);
    expect(JSON.stringify(EXTRA_STUN_CANDIDATES)).not.toContain("openrelay");
    expect(JSON.stringify(PUBLIC_RELAY_CANDIDATES)).not.toContain("openrelayproject\"");
  });

  it("mints TURN REST credentials from a shared secret (RFC-style HMAC-SHA1, base64)", async () => {
    // Known vector: HMAC-SHA1("key", "The quick brown fox jumps over the lazy dog") = de7c9b85b8b78aa6bc8a7a36f70a90701c9db4d9
    expect(await turnRestPassword("key", "The quick brown fox jumps over the lazy dog")).toBe("3nybhbi3iqa8ino29wqQcBydtNk=");
    const c = PUBLIC_RELAY_CANDIDATES.find((x) => x.sharedSecret)!;
    const now = 1_700_000_000_000;
    const server = await credentialsFor(c, now);
    expect(server.username).toBe(`${Math.floor((now + MINTED_TTL_MS) / 1000)}:undepressable`);
    expect(server.mintedFrom).toBe(c.id);
    expect(server.expires).toBe(now + MINTED_TTL_MS);
    expect(server.credential).toBe(await turnRestPassword(c.sharedSecret!, server.username!));
  });

  it("re-mints stored credentials before they expire, and leaves fixed ones alone", async () => {
    const s = memoryStorage();
    const c = PUBLIC_RELAY_CANDIDATES.find((x) => x.sharedSecret)!;
    const fixed = { urls: "turn:fixed.example.org:3478", username: "a", credential: "b" };
    const minted = await credentialsFor(c, 0);
    setPublicRelays([fixed, minted], s);
    expect(await refreshMintedRelays(s, 1000)).toBe(false);
    const late = MINTED_TTL_MS - MINTED_TTL_MS / 8;
    expect(await refreshMintedRelays(s, late)).toBe(true);
    const after = getPublicRelays(s);
    expect(after[0]).toEqual(fixed);
    expect(after[1].expires).toBe(late + MINTED_TTL_MS);
    expect(after[1].username).not.toBe(minted.username);
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

  it("public relays reach the RTCConfiguration — and, speaking UDP, replace every STUN server", async () => {
    const s = memoryStorage();
    setExtraStun(["stun:stun.t-online.de:3478"], s);
    setPublicRelays([await credentialsFor(PUBLIC_RELAY_CANDIDATES[0])], s);
    let all = JSON.stringify((await resolveRtcConfig({ storage: s })).iceServers);
    expect(all).toContain("staticauth.openrelay.metered.ca");
    expect(all).not.toContain("stun:");
    // The fallback setting keeps the public servers and the extras.
    setPublicStunWithRelay(true, s);
    all = JSON.stringify((await resolveRtcConfig({ storage: s })).iceServers);
    expect(all).toContain("stun.t-online.de");
    expect(all).toContain("staticauth.openrelay.metered.ca");
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

import { stunVerdict, rememberStunTest, recallStunTest, rememberRelayTest, recallRelayTest, forgetTests, agoText } from "./publicRelays";

describe("what a STUN test means", () => {
  const now = 1_000_000;
  it("servers answering on a strict (symmetric) network do not help, and say so", () => {
    const v = stunVerdict({ answered: 8, tested: 8, using: 4, natKind: "hard", previous: null, now });
    expect(v.useful).toBe(false);
    expect(v.tone).toBe("warn");
    expect(v.text).toMatch(/8 of 8 answered/);
    expect(v.text).toMatch(/relay/);
  });
  it("servers answering where UDP looked blocked are worth a reconnect", () => {
    const v = stunVerdict({ answered: 3, tested: 8, using: 3, natKind: "blocked", previous: null, now });
    expect(v).toEqual({ tone: "good", useful: true, text: "3 of 8 answered — using 3." });
  });
  it("nothing answering right after servers did answer reads as throttling, not a blocked network", () => {
    const previous = { at: now - 90_000, results: [{ candidate: "stun:a", ok: true, detail: "" }, { candidate: "stun:b", ok: false, detail: "" }] };
    const v = stunVerdict({ answered: 0, tested: 10, using: 0, natKind: "hard", previous, now });
    expect(v.tone).toBe("warn");
    expect(v.text).toMatch(/1 did 2 min ago/);
    expect(v.text).toMatch(/does not block UDP/);
  });
  it("an old success no longer vouches for the network", () => {
    const previous = { at: now - 20 * 60_000, results: [{ candidate: "stun:a", ok: true, detail: "" }] };
    const v = stunVerdict({ answered: 0, tested: 8, using: 0, natKind: null, previous, now });
    expect(v.tone).toBe("none");
    expect(v.text).toMatch(/block UDP entirely/);
  });
  it("remembers the last tests for the page's life, with their time", () => {
    forgetTests();
    expect(recallStunTest()).toBeNull();
    rememberStunTest([{ candidate: "stun:a", ok: true, detail: "answered" }], now);
    rememberRelayTest([{ candidate: { id: "x", label: "x", server: { urls: "turn:x" } }, ok: false, detail: "no answer" }], now);
    expect(recallStunTest()?.at).toBe(now);
    expect(recallRelayTest()?.results[0].detail).toBe("no answer");
    forgetTests();
    expect(recallRelayTest()).toBeNull();
  });
  it("says how long ago in plain words", () => {
    expect(agoText(now - 10_000, now)).toBe("just now");
    expect(agoText(now - 3 * 60_000, now)).toBe("3 min ago");
    expect(agoText(now - 2 * 3_600_000, now)).toBe("2 h ago");
  });
});
