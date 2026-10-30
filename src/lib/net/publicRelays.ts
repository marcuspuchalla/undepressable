// Free public relays and extra STUN servers — opt-in, tested before use.
//
// A strict network (a VPN exit, a mobile carrier's CGNAT) needs a relay to
// reach another strict network. People without a relay of their own can try
// free public ones, but those are run by third parties, come and go without
// notice (freeturn.net vanished from DNS; the Open Relay Project's free TURN
// died in 2026) and nobody can promise they work. So nothing here is used
// until the user asks, and every candidate is tested *on the user's own
// network* first; only the ones that answered are kept.
//
// STUN is a different, smaller problem: it only tells a device its public
// address, which cannot connect two strict NATs. It matters when the usual
// STUN servers are unreachable (blocked by a VPN, a censor, a firewall) —
// then even easy NATs cannot be crossed. A few more servers in other
// jurisdictions and on other ports often get through.

import type { NatKind } from "./natProbe";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface PublicRelayCandidate {
  id: string;
  /** Who is behind it, as far as anyone knows — shown to the user. */
  label: string;
  /** The addresses; username and password when they are fixed. */
  server: RTCIceServer;
  /**
   * A relay that publishes its shared secret instead of a password: the
   * credentials are minted here (TURN REST API — username `expiry:name`,
   * password = base64(HMAC-SHA1(secret, username))) and expire.
   */
  sharedSecret?: string;
}

/**
 * The one shared public relay still known to answer in October 2026
 * (docs/STUN_RESEARCH.md): Metered's Open Relay Project publishes a shared
 * secret for a 20 GB-a-month pool everyone draws on. The volunteer relays
 * listed before (freestun.net, relay.backups.cz) could not be verified to
 * exist any more. Best-effort: the in-app test is the authority.
 */
export const PUBLIC_RELAY_CANDIDATES: PublicRelayCandidate[] = [
  {
    id: "openrelay-static",
    label: "Open Relay Project (Metered; a 20 GB/month pool shared by everyone)",
    server: {
      urls: [
        "turn:staticauth.openrelay.metered.ca:80",
        "turn:staticauth.openrelay.metered.ca:443",
        "turn:staticauth.openrelay.metered.ca:443?transport=tcp",
        "turns:staticauth.openrelay.metered.ca:443",
      ],
    },
    sharedSecret: "openrelayprojectsecret",
  },
];

/** Minted credentials are good this long; refreshed when a quarter is left. */
export const MINTED_TTL_MS = 24 * 3600_000;

/** base64(HMAC-SHA1(secret, message)) — the TURN REST API's password. */
export async function turnRestPassword(secret: string, username: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(username));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/** A stored public relay: the server, and when minted credentials expire. */
export interface StoredPublicRelay extends RTCIceServer {
  mintedFrom?: string;
  expires?: number;
}

/** The candidate's server with credentials: its fixed ones, or ones minted now. */
export async function credentialsFor(c: PublicRelayCandidate, now = Date.now()): Promise<StoredPublicRelay> {
  if (!c.sharedSecret) return { ...c.server };
  const expires = now + MINTED_TTL_MS;
  const username = `${Math.floor(expires / 1000)}:undepressable`;
  return { urls: c.server.urls, username, credential: await turnRestPassword(c.sharedSecret, username), mintedFrom: c.id, expires };
}

/**
 * STUN servers beyond the defaults, for networks that block the usual ones.
 * From Tor's 2026 Snowflake list (minus the two that geoblock Russia and
 * China) and the hourly-tested list at github.com/pradt2/always-online-stun,
 * spread across operators and countries; all on 3478 (docs/STUN_RESEARCH.md).
 */
export const EXTRA_STUN_CANDIDATES: string[] = [
  "stun:stun.m-online.net:3478",
  "stun:stun.hot-chilli.net:3478",
  "stun:stun.fitauto.ru:3478",
  "stun:stun.uls.co.za:3478",
  "stun:stun.t-online.de:3478",
  "stun:stun.linphone.org:3478",
  "stun:relay.webwormhole.io:3478",
  "stun:global.stun.twilio.com:3478",
];

