// Timing policy for the connections Trystero opens on our behalf.
//
// Trystero makes three decisions that are fine on a LAN and harmful on the
// networks this app is for (VPNs, carrier NAT, congested cells):
//
//   1. No trickle ICE: every offer and answer waits for ICE gathering to
//      *complete* (capped at 5 s). One slow or unreachable STUN server — or a
//      broken IPv6 route — makes every single answer wait the full 5 s.
//   2. A nostr/mqtt offer that has not connected ~4.8 s after it was sent is
//      destroyed. Relayed (TURN) connections through a VPN routinely need
//      longer than that, so the one path that *would* work is killed first.
//   3. A connection is torn down on the first `disconnected`, which on mobile
//      is usually a 2–5 s blip (cell handover, a tunnel) that ICE recovers from
//      by itself. Tearing down costs a full re-discovery and splits recordings.
//
// These pure functions decide when to deviate; `connectionMonitor.ts` applies
// them. Kept free of browser APIs so they are unit-testable.

export interface PeerTuning {
  /** Declare gathering complete once no new candidate arrived for this long. */
  quietMs: number;
  /** Stop waiting for STUN answers after this long (UDP blocked / STUN dead). */
  srflxCapMs: number;
  /**
   * Stop waiting for a relay candidate after this long. Must stay well under
   * Trystero's ~4.8 s nostr offer prune: an answer that waits longer than
   * that arrives after the offer is gone, so a dead relay would block even
   * connections that never needed it.
   */
  relayCapMs: number;
  /** How long a negotiation that already reached the far side may keep trying. */
  negotiationWindowMs: number;
  /** After ICE connects, how long to wait for the data channel before giving up. */
  adoptAfterConnectMs: number;
  /** How long a `disconnected` connection gets to recover before teardown. */
  disconnectGraceMs: number;
}

export const PEER_TUNING: PeerTuning = {
  quietMs: 400,
  srflxCapMs: 2500,
  relayCapMs: 3000,
  negotiationWindowMs: 15_000,
  adoptAfterConnectMs: 5000,
  disconnectGraceMs: 6000,
};

export interface GatherState {
  elapsedMs: number;
  sinceLastCandidateMs: number;
  haveAny: boolean;
  haveSrflx: boolean;
  haveRelay: boolean;
  /** STUN or TURN servers are configured (so srflx candidates are expected). */
  wantSrflx: boolean;
  /** TURN servers are configured (so relay candidates are expected). */
  wantRelay: boolean;
}

export type GatherVerdict = { done: true } | { done: false; recheckInMs: number | null };

/**
 * Should we tell Trystero gathering is complete now?
 *
 * The rule is "never ship an offer without the candidates that matter, never
 * wait for ones that don't": a relay candidate is the only thing that crosses
 * two strict NATs, so with TURN configured we hold out for it — but only up
 * to `relayCapMs`, because a relay that is down must not stall everything
 * else. Without TURN, one STUN answer is enough — the remaining servers would
 * only add duplicates.
 */
export function gatherVerdict(s: GatherState, t: PeerTuning = PEER_TUNING): GatherVerdict {
  if (!s.haveAny) return { done: false, recheckInMs: null };

  const quietLeft = t.quietMs - s.sinceLastCandidateMs;
  const whenQuiet = (): GatherVerdict => (quietLeft <= 0 ? { done: true } : { done: false, recheckInMs: quietLeft });

  if (s.wantRelay) {
    if (s.haveRelay) return whenQuiet();
    const capLeft = t.relayCapMs - s.elapsedMs;
    return capLeft <= 0 ? { done: true } : { done: false, recheckInMs: capLeft };
  }
  if (s.wantSrflx && !s.haveSrflx) {
    const capLeft = t.srflxCapMs - s.elapsedMs;
    return capLeft <= 0 ? { done: true } : { done: false, recheckInMs: capLeft };
  }
  return whenQuiet();
}

export interface CloseContext {
  /** When the far side's description was applied (null: the peer never answered). */
  remoteAt: number | null;
  now: number;
  connectionState: RTCPeerConnectionState;
  /** A data channel already opened — Trystero owns this peer; honour it. */
  channelOpen: boolean;
  /** The session is over (user left); nothing should outlive it. */
  sessionEnded: boolean;
}

/**
 * Defer Trystero's close of a connection that is mid-negotiation with a peer
 * that already answered — it is likely seconds from connecting, and closing it
 * restarts discovery from scratch with the same odds of being cut short again.
 */
export function shouldDeferClose(c: CloseContext, t: PeerTuning = PEER_TUNING): boolean {
  if (c.sessionEnded || c.channelOpen || c.remoteAt === null) return false;
  if (c.connectionState === "failed" || c.connectionState === "closed") return false;
  return c.now - c.remoteAt < t.negotiationWindowMs;
}
