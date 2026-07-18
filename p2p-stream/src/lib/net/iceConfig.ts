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
// TURN can be supplied three ways (highest precedence first):
//   1. Runtime: localStorage (set directly, or via a `?turn=` URL param so an
//      organizer can distribute a relay inside a share link).
//   2. Build time: VITE_TURN_URL / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL.
//   3. Not at all — direct P2P only (STUN), the honest default.
//
// Prefer `turns:` on port 443: TLS-wrapped TURN is the only variant that
// survives networks which block UDP and non-HTTPS ports (DPI, hotel/corporate
// firewalls, hostile infrastructure).

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

/** The RTCConfiguration to hand Trystero. Evaluated per-join so runtime TURN changes apply. */
export function getRtcConfig(): RTCConfiguration {
  const env = (import.meta as any).env ?? {};
  return {
    iceServers: buildIceServers(env, getRuntimeTurn()),
    iceCandidatePoolSize: 10,
  };
}
