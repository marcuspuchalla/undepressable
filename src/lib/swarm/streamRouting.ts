// Media routing across parallel transports.
//
// Every transport strategy (torrent / nostr / mqtt) opens its OWN
// RTCPeerConnection to the same peer — Trystero does not dedupe across rooms.
// Naively adding the local stream on every room's peer-join therefore makes
// the streamer encode and upload one full copy of the video PER TRANSPORT per
// watcher (up to 3×), which collapses a phone uplink. These helpers track, per
// peer, which room "owns" the media so exactly one copy is ever sent, and hand
// ownership to a surviving room if the owning connection dies.

export interface StreamRoutes {
  /** room/strategy -> set of peer ids connected through it */
  members: Map<string, Set<string>>;
  /** peer id -> the single room currently carrying media to it */
  owners: Map<string, string>;
}

export function createRoutes(): StreamRoutes {
  return { members: new Map(), owners: new Map() };
}

/** Record a peer joining via a room. Returns true if this is the peer's first live connection. */
export function addMember(routes: StreamRoutes, room: string, peerId: string): boolean {
  let set = routes.members.get(room);
  if (!set) {
    set = new Set();
    routes.members.set(room, set);
  }
  const isFirst = !isMemberAnywhere(routes, peerId);
  set.add(peerId);
  return isFirst;
}

export interface RemovalResult {
  /** The peer has no connections left on any room. */
  gone: boolean;
  /** Media ownership moved to this room and the stream must be re-sent there. */
  reassignTo: string | null;
}

/** Record a peer leaving a room; reassigns media ownership if that room carried it. */
export function removeMember(routes: StreamRoutes, room: string, peerId: string): RemovalResult {
  routes.members.get(room)?.delete(peerId);
  const remaining = roomsWithPeer(routes, peerId);

  if (remaining.length === 0) {
    routes.owners.delete(peerId);
    return { gone: true, reassignTo: null };
  }

  if (routes.owners.get(peerId) === room) {
    const next = remaining[0];
    routes.owners.set(peerId, next);
    return { gone: false, reassignTo: next };
  }

  return { gone: false, reassignTo: null };
}

/**
 * Claim media ownership of a peer for `room` if nobody owns it yet.
 * Returns true when the caller should send the stream over this room.
 */
export function claimOwner(routes: StreamRoutes, room: string, peerId: string): boolean {
  if (routes.owners.has(peerId)) return false;
  routes.owners.set(peerId, room);
  return true;
}

/** The room currently carrying media to a peer (undefined if none claimed). */
export function ownerOf(routes: StreamRoutes, peerId: string): string | undefined {
  return routes.owners.get(peerId);
}

/** All peers connected via at least one room. */
export function allPeers(routes: StreamRoutes): Set<string> {
  const out = new Set<string>();
  for (const set of routes.members.values()) for (const id of set) out.add(id);
  return out;
}

export function roomsWithPeer(routes: StreamRoutes, peerId: string): string[] {
  const out: string[] = [];
  for (const [room, set] of routes.members) if (set.has(peerId)) out.push(room);
  return out;
}

function isMemberAnywhere(routes: StreamRoutes, peerId: string): boolean {
  for (const set of routes.members.values()) if (set.has(peerId)) return true;
  return false;
}

export function clearRoutes(routes: StreamRoutes): void {
  routes.members.clear();
  routes.owners.clear();
}
