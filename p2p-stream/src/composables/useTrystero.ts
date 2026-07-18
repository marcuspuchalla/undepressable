import { ref, computed, markRaw } from "vue";
import type { PeerInfo, UserRole } from "../types";
import { NOSTR_RELAYS } from "../types";
import { getRtcConfig } from "../lib/net/iceConfig";
import { computeCounts, pruneStale, isValidStat, canTrackStat, type SwarmStat } from "../lib/swarm/stats";
import { capVideoSendersWithRetry, markMotionContent } from "../lib/net/senderTuning";
import {
  createRoutes,
  addMember,
  removeMember,
  claimOwner,
  ownerOf,
  allPeers,
  roomsWithPeer,
  clearRoutes,
} from "../lib/swarm/streamRouting";
import {
  ROOT,
  createTree,
  peerJoined as treePeerJoined,
  peerLeft as treePeerLeft,
  setRelay as treeSetRelay,
  reseatOrphan,
  childrenOf,
  isTreeMsg,
  type Assignment,
  type TreeMsg,
} from "../lib/swarm/tree";

// Trystero strategies - lazy loaded
let joinRoomTorrent: any = null;
let joinRoomNostr: any = null;
let joinRoomMqtt: any = null;

export type TrysteroStrategy = "torrent" | "nostr" | "mqtt" | "both";

// Trystero's action send/receive tuple. `send(data, targetPeers?)`; `receive`
// fires per incoming message with the sender's peer id.
type ActionSend = (data: unknown, targetPeers?: string | string[]) => void;
type ActionReceive = (cb: (data: unknown, peerId: string) => void) => void;

export interface TrysteroRoom {
  selfId: string;
  onPeerJoin: (callback: (peerId: string) => void) => void;
  onPeerLeave: (callback: (peerId: string) => void) => void;
  onPeerStream: (callback: (stream: MediaStream, peerId: string) => void) => void;
  addStream: (stream: MediaStream, peerId?: string) => void;
  removeStream: (stream: MediaStream, peerId?: string) => void;
  makeAction: (type: string) => [ActionSend, ActionReceive, unknown];
  getPeers: () => Record<string, RTCPeerConnection>;
  leave: () => void;
}

// How often each peer re-announces its stat, and how long before a silent peer
// is considered gone. The heartbeat also covers NAT keepalive for the channel.
const HEARTBEAT_MS = 4000;
const STAT_TTL_MS = 12000;

