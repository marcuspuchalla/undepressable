// Custom discovery relays, configurable on the device.
//
// Public relays rot (four incidents in this project's history) and are the
// first thing a censor blocks. The remedy has always been "run your own Nostr
// relay on 443 behind a boring domain" — but using it meant editing
// `types.ts` and rebuilding. Now it is a setting, and it travels in share
// links: a streamer on a private relay is only findable by watchers who use
// that relay too.

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const RELAYS_KEY = "undepressable_nostr_relays";
const ONLY_KEY = "undepressable_nostr_relays_only";
const MAX_CUSTOM = 8;

function safeStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** wss:// anywhere; plain ws:// only to this machine (local testing). */
export function normalizeRelayUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  if (hasScheme && !/^wss?:\/\//i.test(trimmed)) return null;
  const withScheme = hasScheme ? trimmed : `wss://${trimmed}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol === "ws:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return null;
    if (u.protocol !== "wss:" && u.protocol !== "ws:") return null;
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return null;
  }
}

/** Parse a comma/space/newline separated list, dropping invalid and duplicate entries. */
export function parseRelayList(text: string): string[] {
  const out: string[] = [];
  for (const part of (text ?? "").split(/[\s,]+/)) {
    const url = normalizeRelayUrl(part);
    if (url && !out.includes(url)) out.push(url);
    if (out.length >= MAX_CUSTOM) break;
  }
  return out;
}

export function getCustomRelays(storage: Pick<Storage, "getItem"> | null = safeStorage()): string[] {
  try {
    const raw = storage?.getItem(RELAYS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parseRelayList(parsed.join(",")) : [];
  } catch {
    return [];
  }
}

export function setCustomRelays(list: string[], storage: StorageLike | null = safeStorage()): void {
  try {
    const clean = parseRelayList(list.join(","));
    if (clean.length === 0) storage?.removeItem(RELAYS_KEY);
    else storage?.setItem(RELAYS_KEY, JSON.stringify(clean));
  } catch {
    /* storage blocked */
  }
}

/** Use only the custom relays: no public discovery at all (less metadata leaves the group). */
export function isCustomRelaysOnly(storage: Pick<Storage, "getItem"> | null = safeStorage()): boolean {
  try {
    return storage?.getItem(ONLY_KEY) === "1" && getCustomRelays(storage).length > 0;
  } catch {
    return false;
  }
}

export function setCustomRelaysOnly(only: boolean, storage: StorageLike | null = safeStorage()): void {
  try {
    if (only) storage?.setItem(ONLY_KEY, "1");
    else storage?.removeItem(ONLY_KEY);
  } catch {
    /* ignore */
  }
}

export interface DiscoveryPlan {
  nostrRelays: string[];
  /** Whether the public torrent/mqtt transports should run at all. */
  usePublicTransports: boolean;
}

/** Custom relays go first (they are the ones that survive a block), public ones after. */
export function planDiscovery(publicNostr: string[], custom: string[], onlyCustom: boolean): DiscoveryPlan {
  if (onlyCustom && custom.length > 0) return { nostrRelays: [...custom], usePublicTransports: false };
  const merged = [...custom];
  for (const url of publicNostr) if (!merged.includes(url)) merged.push(url);
  return { nostrRelays: merged, usePublicTransports: true };
}

export function discoveryShareParams(storage: Pick<Storage, "getItem"> | null = safeStorage()): Record<string, string> {
  const custom = getCustomRelays(storage);
  return custom.length > 0 ? { relays: custom.join(",") } : {};
}

/**
 * Adopt relays from a link. They are *added* to this device's list (never
 * switched to "only"), so a watcher can still meet streamers on public relays.
 */
export function adoptDiscoveryFromUrl(
  search: string = typeof location !== "undefined" ? location.search : "",
  storage: StorageLike | null = safeStorage(),
): string[] {
  try {
    const raw = new URLSearchParams(search).get("relays");
    if (!raw) return [];
    const incoming = parseRelayList(raw);
    if (incoming.length === 0) return [];
    const merged = parseRelayList([...incoming, ...getCustomRelays(storage)].join(","));
    setCustomRelays(merged, storage);
    return incoming;
  } catch {
    return [];
  }
}
