import { describe, it, expect } from "vitest";
import {
  normalizeRelayUrl,
  parseRelayList,
  getCustomRelays,
  setCustomRelays,
  isCustomRelaysOnly,
  setCustomRelaysOnly,
  planDiscovery,
  discoveryShareParams,
  adoptDiscoveryFromUrl,
} from "./discoveryConfig";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("normalizeRelayUrl", () => {
  it("adds wss://, strips trailing slashes, keeps paths", () => {
    expect(normalizeRelayUrl("relay.example.org")).toBe("wss://relay.example.org");
    expect(normalizeRelayUrl("wss://relay.example.org/")).toBe("wss://relay.example.org");
    expect(normalizeRelayUrl("wss://host.example/nostr/")).toBe("wss://host.example/nostr");
  });

  it("allows plain ws:// only to this machine", () => {
    expect(normalizeRelayUrl("ws://localhost:7777")).toBe("ws://localhost:7777");
    expect(normalizeRelayUrl("ws://relay.example.org")).toBeNull();
    expect(normalizeRelayUrl("https://relay.example.org")).toBeNull();
    expect(normalizeRelayUrl("")).toBeNull();
  });
});

describe("parseRelayList", () => {
  it("splits on commas/whitespace and dedupes", () => {
    expect(parseRelayList("a.example, wss://a.example\nb.example  junk://x")).toEqual(["wss://a.example", "wss://b.example"]);
  });
});

describe("storage and planning", () => {
  it("round-trips custom relays and the only-mode flag", () => {
    const s = memoryStorage();
    expect(isCustomRelaysOnly(s)).toBe(false);
    setCustomRelays(["mine.example"], s);
    setCustomRelaysOnly(true, s);
    expect(getCustomRelays(s)).toEqual(["wss://mine.example"]);
    expect(isCustomRelaysOnly(s)).toBe(true);
    setCustomRelays([], s);
    expect(isCustomRelaysOnly(s)).toBe(false); // "only" with nothing configured would find no one
  });

  it("puts custom relays first and keeps public ones as fallback", () => {
    expect(planDiscovery(["wss://pub1", "wss://mine"], ["wss://mine"], false)).toEqual({
      nostrRelays: ["wss://mine", "wss://pub1"],
      usePublicTransports: true,
    });
  });

  it("only-mode drops every public transport", () => {
    expect(planDiscovery(["wss://pub1"], ["wss://mine"], true)).toEqual({ nostrRelays: ["wss://mine"], usePublicTransports: false });
    expect(planDiscovery(["wss://pub1"], [], true).usePublicTransports).toBe(true);
  });
});

describe("share links", () => {
  it("carries custom relays and adds them on the receiving device", () => {
    const sender = memoryStorage();
    setCustomRelays(["mine.example"], sender);
    const qs = "?" + new URLSearchParams(discoveryShareParams(sender)).toString();

    const receiver = memoryStorage();
    setCustomRelays(["theirs.example"], receiver);
    expect(adoptDiscoveryFromUrl(qs, receiver)).toEqual(["wss://mine.example"]);
    expect(getCustomRelays(receiver)).toEqual(["wss://mine.example", "wss://theirs.example"]);
    expect(isCustomRelaysOnly(receiver)).toBe(false);
  });

  it("ignores links without valid relays", () => {
    const s = memoryStorage();
    expect(adoptDiscoveryFromUrl("?relays=http://x", s)).toEqual([]);
    expect(adoptDiscoveryFromUrl("?foo=1", s)).toEqual([]);
    expect(discoveryShareParams(s)).toEqual({});
  });
});
