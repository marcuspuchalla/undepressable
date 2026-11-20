// Relays built into the app, on by default.
//
// Two strict networks (a home router and a mobile carrier, a VPN exit and
// anything) cannot connect without a relay, and most people have none. So the
// published build carries the project's relays — its own, and free plans of
// relay providers — compiled in from VITE_BUILTIN_RELAYS. Using them needs no
// request to anyone but the relays themselves.
//
// Every relay has a monthly limit, kept by the project's relay-status service
// (services/relay-status). The app never asks that service on its own: only
// when the person taps "Check the built-in relays". The answer says which
// relays are on this month (a relay over its limit is skipped here until it
// resets), and brings current credentials — including Cloudflare's, which live
// at most 48 hours and so can only come from there.
//
// Turning "Use the built-in relays" off removes them entirely.

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface BuiltinRelay {
  id: string;
  label: string;
  server: RTCIceServer;
}

export interface RelayVerdict {
  id: string;
  label: string;
  active: boolean;
  reason: string | null;
  usedGB: number;
  limitGB: number;
  resetsAt: string;
}

interface Stored {
  off?: boolean;
  checkedAt?: number;
  verdicts?: RelayVerdict[];
  /** Credentials from the last check, by relay id, until they expire. */
  fetched?: Record<string, { servers: RTCIceServer[]; expires: number }>;
}

const KEY = "undepressable_builtin_relays";
/** Credentials fetched by a check are trusted this long (Cloudflare's live 6 h). */
export const FETCHED_TTL_MS = 3 * 3600_000;

function isServer(v: unknown): v is RTCIceServer {
  if (!v || typeof v !== "object") return false;
  const urls = (v as RTCIceServer).urls;
  const list = Array.isArray(urls) ? urls : [urls];
  return list.length > 0 && list.every((u) => typeof u === "string" && /^(stun|turns?):/i.test(u));
}

/** The relays compiled into this build: VITE_BUILTIN_RELAYS, a JSON list. */
export function compiledRelays(env: Record<string, string | undefined>): BuiltinRelay[] {
  try {
    const parsed = JSON.parse(env.VITE_BUILTIN_RELAYS ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((r) => r && typeof r.id === "string" && typeof r.label === "string" && isServer(r.server))
      : [];
  } catch {
    return [];
  }
}

/** Where "Check the built-in relays" asks; null if this build has none. */
export function statusUrl(env: Record<string, string | undefined>): string | null {
  const u = env.VITE_RELAY_STATUS_URL;
  return u && /^https:\/\//i.test(u) ? u.replace(/\/+$/, "") : null;
}

function read(storage: Pick<Storage, "getItem"> | null): Stored {
  try {
    const raw = storage?.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function write(storage: StorageLike | null, s: Stored): void {
  try {
    storage?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: the defaults still apply */
  }
}

export function builtinRelaysEnabled(storage: Pick<Storage, "getItem"> | null): boolean {
  return !read(storage).off;
}

export function setBuiltinRelaysEnabled(on: boolean, storage: StorageLike | null): void {
  write(storage, { ...read(storage), off: !on });
}

/** The last check's answer, if any. */
export function lastCheck(storage: Pick<Storage, "getItem"> | null): { at: number; verdicts: RelayVerdict[] } | null {
  const s = read(storage);
  return s.checkedAt && Array.isArray(s.verdicts) ? { at: s.checkedAt, verdicts: s.verdicts } : null;
}

/**
 * The built-in relays to use now: compiled ones plus ones a check brought
 * (Cloudflare), minus any the last check found over its limit for a month
 * that has not ended yet. Fresher credentials from a check replace compiled ones.
 */
export function builtinServers(
  env: Record<string, string | undefined>,
  storage: Pick<Storage, "getItem"> | null,
  now = Date.now(),
): RTCIceServer[] {
  const s = read(storage);
  if (s.off) return [];
  const off = new Set(
    (s.verdicts ?? []).filter((v) => !v.active && Date.parse(v.resetsAt) > now).map((v) => v.id),
  );
  const out: RTCIceServer[] = [];
  const ids = new Set<string>();
  for (const r of compiledRelays(env)) ids.add(r.id);
  for (const id of Object.keys(s.fetched ?? {})) ids.add(id);
  for (const id of ids) {
    if (off.has(id)) continue;
    const fetched = s.fetched?.[id];
    if (fetched && fetched.expires > now && fetched.servers.length) out.push(...fetched.servers);
    else {
      const compiled = compiledRelays(env).find((r) => r.id === id);
      if (compiled) out.push(compiled.server);
    }
  }
  return out;
}

/** Validate relay-status's /v1/relays answer. */
export function parseStatus(json: unknown): { verdicts: RelayVerdict[]; servers: Record<string, RTCIceServer[]> } | null {
  const relays = (json as { relays?: unknown })?.relays;
  if (!Array.isArray(relays)) return null;
  const verdicts: RelayVerdict[] = [];
  const servers: Record<string, RTCIceServer[]> = {};
  for (const r of relays) {
    if (!r || typeof r.id !== "string" || typeof r.active !== "boolean") continue;
    verdicts.push({
      id: r.id,
      label: typeof r.label === "string" ? r.label : r.id,
      active: r.active,
      reason: typeof r.reason === "string" ? r.reason : null,
      usedGB: Number(r.usedGB) || 0,
      limitGB: Number(r.limitGB) || 0,
      resetsAt: typeof r.resetsAt === "string" ? r.resetsAt : new Date(0).toISOString(),
    });
    if (r.active && Array.isArray(r.iceServers)) {
      const list = r.iceServers.filter(isServer);
      if (list.length) servers[r.id] = list;
    }
  }
  return { verdicts, servers };
}

export type CheckResult =
  | { ok: true; verdicts: RelayVerdict[] }
  | { ok: false; error: string };

/** "Check the built-in relays": the one request this feature ever makes. */
export async function checkBuiltinRelays(
  env: Record<string, string | undefined>,
  storage: StorageLike | null,
  fetchFn: typeof fetch = fetch,
  now = Date.now(),
): Promise<CheckResult> {
  const url = statusUrl(env);
  if (!url) return { ok: false, error: "This copy of the app has no relay status service." };
  let json: unknown;
  try {
    const res = await fetchFn(`${url}/v1/relays`, {
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, error: `The status service answered ${res.status}.` };
    json = await res.json();
  } catch {
    return { ok: false, error: "The status service could not be reached from this network." };
  }
  const parsed = parseStatus(json);
  if (!parsed) return { ok: false, error: "The status service sent an answer this app does not understand." };
  const fetched: Stored["fetched"] = {};
  for (const [id, servers] of Object.entries(parsed.servers)) fetched[id] = { servers, expires: now + FETCHED_TTL_MS };
  write(storage, { ...read(storage), checkedAt: now, verdicts: parsed.verdicts, fetched });
  return { ok: true, verdicts: parsed.verdicts };
}
