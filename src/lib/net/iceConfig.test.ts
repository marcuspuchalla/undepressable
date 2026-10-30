import { describe, it, expect } from "vitest";
import {
  STUN_SERVERS,
  parseTurnSpec,
  isValidTurnConfig,
  getRuntimeTurn,
  setRuntimeTurn,
  adoptTurnFromUrl,
  buildIceServers,
  parseIceServersResponse,
  isValidIceUrl,
  fetchIceServers,
  getRelaySetup,
  saveRelaySettings,
  relayShareParams,
  adoptRelayFromUrl,
  setRelaySharingEnabled,
  resolveRtcConfig,
  setForceRelay,
  relayServersOf,
  turnSpecOf,
  isUdpTurnUrl,
  relayServesStun,
  stunUrlOfTurn,
  applyStunPolicy,
  stunSourceOf,
  natProbeServers,
  setPublicStunWithRelay,
} from "./iceConfig";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    dump: () => map,
  };
}

describe("parseTurnSpec", () => {
  it("parses a single turns: url with credentials", () => {
    expect(parseTurnSpec("turns:relay.example.org:443|alice|s3cret")).toEqual({
      urls: ["turns:relay.example.org:443"],
      username: "alice",
      credential: "s3cret",
    });
  });

  it("parses multiple comma-separated urls", () => {
    const c = parseTurnSpec("turn:r.example:3478,turns:r.example:443|u|p");
    expect(c?.urls).toEqual(["turn:r.example:3478", "turns:r.example:443"]);
  });

  it("rejects non-turn urls and malformed specs", () => {
    expect(parseTurnSpec("stun:stun.example|u|p")).toBeNull();
    expect(parseTurnSpec("https://evil.example|u|p")).toBeNull();
    expect(parseTurnSpec("turns:r.example:443|useronly")).toBeNull();
    expect(parseTurnSpec("")).toBeNull();
  });
});

describe("isValidTurnConfig", () => {
  it("accepts a well-formed config", () => {
    expect(isValidTurnConfig({ urls: ["turn:r:3478"], username: "", credential: "" })).toBe(true);
  });

  it("rejects empty urls, wrong schemes, and missing fields", () => {
    expect(isValidTurnConfig({ urls: [], username: "", credential: "" })).toBe(false);
    expect(isValidTurnConfig({ urls: ["wss://x"], username: "", credential: "" })).toBe(false);
    expect(isValidTurnConfig({ urls: ["turn:r"] })).toBe(false);
    expect(isValidTurnConfig(null)).toBe(false);
    expect(isValidTurnConfig("turn:r|u|p")).toBe(false);
  });
});

describe("runtime TURN storage", () => {
  it("round-trips a config and clears it", () => {
    const storage = memoryStorage();
    const config = { urls: ["turns:r:443"], username: "u", credential: "p" };
    expect(setRuntimeTurn(config, storage)).toBe(true);
    expect(getRuntimeTurn(storage)).toEqual(config);
    expect(setRuntimeTurn(null, storage)).toBe(true);
    expect(getRuntimeTurn(storage)).toBeNull();
  });

  it("ignores corrupt or invalid stored values", () => {
    const storage = memoryStorage();
    storage.setItem("undepressable_turn", "not json {");
    expect(getRuntimeTurn(storage)).toBeNull();
    storage.setItem("undepressable_turn", JSON.stringify({ urls: ["https://x"], username: "", credential: "" }));
    expect(getRuntimeTurn(storage)).toBeNull();
  });

  it("refuses to persist an invalid config", () => {
    const storage = memoryStorage();
    expect(setRuntimeTurn({ urls: [], username: "", credential: "" } as any, storage)).toBe(false);
    expect(getRuntimeTurn(storage)).toBeNull();
  });
});

describe("adoptTurnFromUrl", () => {
  it("persists a valid ?turn= param", () => {
    const storage = memoryStorage();
    const adopted = adoptTurnFromUrl("?turn=" + encodeURIComponent("turns:r:443|u|p"), storage);
    expect(adopted?.urls).toEqual(["turns:r:443"]);
    expect(getRuntimeTurn(storage)?.urls).toEqual(["turns:r:443"]);
  });

  it("ignores absent or malformed params without touching storage", () => {
    const storage = memoryStorage();
    expect(adoptTurnFromUrl("?foo=bar", storage)).toBeNull();
    expect(adoptTurnFromUrl("?turn=garbage", storage)).toBeNull();
    expect(getRuntimeTurn(storage)).toBeNull();
  });
});