/** A fresh list, maintained and re-tested every hour by a third party. */
export const FRESH_STUN_LIST_URL = "https://raw.githubusercontent.com/pradt2/always-online-stun/master/valid_hosts.txt";

const PUBLIC_RELAYS_KEY = "undepressable_public_relays";
const EXTRA_STUN_KEY = "undepressable_extra_stun";
/** More servers only slow gathering down; a handful that answered is plenty. */
const MAX_EXTRA_STUN = 4;

function safeStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function isIceServer(v: unknown): v is RTCIceServer {
  if (!v || typeof v !== "object") return false;
  const urls = (v as RTCIceServer).urls;
  const list = Array.isArray(urls) ? urls : [urls];
  return list.length > 0 && list.every((u) => typeof u === "string" && /^(stun|turns?):/i.test(u));
}

/** Public relays the user opted into and that passed the test. */
export function getPublicRelays(storage: Pick<Storage, "getItem"> | null = safeStorage()): StoredPublicRelay[] {
  try {
    const raw = storage?.getItem(PUBLIC_RELAYS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isIceServer) : [];
  } catch {
    return [];
  }
}

export function setPublicRelays(servers: StoredPublicRelay[], storage: StorageLike | null = safeStorage()): void {
  try {
    const clean = servers.filter(isIceServer);
    if (clean.length === 0) storage?.removeItem(PUBLIC_RELAYS_KEY);
    else storage?.setItem(PUBLIC_RELAYS_KEY, JSON.stringify(clean));
  } catch {
    /* storage blocked */
  }
}

/** Re-mint credentials of stored public relays that are about to expire. */
export async function refreshMintedRelays(storage: StorageLike | null = safeStorage(), now = Date.now()): Promise<boolean> {
  const stored = getPublicRelays(storage);
  let changed = false;
  const fresh: StoredPublicRelay[] = [];
  for (const s of stored) {
    const c = s.mintedFrom ? PUBLIC_RELAY_CANDIDATES.find((x) => x.id === s.mintedFrom) : undefined;
    if (c && (s.expires ?? 0) - now < MINTED_TTL_MS / 4) {
      fresh.push(await credentialsFor(c, now));
      changed = true;
    } else fresh.push(s);
  }
  if (changed) setPublicRelays(fresh, storage);
  return changed;
}

