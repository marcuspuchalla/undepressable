import { describe, it, expect, vi } from "vitest";
import {
  compiledRelays,
  statusUrl,
  builtinServers,
  builtinRelaysEnabled,
  setBuiltinRelaysEnabled,
  checkBuiltinRelays,
  parseStatus,
  lastCheck,
  FETCHED_TTL_MS,
} from "./builtinRelays";

const NOW = Date.UTC(2026, 10, 20, 12);
const FMP = { id: "fmp", label: "Undepressable relay", server: { urls: ["turn:turn.example:3478"], username: "u", credential: "p" } };
const ET = { id: "expressturn", label: "ExpressTURN", server: { urls: ["turn:free.expressturn.com:3478"], username: "e", credential: "q" } };
const env = { VITE_BUILTIN_RELAYS: JSON.stringify([FMP, ET]), VITE_RELAY_STATUS_URL: "https://status.example/" };

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

const answer = (relays: unknown[]) => ({ ok: true, status: 200, json: async () => ({ month: "2026-11", relays }) }) as unknown as Response;
const verdict = (id: string, active: boolean, extra: Record<string, unknown> = {}) => ({
  id, label: id, active, reason: active ? null : "monthly limit reached", usedGB: 1, limitGB: 20, resetsAt: "2026-12-01T00:00:00.000Z", ...extra,
});

describe("compiled relays", () => {
  it("reads the build's list and ignores malformed entries", () => {
    expect(compiledRelays(env).map((r) => r.id)).toEqual(["fmp", "expressturn"]);
    expect(compiledRelays({ VITE_BUILTIN_RELAYS: '[{"id":"x"}, 5]' })).toEqual([]);
    expect(compiledRelays({ VITE_BUILTIN_RELAYS: "not json" })).toEqual([]);
    expect(compiledRelays({})).toEqual([]);
  });

  it("only accepts an https status address", () => {
    expect(statusUrl(env)).toBe("https://status.example");
    expect(statusUrl({ VITE_RELAY_STATUS_URL: "http://status.example" })).toBeNull();
  });
});

describe("builtinServers", () => {
  it("uses every compiled relay by default, with no request made", () => {
    expect(builtinServers(env, memory(), NOW)).toEqual([FMP.server, ET.server]);
  });

  it("uses none when the person turned them off", () => {
    const s = memory();
    setBuiltinRelaysEnabled(false, s);
    expect(builtinRelaysEnabled(s)).toBe(false);
    expect(builtinServers(env, s, NOW)).toEqual([]);
    setBuiltinRelaysEnabled(true, s);
    expect(builtinServers(env, s, NOW)).toHaveLength(2);
  });
});

describe("checkBuiltinRelays", () => {
  it("makes exactly one request, without cookies or referrer", async () => {
    const fetchFn = vi.fn(async () => answer([verdict("fmp", true)]));
    await checkBuiltinRelays(env, memory(), fetchFn as unknown as typeof fetch, NOW);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://status.example/v1/relays");
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
  });

  it("skips a relay over its limit until its month ends", async () => {
    const s = memory();
    await checkBuiltinRelays(env, s, (async () => answer([verdict("fmp", false), verdict("expressturn", true)])) as unknown as typeof fetch, NOW);
    expect(builtinServers(env, s, NOW)).toEqual([ET.server]);
    expect(builtinServers(env, s, Date.UTC(2026, 11, 1, 0, 1))).toEqual([FMP.server, ET.server]);
  });

  it("adds a relay only a check can bring (Cloudflare), and drops it when its credentials age", async () => {
    const s = memory();
    const cf = { urls: ["turns:turn.cloudflare.com:443?transport=tcp"], username: "cf", credential: "x" };
    await checkBuiltinRelays(env, s, (async () => answer([verdict("cloudflare", true, { iceServers: [cf] })])) as unknown as typeof fetch, NOW);
    expect(builtinServers(env, s, NOW)).toContainEqual(cf);
    expect(builtinServers(env, s, NOW + FETCHED_TTL_MS + 1)).not.toContainEqual(cf);
  });

  it("prefers fresher credentials from a check over compiled ones", async () => {
    const s = memory();
    const rotated = { urls: ["turn:free.expressturn.com:3478"], username: "e2", credential: "q2" };
    await checkBuiltinRelays(env, s, (async () => answer([verdict("expressturn", true, { iceServers: [rotated] })])) as unknown as typeof fetch, NOW);
    expect(builtinServers(env, s, NOW)).toEqual([FMP.server, rotated]);
  });

  it("says why when the service is unreachable, and changes nothing", async () => {
    const s = memory();
    const r = await checkBuiltinRelays(env, s, (async () => { throw new Error("offline"); }) as unknown as typeof fetch, NOW);
    expect(r.ok).toBe(false);
    expect(lastCheck(s)).toBeNull();
    expect(builtinServers(env, s, NOW)).toHaveLength(2);
  });

  it("refuses when the build has no status service", async () => {
    const r = await checkBuiltinRelays({}, memory(), vi.fn() as unknown as typeof fetch, NOW);
    expect(r).toEqual({ ok: false, error: "This copy of the app has no relay status service." });
  });
});

describe("parseStatus", () => {
  it("never takes credentials for an inactive relay", () => {
    const p = parseStatus({ relays: [verdict("fmp", false, { iceServers: [FMP.server] })] });
    expect(p?.servers).toEqual({});
  });

  it("drops entries that are not relay servers", () => {
    const p = parseStatus({ relays: [verdict("fmp", true, { iceServers: [{ urls: "https://evil.example" }, FMP.server] })] });
    expect(p?.servers.fmp).toEqual([FMP.server]);
  });

  it("refuses a non-answer", () => {
    expect(parseStatus({})).toBeNull();
  });
});
