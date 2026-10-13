// Storage headroom assessment for long recordings.
//
// Recording at ~2.5 Mbps writes ~1.1 GB/hour into OPFS. Browsers don't warn
// before the quota wall — chunk writes just start failing — so we check the
// estimate up front and periodically, and surface honest levels the UI can
// show *before* footage is lost.

export type StorageLevel = "ok" | "low" | "critical" | "unknown";

export interface StorageAssessment {
  level: StorageLevel;
  remainingBytes: number | null;
  /** Rough minutes of recording left at the given bitrate (null if unknown). */
  minutesLeft: number | null;
}

export const LOW_BYTES = 500 * 1024 * 1024; // ~25 min of 2.5 Mbps footage
export const CRITICAL_BYTES = 100 * 1024 * 1024; // ~5 min

export function assessStorage(
  usage: number | undefined,
  quota: number | undefined,
  bitrateBps = 2_500_000,
): StorageAssessment {
  if (quota === undefined || quota === 0) {
    return { level: "unknown", remainingBytes: null, minutesLeft: null };
  }
  const remaining = Math.max(0, quota - (usage ?? 0));
  const minutesLeft = Math.floor(remaining / (bitrateBps / 8) / 60);
  const level: StorageLevel =
    remaining < CRITICAL_BYTES ? "critical" : remaining < LOW_BYTES ? "low" : "ok";
  return { level, remainingBytes: remaining, minutesLeft };
}

/** Query the browser's estimate; degrades to "unknown" where unsupported. */
export async function checkStorage(bitrateBps?: number): Promise<StorageAssessment> {
  try {
    if (!("storage" in navigator) || !navigator.storage.estimate) {
      return { level: "unknown", remainingBytes: null, minutesLeft: null };
    }
    const { usage, quota } = await navigator.storage.estimate();
    return assessStorage(usage, quota, bitrateBps);
  } catch {
    return { level: "unknown", remainingBytes: null, minutesLeft: null };
  }
}
