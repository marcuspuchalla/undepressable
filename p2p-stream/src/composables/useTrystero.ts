import { ref, shallowRef, computed, markRaw } from "vue";
import type { PeerInfo, UserRole } from "../types";
import { NOSTR_RELAYS, TORRENT_TRACKERS } from "../types";
import { resolveRtcConfig } from "../lib/net/iceConfig";
import { createConnectionMonitor, type ConnectionMonitor, type ConnectionReport } from "../lib/net/connectionMonitor";
import { planDiscovery, getCustomRelays, isCustomRelaysOnly } from "../lib/net/discoveryConfig";
import { computeCounts, pruneStale, isValidStat, canTrackStat, type SwarmStat } from "../lib/swarm/stats";
import { createControlGate } from "../lib/swarm/controlAuth";
import { summarizeRelays, type RelayHealth } from "../lib/net/relayHealth";
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

// Each strategy's live relay sockets, so relay rot is observable without
// opening extra connections to probe with.
const relaySocketGetters: Record<string, () => Record<string, { readyState: number } | null>> = {};

// The most recent connection report from any instance, for the debug panel
// (which is not the component that owns the connection).
export const latestConnectionReport = shallowRef<ConnectionReport | null>(null);
if (typeof window !== "undefined") {
  (window as any).__undepressableConnections = () => latestConnectionReport.value;
}

// Rooms open per transport, across every useTrystero instance (the collector
// runs a second one for home-archive forwarding). Trystero shares one set of
// relay sockets per transport, so they may only be closed when this hits 0.
const openRoomsPerStrategy: Record<string, number> = {};

// Safety valve: `localStorage.undepressable_no_instrument = "1"` hands Trystero
// the browser's own RTCPeerConnection (no fast gathering, no rescue, no
// diagnostics) — for isolating a problem on some browser in the field.
function instrumentationEnabled(): boolean {
  if (typeof RTCPeerConnection === "undefined") return false;
  try {
    return localStorage.getItem("undepressable_no_instrument") !== "1";
  } catch {
    return true;
  }
}

// Trystero hands back the *existing* room object for a room id until that
// room's async leave() has finished (~100 ms). Re-joining sooner — e.g. the
// streamer re-opening its room to pick up a new relay — got a room that was
// about to shut itself down, and the streamer silently stopped announcing.
// In-flight leaves are tracked here so a rejoin can wait them out.
const leavingRooms = new Map<string, Promise<void>>();
const LEAVE_WAIT_MS = 2000;

type ClosableSocket = { readyState: number; onclose: unknown; close: () => void };

// Trystero re-creates its relay sockets on every join after a leave but never
// closes the old ones — and each keeps auto-reconnecting forever. Every retry
// used to leak another set. Close the old set once nothing uses it.
function releaseRelaySockets(strategy: string, sockets: Record<string, ClosableSocket | null>) {
  // MQTT sockets belong to mqtt.js, which would just reconnect them.
  if (strategy === "mqtt") return;
  for (const socket of Object.values(sockets)) {
    if (!socket) continue;
    try {
      socket.onclose = null; // disarm Trystero's reconnect loop first
      if (socket.readyState <= 1) socket.close();
    } catch {
      /* already gone */
    }
  }
}

export type TrysteroStrategy = "torrent" | "nostr" | "mqtt" | "both";

// Trystero's action send/receive tuple. `send(data, targetPeers?)`; `receive`
// fires per incoming message with the sender's peer id.
// Binary payloads may carry a small JSON `meta` object alongside.
type ActionSend = (data: unknown, targetPeers?: string | string[], meta?: Record<string, unknown>) => unknown;
type ActionReceive = (cb: (data: unknown, peerId: string, meta?: unknown) => void) => void;