describe("buildIceServers", () => {
  it("is STUN-only when no TURN is configured (no dead relay defaults)", () => {
    const servers = buildIceServers({}, null);
    expect(servers).toEqual(STUN_SERVERS);
    // The rotted Open Relay TURN must never come back as a silent default.
    expect(JSON.stringify(servers)).not.toContain("openrelay");
  });

  it("uses build-env TURN when set", () => {
    const servers = buildIceServers(
      { VITE_TURN_URL: "turn:a:3478, turns:a:443", VITE_TURN_USERNAME: "u", VITE_TURN_CREDENTIAL: "p" },
      null,
    );
    expect(servers[servers.length - 1]).toEqual({
      urls: ["turn:a:3478", "turns:a:443"],
      username: "u",
      credential: "p",
    });
  });

  it("prefers runtime TURN over build-env TURN", () => {
    const runtime = { urls: ["turns:runtime:443"], username: "ru", credential: "rp" };
    const servers = buildIceServers({ VITE_TURN_URL: "turn:env:3478" }, runtime);
    expect(servers[servers.length - 1]).toEqual({ urls: ["turns:runtime:443"], username: "ru", credential: "rp" });
    expect(JSON.stringify(servers)).not.toContain("turn:env");
  });
});

describe("parseIceServersResponse", () => {
  const turn = { urls: "turn:r.example:3478", username: "u", credential: "p" };

  it("accepts the shapes real providers return", () => {
    expect(parseIceServersResponse([turn])).toEqual([turn]); // Metered
    expect(parseIceServersResponse({ iceServers: [turn] })).toEqual([turn]);
    expect(parseIceServersResponse({ iceServers: { ...turn, urls: [turn.urls, "turns:r.example:443"] } })).toEqual([
      { ...turn, urls: [turn.urls, "turns:r.example:443"] },
    ]); // Cloudflare: a single object
    expect(parseIceServersResponse({ ice_servers: [{ url: "stun:s.example" }] })).toEqual([{ urls: "stun:s.example" }]);
    expect(parseIceServersResponse({ v: { iceServers: [turn] } })).toEqual([turn]); // Xirsys
  });

  it("drops anything that is not a STUN/TURN url", () => {
    expect(parseIceServersResponse([{ urls: ["https://evil.example", "turn:ok:3478"] }])).toEqual([{ urls: "turn:ok:3478" }]);
    expect(parseIceServersResponse([{ urls: "javascript:alert(1)" }, null, 7])).toEqual([]);
    expect(parseIceServersResponse({ nothing: true })).toEqual([]);
    expect(parseIceServersResponse(null)).toEqual([]);
  });
});

describe("isValidIceUrl", () => {
  it("requires https (http only for local testing)", () => {
    expect(isValidIceUrl("https://x.metered.live/api/v1/turn/credentials?apiKey=k")).toBe(true);
    expect(isValidIceUrl("http://localhost:8787/ice")).toBe(true);
    expect(isValidIceUrl("http://relay.example/ice")).toBe(false);
    expect(isValidIceUrl("turn:relay.example")).toBe(false);
    expect(isValidIceUrl("not a url")).toBe(false);
  });
});

describe("fetchIceServers", () => {
  const url = "https://creds.example/ice";
  const servers = [{ urls: "turn:r.example:3478", username: "u", credential: "p" }];
  const ok = (body: unknown) => async () => ({ ok: true, status: 200, json: async () => body }) as any;

  it("fetches, then serves from cache until the TTL passes", async () => {
    const storage = memoryStorage();
    let t = 1000;
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return ok(servers)();
    }) as any;
    expect(await fetchIceServers(url, { fetchImpl, storage, now: () => t })).toEqual(servers);
    expect(await fetchIceServers(url, { fetchImpl, storage, now: () => t })).toEqual(servers);
    expect(calls).toBe(1);
    t += 11 * 60 * 1000;
    await fetchIceServers(url, { fetchImpl, storage, now: () => t });
    expect(calls).toBe(2);
  });

  it("falls back to stale credentials when the endpoint fails", async () => {
    const storage = memoryStorage();
    let t = 0;
    await fetchIceServers(url, { fetchImpl: ok(servers) as any, storage, now: () => t });
    t += 60 * 60 * 1000;
    const failing = (async () => ({ ok: false, status: 503, json: async () => ({}) })) as any;
    expect(await fetchIceServers(url, { fetchImpl: failing, storage, now: () => t })).toEqual(servers);
  });

  it("returns null when nothing usable exists", async () => {
    const storage = memoryStorage();
    const failing = (async () => {
      throw new Error("offline");
    }) as any;
    expect(await fetchIceServers(url, { fetchImpl: failing, storage })).toBeNull();
    expect(await fetchIceServers(url, { fetchImpl: ok({ nope: 1 }) as any, storage })).toBeNull();
  });
});

