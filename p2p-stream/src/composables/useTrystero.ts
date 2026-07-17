import { ref, computed, markRaw } from "vue";
import type { PeerInfo, UserRole } from "../types";
import { RTC_CONFIG, NOSTR_RELAYS } from "../types";
import { computeCounts, pruneStale, isValidStat, type SwarmStat } from "../lib/swarm/stats";

// Trystero strategies - lazy loaded
let joinRoomTorrent: any = null;
let joinRoomNostr: any = null;

export type TrysteroStrategy = "torrent" | "nostr" | "both";

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

  const peerCount = computed(() => peers.value.size);
  const isConnected = computed(() => peerCount.value > 0);
  const peerList = computed(() => Array.from(peers.value.values()));

  const selfStat = computed<SwarmStat>(() => ({
    role: myRole.value,
    recording: isRecordingLocal.value,
    lastSeen: Date.now(),
  }));
  // Swarm-wide totals everyone agrees on: our own stat plus every peer's.
  const counts = computed(() => computeCounts([selfStat.value, ...peerStats.value.values()]));

  // Lazy load strategy modules
  async function loadStrategy(strategy: "torrent" | "nostr") {
    if (strategy === "torrent" && !joinRoomTorrent) {
      const mod = await import("trystero/torrent");
      joinRoomTorrent = mod.joinRoom;
    } else if (strategy === "nostr" && !joinRoomNostr) {
      const mod = await import("trystero/nostr");
      joinRoomNostr = mod.joinRoom;
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

      isReady.value = true;
      return true;
    } catch (err: any) {
      error.value = `Failed to load strategies: ${err.message}`;
      return false;
    }
  }

  function resolveStrategies(strategies: TrysteroStrategy[]): ("torrent" | "nostr")[] {
    return strategies.includes("both")
      ? ["torrent", "nostr"]
      : (strategies.filter((s) => s !== "both") as ("torrent" | "nostr")[]);
  }

  function openRooms(campaignId: string, strategies: TrysteroStrategy[], role: UserRole, stream?: MediaStream) {
    leaveAllRooms();
    myRole.value = role;
    if (stream) localStream.value = stream;

    for (const strategy of resolveStrategies(strategies)) {
      const join = strategy === "nostr" ? joinRoomNostr : joinRoomTorrent;
      // Passing rtcConfig lets us add TURN relays for cross-network reach.
      // For the nostr strategy, pin a curated relay list — Trystero's defaults
      // include relays that reject our signaling and stall peer discovery.
      const config =
        strategy === "nostr"
          ? { appId: "p2p-es-v1", rtcConfig: RTC_CONFIG, relayUrls: NOSTR_RELAYS }
          : { appId: "p2p-es-v1", rtcConfig: RTC_CONFIG };
      const room: TrysteroRoom = join(config, campaignId);
      rooms.value.set(strategy, markRaw(room));
      if (!selfId.value) selfId.value = room.selfId;
      setupRoomHandlers(room, role);
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
  function setupRoomHandlers(roomInstance: TrysteroRoom, role: UserRole) {
    // Per-room stat channel for live watching/recording counts.
    const [sendStat, getStat] = roomInstance.makeAction("stat");
    statSenders.push(sendStat);
    getStat((data: unknown, peerId: string) => {
      if (!isValidStat(data)) return;
      peerStats.value.set(peerId, { role: data.role, recording: data.recording, lastSeen: Date.now() });
    });

    roomInstance.onPeerJoin((peerId: string) => {
      console.log(`[Trystero] Peer joined: ${peerId}`);
      if (!peers.value.has(peerId)) {
        peers.value.set(peerId, {
          id: peerId,
          displayName: `${role === "streamer" ? "Collector" : "Streamer"} ${peerId.slice(0, 6)}`,
          role: role === "streamer" ? "collector" : "streamer",
          connectionState: "connected",
          joinedAt: new Date(),
        });
      }

      // Anyone holding a local stream (i.e. the streamer) forwards it to every
      // newcomer — this is what makes LATE joiners actually receive video, the
      // bug in the previous version which only streamed to peers already present.
      if (localStream.value) {
        console.log(`[Trystero] Sending stream to ${peerId}`);
        try {
          roomInstance.addStream(localStream.value, peerId);
        } catch (err) {
          console.warn("[Trystero] addStream failed:", err);
        }
      }

      // Announce ourselves to the newcomer so counts converge immediately.
      broadcastStat();
    });

    roomInstance.onPeerLeave((peerId: string) => {
      console.log(`[Trystero] Peer left: ${peerId}`);
      peers.value.delete(peerId);
      peerStats.value.delete(peerId);
    });

    roomInstance.onPeerStream((receivedStream: MediaStream, peerId: string) => {
      console.log(`[Trystero] Received stream from ${peerId}`);
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

  // Update / swap the local stream (e.g. camera switch). Sends to all peers,
  // present and future (future via onPeerJoin reading localStream).
  function updateStream(stream: MediaStream | null) {
    localStream.value = stream;
    if (stream) {
      rooms.value.forEach((room) => {
        peers.value.forEach((peer) => {
          try {
            room.addStream(stream, peer.id);
          } catch (err) {
            console.warn("[Trystero] updateStream addStream failed:", err);
          }
        });
      });
    }
  }

  // Leave all rooms
  function leaveAllRooms() {
    stopHeartbeat();
    rooms.value.forEach((room) => room.leave());
    rooms.value.clear();
    peers.value.clear();
    peerStats.value.clear();
    statSenders = [];
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
    counts,
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