export function useTrystero() {
  const rooms = ref<Map<TrysteroStrategy, TrysteroRoom>>(new Map());
  const peers = ref<Map<string, PeerInfo>>(new Map());
  const localStream = ref<MediaStream | null>(null);
  const isConnecting = ref(false);
  const error = ref<string | null>(null);
  const selfId = ref<string>("");
  const activeStrategies = ref<TrysteroStrategy[]>([]);
  const isReady = ref(false);

  // --- swarm stats (watching / recording counts) ---
  const myRole = ref<UserRole>("collector");
  const isRecordingLocal = ref(false);
  const peerStats = ref<Map<string, SwarmStat>>(new Map());
  let statSenders: ActionSend[] = [];
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  // Which room carries media to each peer. Every strategy opens its own
  // RTCPeerConnection to the same peer, so without this the streamer would
  // upload one copy of the video per transport per watcher (up to 3×).
  const routes = createRoutes();

  // --- relay tree (docs/RELAY_TREE_DESIGN.md) ---
  // As streamer: authoritative topology — up to 2 direct children, relay-
  // willing children seed up to 4 more each. As collector: our place in it.
  let tree = createTree();
  const relayEnabled = ref(true); // hybrid default: willing to relay, opt-out toggle
  const myParent = ref<string | null>(null);
  const myTreeChildren = ref<string[]>([]);
  const forwardingTo = new Set<string>();
  let remoteStreamForTree: MediaStream | null = null;
  let treeSenders: { send: ActionSend; room: TrysteroRoom }[] = [];
  const relayingToCount = computed(() => myTreeChildren.value.length);

  const peerCount = computed(() => peers.value.size);
  const isConnected = computed(() => peerCount.value > 0);
  const peerList = computed(() => Array.from(peers.value.values()));
  // The transports actually open right now (torrent / nostr / mqtt) — used for
  // the on-screen connection badges.
  const connectedStrategies = computed(() => Array.from(rooms.value.keys()));

  const selfStat = computed<SwarmStat>(() => ({
    role: myRole.value,
    recording: isRecordingLocal.value,
    lastSeen: Date.now(),
  }));
  // Swarm-wide totals everyone agrees on: our own stat plus every peer's.
  const counts = computed(() => computeCounts([selfStat.value, ...peerStats.value.values()]));

  // Lazy load strategy modules
  async function loadStrategy(strategy: "torrent" | "nostr" | "mqtt") {
    if (strategy === "torrent" && !joinRoomTorrent) {
      const mod = await import("trystero/torrent");
      joinRoomTorrent = mod.joinRoom;
    } else if (strategy === "nostr" && !joinRoomNostr) {
      const mod = await import("trystero/nostr");
      joinRoomNostr = mod.joinRoom;
    } else if (strategy === "mqtt" && !joinRoomMqtt) {
      const mod = await import("trystero/mqtt");
      joinRoomMqtt = mod.joinRoom;
    }
  }

  // Initialize Trystero strategies
  async function init(strategies: TrysteroStrategy[]): Promise<boolean> {
    try {
      activeStrategies.value = strategies;

      if (strategies.includes("torrent") || strategies.includes("both")) {
        await loadStrategy("torrent");
      }
      if (strategies.includes("nostr") || strategies.includes("both")) {
        await loadStrategy("nostr");
      }
      if (strategies.includes("mqtt") || strategies.includes("both")) {
        await loadStrategy("mqtt");
      }

      isReady.value = true;
      return true;
    } catch (err: any) {
      error.value = `Failed to load strategies: ${err.message}`;
      return false;
    }
  }

  function resolveStrategies(strategies: TrysteroStrategy[]): ("torrent" | "nostr" | "mqtt")[] {
    // "both" now means "every zero-config transport" — the more independent
    // discovery paths, the faster and more reliably peers find each other.
    return strategies.includes("both")
      ? ["torrent", "nostr", "mqtt"]
      : (strategies.filter((s) => s !== "both") as ("torrent" | "nostr" | "mqtt")[]);
  }

  function openRooms(campaignId: string, strategies: TrysteroStrategy[], role: UserRole, stream?: MediaStream) {
    leaveAllRooms();
    myRole.value = role;
    if (stream) {
      markMotionContent(stream);
      localStream.value = stream;
    }

    for (const strategy of resolveStrategies(strategies)) {
      const join =
        strategy === "nostr" ? joinRoomNostr : strategy === "mqtt" ? joinRoomMqtt : joinRoomTorrent;
      // Passing rtcConfig lets us add TURN relays for cross-network reach;
      // resolved per-join so a runtime-configured TURN applies immediately.
      // For the nostr strategy, pin a curated relay list — Trystero's defaults
      // include relays that reject our signaling and stall peer discovery.
      const rtcConfig = getRtcConfig();
      const config =
        strategy === "nostr"
          ? { appId: "p2p-es-v1", rtcConfig, relayUrls: NOSTR_RELAYS }
          : { appId: "p2p-es-v1", rtcConfig };
      const room: TrysteroRoom = join(config, campaignId);
      rooms.value.set(strategy, markRaw(room));
      if (!selfId.value) selfId.value = room.selfId;
      setupRoomHandlers(room, strategy, role);
      console.log(`[Trystero] ${role === "streamer" ? "Created" : "Joined"} ${strategy} room:`, campaignId);
    }

    startHeartbeat();
  }

  // Create rooms as the streamer (source of video).
  async function createRoom(
    campaignId: string,
    strategies: TrysteroStrategy[],
    stream?: MediaStream,
  ): Promise<boolean> {
    error.value = null;
    isConnecting.value = true;
    try {
      openRooms(campaignId, strategies, "streamer", stream);
      isConnecting.value = false;
      return true;
    } catch (err: any) {
      error.value = err.message || "Failed to create room";
      isConnecting.value = false;
      return false;
    }
  }

  // Join rooms as a collector (watcher/recorder).
  async function joinRoom(campaignId: string, strategies: TrysteroStrategy[]): Promise<boolean> {
    error.value = null;
    isConnecting.value = true;
    try {
      openRooms(campaignId, strategies, "collector");
      isConnecting.value = false;
      return true;
    } catch (err: any) {
      error.value = err.message || "Failed to join room";
      isConnecting.value = false;
      return false;
    }
  }

  // Set up room event handlers
  function setupRoomHandlers(roomInstance: TrysteroRoom, strategy: string, role: UserRole) {
    // Per-room stat channel for live watching/recording counts.
    const [sendStat, getStat] = roomInstance.makeAction("stat");
    statSenders.push(sendStat);
    getStat((data: unknown, peerId: string) => {
      if (!isValidStat(data)) return;
      if (!canTrackStat(peerStats.value, peerId)) return;
      peerStats.value.set(peerId, { role: data.role, recording: data.recording, lastSeen: Date.now() });
    });

    // Relay-tree control channel (assignments, capability, orphan reports).
    const [sendTree, getTree] = roomInstance.makeAction("tree");
    treeSenders.push({ send: sendTree, room: roomInstance });
    getTree(handleTreeMsg);

    roomInstance.onPeerJoin((peerId: string) => {
      console.log(`[Trystero] Peer joined via ${strategy}: ${peerId}`);
      addMember(routes, strategy, peerId);
      if (!peers.value.has(peerId)) {
        peers.value.set(peerId, {
          id: peerId,
          displayName: `${role === "streamer" ? "Collector" : "Streamer"} ${peerId.slice(0, 6)}`,
          role: role === "streamer" ? "collector" : "streamer",
          connectionState: "connected",
          joinedAt: new Date(),
        });
      }

      // The relay tree decides who serves each newcomer. As the root we seat
      // the peer (assumed relay-willing until its hello says otherwise): a
      // direct child gets our stream — this is what makes LATE joiners
      // receive video — and one seated under a seed is served by that seed.
      // Only the FIRST room a peer connects through carries the media; the
      // other transports stay signaling/data-only so the uplink sends one copy.
      if (role === "streamer" && localStream.value) {
        applyAssignments(treePeerJoined(tree, peerId, true));
      } else if (role === "collector") {
        // Announce relay capability so the root can seat us properly.
        sendTreeMsg({ t: "hello", relay: relayEnabled.value }, peerId);
      }

      // Announce ourselves to the newcomer so counts converge immediately.
      broadcastStat();
    });

    roomInstance.onPeerLeave((peerId: string) => {
      console.log(`[Trystero] Peer left ${strategy}: ${peerId}`);
      const { gone, reassignTo } = removeMember(routes, strategy, peerId);
      if (gone) {
        // Only forget the peer once its LAST transport dropped — it may still
        // be connected (and receiving media) through another room.
        peers.value.delete(peerId);
        peerStats.value.delete(peerId);
        forwardingTo.delete(peerId);
        if (role === "streamer") {
          // Prune the tree; a dead seed's children get re-seated here.
          applyAssignments(treePeerLeft(tree, peerId));
        }
      } else if (reassignTo && localStream.value) {
        // The room that carried the media died; hand off to a surviving one.
        const survivor = rooms.value.get(reassignTo as TrysteroStrategy);
        if (survivor) {
          console.log(`[Trystero] Media handover for ${peerId}: ${strategy} → ${reassignTo}`);
          sendStreamTo(survivor, peerId);
        }
      }
    });

    roomInstance.onPeerStream((receivedStream: MediaStream, peerId: string) => {
      console.log(`[Trystero] Received stream from ${peerId}`);
      if (role === "collector") {
        // If we're a seed, pass the (possibly replaced) stream straight on to
        // our children — they roll recording segments exactly like we do.
        remoteStreamForTree = receivedStream;
        for (const id of forwardingTo) sendMediaTo(id, receivedStream);
      }
      onStreamReceived.value?.(receivedStream, peerId);
    });
  }

  // --- stat broadcasting ---
  function broadcastStat() {
    const wire = { role: myRole.value, recording: isRecordingLocal.value };
    for (const send of statSenders) {
      try {
        send(wire);
      } catch {
        /* channel not ready yet; the heartbeat will retry */
      }
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeat = setInterval(() => {
      broadcastStat();
      pruneStale(peerStats.value, Date.now(), STAT_TTL_MS);
    }, HEARTBEAT_MS);
  }

  function stopHeartbeat() {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  }

  /** Called by views when local recording starts/stops so the swarm count updates. */
  function setRecording(value: boolean) {
    isRecordingLocal.value = value;
    broadcastStat();
  }

  // Callback for when stream is received
  const onStreamReceived = ref<((stream: MediaStream, peerId: string) => void) | null>(null);

  function setOnStreamReceived(callback: (stream: MediaStream, peerId: string) => void) {
    onStreamReceived.value = callback;
  }

  // The room that carries (or should carry) media to a peer — first transport
  // the peer connected through, sticky thereafter.
  function transportFor(peerId: string): TrysteroRoom | undefined {
    let owner = ownerOf(routes, peerId);
    if (!owner) {
      owner = roomsWithPeer(routes, peerId)[0];
      if (owner) claimOwner(routes, owner, peerId);
    }
    return owner ? rooms.value.get(owner as TrysteroStrategy) : undefined;
  }

  // Send a stream to one peer over its owning room, with uplink caps applied.
  function sendMediaTo(peerId: string, stream: MediaStream) {
    const room = transportFor(peerId);
    if (!room) return;
    try {
      room.addStream(stream, peerId);
      // Cap the video bitrate so a weak phone uplink degrades instead of
      // stalling. Encodings appear only after negotiation, hence the retry.
      const pc = room.getPeers?.()[peerId];
      if (pc) capVideoSendersWithRetry(pc);
    } catch (err) {
      console.warn("[Trystero] addStream failed:", err);
    }
  }

  // Stop sending our outbound stream to a peer (it moved under a seed).
  function stopMediaTo(peerId: string) {
    const owner = ownerOf(routes, peerId);
    const room = owner ? rooms.value.get(owner as TrysteroStrategy) : undefined;
    const stream = localStream.value ?? remoteStreamForTree;
    if (!room || !stream) return;
    try {
      room.removeStream(stream, peerId);
    } catch {
      /* peer/stream already gone */
    }
  }

  // Kept for the transport-level media handover path.
  function sendStreamTo(roomInstance: TrysteroRoom, peerId: string) {
    const stream = localStream.value ?? remoteStreamForTree;
    if (!stream) return;
    try {
      roomInstance.addStream(stream, peerId);
      const pc = roomInstance.getPeers?.()[peerId];
      if (pc) capVideoSendersWithRetry(pc);
    } catch (err) {
      console.warn("[Trystero] addStream failed:", err);
    }
  }

  // --- relay tree plumbing ---

  // Send a tree message, targeted if `target` is set, via every room that can
  // reach it (Trystero warns loudly on sends to peers a room doesn't have).
  function sendTreeMsg(msg: TreeMsg, target?: string) {
    for (const s of treeSenders) {
      if (target && !s.room.getPeers?.()[target]) continue;
      try {
        s.send(msg, target);
      } catch {
        /* channel not ready; assignment resends cover this */
      }
    }
  }

  // ROOT ONLY: enact topology changes — announce them, start/stop our own
  // media sends, and refresh every seed's forwarding list.
  function applyAssignments(moves: Assignment[]) {
    for (const { peer, parent } of moves) {
      sendTreeMsg({ t: "assign", parent }, peer);
      if (parent === ROOT) {
        if (localStream.value) {
          console.log(`[Tree] Root streams directly to ${peer}`);
          sendMediaTo(peer, localStream.value);
        }
      } else {
        console.log(`[Tree] ${peer} seated under seed ${parent}`);
        stopMediaTo(peer);
      }
    }
    if (moves.length > 0) syncSeeds();
  }

  // ROOT ONLY: every direct child gets its (possibly empty) forwarding list.
  function syncSeeds() {
    for (const child of childrenOf(tree, ROOT)) {
      sendTreeMsg({ t: "children", children: childrenOf(tree, child) }, child);
    }
  }

  // SEED ONLY: make actual forwarding match the list the root assigned us.
  function reconcileForwarding() {
    const want = new Set(myTreeChildren.value);
    for (const id of want) {
      if (!forwardingTo.has(id) && remoteStreamForTree) {
        console.log(`[Tree] Forwarding stream to ${id}`);
        sendMediaTo(id, remoteStreamForTree);
        forwardingTo.add(id);
      }
    }
    for (const id of [...forwardingTo]) {
      if (!want.has(id)) {
        stopMediaTo(id);
        forwardingTo.delete(id);
      }
    }
  }

  // Collector toggle (hybrid model): willing to relay by default, opt out any
  // time. Opting out while seeding makes the root re-seat our children.
  function setRelayEnabled(value: boolean) {
    relayEnabled.value = value;
    sendTreeMsg({ t: "hello", relay: value });
  }

  // Called by the view when our incoming stream died but transports look
  // alive — asks the root to re-seat us (e.g. our seed silently broke).
  function reportStreamLost() {
    if (myRole.value !== "collector") return;
    sendTreeMsg({ t: "orphan" });
  }

  // Control messages must come from the streamer — peers are untrusted, and a
  // forged 'children' list would turn collectors into DoS amplifiers.
  function isFromStreamer(peerId: string): boolean {
    return peerStats.value.get(peerId)?.role === "streamer";
  }

  function handleTreeMsg(data: unknown, peerId: string) {
    if (!isTreeMsg(data)) return;
    if (myRole.value === "streamer") {
      if (data.t === "hello") {
        const moves = tree.parent.has(peerId)
          ? treeSetRelay(tree, peerId, data.relay)
          : treePeerJoined(tree, peerId, data.relay);
        applyAssignments(moves);
      } else if (data.t === "orphan") {
        console.log(`[Tree] Orphan report from ${peerId} — re-seating`);
        applyAssignments(reseatOrphan(tree, peerId));
      }
    } else {
      if (!isFromStreamer(peerId)) return;
      if (data.t === "assign") {
        myParent.value = data.parent;
      } else if (data.t === "children") {
        myTreeChildren.value = data.children;
        reconcileForwarding();
      }
    }
  }

  // Update / swap the local stream (e.g. camera switch/recovery). One copy per
  // served peer: as the root that means our DIRECT tree children — seeds pass
  // the replacement on to theirs when it reaches them.
  function updateStream(stream: MediaStream | null) {
    localStream.value = stream;
    if (!stream) return;
    markMotionContent(stream);
    const targets = myRole.value === "streamer" ? childrenOf(tree, ROOT) : [...allPeers(routes)];
    for (const peerId of targets) sendMediaTo(peerId, stream);
  }

  // Leave all rooms
  function leaveAllRooms() {
    stopHeartbeat();
    rooms.value.forEach((room) => room.leave());
    rooms.value.clear();
    peers.value.clear();
    peerStats.value.clear();
    clearRoutes(routes);
    statSenders = [];
    treeSenders = [];
    tree = createTree();
    myParent.value = null;
    myTreeChildren.value = [];
    forwardingTo.clear();
    remoteStreamForTree = null;
    selfId.value = "";
    isRecordingLocal.value = false;
  }

  // Leave rooms
  function leaveRoom() {
    leaveAllRooms();
  }

  // Get connection status for each strategy
  function getStrategyStatus(): { strategy: string; connected: boolean; peers: number }[] {
    return Array.from(rooms.value.keys()).map((strategy) => ({
      strategy,
      connected: true,
      peers: peers.value.size,
    }));
  }

  return {
    // State
    rooms,
    peers,
    localStream,
    isConnecting,
    error,
    selfId,
    activeStrategies,
    isReady,
    peerStats,
    myRole,
    // Computed
    peerCount,
    isConnected,
    peerList,
    connectedStrategies,
    counts,
    // Relay tree
    relayEnabled,
    relayingToCount,
    myParent,
    setRelayEnabled,
    reportStreamLost,
    // Methods
    init,
    createRoom,
    joinRoom,
    leaveRoom,
    leaveAllRooms,
    updateStream,
    setRecording,
    setOnStreamReceived,
    getStrategyStatus,
  };
}
