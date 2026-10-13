import { describe, it, expect } from "vitest";
import { summarizeRelays, describeRelayHealth } from "./relayHealth";

const OPEN = { readyState: 1 };
const CONNECTING = { readyState: 0 };
const CLOSED = { readyState: 3 };
const CLOSING = { readyState: 2 };

describe("summarizeRelays", () => {
  it("reports every relay with its transport and state", () => {
    const health = summarizeRelays({
      nostr: { "wss://relay.damus.io": OPEN, "wss://nos.lol": CLOSED },
      mqtt: { "wss://broker.emqx.io": CONNECTING },
    });
    expect(health.total).toBe(3);
    expect(health.open).toBe(1);
    expect(health.relays).toContainEqual({
      url: "wss://relay.damus.io",
      transport: "nostr",
      state: "open",
    });
    expect(health.relays).toContainEqual({
      url: "wss://broker.emqx.io",
      transport: "mqtt",
      state: "connecting",
    });
  });

  it("is healthy when every transport has at least one relay up", () => {
    const health = summarizeRelays({
      nostr: { a: OPEN, b: CLOSED },
      mqtt: { c: OPEN },
    });
    expect(health.healthy).toBe(true);
    expect(health.deadTransports).toEqual([]);
  });

  it("flags a transport whose relays have all rotted", () => {
    // The exact shape of this project's three past outages.
    const health = summarizeRelays({
      nostr: { a: CLOSED, b: CLOSED },
      mqtt: { c: OPEN },
    });
    expect(health.healthy).toBe(false);
    expect(health.deadTransports).toEqual(["nostr"]);
  });

  it("is unhealthy when nothing is open anywhere", () => {
    const health = summarizeRelays({ nostr: { a: CLOSED }, mqtt: { b: CLOSING } });
    expect(health.open).toBe(0);
    expect(health.healthy).toBe(false);
  });

  it("counts a closing socket as not usable", () => {
    expect(summarizeRelays({ nostr: { a: CLOSING } }).open).toBe(0);
  });

  it("treats a relay that never produced a socket as down", () => {
    const health = summarizeRelays({ nostr: { a: null, b: undefined, c: OPEN } });
    expect(health.open).toBe(1);
    expect(health.relays.filter((r) => r.state === "closed")).toHaveLength(2);
  });

  it("ignores transports that have no relays configured", () => {
    const health = summarizeRelays({ nostr: { a: OPEN }, torrent: {} });
    expect(health.total).toBe(1);
    expect(health.deadTransports).toEqual([]);
  });

  it("is not healthy before anything has connected", () => {
    const health = summarizeRelays({});
    expect(health.healthy).toBe(false);
    expect(health.total).toBe(0);
  });
});

describe("describeRelayHealth", () => {
  it("names the transports that cannot reach any relay", () => {
    const text = describeRelayHealth(
      summarizeRelays({ nostr: { a: CLOSED }, mqtt: { b: OPEN } }),
    );
    expect(text).toContain("nostr");
    expect(text).toContain("1/2");
  });

  it("stays terse when all is well", () => {
    expect(describeRelayHealth(summarizeRelays({ nostr: { a: OPEN } }))).toBe("1/1 relays up");
  });

  it("says so when nothing has connected yet", () => {
    expect(describeRelayHealth(summarizeRelays({}))).toBe("No relays connected yet");
  });
});
