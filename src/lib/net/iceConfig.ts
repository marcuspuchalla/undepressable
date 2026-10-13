// ICE server configuration.
//
// STUN lets peers discover their public address for direct P2P. When both
// peers sit behind strict/symmetric NAT (common on mobile carriers) a direct
// path is impossible and media must be relayed through a TURN server.
//
// We deliberately ship NO default TURN server. The free "Open Relay Project"
// TURN this app used to bundle is dead (its hostname now serves HTTP 502), and
// a dead TURN server is worse than none: Trystero waits for ICE gathering to
// finish before sending each offer/answer, so an unreachable TURN adds ~5s of
// latency to every single connection attempt — while providing no relay at all.
//
// A relay can be supplied as static credentials or as a *credentials URL* —
// an HTTPS endpoint that returns short-lived ICE servers (Metered, Cloudflare,
// a coturn REST shim, …). Either can come from (highest precedence first):
//   1. Runtime: this device's settings (the Network page), or a share link
//      (`?turn=` / `?ice=`) so an organizer can hand out a working relay
//      together with the room code.
//   2. Build time: VITE_TURN_URL / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL,
//      VITE_ICE_SERVERS_URL.
//   3. Not at all — direct P2P only (STUN), the honest default.
//
// Why a relay matters so much: two devices that are *both* behind strict NAT
// — a VPN exit and a mobile carrier is the textbook pair — cannot connect
// directly, whatever the app does. Only a relay crosses that gap.
//
// Prefer `turns:` on port 443: TLS-wrapped TURN is the only variant that
// survives networks which block UDP and non-HTTPS ports (DPI, hotel/corporate
// firewalls, hostile infrastructure).

import { getPublicRelays, getExtraStun } from "./publicRelays";
import { isBlendIn, blendInConfig, blendInApplies } from "./blendIn";

const TURN_STORAGE_KEY = "undepressable_turn";

export interface TurnConfig {
  urls: string[];
  username: string;
  credential: string;
}

// STUN diversity matters on censored networks: Google is blocked in several
// countries, so we also carry Cloudflare and Nextcloud (the latter answers on
// 443, which survives some UDP-hostile networks). All probed alive 2026-07-18.
export const STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:stun.nextcloud.com:443" },
];

function isTurnUrl(url: string): boolean {
  return /^turns?:/.test(url.trim());
}

/** Parse a compact TURN spec: "url[,url...]|username|credential". */
export function parseTurnSpec(spec: string): TurnConfig | null {
  const parts = spec.split("|");
  if (parts.length !== 3) return null;
  const urls = parts[0]
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  if (urls.length === 0 || !urls.every(isTurnUrl)) return null;
  return { urls, username: parts[1], credential: parts[2] };
}

export function isValidTurnConfig(value: unknown): value is TurnConfig {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.urls) &&
    v.urls.length > 0 &&
    v.urls.every((u) => typeof u === "string" && isTurnUrl(u)) &&
    typeof v.username === "string" &&
    typeof v.credential === "string"
  );
}

