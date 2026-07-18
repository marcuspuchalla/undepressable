// Relay-tree topology (docs/RELAY_TREE_DESIGN.md).
//
// Pure, deterministic state machine run by the ROOT (the streamer). The root
// uploads to at most `rootFanout` direct children; relay-willing direct
// children act as seeds and re-broadcast to up to `seedCap` children each.
// Depth is 1 in v1: every parent is either the root or a direct child of it.
//
// Determinism matters: healing after a seed dies re-seats orphans one at a
// time against this single map, so concurrent failures converge instead of
// oscillating. Ties break lexicographically, never by iteration order.

export const ROOT = "@root";

export interface TreeConfig {
  /** Max peers the root streams to directly (seeds + direct leaves). */
  rootFanout: number;
  /** Max children a seed re-broadcasts to (soft cap — overflow degrades to root). */
  seedCap: number;
}

export const DEFAULT_TREE_CONFIG: TreeConfig = { rootFanout: 2, seedCap: 4 };

export interface TreeState {
  /** peerId -> willing/able to relay (hybrid default: true, user can opt out). */
  relay: Map<string, boolean>;
  /** peerId -> parent (ROOT or a seed's peerId). */
  parent: Map<string, string>;
  /** ROOT or seed peerId -> children. */
  children: Map<string, Set<string>>;
}

/** A (re)assignment the coordinator must announce and act on. */
export interface Assignment {
  peer: string;
  parent: string;
}

export function createTree(): TreeState {
  return { relay: new Map(), parent: new Map(), children: new Map() };
}

export function parentOf(t: TreeState, id: string): string | undefined {
  return t.parent.get(id);
}

export function childrenOf(t: TreeState, id: string): string[] {
  return [...(t.children.get(id) ?? [])].sort();
}

/** A seed is a relay-willing direct child of the root that has children. */
export function isSeed(t: TreeState, id: string): boolean {
  return t.parent.get(id) === ROOT && (t.children.get(id)?.size ?? 0) > 0;
}

function childCount(t: TreeState, id: string): number {
  return t.children.get(id)?.size ?? 0;
}

function attach(t: TreeState, peer: string, parent: string): Assignment {
  const old = t.parent.get(peer);
  if (old !== undefined) t.children.get(old)?.delete(peer);
  t.parent.set(peer, parent);
  let set = t.children.get(parent);
  if (!set) {
    set = new Set();
    t.children.set(parent, set);
  }
  set.add(peer);
  return { peer, parent };
}

/**
 * Choose a parent for `peer`: root while it has fan-out budget, else the
 * least-loaded relay-willing direct child with seed capacity, else the root
 * as overflow (a degraded stream beats no stream).
 */
function placement(t: TreeState, peer: string, cfg: TreeConfig): string {
  if (childCount(t, ROOT) < cfg.rootFanout) return ROOT;

  const candidates = childrenOf(t, ROOT)
    .filter((id) => id !== peer && t.relay.get(id) === true && childCount(t, id) < cfg.seedCap)
    .sort((a, b) => childCount(t, a) - childCount(t, b) || (a < b ? -1 : 1));

  return candidates[0] ?? ROOT;
}

/** A peer joined (or re-announced). Returns the assignments that changed. */
export function peerJoined(
  t: TreeState,
  peer: string,
  relay: boolean,
  cfg: TreeConfig = DEFAULT_TREE_CONFIG,
): Assignment[] {
  t.relay.set(peer, relay);
  if (t.parent.has(peer)) return []; // already placed; capability updates go through setRelay
  return [attach(t, peer, placement(t, peer, cfg))];
}

/**
 * A peer disconnected. Its children (if it was a seed) are re-seated one at a
 * time; relay-willing orphans are seated first so they can claim the freed
 * root slot and become the replacement seed for the rest.
 */
export function peerLeft(t: TreeState, peer: string, cfg: TreeConfig = DEFAULT_TREE_CONFIG): Assignment[] {
  const orphans = childrenOf(t, peer);
  const parent = t.parent.get(peer);
  if (parent !== undefined) t.children.get(parent)?.delete(peer);
  t.parent.delete(peer);
  t.children.delete(peer);
  t.relay.delete(peer);

  const ordered = [
    ...orphans.filter((id) => t.relay.get(id) === true),
    ...orphans.filter((id) => t.relay.get(id) !== true),
  ];
  return ordered.map((id) => attach(t, id, placement(t, id, cfg)));
}

/**
 * A peer changed its relay willingness (the Collect-screen toggle). Opting out
 * while seeding re-seats its children elsewhere.
 */
export function setRelay(
  t: TreeState,
  peer: string,
  relay: boolean,
  cfg: TreeConfig = DEFAULT_TREE_CONFIG,
): Assignment[] {
  if (!t.parent.has(peer)) {
    t.relay.set(peer, relay);
    return [];
  }
  t.relay.set(peer, relay);
  if (relay) return [];
  const kids = childrenOf(t, peer);
  return kids.map((id) => attach(t, id, placement(t, id, cfg)));
}

/**
 * A leaf reported its stream dead but its parent still looks present (e.g.
 * one-sided failure). Re-seat just that leaf away from its current parent.
 */
export function reseatOrphan(
  t: TreeState,
  peer: string,
  cfg: TreeConfig = DEFAULT_TREE_CONFIG,
): Assignment[] {
  if (!t.parent.has(peer)) return [];
  const current = t.parent.get(peer)!;
  // Temporarily detach so placement doesn't count the peer, then avoid
  // re-picking the parent that just failed it (unless it's the only option).
  t.children.get(current)?.delete(peer);
  t.parent.delete(peer);
  let target = placement(t, peer, cfg);
  if (target === current) {
    const alternates = childrenOf(t, ROOT).filter(
      (id) => id !== peer && id !== current && t.relay.get(id) === true && childCount(t, id) < cfg.seedCap,
    );
    target = alternates[0] ?? ROOT;
  }
  return [attach(t, peer, target)];
}

/** Sanity: every placed peer has a live parent chain to ROOT and no cycles (depth 1). */
export function isConsistent(t: TreeState): boolean {
  for (const [peer, parent] of t.parent) {
    if (parent !== ROOT && t.parent.get(parent) !== ROOT) return false;
    if (!t.children.get(parent)?.has(peer)) return false;
  }
  for (const [parent, kids] of t.children) {
    for (const k of kids) if (t.parent.get(k) !== parent) return false;
    if (parent !== ROOT && !t.parent.has(parent)) return false;
  }
  return true;
}
