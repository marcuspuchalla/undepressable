// Keep the app and its recordings from being cleaned up by the browser.
//
// Browser storage is "best effort" by default: under storage pressure — and in
// Safari, after days without a visit — the browser may delete a site's cache
// and files. For this app that would mean losing the offline copy of itself
// *and* recorded evidence. `navigator.storage.persist()` asks for the
// stronger guarantee. Browsers decide on their own (Chrome grants it to
// installed or frequently used apps, Firefox asks the user, Safari grants it
// to Home Screen apps), so we ask at the moments that matter — installing,
// and the first recording — and show the outcome.

export type PersistenceState = "persistent" | "best-effort" | "unsupported";

export async function persistenceState(): Promise<PersistenceState> {
  const storage = (globalThis.navigator as Navigator | undefined)?.storage;
  if (!storage?.persisted) return "unsupported";
  try {
    return (await storage.persisted()) ? "persistent" : "best-effort";
  } catch {
    return "unsupported";
  }
}

/** Ask for persistent storage if we do not have it yet. Never throws. */
export async function ensurePersistentStorage(): Promise<PersistenceState> {
  const current = await persistenceState();
  if (current !== "best-effort") return current;
  try {
    return (await navigator.storage.persist()) ? "persistent" : "best-effort";
  } catch {
    return "best-effort";
  }
}
