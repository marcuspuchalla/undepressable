import { ref, onUnmounted } from "vue";

// Screen wake lock: phone screens locking mid-stream suspend capture in mobile
// browsers (observed in field testing). The lock is auto-released by the OS
// whenever the page is hidden, so we re-acquire on return to foreground for as
// long as the caller still wants it. Best-effort — iOS Safari < 16.4 lacks it.
export function useWakeLock() {
  const isSupported = typeof navigator !== "undefined" && "wakeLock" in navigator;
  const active = ref(false);
  let sentinel: WakeLockSentinel | null = null;
  let wanted = false;

  async function request(): Promise<boolean> {
    wanted = true;
    if (!isSupported) return false;
    try {
      sentinel = await navigator.wakeLock.request("screen");
      active.value = true;
      sentinel.addEventListener("release", () => {
        active.value = false;
      });
      return true;
    } catch {
      active.value = false;
      return false;
    }
  }

  async function release(): Promise<void> {
    wanted = false;
    try {
      await sentinel?.release();
    } catch {
      /* already released */
    }
    sentinel = null;
    active.value = false;
  }

  function onVisibility() {
    if (wanted && document.visibilityState === "visible" && !active.value) {
      request();
    }
  }
  document.addEventListener("visibilitychange", onVisibility);

  onUnmounted(() => {
    document.removeEventListener("visibilitychange", onVisibility);
    release();
  });

  return { isSupported, active, request, release };
}