export function getRuntimeTurn(storage: Pick<Storage, "getItem"> = localStorage): TurnConfig | null {
  try {
    const raw = storage.getItem(TURN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidTurnConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function setRuntimeTurn(
  config: TurnConfig | null,
  storage: Pick<Storage, "setItem" | "removeItem"> = localStorage,
): boolean {
  try {
    if (config === null) {
      storage.removeItem(TURN_STORAGE_KEY);
      return true;
    }
    if (!isValidTurnConfig(config)) return false;
    storage.setItem(TURN_STORAGE_KEY, JSON.stringify(config));
    return true;
  } catch {
    return false;
  }
}

/** Read a `?turn=urls|user|pass` param and persist it, so a shared link can carry a relay. */
export function adoptTurnFromUrl(
  search: string = typeof location !== "undefined" ? location.search : "",
  storage: Pick<Storage, "setItem" | "removeItem"> = localStorage,
): TurnConfig | null {
  try {
    const spec = new URLSearchParams(search).get("turn");
    if (!spec) return null;
    const config = parseTurnSpec(spec);
    if (config) setRuntimeTurn(config, storage);
    return config;
  } catch {
    return null;
  }
}

function envTurn(env: Record<string, string | undefined>): TurnConfig | null {
  if (!env.VITE_TURN_URL) return null;
  const urls = String(env.VITE_TURN_URL)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (urls.length === 0) return null;
  return { urls, username: env.VITE_TURN_USERNAME ?? "", credential: env.VITE_TURN_CREDENTIAL ?? "" };
}

/** Assemble the ICE server list: STUN always, plus the highest-precedence TURN if any. */
export function buildIceServers(
  env: Record<string, string | undefined>,
  runtimeTurn: TurnConfig | null,
): RTCIceServer[] {
  const turn = runtimeTurn ?? envTurn(env);
  return turn
    ? [...STUN_SERVERS, { urls: turn.urls, username: turn.username, credential: turn.credential }]
    : [...STUN_SERVERS];
}


// --- credentials URL (short-lived ICE servers fetched over HTTPS) ---

const ICE_URL_KEY = "undepressable_ice_url";
const ICE_CACHE_KEY = "undepressable_ice_cache";
const RELAY_ORIGIN_KEY = "undepressable_relay_origin";
const SHARE_KEY = "undepressable_relay_share";
const FORCE_RELAY_KEY = "undepressable_force_relay";

/** Default lifetime for fetched credentials when the provider does not say. */
const ICE_CACHE_TTL_MS = 10 * 60 * 1000;
/** Joining must not hang on a slow credentials endpoint. */
const ICE_FETCH_TIMEOUT_MS = 4000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function safeStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Credentials endpoints must be HTTPS (plain http is allowed only for local testing). */
export function isValidIceUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

function isIceUrlString(u: unknown): u is string {
  return typeof u === "string" && /^(stun|stuns|turn|turns):/i.test(u.trim());
}

function normalizeServer(raw: unknown): RTCIceServer | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const rawUrls = r.urls ?? r.url;
  const urls = (Array.isArray(rawUrls) ? rawUrls : [rawUrls]).filter(isIceUrlString).map((u) => u.trim());
  if (urls.length === 0) return null;
  const server: RTCIceServer = { urls: urls.length === 1 ? urls[0] : urls };
  if (typeof r.username === "string") server.username = r.username;
  if (typeof r.credential === "string") server.credential = r.credential;
  return server;
}

/**
 * Accept the response shapes real providers return: a bare array (Metered),
 * `{iceServers: [...]}` or `{iceServers: {...}}` (Cloudflare), `{ice_servers}`
 * (Twilio-style proxies), `{v: {iceServers}}` (Xirsys). Anything that is not a
 * STUN/TURN url is dropped.
 */
export function parseIceServersResponse(json: unknown): RTCIceServer[] {
  let list: unknown = json;
  if (list && typeof list === "object" && !Array.isArray(list)) {
    const o = list as Record<string, any>;
    list = o.iceServers ?? o.ice_servers ?? o.v?.iceServers ?? null;
  }
  const items = Array.isArray(list) ? list : list ? [list] : [];
  return items.map(normalizeServer).filter((s): s is RTCIceServer => s !== null);
}

export function getRuntimeIceUrl(storage: Pick<Storage, "getItem"> | null = safeStorage()): string | null {
  try {
    const url = storage?.getItem(ICE_URL_KEY);
    return url && isValidIceUrl(url) ? url : null;
  } catch {
    return null;
  }
}

export function setRuntimeIceUrl(url: string | null, storage: StorageLike | null = safeStorage()): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(ICE_CACHE_KEY);
    if (url === null) {
      storage.removeItem(ICE_URL_KEY);
      return true;
    }
    if (!isValidIceUrl(url)) return false;
    storage.setItem(ICE_URL_KEY, url.trim());
    return true;
  } catch {
    return false;
  }
}

