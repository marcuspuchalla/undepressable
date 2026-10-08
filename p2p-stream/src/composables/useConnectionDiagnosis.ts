import { ref, shallowRef, computed, onMounted, onUnmounted } from "vue";
import type { useTrystero } from "./useTrystero";
import { diagnose, type Diagnosis } from "../lib/net/diagnosis";
import { hasRelay, STUN_SERVERS } from "../lib/net/iceConfig";
import { probeNat, type NatKind } from "../lib/net/natProbe";
import { getExtraStun } from "../lib/net/publicRelays";
import { isBlendIn } from "../lib/net/blendIn";

// One quick STUN check per ~10 minutes per tab is enough: the network rarely
// changes under a session, and each check opens a connection of its own.
const NAT_CACHE_KEY = "undepressable_nat_kind";
const NAT_CACHE_MS = 10 * 60_000;

let natProbeInFlight: Promise<NatKind | null> | null = null;

function currentNatKind(): Promise<NatKind | null> {
  natProbeInFlight ??= measureNatKind().finally(() => (natProbeInFlight = null));
  return natProbeInFlight;
}

async function measureNatKind(): Promise<NatKind | null> {
  // A NAT probe is STUN traffic: not while blending in (nothing direct is tried anyway).
  if (isBlendIn()) return null;
  try {
    const cached = JSON.parse(sessionStorage.getItem(NAT_CACHE_KEY) ?? "null");
    if (cached && Date.now() - cached.at < NAT_CACHE_MS) return cached.kind as NatKind;
  } catch {
    /* no cache */
  }
  try {
    const extra = getExtraStun();
    const servers = extra.length ? [...STUN_SERVERS, { urls: extra }] : STUN_SERVERS;
    const { kind } = await probeNat(servers, 4000);
    try {
      sessionStorage.setItem(NAT_CACHE_KEY, JSON.stringify({ kind, at: Date.now() }));
    } catch {
      /* storage blocked */
    }
    return kind;
  } catch {
    return null;
  }
}

type Trystero = ReturnType<typeof useTrystero>;

/**
 * A live, plain-language connection status for the Stream/Collect views.
 * Time matters to the verdict ("still searching after 25 s" is different
 * from "searching"), so this ticks once a second while mounted.
 */
export function useConnectionDiagnosis(
  trystero: Trystero,
  opts: { role: "streamer" | "collector" | "archive"; hasStream?: () => boolean },
) {
  const now = ref(Date.now());
  const online = ref(typeof navigator === "undefined" ? true : navigator.onLine);
  const relayConfigured = ref(hasRelay());
  const relayHealth = shallowRef<{ open: number; total: number } | null>(null);
  const natKind = ref<NatKind | null>(null);
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
    currentNatKind().then((k) => (natKind.value = k));
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
      natKind: natKind.value,
    }),
  );

  /** Call after relay settings change. */
  function refreshRelay() {
    relayConfigured.value = hasRelay();
  }

  return { diagnosis, online, relayConfigured, natKind, refreshRelay };
}
