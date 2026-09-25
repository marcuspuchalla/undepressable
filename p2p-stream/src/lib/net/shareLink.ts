// Where a share link / QR code should point.
//
// The link used to be built from wherever the app happened to be running:
// `http://localhost:4400` rewritten to a LAN IP, or `tauri://localhost` in the
// desktop app, or `https://localhost` inside the Android shell. A phone on a
// mobile network can open none of those — scanning the QR with its camera led
// nowhere, which looks exactly like "the connection failed". (The in-app
// scanner only needs the room code inside the link, so it kept working.)
//
// The fix is to know the app's *public* address: configured on the device,
// baked in at build time, or — when the app is already served from a public
// origin — the origin itself.

import { isPrivateIPv4 } from "./candidates";

const PUBLIC_URL_KEY = "undepressable_public_url";

/**
 * public: anyone on the internet can open it.
 * lan:    only devices on the same local network (e.g. a dev server).
 * device: only this device (localhost, desktop/mobile app shells).
 */
export type Reachability = "public" | "lan" | "device";

export function classifyOrigin(origin: string): Reachability {
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return "device";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "device"; // tauri:, capacitor:, file:
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1") return "device";
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return isPrivateIPv4(host) ? "lan" : "public";
  if (host.includes(":")) {
    return /^(fe[89ab]|f[cd])/.test(host) ? "lan" : "public";
  }
  if (host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".home.arpa") || !host.includes(".")) return "lan";
  return "public";
}

/** Accept "example.org/app" or "https://example.org/app/", return "https://example.org/app". */
export function normalizePublicUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname) return null;
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return null;
  }
}

export function getConfiguredPublicUrl(storage: Pick<Storage, "getItem"> | null = safeStorage()): string | null {
  try {
    const v = storage?.getItem(PUBLIC_URL_KEY);
    return v ? normalizePublicUrl(v) : null;
  } catch {
    return null;
  }
}

export function setConfiguredPublicUrl(
  input: string | null,
  storage: Pick<Storage, "setItem" | "removeItem"> | null = safeStorage(),
): boolean {
  try {
    if (!input || !input.trim()) {
      storage?.removeItem(PUBLIC_URL_KEY);
      return true;
    }
    const url = normalizePublicUrl(input);
    if (!url) return false;
    storage?.setItem(PUBLIC_URL_KEY, url);
    return true;
  } catch {
    return false;
  }
}

export interface ShareBase {
  base: string;
  reachability: Reachability;
  source: "configured" | "build" | "origin" | "lan-ip";
  /**
   * Opens as a secure context. Over plain http (other than localhost)
   * browsers withhold the camera and WebCrypto — which the signaling
   * encryption needs — so the app cannot work there at all.
   */
  secure: boolean;
}

function isSecureBase(base: string): boolean {
  try {
    const u = new URL(base);
    return u.protocol === "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1" || (u.protocol !== "http:");
  } catch {
    return false;
  }
}

/**
 * Pick the address a share link should use, best first: an address set on
 * this device, one baked into the build, the current origin if it is public,
 * the dev server's LAN address, and finally the origin as-is (the in-app
 * scanner still reads the room code out of it).
 */
export function resolveShareBase(opts: {
  origin: string;
  configured?: string | null;
  envPublicUrl?: string | null;
  lanIp?: string | null;
}): ShareBase {
  const r = pickShareBase(opts);
  return { ...r, secure: isSecureBase(r.base) };
}

function pickShareBase(opts: {
  origin: string;
  configured?: string | null;
  envPublicUrl?: string | null;
  lanIp?: string | null;
}): Omit<ShareBase, "secure"> {
  const configured = opts.configured ? normalizePublicUrl(opts.configured) : null;
  if (configured) return { base: configured, reachability: classifyOrigin(configured), source: "configured" };
  const env = opts.envPublicUrl ? normalizePublicUrl(opts.envPublicUrl) : null;
  if (env) return { base: env, reachability: classifyOrigin(env), source: "build" };

  const originClass = classifyOrigin(opts.origin);
  if (originClass === "public" || originClass === "lan") {
    return { base: opts.origin, reachability: originClass, source: "origin" };
  }
  // A dev server on localhost: other devices on the LAN can reach it by IP.
  try {
    const u = new URL(opts.origin);
    if ((u.protocol === "http:" || u.protocol === "https:") && opts.lanIp && isPrivateIPv4(opts.lanIp)) {
      return { base: `${u.protocol}//${opts.lanIp}${u.port ? `:${u.port}` : ""}`, reachability: "lan", source: "lan-ip" };
    }
  } catch {
    /* fall through */
  }
  return { base: opts.origin, reachability: "device", source: "origin" };
}

/** `${base}/collect/CODE?turn=…&ice=…` */
export function buildCollectUrl(base: string, code: string, params: Record<string, string> = {}): string {
  const qs = new URLSearchParams(params).toString();
  return `${base.replace(/\/+$/, "")}/collect/${code}${qs ? `?${qs}` : ""}`;
}

/** Pull a 6-character room code out of anything a QR code might hold. */
export function extractRoomCode(text: string): string | null {
  const trimmed = (text ?? "").trim();
  const fromUrl = /\/collect\/([A-Z0-9]{6})(?:[/?#]|$)/i.exec(trimmed);
  if (fromUrl) return fromUrl[1].toUpperCase();
  return /^[A-Z0-9]{6}$/i.test(trimmed) ? trimmed.toUpperCase() : null;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}
