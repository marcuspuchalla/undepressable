// Pure, framework-agnostic reducer for live swarm counts.
//
// Every peer periodically broadcasts a tiny SwarmStat over a Trystero data
// channel. Any peer can then compute the same swarm-wide totals: how many are
// watching (collectors) and how many are actively recording. Keeping the math
// here — separate from the Vue/Trystero glue — makes it unit-testable and keeps
// the wire format in one place.

export type SwarmRole = "streamer" | "collector";

/** What each peer advertises about itself. `lastSeen` is stamped on receipt. */
export interface SwarmStat {
  role: SwarmRole;
  recording: boolean;
  lastSeen?: number;
}

/** The wire shape actually sent over the data channel (no lastSeen). */
export interface SwarmStatWire {
  role: SwarmRole;
  recording: boolean;
}

export interface SwarmCounts {
  /** Peers currently sourcing video (normally 1). */
  streaming: number;
  /** Peers watching the stream (collectors), swarm-wide. */
  watching: number;
  /** Peers with an active local recording, swarm-wide. */
  recording: number;
  /** Total known participants (including self). */
  total: number;
}

/**
 * Fold a set of per-peer stats (including your own) into swarm totals.
 * A collector counts as "watching"; anyone recording counts as "recording".
 */
export function computeCounts(stats: Iterable<SwarmStat>): SwarmCounts {
  let streaming = 0;
  let watching = 0;
  let recording = 0;
  let total = 0;
  for (const s of stats) {
    total++;
    if (s.role === "streamer") streaming++;
    else watching++;
    if (s.recording) recording++;
  }
  return { streaming, watching, recording, total };
}

/** Drop peers we haven't heard from within `ttlMs`. Mutates and returns the map. */
export function pruneStale(map: Map<string, SwarmStat>, now: number, ttlMs: number): Map<string, SwarmStat> {
  for (const [id, s] of map) {
    if (s.lastSeen !== undefined && now - s.lastSeen > ttlMs) map.delete(id);
  }
  return map;
}

/** Validate an incoming wire message before trusting it (peers are untrusted). */
export function isValidStat(data: unknown): data is SwarmStatWire {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (d.role === "streamer" || d.role === "collector") && typeof d.recording === "boolean";
}

/** Upper bound on tracked peers — a malicious room member can't grow the map unboundedly. */
export const MAX_TRACKED_PEERS = 500;

/**
 * Whether a stat from `peerId` may be stored. Updates to already-known peers
 * are always fine; NEW peers are rejected once the map is at capacity.
 */
export function canTrackStat(map: Map<string, unknown>, peerId: string, max: number = MAX_TRACKED_PEERS): boolean {
  return map.has(peerId) || map.size < max;
}
