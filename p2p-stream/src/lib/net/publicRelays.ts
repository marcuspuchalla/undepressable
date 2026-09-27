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

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface PublicRelayCandidate {
  id: string;
  /** Who is behind it, as far as anyone knows — shown to the user. */
  label: string;
  server: RTCIceServer;
}

/**
 * Relays that publish shared credentials. Last reported working: freestun.net
 * in May 2025 (community reports); relay.backups.cz is an older listing that
 * still resolves. Both are best-effort — the in-app test is the authority.
 */
export const PUBLIC_RELAY_CANDIDATES: PublicRelayCandidate[] = [
  {
    id: "freestun",
    label: "freestun.net (volunteer-run)",
    server: { urls: ["turn:freestun.net:3478", "turn:freestun.net:3478?transport=tcp"], username: "free", credential: "free" },
  },
  {
    id: "backups-cz",
    label: "relay.backups.cz (volunteer-run)",
    server: { urls: ["turn:relay.backups.cz", "turn:relay.backups.cz?transport=tcp"], username: "webrtc", credential: "webrtc" },
  },
];

/**
 * STUN servers beyond the defaults, picked from the hourly-tested list at
 * github.com/pradt2/always-online-stun for diversity of operator, country and
 * port (443 survives networks that block everything but HTTPS ports).
 */
export const EXTRA_STUN_CANDIDATES: string[] = [
  "stun:stun.t-online.de:3478",
  "stun:stun.linphone.org:3478",
  "stun:stun.aa.net.uk:3478",
  "stun:stun.acrobits.cz:3478",
  "stun:stun.gigaset.net:3478",
  "stun:stun.frozenmountain.com:3478",
  "stun:stun3.l.google.com:19302",
  "stun:relay.webwormhole.io:3478",
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
export function getPublicRelays(storage: Pick<Storage, "getItem"> | null = safeStorage()): RTCIceServer[] {
  try {
    const raw = storage?.getItem(PUBLIC_RELAYS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isIceServer) : [];
  } catch {
    return [];
  }
}

export function setPublicRelays(servers: RTCIceServer[], storage: StorageLike | null = safeStorage()): void {
  try {
    const clean = servers.filter(isIceServer);
    if (clean.length === 0) storage?.removeItem(PUBLIC_RELAYS_KEY);
    else storage?.setItem(PUBLIC_RELAYS_KEY, JSON.stringify(clean));
  } catch {
    /* storage blocked */
  }
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