/** A feature's own data channel over the room (see addChannel). */
export interface RoomChannel {
  /** Send to one peer over the transport that carries it; resolves once handed to the connection. */
  send(data: unknown, peerId: string, meta?: Record<string, unknown>): Promise<boolean>;
  /** Send to every connected peer; failures are ignored (for small, frequent messages). */
  broadcast(data: unknown): void;
  remove(): void;
}

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

  // --- connection observability (lib/net/connectionMonitor.ts) ---
  // One monitor per session: it instruments every RTCPeerConnection Trystero
  // opens for us, and is ended (closing leftovers) when we leave.
  let monitor: ConnectionMonitor | null = null;
  let session = 0;
  const roomIds = new Map<string, string>();
  const joinedAt = ref<number | null>(null);
  const connectionReport = shallowRef<ConnectionReport | null>(null);
  let reportTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleReport() {
    if (reportTimer) return;
    reportTimer = setTimeout(() => {
      reportTimer = null;
      connectionReport.value = monitor ? monitor.report() : null;
      if (connectionReport.value) latestConnectionReport.value = connectionReport.value;
    }, 250);
  }

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

  // Who may reshape our place in the relay tree, and a short holding area for
  // instructions that outrun the sender's identity.
  const controlGate = createControlGate();

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

  // Channels added by features built on top of a room (recording sync).
  // They outlive re-joins: every room opened later is wired up too.
  interface ExtraChannel {
    onData: (data: unknown, peerId: string, meta?: unknown) => void;
    onPeerJoin?: (peerId: string) => void;
    senders: Map<TrysteroRoom, ActionSend>;
  }
  const extraChannels = new Map<string, ExtraChannel>();
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
      relaySocketGetters.torrent = mod.getRelaySockets as any;
    } else if (strategy === "nostr" && !joinRoomNostr) {
      const mod = await import("trystero/nostr");
      joinRoomNostr = mod.joinRoom;
      relaySocketGetters.nostr = mod.getRelaySockets as any;
    } else if (strategy === "mqtt" && !joinRoomMqtt) {
      const mod = await import("trystero/mqtt");
      joinRoomMqtt = mod.joinRoom;
      relaySocketGetters.mqtt = mod.getRelaySockets as any;
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

  async function openRooms(campaignId: string, strategies: TrysteroStrategy[], role: UserRole, stream?: MediaStream) {
    leaveAllRooms();
    const mySession = ++session;
    myRole.value = role;
    if (stream) {
      markMotionContent(stream);
      localStream.value = stream;
    }

    // Resolved per join so relay settings changed a moment ago apply, and a
    // credentials URL gets fresh short-lived credentials.
    const rtcConfig = await resolveRtcConfig();
    if (mySession !== session) return; // left (or re-joined) while we waited

    monitor = createConnectionMonitor({ onChange: scheduleReport });
    joinedAt.value = Date.now();
    connectionReport.value = monitor.report();
    const rtcPolyfill = instrumentationEnabled() ? monitor.peerClass() : undefined;

    // A self-hosted relay (Network page, or adopted from a share link) goes
    // first; in "only my relays" mode the public transports stay off.
    const plan = planDiscovery(NOSTR_RELAYS, getCustomRelays(), isCustomRelaysOnly());
    let resolved = resolveStrategies(strategies);
    if (!plan.usePublicTransports) resolved = resolved.filter((s) => s === "nostr");
    if (resolved.length === 0) resolved = ["nostr"];
    if (resolved.includes("nostr")) await loadStrategy("nostr");
    if (mySession !== session) return;

    for (const strategy of resolved) {
      const leaving = leavingRooms.get(`${strategy}:${campaignId}`);
      if (leaving) {
        await Promise.race([leaving, new Promise((r) => setTimeout(r, LEAVE_WAIT_MS))]);
        if (mySession !== session) return;
      }
      const join =
        strategy === "nostr" ? joinRoomNostr : strategy === "mqtt" ? joinRoomMqtt : joinRoomTorrent;
      // Pin relay lists for nostr and torrent — Trystero's defaults include
      // relays that reject our signaling or no longer exist (types.ts).
      const relayUrls =
        strategy === "nostr" ? plan.nostrRelays : strategy === "torrent" ? TORRENT_TRACKERS : undefined;
      const config = {
        appId: "p2p-es-v1",
        rtcConfig,
        ...(rtcPolyfill ? { rtcPolyfill } : {}),
        ...(relayUrls ? { relayUrls } : {}),
      };
      const room: TrysteroRoom = join(config, campaignId);
      rooms.value.set(strategy, markRaw(room));
      roomIds.set(strategy, campaignId);
      openRoomsPerStrategy[strategy] = (openRoomsPerStrategy[strategy] ?? 0) + 1;
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
      await openRooms(campaignId, strategies, "streamer", stream);
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
      await openRooms(campaignId, strategies, "collector");
      isConnecting.value = false;
      return true;
    } catch (err: any) {
      error.value = err.message || "Failed to join room";
      isConnecting.value = false;
      return false;
    }
  }

  // A room we have left can still fire: a negotiation in flight when we left
  // may complete afterwards and attach to the old room. That zombie makes the
  // other device believe it is connected to us, so it ignores the real
  // connection from our new room — a deadlock (found via the home-archive
  // E2E run). Closing the zombie frees the other side to accept the real one.
  function isStale(roomInstance: TrysteroRoom, strategy: string): boolean {
    return rooms.value.get(strategy as TrysteroStrategy) !== roomInstance;
  }

  // Set up room event handlers
  function setupRoomHandlers(roomInstance: TrysteroRoom, strategy: string, role: UserRole) {
    // Per-room stat channel for live watching/recording counts.
    const [sendStat, getStat] = roomInstance.makeAction("stat");
    statSenders.push(sendStat);
    getStat((data: unknown, peerId: string) => {
      if (isStale(roomInstance, strategy)) return;
      if (!isValidStat(data)) return;
      if (!canTrackStat(peerStats.value, peerId)) return;
      peerStats.value.set(peerId, { role: data.role, recording: data.recording, lastSeen: Date.now() });
      // Learning who the streamer is unblocks any tree instruction that raced
      // ahead of this stat. Identity is remembered, so a stat pruned on a bad
      // link does not silently revoke the root's authority.
      for (const held of controlGate.noteRole(peerId, data.role)) {
        if (myRole.value !== "streamer" && isTreeMsg(held)) applyTreeInstruction(held);
      }
    });

    // Relay-tree control channel (assignments, capability, orphan reports).
    const [sendTree, getTree] = roomInstance.makeAction("tree");
    treeSenders.push({ send: sendTree, room: roomInstance });
    getTree((data: unknown, peerId: string) => {
      if (!isStale(roomInstance, strategy)) handleTreeMsg(data, peerId);
    });

    for (const [name, ch] of extraChannels) wireChannel(roomInstance, strategy, name, ch);

    roomInstance.onPeerJoin((peerId: string) => {
      if (isStale(roomInstance, strategy)) {
        console.log(`[Trystero] Closing late connection to ${peerId} on a room we already left`);
        try {
          roomInstance.getPeers?.()[peerId]?.close();
        } catch {
          /* already gone */
        }
        return;
      }
      console.log(`[Trystero] Peer joined via ${strategy}: ${peerId}`);
      addMember(routes, strategy, peerId);
      const isNewPeer = !peers.value.has(peerId);
      if (isNewPeer) {
        peers.value.set(peerId, {
          id: peerId,
          displayName: `${role === "streamer" ? "Collector" : "Streamer"} ${peerId.slice(0, 6)}`,
          role: role === "streamer" ? "collector" : "streamer",
          connectionState: "connected",
          joinedAt: new Date(),
        });
        for (const ch of extraChannels.values()) {
          try {
            ch.onPeerJoin?.(peerId);
          } catch (err) {
            console.warn("[Trystero] channel peer-join handler failed:", err);
          }
        }
      }

      // Announce who we are BEFORE issuing any tree instruction: a watcher
      // that doesn't yet know the root is the streamer would have to park the
      // instruction instead of acting on it.
      broadcastStat();

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
        // A child can be assigned to us BEFORE our mesh connection to it
        // exists — deliver the pending forward now that it does.
        if (forwardingTo.has(peerId) && remoteStreamForTree) {
          console.log(`[Tree] Forwarding stream to late-connecting child ${peerId}`);
          sendMediaTo(peerId, remoteStreamForTree);
        }
      }
    });

    roomInstance.onPeerLeave((peerId: string) => {
      if (isStale(roomInstance, strategy)) return;
      console.log(`[Trystero] Peer left ${strategy}: ${peerId}`);
      const { gone, reassignTo } = removeMember(routes, strategy, peerId);
      if (gone) {
        // Only forget the peer once its LAST transport dropped — it may still
        // be connected (and receiving media) through another room.
        peers.value.delete(peerId);
        peerStats.value.delete(peerId);
        forwardingTo.delete(peerId);
        mediaSentTo.delete(peerId);
        controlGate.forget(peerId);
        if (role === "streamer") {
          // Prune the tree; a dead seed's children get re-seated here.
          applyAssignments(treePeerLeft(tree, peerId));
        }
      } else {
        // The peer is still reachable via another transport. If the dead one
        // carried our media, re-send over the survivor (routes already moved
        // ownership there); sendMediaTo re-adds because the strategy changed.
        const stream = outboundStreamFor(peerId);
        if (reassignTo && stream && mediaSentTo.has(peerId)) {
          console.log(`[Trystero] Media handover for ${peerId}: ${strategy} → ${reassignTo}`);
          sendMediaTo(peerId, stream);
        }
      }
    });

    roomInstance.onPeerStream((receivedStream: MediaStream, peerId: string) => {
      if (isStale(roomInstance, strategy)) return;
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

  // --- feature channels ---

  function wireChannel(room: TrysteroRoom, strategy: string, name: string, ch: ExtraChannel) {
    const [send, receive] = room.makeAction(name) as unknown as [ActionSend, ActionReceive];
    ch.senders.set(room, send);
    receive((data, peerId, meta) => {
      if (!isStale(room, strategy) && extraChannels.get(name) === ch) ch.onData(data, peerId, meta);
    });
  }

  /**
   * Open a named data channel (at most 12 bytes) on every room, now and after
   * re-joins. `onPeerJoin` fires once per newly connected peer — and right
   * away for peers already connected. A send goes once, over the transport
   * that carries that peer, and resolves after Trystero's flow control let it
   * through, so awaiting sends paces a bulk transfer.
   */
  function addChannel(
    name: string,
    handlers: { onData: (data: unknown, peerId: string, meta?: unknown) => void; onPeerJoin?: (peerId: string) => void },
  ): RoomChannel {
    const ch: ExtraChannel = { ...handlers, senders: new Map() };
    extraChannels.set(name, ch);
    rooms.value.forEach((room, strategy) => wireChannel(room, strategy, name, ch));
    for (const peerId of peers.value.keys()) handlers.onPeerJoin?.(peerId);
    const sendTo = async (data: unknown, peerId: string, meta?: Record<string, unknown>) => {
      const strategy = transportStrategyFor(peerId);
      const room = strategy ? rooms.value.get(strategy as TrysteroStrategy) : undefined;
      const send = room ? ch.senders.get(room) : undefined;
      if (!send) return false;
      const result = send(data, peerId, meta);
      await Promise.all(Array.isArray(result) ? result : [result]);
      return true;
    };
    return {
      send: sendTo,
      broadcast(data) {
        for (const peerId of peers.value.keys()) sendTo(data, peerId).catch(() => {});
      },
      remove() {
        if (extraChannels.get(name) === ch) extraChannels.delete(name);
      },
    };
  }

  // --- stat broadcasting ---
  function broadcastStat() {
    const wire = { role: myRole.value, recording: isRecordingLocal.value };
    for (const send of statSenders) {
      try {
        quiet(send(wire));
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

  // What we have actually addStream'd, per peer. Duplicate addTrack on the
  // same RTCPeerConnection throws (and Trystero's async internals turn that
  // into unhandled rejections), so sends must be idempotent.
  const mediaSentTo = new Map<string, { strategy: string; stream: MediaStream }>();

  // Trystero's send/addStream are async under the hood; a dead data channel
  // rejects instead of throwing. Swallow rejections — retries and handovers
  // are handled explicitly at this layer.
  function quiet(result: unknown) {
    if (Array.isArray(result)) {
      for (const p of result) Promise.resolve(p).catch(() => {});
    } else if (result instanceof Promise) {
      result.catch(() => {});
    }
  }

  // The strategy that carries (or should carry) media to a peer — first
  // transport the peer connected through, sticky thereafter.
  function transportStrategyFor(peerId: string): string | undefined {
    let owner = ownerOf(routes, peerId);
    if (!owner) {
      owner = roomsWithPeer(routes, peerId)[0];
      if (owner) claimOwner(routes, owner, peerId);
    }
    return owner;
  }

  // Send a stream to one peer over its owning room, idempotently, with uplink
  // caps applied.
  function sendMediaTo(peerId: string, stream: MediaStream) {
    const strategy = transportStrategyFor(peerId);
    const room = strategy ? rooms.value.get(strategy as TrysteroStrategy) : undefined;
    if (!strategy || !room) return;
    const prev = mediaSentTo.get(peerId);
    if (!prev || prev.strategy !== strategy || prev.stream !== stream) {
      try {
        quiet(room.addStream(stream, peerId));
        mediaSentTo.set(peerId, { strategy, stream });
      } catch (err) {
        console.warn("[Trystero] addStream failed:", err);
        return;
      }
    }
    // Cap the video bitrate so a weak phone uplink degrades instead of
    // stalling. Encodings appear only after negotiation, hence the retry.
    const pc = room.getPeers?.()[peerId];
    if (pc) capVideoSendersWithRetry(pc);
  }

  // Stop sending our outbound stream to a peer (it moved under a seed).
  function stopMediaTo(peerId: string) {
    const rec = mediaSentTo.get(peerId);
    if (!rec) return;
    mediaSentTo.delete(peerId);
    const room = rooms.value.get(rec.strategy as TrysteroStrategy);
    if (!room) return;
    try {
      quiet(room.removeStream(rec.stream, peerId));
    } catch {
      /* peer/stream already gone */
    }
  }

  // The stream this node is responsible for sending to a given peer, if any:
  // roots serve their direct tree children, seeds serve their assigned leaves.
  function outboundStreamFor(peerId: string): MediaStream | null {
    if (myRole.value === "streamer") return localStream.value;
    return forwardingTo.has(peerId) ? remoteStreamForTree : null;
  }

  // --- relay tree plumbing ---

  // Send a tree message, targeted if `target` is set, via every room that can
  // reach it (Trystero warns loudly on sends to peers a room doesn't have).
  function sendTreeMsg(msg: TreeMsg, target?: string) {
    for (const s of treeSenders) {
      if (target && !s.room.getPeers?.()[target]) continue;
      try {
        quiet(s.send(msg, target));
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
  // forwardingTo is the INTENT set — a child we can't reach yet is delivered
  // by onPeerJoin when its connection appears (sendMediaTo is idempotent).
  function reconcileForwarding() {
    const want = new Set(myTreeChildren.value);
    for (const id of want) {
      if (!forwardingTo.has(id)) {
        console.log(`[Tree] Forwarding stream to ${id}`);
        forwardingTo.add(id);
      }
      if (remoteStreamForTree) sendMediaTo(id, remoteStreamForTree);
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
      // Only the streamer may reshape the tree — a forged 'children' list would
      // turn watchers into DoS amplifiers. If we don't know who this is yet,
      // hold the instruction rather than dropping it: the root announces
      // assignments before its first stat arrives.
      if (!controlGate.isStreamer(peerId)) {
        controlGate.hold(peerId, data);
        return;
      }
      applyTreeInstruction(data);
    }
  }

  function applyTreeInstruction(data: TreeMsg) {
    if (data.t === "assign") {
      myParent.value = data.parent;
    } else if (data.t === "children") {
      myTreeChildren.value = data.children;
      reconcileForwarding();
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
    session++;
    stopHeartbeat();
    rooms.value.forEach((room, strategy) => {
      const left = Math.max(0, (openRoomsPerStrategy[strategy] ?? 1) - 1);
      openRoomsPerStrategy[strategy] = left;
      // Capture this session's sockets now: the next join replaces them.
      let sockets: Record<string, ClosableSocket | null> = {};
      try {
        if (left === 0) sockets = (relaySocketGetters[strategy]?.() ?? {}) as Record<string, ClosableSocket | null>;
      } catch {
        /* no sockets to release */
      }
      const leaveKey = `${strategy}:${roomIds.get(strategy) ?? ""}`;
      const leaving = Promise.resolve(room.leave())
        .catch(() => {})
        .finally(() => {
          if (leavingRooms.get(leaveKey) === leaving) leavingRooms.delete(leaveKey);
          if (left === 0 && (openRoomsPerStrategy[strategy] ?? 0) === 0) releaseRelaySockets(strategy, sockets);
          else if (left === 0) {
            // Someone re-joined meanwhile; release only sockets they did not inherit.
            const current = new Set(Object.values(relaySocketGetters[strategy]?.() ?? {}));
            releaseRelaySockets(
              strategy,
              Object.fromEntries(Object.entries(sockets).filter(([, sock]) => !current.has(sock as any))),
            );
          }
        });
      leavingRooms.set(leaveKey, leaving);
    });
    rooms.value.clear();
    roomIds.clear();
    monitor?.end();
    monitor = null;
    joinedAt.value = null;
    connectionReport.value = null;
    if (reportTimer) {
      clearTimeout(reportTimer);
      reportTimer = null;
    }
    peers.value.clear();
    peerStats.value.clear();
    clearRoutes(routes);
    controlGate.clear();
    statSenders = [];
    treeSenders = [];
    for (const ch of extraChannels.values()) ch.senders.clear();
    tree = createTree();
    myParent.value = null;
    myTreeChildren.value = [];
    forwardingTo.clear();
    mediaSentTo.clear();
    remoteStreamForTree = null;
    selfId.value = "";
    isRecordingLocal.value = false;
  }

  // Leave rooms
  function leaveRoom() {
    leaveAllRooms();
  }

  /**
   * Totals for the video we are RECEIVING, across every transport.
   *
   * Track `ended`/`mute` events miss the common failure on a bad network: the
   * path silently stops delivering while the track stays live. Watching these
   * counters is the only way to notice the picture froze.
   */
  async function sampleInboundVideo(): Promise<{ bytesReceived: number; framesDecoded: number } | null> {
    const connections: RTCPeerConnection[] = [];
    for (const room of rooms.value.values()) {
      for (const pc of Object.values(room.getPeers?.() ?? {})) connections.push(pc);
    }
    if (connections.length === 0) return null;

    let bytesReceived = 0;
    let framesDecoded = 0;
    let sawInbound = false;

    const reports = await Promise.all(
      connections.map((pc) => pc.getStats().catch(() => null)),
    );
    for (const report of reports) {
      if (!report) continue;
      report.forEach((entry: any) => {
        if (entry.type === "inbound-rtp" && entry.kind === "video") {
          sawInbound = true;
          bytesReceived += entry.bytesReceived ?? 0;
          framesDecoded += entry.framesDecoded ?? 0;
        }
      });
    }
    return sawInbound ? { bytesReceived, framesDecoded } : null;
  }

  /**
   * Which discovery relays are up. Public relays here rot in weeks, and the
   * symptom is always "peers mysteriously can't find each other" — so make it
   * inspectable rather than something to rediscover by bisection.
   */
  function getRelayHealth(): RelayHealth {
    const sockets: Record<string, Record<string, { readyState: number } | null>> = {};
    for (const [strategy, getSockets] of Object.entries(relaySocketGetters)) {
      try {
        sockets[strategy] = getSockets() ?? {};
      } catch {
        sockets[strategy] = {};
      }
    }
    return summarizeRelays(sockets);
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
    joinedAt,
    connectionReport,
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
    addChannel,
    /** Has this peer announced itself as the one filming? (Unauthenticated: a hint, not proof.) */
    isStreamerPeer: (peerId: string) => controlGate.isStreamer(peerId),
    sampleInboundVideo,
    getRelayHealth,
    getStrategyStatus,
  };
}
