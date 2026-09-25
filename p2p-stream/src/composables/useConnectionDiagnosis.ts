import { ref, shallowRef, computed, onMounted, onUnmounted } from "vue";
import type { useTrystero } from "./useTrystero";
import { diagnose, type Diagnosis } from "../lib/net/diagnosis";
import { hasRelay } from "../lib/net/iceConfig";

type Trystero = ReturnType<typeof useTrystero>;

/**
 * A live, plain-language connection status for the Stream/Collect views.
 * Time matters to the verdict ("still searching after 25 s" is different
 * from "searching"), so this ticks once a second while mounted.
 */
export function useConnectionDiagnosis(
  trystero: Trystero,
  opts: { role: "streamer" | "collector"; hasStream?: () => boolean },
) {
  const now = ref(Date.now());
  const online = ref(typeof navigator === "undefined" ? true : navigator.onLine);
  const relayConfigured = ref(hasRelay());
  const relayHealth = shallowRef<{ open: number; total: number } | null>(null);
  let timer: number | null = null;
  let ticks = 0;

  function sampleRelays() {
    try {
      const h = trystero.getRelayHealth();
      relayHealth.value = h.total > 0 ? { open: h.open, total: h.total } : null;
    } catch {
      relayHealth.value = null;
    }
  }

  const updateOnline = () => (online.value = navigator.onLine);

  onMounted(() => {
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    timer = window.setInterval(() => {
      now.value = Date.now();
      if (++ticks % 2 === 0) sampleRelays();
    }, 1000);
  });
  onUnmounted(() => {
    window.removeEventListener("online", updateOnline);
    window.removeEventListener("offline", updateOnline);
    if (timer) clearInterval(timer);
  });

  const diagnosis = computed<Diagnosis>(() =>
    diagnose({
      role: opts.role,
      now: now.value,
      joinedAt: trystero.joinedAt.value,
      report: trystero.connectionReport.value,
      peerCount: trystero.peerCount.value,
      hasStream: opts.hasStream?.() ?? false,
      relayConfigured: relayConfigured.value,
      relayHealth: relayHealth.value,
      online: online.value,
    }),
  );

  /** Call after relay settings change. */
  function refreshRelay() {
    relayConfigured.value = hasRelay();
  }

  return { diagnosis, online, relayConfigured, refreshRelay };
}