interface IceCache {
  url: string;
  servers: RTCIceServer[];
  expiresAt: number;
}

function readCache(storage: StorageLike | null, url: string): IceCache | null {
  try {
    const raw = storage?.getItem(ICE_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as IceCache;
    return c && c.url === url && Array.isArray(c.servers) ? c : null;
  } catch {
    return null;
  }
}

export interface FetchIceOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  storage?: StorageLike | null;
  now?: () => number;
}

/**
 * Fetch ICE servers from a credentials URL, with a short timeout and a cache.
 * On failure a stale cached answer is still better than none: many providers
 * issue credentials valid for hours, far longer than our cache TTL.
 */
export async function fetchIceServers(url: string, opts: FetchIceOptions = {}): Promise<RTCIceServer[] | null> {
  const storage = opts.storage === undefined ? safeStorage() : opts.storage;
  const now = opts.now ?? (() => Date.now());
  const cached = readCache(storage, url);
  if (cached && cached.expiresAt > now()) return cached.servers;

  const doFetch = opts.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : null);
  if (!doFetch || !isValidIceUrl(url)) return cached?.servers ?? null;

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), opts.timeoutMs ?? ICE_FETCH_TIMEOUT_MS);
  try {
    const res = await doFetch(url, { signal: controller?.signal, cache: "no-store", credentials: "omit" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const servers = parseIceServersResponse(json);
    if (servers.length === 0) throw new Error("no ICE servers in response");
    const ttlSec = typeof (json as any)?.ttl === "number" ? (json as any).ttl : null;
    const ttlMs = ttlSec ? Math.min(ttlSec * 1000 * 0.8, ICE_CACHE_TTL_MS) : ICE_CACHE_TTL_MS;
    try {
      storage?.setItem(ICE_CACHE_KEY, JSON.stringify({ url, servers, expiresAt: now() + ttlMs }));
    } catch {
      /* storage full or blocked — use the answer uncached */
    }
    return servers;
  } catch (err) {
    console.warn("[ice] Could not fetch relay credentials:", (err as Error)?.message ?? err);
    return cached?.servers ?? null;
  } finally {
    clearTimeout(timer);
  }
}

// --- where the relay came from, and whether to pass it on ---

export type RelayOrigin = "link" | "settings";

export interface RelaySetup {
  /** runtime = this device (settings or an adopted link); build = baked into this build. */
  source: "runtime" | "build" | "none";
  origin: RelayOrigin | null;
  turn: TurnConfig | null;
  iceUrl: string | null;
  /** Free public relays the user opted into (tested on their network; never shared in links). */
  publicServers: RTCIceServer[];
}

export function getRelaySetup(
  env: Record<string, string | undefined> = viteEnv(),
  storage: StorageLike | null = safeStorage(),
): RelaySetup {
  const turn = storage ? getRuntimeTurn(storage) : null;
  const iceUrl = getRuntimeIceUrl(storage);
  if (turn || iceUrl) {
    let origin: RelayOrigin | null = null;
    try {
      origin = storage?.getItem(RELAY_ORIGIN_KEY) === "link" ? "link" : "settings";
    } catch {
      origin = "settings";
    }
    return { source: "runtime", origin, turn, iceUrl, publicServers: getPublicRelays(storage) };
  }
  const envIce = env.VITE_ICE_SERVERS_URL && isValidIceUrl(env.VITE_ICE_SERVERS_URL) ? env.VITE_ICE_SERVERS_URL : null;
  const eTurn = envTurn(env);
  const publicServers = getPublicRelays(storage);
  if (eTurn || envIce) return { source: "build", origin: null, turn: eTurn, iceUrl: envIce, publicServers };
  return { source: "none", origin: null, turn: null, iceUrl: null, publicServers };
}

export function hasRelay(setup: RelaySetup = getRelaySetup()): boolean {
  return setup.source !== "none" || setup.publicServers.length > 0;
}

/** Save relay settings entered on this device (replaces whatever was there). */
export function saveRelaySettings(
  settings: { turn: TurnConfig | null; iceUrl: string | null },
  origin: RelayOrigin = "settings",
  storage: StorageLike | null = safeStorage(),
): boolean {
  if (!storage) return false;
  if (settings.turn && !isValidTurnConfig(settings.turn)) return false;
  if (settings.iceUrl && !isValidIceUrl(settings.iceUrl)) return false;
  const ok = setRuntimeTurn(settings.turn, storage) && setRuntimeIceUrl(settings.iceUrl, storage);
  try {
    if (settings.turn || settings.iceUrl) storage.setItem(RELAY_ORIGIN_KEY, origin);
    else storage.removeItem(RELAY_ORIGIN_KEY);
  } catch {
    /* origin is cosmetic */
  }
  return ok;
}

export function isRelaySharingEnabled(storage: Pick<Storage, "getItem"> | null = safeStorage()): boolean {
  try {
    return storage?.getItem(SHARE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setRelaySharingEnabled(enabled: boolean, storage: StorageLike | null = safeStorage()): void {
  try {
    if (enabled) storage?.removeItem(SHARE_KEY);
    else storage?.setItem(SHARE_KEY, "0");
  } catch {
    /* ignore */
  }
}

/**
 * Relay-only mode: every connection goes through the relay, so the people you
 * connect to see the relay's address instead of yours. Costs latency and relay
 * bandwidth, and does nothing without a relay configured.
 */
export function isForceRelay(storage: Pick<Storage, "getItem"> | null = safeStorage()): boolean {
  try {
    return storage?.getItem(FORCE_RELAY_KEY) === "1";
  } catch {
    return false;
  }
}

export function setForceRelay(enabled: boolean, storage: StorageLike | null = safeStorage()): void {
  try {
    if (enabled) storage?.setItem(FORCE_RELAY_KEY, "1");
    else storage?.removeItem(FORCE_RELAY_KEY);
  } catch {
    /* ignore */
  }
}

export function turnSpecOf(turn: TurnConfig): string {
  return `${turn.urls.join(",")}|${turn.username}|${turn.credential}`;
}

/**
 * Query params that carry this device's relay to whoever opens a share link,
 * so the watcher needs no setup. One side having a relay is already enough to
 * cross two strict NATs; both having it gives ICE more paths to choose from.
 */
export function relayShareParams(
  setup: RelaySetup = getRelaySetup(),
  storage: Pick<Storage, "getItem"> | null = safeStorage(),
): Record<string, string> {
  if (!isRelaySharingEnabled(storage) || setup.source === "none") return {};
  const params: Record<string, string> = {};
  if (setup.turn) params.turn = turnSpecOf(setup.turn);
  if (setup.iceUrl) params.ice = setup.iceUrl;
  return params;
}

/** Adopt `?turn=` and/or `?ice=` from a share link, persisting them on this device. */
export function adoptRelayFromUrl(
  search: string = typeof location !== "undefined" ? location.search : "",
  storage: StorageLike | null = safeStorage(),
): { turn: TurnConfig | null; iceUrl: string | null } {
  if (!storage) return { turn: null, iceUrl: null };
  let turn: TurnConfig | null = null;
  let iceUrl: string | null = null;
  try {
    const params = new URLSearchParams(search);
    const spec = params.get("turn");
    if (spec) turn = parseTurnSpec(spec);
    const ice = params.get("ice");
    if (ice && isValidIceUrl(ice)) iceUrl = ice;
  } catch {
    return { turn: null, iceUrl: null };
  }
  if (turn || iceUrl) {
    // A link replaces the whole relay setup: mixing an old TURN with a new
    // credentials URL would leave the user unsure which one is in use.
    saveRelaySettings({ turn, iceUrl }, "link", storage);
  }
  return { turn, iceUrl };
}

function viteEnv(): Record<string, string | undefined> {
  return ((import.meta as any).env ?? {}) as Record<string, string | undefined>;
}

function dedupeServers(servers: RTCIceServer[]): RTCIceServer[] {
  const seen = new Set<string>();
  return servers.filter((s) => {
    const key = JSON.stringify([s.urls, s.username ?? "", s.credential ?? ""]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** STUN (defaults + any extra the user opted into), own TURN, then public relays. */
function baseServers(setup: RelaySetup, storage: StorageLike | null): RTCIceServer[] {
  const servers: RTCIceServer[] = [...STUN_SERVERS];
  const extra = getExtraStun(storage);
  if (extra.length > 0) servers.push({ urls: extra });
  if (setup.turn) servers.push({ urls: setup.turn.urls, username: setup.turn.username, credential: setup.turn.credential });
  servers.push(...setup.publicServers);
  return servers;
}

function baseRtcConfig(iceServers: RTCIceServer[], forceRelay: boolean): RTCConfiguration {
  const hasTurn = iceServers.some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => /^turns?:/i.test(u)));
  return {
    iceServers,
    // Trystero already pre-builds a pool of 20 offers per transport and waits
    // for each to finish gathering. A candidate pool on top made every one of
    // those connections gather 10× — hundreds of STUN requests (and, with a
    // relay configured, hundreds of TURN allocations) the moment a room opens.
    iceCandidatePoolSize: 0,
    // Everything rides one transport: fewer candidates to gather and check,
    // one relay allocation per connection instead of one per media line.
    bundlePolicy: "max-bundle",
    ...(forceRelay && hasTurn ? { iceTransportPolicy: "relay" as RTCIceTransportPolicy } : {}),
  };
}

/**
 * The RTCConfiguration to hand Trystero, synchronously. Uses cached
 * credentials from a credentials URL if we have them; prefer
 * `resolveRtcConfig()` on the join path so a fresh fetch can happen.
 */
export function getRtcConfig(): RTCConfiguration {
  const env = viteEnv();
  const storage = safeStorage();
  const setup = getRelaySetup(env, storage);
  const servers = baseServers(setup, storage);
  if (setup.iceUrl) servers.push(...(readCache(storage, setup.iceUrl)?.servers ?? []));
  return finishRtcConfig(baseRtcConfig(dedupeServers(servers), isForceRelay(storage)), storage);
}

// Blend in (lib/net/blendIn.ts): only a TLS relay, relay candidates only. If
// nothing qualifies the ordinary configuration stands — the setting cannot
// make a connection impossible, only quieter.
function finishRtcConfig(config: RTCConfiguration, storage: StorageLike | null): RTCConfiguration {
  return isBlendIn(storage) && blendInApplies(config) ? blendInConfig(config) : config;
}

/** Like getRtcConfig, but fetches credentials from a credentials URL first. */
export async function resolveRtcConfig(opts: FetchIceOptions = {}): Promise<RTCConfiguration> {
  const env = viteEnv();
  const storage = opts.storage === undefined ? safeStorage() : opts.storage;
  const setup = getRelaySetup(env, storage);
  const servers = baseServers(setup, storage);
  if (setup.iceUrl) servers.push(...((await fetchIceServers(setup.iceUrl, { ...opts, storage })) ?? []));
  return finishRtcConfig(baseRtcConfig(dedupeServers(servers), isForceRelay(storage)), storage);
}

/** Just the relay (TURN) entries of a server list — for relay self-tests. */
export function relayServersOf(servers: RTCIceServer[]): RTCIceServer[] {
  const out: RTCIceServer[] = [];
  for (const s of servers) {
    const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => /^turns?:/i.test(u));
    if (urls.length > 0) out.push({ ...s, urls });
  }
  return out;
}
