// Who is allowed to reshape the relay tree, without dropping their orders.
//
// Relay-tree control messages ("you are now serving these peers") must come
// from the streamer: a forged `children` list would turn watchers into DoS
// amplifiers. The check used to read the sender's live swarm stat, which broke
// in two ways that cost watchers their video:
//
//   1. The root announces assignments to a newcomer BEFORE its first stat
//      reaches them, so the opening instructions were dropped unread.
//   2. Stats are pruned after ~12s of silence. On a congested link — exactly
//      when re-seating matters most — the root's stat expires and the watcher
//      starts rejecting every instruction it sends.
//
// So identity is remembered rather than re-proved (stats are unauthenticated
// anyway, so expiring them buys no security, only dropped messages), and
// instructions that arrive before identity does are held briefly instead of
// being thrown away.

export type PeerRole = "streamer" | "collector";

/** Caps so a hostile peer cannot make us buffer without bound. */
export const MAX_HELD_PER_PEER = 8;
export const MAX_HOLDING_PEERS = 32;

export function createControlGate() {
  /** Peers seen claiming the streamer role, sticky for the session. */
  const streamers = new Set<string>();
  /** Control messages received before the sender was known to be the streamer. */
  const held = new Map<string, unknown[]>();

  /**
   * Record a peer's announced role.
   *
   * Returns any messages that were waiting on this peer's identity, so the
   * caller can replay them now that they are authorized.
   */
  function noteRole(peerId: string, role: PeerRole): unknown[] {
    if (role !== "streamer") return [];
    streamers.add(peerId);
    return takeHeld(peerId);
  }

  function isStreamer(peerId: string): boolean {
    return streamers.has(peerId);
  }

  /**
   * Park a message from a not-yet-identified peer. Dropped silently once the
   * caps are hit — buffering is a courtesy for a startup race, not a queue.
   */
  function hold(peerId: string, msg: unknown): void {
    if (streamers.has(peerId)) return;
    const queue = held.get(peerId);
    if (queue) {
      if (queue.length < MAX_HELD_PER_PEER) queue.push(msg);
      return;
    }
    if (held.size >= MAX_HOLDING_PEERS) return;
    held.set(peerId, [msg]);
  }

  function takeHeld(peerId: string): unknown[] {
    const queue = held.get(peerId) ?? [];
    held.delete(peerId);
    return queue;
  }

  /** Forget a peer that left for good. */
  function forget(peerId: string): void {
    streamers.delete(peerId);
    held.delete(peerId);
  }

  function clear(): void {
    streamers.clear();
    held.clear();
  }

  return { noteRole, isStreamer, hold, takeHeld, forget, clear };
}
