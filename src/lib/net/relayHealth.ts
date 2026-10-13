// Which discovery relays are actually up, right now.
//
// This project has been bitten three times by public infrastructure rotting
// under it: Trystero's default Nostr relays started rejecting our signalling,
// the bundled TURN server died, and a pinned relay began demanding proof of
// work. Each time the symptom was the same — peers mysteriously failing to
// find each other — and each time it took a debugging session to trace it back
// to a dead host.
//
// Relay decay is measured in weeks here, so treat it as an operating condition
// rather than an incident: read the liveness the transports already track, and
// make it visible before a demo instead of after.
//
// Deliberately reads existing sockets rather than probing: opening extra
// connections to every relay would cost battery and radio on a phone, and
// would itself look like scanning.

/** The bits of a WebSocket we care about (kept structural so it is testable). */
export interface SocketLike {
  readyState: number;
}

export type RelayState = "open" | "connecting" | "closed";

export interface RelayStatus {
  url: string;
  /** Which transport owns this relay: torrent | nostr | mqtt. */
  transport: string;
  state: RelayState;
}

export interface RelayHealth {
  relays: RelayStatus[];
  open: number;
  total: number;
  /**
   * False when every relay of some transport is down, or nothing is open at
   * all — the state where peers silently stop finding each other.
   */
  healthy: boolean;
  /** Transports that have relays configured but none of them open. */
  deadTransports: string[];
}

// WebSocket.readyState: 0 CONNECTING, 1 OPEN, 2 CLOSING, 3 CLOSED.
function toState(readyState: number): RelayState {
  if (readyState === 1) return "open";
  if (readyState === 0) return "connecting";
  return "closed";
}

/**
 * Fold each transport's relay sockets into one report.
 *
 * `sockets` maps transport name → (relay url → socket), which is the shape
 * Trystero's `getRelaySockets()` returns per strategy.
 */
export function summarizeRelays(
  sockets: Record<string, Record<string, SocketLike | null | undefined>>,
): RelayHealth {
  const relays: RelayStatus[] = [];
  const deadTransports: string[] = [];

  for (const [transport, byUrl] of Object.entries(sockets)) {
    const entries = Object.entries(byUrl ?? {});
    if (entries.length === 0) continue;

    let openHere = 0;
    for (const [url, socket] of entries) {
      // A missing socket is a relay that never came up.
      const state = socket ? toState(socket.readyState) : "closed";
      if (state === "open") openHere++;
      relays.push({ url, transport, state });
    }
    if (openHere === 0) deadTransports.push(transport);
  }

  const open = relays.filter((r) => r.state === "open").length;
  return {
    relays,
    open,
    total: relays.length,
    healthy: relays.length > 0 && open > 0 && deadTransports.length === 0,
    deadTransports,
  };
}

/** One-line summary for the debug panel / logs. */
export function describeRelayHealth(health: RelayHealth): string {
  if (health.total === 0) return "No relays connected yet";
  if (health.deadTransports.length > 0) {
    return `${health.open}/${health.total} relays up — no relay reachable for: ${health.deadTransports.join(", ")}`;
  }
  return `${health.open}/${health.total} relays up`;
}