describe("relay setup, sharing and links", () => {
  const turn = { urls: ["turns:r.example:443"], username: "u", credential: "p" };

  it("reports no relay by default", () => {
    expect(getRelaySetup({}, memoryStorage()).source).toBe("none");
  });

  it("prefers this device's settings over build-time config", () => {
    const storage = memoryStorage();
    const env = { VITE_TURN_URL: "turn:env:3478", VITE_ICE_SERVERS_URL: "https://env.example/ice" };
    expect(getRelaySetup(env, storage)).toMatchObject({ source: "build", iceUrl: "https://env.example/ice" });
    saveRelaySettings({ turn, iceUrl: null }, "settings", storage);
    expect(getRelaySetup(env, storage)).toMatchObject({ source: "runtime", origin: "settings", turn, iceUrl: null });
  });

  it("puts the relay in share links unless the user opted out", () => {
    const storage = memoryStorage();
    saveRelaySettings({ turn, iceUrl: "https://creds.example/ice" }, "settings", storage);
    const setup = getRelaySetup({}, storage);
    expect(relayShareParams(setup, storage)).toEqual({ turn: turnSpecOf(turn), ice: "https://creds.example/ice" });
    setRelaySharingEnabled(false, storage);
    expect(relayShareParams(setup, storage)).toEqual({});
  });

  it("adopts a relay from a link, round-tripping what relayShareParams produced", () => {
    const sender = memoryStorage();
    saveRelaySettings({ turn, iceUrl: "https://creds.example/ice" }, "settings", sender);
    const qs = "?" + new URLSearchParams(relayShareParams(getRelaySetup({}, sender), sender)).toString();

    const receiver = memoryStorage();
    const adopted = adoptRelayFromUrl(qs, receiver);
    expect(adopted).toEqual({ turn, iceUrl: "https://creds.example/ice" });
    expect(getRelaySetup({}, receiver)).toMatchObject({ source: "runtime", origin: "link", turn });
  });

  it("ignores links without (valid) relay params", () => {
    const storage = memoryStorage();
    expect(adoptRelayFromUrl("?ice=http://evil.example/x&turn=junk", storage)).toEqual({ turn: null, iceUrl: null });
    expect(getRelaySetup({}, storage).source).toBe("none");
  });
});

describe("resolveRtcConfig", () => {
  it("never pre-gathers a candidate pool and bundles everything", async () => {
    const config = await resolveRtcConfig({ storage: memoryStorage() });
    expect(config.iceCandidatePoolSize).toBe(0);
    expect(config.bundlePolicy).toBe("max-bundle");
    expect(config.iceTransportPolicy).toBeUndefined();
  });

  it("merges fetched credentials after STUN", async () => {
    const storage = memoryStorage();
    saveRelaySettings({ turn: null, iceUrl: "https://creds.example/ice" }, "settings", storage);
    const fetched = [{ urls: "turn:r.example:3478", username: "u", credential: "p" }];
    const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => fetched })) as any;
    // A fetched UDP relay answers STUN itself: the public servers go.
    let config = await resolveRtcConfig({ storage, fetchImpl });
    expect(config.iceServers).toEqual(fetched);
    setPublicStunWithRelay(true, storage);
    config = await resolveRtcConfig({ storage, fetchImpl });
    expect(config.iceServers?.slice(0, STUN_SERVERS.length)).toEqual(STUN_SERVERS);
    expect(config.iceServers?.at(-1)).toEqual(fetched[0]);
  });

  it("forces relay-only only when a relay exists to force", async () => {
    const storage = memoryStorage();
    setForceRelay(true, storage);
    expect((await resolveRtcConfig({ storage })).iceTransportPolicy).toBeUndefined();
    saveRelaySettings({ turn: { urls: ["turn:r:3478"], username: "u", credential: "p" }, iceUrl: null }, "settings", storage);
    expect((await resolveRtcConfig({ storage })).iceTransportPolicy).toBe("relay");
  });
});

