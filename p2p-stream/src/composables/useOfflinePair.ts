import { ref, onUnmounted } from "vue";
import { encodeSignal, decodeSignal } from "../lib/net/offlinePair";
import { capVideoSendersWithRetry, markMotionContent } from "../lib/net/senderTuning";

/**
 * One WebRTC connection established entirely by hand, for when there is no
 * internet to discover anyone through.
 *
 * Two deliberate differences from the normal path:
 *   * `iceServers: []` — STUN/TURN are unreachable offline, and waiting on them
 *     would stall gathering for seconds before we could draw a QR code. Host
 *     candidates are the only ones that can work on a hotspot anyway.
 *   * Gathering must COMPLETE before we encode, because a QR code cannot
 *     trickle later candidates.
 */

// Gathering host candidates is near-instant; this is only a stuck-state guard.
const GATHER_TIMEOUT_MS = 3000;

export function useOfflinePair() {
  const connectionState = ref<RTCPeerConnectionState>("new");
  const remoteStream = ref<MediaStream | null>(null);
  const error = ref<string | null>(null);

  let pc: RTCPeerConnection | null = null;

  function reset() {
    pc?.close();
    pc = null;
    connectionState.value = "new";
    remoteStream.value = null;
    error.value = null;
  }

  function createPeer(): RTCPeerConnection {
    reset();
    const conn = new RTCPeerConnection({ iceServers: [] });

    conn.onconnectionstatechange = () => {
      connectionState.value = conn.connectionState;
    };
    conn.ontrack = (event) => {
      remoteStream.value = event.streams[0] ?? new MediaStream([event.track]);
    };

    pc = conn;
    return conn;
  }

  /** Resolve once ICE gathering finishes, so the QR carries every candidate. */
  function waitForGathering(conn: RTCPeerConnection): Promise<void> {
    if (conn.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        conn.removeEventListener("icegatheringstatechange", onChange);
        resolve();
      };
      const onChange = () => {
        if (conn.iceGatheringState === "complete") done();
      };
      // Encode what we have rather than hanging forever on a stuck gatherer.
      const timer = setTimeout(done, GATHER_TIMEOUT_MS);
      conn.addEventListener("icegatheringstatechange", onChange);
    });
  }

  /** Streamer side: build the offer QR payload for the watcher to scan. */
  async function createOffer(stream: MediaStream): Promise<string> {
    error.value = null;
    const conn = createPeer();
    markMotionContent(stream);
    for (const track of stream.getTracks()) conn.addTrack(track, stream);

    await conn.setLocalDescription(await conn.createOffer());
    await waitForGathering(conn);
    return encodeSignal({ v: 1, t: "offer", s: conn.localDescription?.sdp ?? "" });
  }

  /** Streamer side: finish the handshake with the watcher's scanned answer. */
  async function acceptAnswer(text: string): Promise<void> {
    const signal = await decodeSignal(text);
    if (signal.t !== "answer") throw new Error("That code is an offer — scan the watcher's reply code");
    if (!pc) throw new Error("Start the offline stream again — this pairing expired");
    await pc.setRemoteDescription({ type: "answer", sdp: signal.s });
    capVideoSendersWithRetry(pc);
  }

  /** Watcher side: consume the streamer's offer and produce the reply QR. */
  async function acceptOffer(text: string): Promise<string> {
    error.value = null;
    const signal = await decodeSignal(text);
    if (signal.t !== "offer") throw new Error("That code is a reply — scan the streamer's code instead");

    const conn = createPeer();
    // Receive-only: the watcher shows and records, it never sends media back.
    conn.addTransceiver("video", { direction: "recvonly" });
    conn.addTransceiver("audio", { direction: "recvonly" });

    await conn.setRemoteDescription({ type: "offer", sdp: signal.s });
    await conn.setLocalDescription(await conn.createAnswer());
    await waitForGathering(conn);
    return encodeSignal({ v: 1, t: "answer", s: conn.localDescription?.sdp ?? "" });
  }

  onUnmounted(reset);

  return {
    connectionState,
    remoteStream,
    error,
    createOffer,
    acceptAnswer,
    acceptOffer,
    reset,
  };
}