export function getExtraStun(storage: Pick<Storage, "getItem"> | null = safeStorage()): string[] {
  try {
    const raw = storage?.getItem(EXTRA_STUN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((u) => typeof u === "string" && /^stun:/i.test(u)).slice(0, MAX_EXTRA_STUN) : [];
  } catch {
    return [];
  }
}

export function setExtraStun(urls: string[], storage: StorageLike | null = safeStorage()): void {
  try {
    const clean = urls.filter((u) => /^stun:/i.test(u)).slice(0, MAX_EXTRA_STUN);
    if (clean.length === 0) storage?.removeItem(EXTRA_STUN_KEY);
    else storage?.setItem(EXTRA_STUN_KEY, JSON.stringify(clean));
  } catch {
    /* storage blocked */
  }
}

/** Parse always-online-stun's `host:port` lines into stun: URLs. */
export function parseStunList(text: string): string[] {
  const out: string[] = [];
  for (const line of (text ?? "").split(/\r?\n/)) {
    const m = /^([a-z0-9.-]+\.[a-z]{2,}):(\d{1,5})$/i.exec(line.trim());
    if (!m || Number(m[2]) > 65535) continue;
    const url = `stun:${m[1].toLowerCase()}:${m[2]}`;
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

/** Pick `n` entries spread across the list, so one operator's outage isn't all of them. */
export function spreadPick<T>(list: T[], n: number, seed = Math.random()): T[] {
  if (list.length <= n) return [...list];
  const start = Math.floor(seed * list.length);
  const step = list.length / n;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(list[(start + Math.floor(i * step)) % list.length]);
  return out;
}

export interface CandidateResult<T> {
  candidate: T;
  ok: boolean;
  detail: string;
}

/** Test candidates in parallel with an injectable tester (browser: natProbe). */
export async function testAll<T>(
  candidates: T[],
  test: (c: T) => Promise<{ ok: boolean; detail: string }>,
): Promise<CandidateResult<T>[]> {
  return Promise.all(
    candidates.map(async (candidate) => {
      try {
        const r = await test(candidate);
        return { candidate, ok: r.ok, detail: r.detail };
      } catch (err) {
        return { candidate, ok: false, detail: (err as Error)?.message ?? "test failed" };
      }
    }),
  );
}

/**
 * Development-only override of the candidate list (the E2E harness points it
 * at a local TURN server). Ignored in production builds.
 */
export function relayCandidates(storage: Pick<Storage, "getItem"> | null = safeStorage()): PublicRelayCandidate[] {
  if (!(import.meta as any).env?.DEV) return PUBLIC_RELAY_CANDIDATES;
  try {
    const raw = storage?.getItem("undepressable_dev_public_relay_candidates");
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.every((c) => c && typeof c.id === "string" && isIceServer(c.server)) ? parsed : PUBLIC_RELAY_CANDIDATES;
  } catch {
    return PUBLIC_RELAY_CANDIDATES;
  }
}

// --- what the last tests found ---
// Kept for the life of the page (not persisted: networks change), so the
// panel shows the last result again after it was closed, after a reconnect
// and on another view — nobody should have to redo a test because the panel
// was re-opened, and a result from a minute ago is evidence in its own right.
export interface TestMemory<T> {
  at: number;
  results: CandidateResult<T>[];
}
let lastRelayTest: TestMemory<PublicRelayCandidate> | null = null;
let lastStunTest: TestMemory<string> | null = null;

export function rememberRelayTest(results: CandidateResult<PublicRelayCandidate>[], now = Date.now()): void {
  lastRelayTest = { at: now, results };
}
export function recallRelayTest(): TestMemory<PublicRelayCandidate> | null {
  return lastRelayTest;
}
export function rememberStunTest(results: CandidateResult<string>[], now = Date.now()): void {
  lastStunTest = { at: now, results };
}
export function recallStunTest(): TestMemory<string> | null {
  return lastStunTest;
}
export function forgetTests(): void {
  lastRelayTest = null;
  lastStunTest = null;
}

/** "just now", "3 min ago", "2 h ago". */
export function agoText(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

export interface StunVerdict {
  tone: "good" | "warn" | "none";
  /** Worth reconnecting with the servers that answered. */
  useful: boolean;
  text: string;
}

/** A test that found servers answering this recently says the network does not block UDP, whatever a later test found. */
const THROTTLE_MEMORY_MS = 15 * 60_000;

/**
 * What a STUN test means — which depends on what the network check found
 * and on what an earlier test saw. Two strict NATs are not helped by any
 * number of STUN servers; and servers that answered a few minutes ago and
 * fall silent right after the app opened a burst of connections point to
 * throttling, not to a network that blocks UDP. Pure.
 */
export function stunVerdict(input: {
  answered: number;
  tested: number;
  using: number;
  natKind: NatKind | null;
  previous: TestMemory<string> | null;
  now?: number;
}): StunVerdict {
  const now = input.now ?? Date.now();
  if (input.answered > 0) {
    if (input.natKind === "hard") {
      return {
        tone: "warn",
        useful: false,
        text: `${input.answered} of ${input.tested} answered — STUN works from here, so that is not what blocks you. Two strict networks need a relay; more STUN servers change nothing.`,
      };
    }
    return { tone: "good", useful: true, text: `${input.answered} of ${input.tested} answered — using ${input.using}.` };
  }
  const before = input.previous ? input.previous.results.filter((r) => r.ok).length : 0;
  if (input.previous && before > 0 && now - input.previous.at < THROTTLE_MEMORY_MS) {
    return {
      tone: "warn",
      useful: false,
      text: `None of ${input.tested} answered now, but ${before} did ${agoText(input.previous.at, now)}. The app had just opened a burst of connections, and networks throttle that for a while: wait a minute and test again. This network does not block UDP.`,
    };
  }
  return {
    tone: "none",
    useful: false,
    text: `None of ${input.tested} answered: this network seems to block UDP entirely. Only a relay reachable over TCP/TLS (turns: on port 443) can connect you.`,
  };
}