describe("relayServersOf", () => {
  it("keeps only TURN urls", () => {
    expect(
      relayServersOf([
        { urls: "stun:s:3478" },
        { urls: ["stun:x", "turn:t:3478", "turns:t:443"], username: "u", credential: "p" },
      ]),
    ).toEqual([{ urls: ["turn:t:3478", "turns:t:443"], username: "u", credential: "p" }]);
  });
});

describe("STUN from the relay", () => {
  const udp = { urls: ["turn:relay.example.org:3478", "turns:relay.example.org:443"], username: "u", credential: "p" };
  const tlsOnly = { urls: "turns:relay.example.org:443", username: "u", credential: "p" };
  const tcpOnly = { urls: "turn:relay.example.org:443?transport=tcp", username: "u", credential: "p" };

  it("knows which relay addresses answer STUN (UDP turn:)", () => {
    expect(isUdpTurnUrl("turn:h:3478")).toBe(true);
    expect(isUdpTurnUrl("turn:h:3478?transport=udp")).toBe(true);
    expect(isUdpTurnUrl("turn:h:443?transport=tcp")).toBe(false);
    expect(isUdpTurnUrl("turns:h:443")).toBe(false);
    expect(isUdpTurnUrl("stun:h:3478")).toBe(false);
    expect(relayServesStun([...STUN_SERVERS, udp])).toBe(true);
    expect(relayServesStun([...STUN_SERVERS, tlsOnly, tcpOnly])).toBe(false);
    expect(stunUrlOfTurn("turn:relay.example.org:3478?transport=udp")).toBe("stun:relay.example.org:3478");
    expect(stunUrlOfTurn("turns:relay.example.org:443")).toBeNull();
  });

  it("drops every public STUN server once a UDP relay is configured", () => {
    const servers = applyStunPolicy([...STUN_SERVERS, { urls: ["stun:extra:3478"] }, udp], false);
    expect(servers).toEqual([udp]);
    expect(stunSourceOf([...STUN_SERVERS, udp], false)).toBe("relay");
  });

  it("keeps them for a TLS-only relay, or when the user asks for the fallback", () => {
    expect(applyStunPolicy([...STUN_SERVERS, tlsOnly], false)).toEqual([...STUN_SERVERS, tlsOnly]);
    expect(stunSourceOf([...STUN_SERVERS, tlsOnly], false)).toBe("public");
    expect(applyStunPolicy([...STUN_SERVERS, udp], true)).toEqual([...STUN_SERVERS, udp]);
    expect(stunSourceOf([...STUN_SERVERS, udp], true)).toBe("public");
    expect(stunSourceOf([udp], false)).toBe("relay");
    expect(stunSourceOf([tlsOnly], false)).toBe("none");
  });

  it("the NAT check asks the relay alone, or the public servers (plus extras) without one", () => {
    expect(natProbeServers([udp], false)).toEqual([{ urls: ["stun:relay.example.org:3478"] }]);
    expect(natProbeServers([udp], true)).toEqual([{ urls: ["stun:relay.example.org:3478"] }, ...STUN_SERVERS]);
    expect(natProbeServers([tlsOnly], false, ["stun:extra:3478"])).toEqual([...STUN_SERVERS, { urls: ["stun:extra:3478"] }]);
  });

  it("the resolved configuration follows the policy and the setting", async () => {
    const s = memoryStorage();
    saveRelaySettings({ turn: { urls: ["turn:relay.example.org:3478", "turns:relay.example.org:443"], username: "u", credential: "p" }, iceUrl: null }, "settings", s);
    let config = await resolveRtcConfig({ storage: s });
    expect((config.iceServers ?? []).every((x) => !/^stun:/.test(String(x.urls)))).toBe(true);
    expect((config.iceServers ?? []).length).toBe(1);
    setPublicStunWithRelay(true, s);
    config = await resolveRtcConfig({ storage: s });
    expect((config.iceServers ?? []).length).toBe(STUN_SERVERS.length + 1);
  });

  it("the defaults are four servers, none on port 443", () => {
    expect(STUN_SERVERS).toHaveLength(4);
    expect(STUN_SERVERS.every((x) => !/:443$/.test(String(x.urls)))).toBe(true);
    expect(JSON.stringify(STUN_SERVERS)).not.toContain("stun1.l.google.com");
    expect(JSON.stringify(STUN_SERVERS)).not.toContain("nextcloud");
  });
});
