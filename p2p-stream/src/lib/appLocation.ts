// Where this copy of the app lives, and how its links must look.
//
// The app normally runs at the root of its own website with ordinary paths
// (/collect/CODE). Copies that do not depend on that website — the browser
// extension, the single-file portable app opened from disk, or a mirror
// served under any path (an IPFS gateway's /ipfs/<cid>/, an onion service,
// a subfolder) — cannot rely on the server answering /collect/CODE, so they
// keep routes in the hash: …/undepressable.html#/collect/CODE.

declare const __HASH_ROUTES__: boolean

export function usesHashRoutes(loc: Pick<Location, "protocol"> | null = typeof location !== "undefined" ? location : null): boolean {
  if (typeof __HASH_ROUTES__ !== "undefined" && __HASH_ROUTES__) return true;
  const protocol = loc?.protocol ?? "";
  return protocol === "file:" || /^(chrome|moz|safari-web)-extension:$/.test(protocol);
}

/** The URL other devices should open to reach this very copy (no hash, no query). */
export function appBase(loc: Pick<Location, "origin" | "pathname" | "protocol"> | null = typeof location !== "undefined" ? location : null): string {
  if (!loc) return "";
  if (!usesHashRoutes(loc)) return loc.origin;
  // file:// has the origin "null"; keep the full path so the link opens this file.
  const origin = loc.protocol === "file:" ? "file://" : loc.origin;
  return origin + loc.pathname;
}

/**
 * The query parameters a link brought with it — in the search part for
 * ordinary links, or after the route inside the hash for hash-routed copies
 * (#/collect/CODE?turn=…). Both are honoured.
 */
export function linkSearch(loc: Pick<Location, "search" | "hash"> | null = typeof location !== "undefined" ? location : null): string {
  if (!loc) return "";
  const params = new URLSearchParams(loc.search);
  const q = loc.hash.indexOf("?");
  if (q >= 0) new URLSearchParams(loc.hash.slice(q + 1)).forEach((v, k) => params.has(k) || params.set(k, v));
  const s = params.toString();
  return s ? `?${s}` : "";
}
