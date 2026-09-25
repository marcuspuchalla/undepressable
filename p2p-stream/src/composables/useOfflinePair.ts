import { ref, shallowRef, onUnmounted } from "vue";
import { encodeSignal, decodeSignal } from "../lib/net/offlinePair";
import { capVideoSendersWithRetry, markMotionContent } from "../lib/net/senderTuning";
import { encodeLinkMsg, decodeLinkMsg, linkPhase, type LinkMsg, type LinkPhase } from "../lib/net/offlineLink";
import { channelWire, type ChannelWire } from "../lib/transfer/channelWire";
import { createSyncReceiver, createSyncSender } from "../lib/transfer/syncProtocol";
import { makeInbox, makeOutbox } from "../lib/transfer/library";

/**
 * Connections established entirely by hand, for when there is no internet to
 * discover anyone through.
 *
 * Each link starts as a bare data channel, because that is what fits in a
 * small, instantly scannable code (compactSignal.ts). The streamer's video
 * is then negotiated over that channel. One filming device can serve several
 * viewers: every "Add a viewer" is a fresh link, and existing ones keep
 * running.
 *
 * Deliberate differences from the online path:
 *   * `iceServers: []` — STUN/TURN are unreachable offline, and waiting on them
 *     would stall gathering. Host candidates are what connect on a hotspot.
 *   * Gathering must complete before a code is shown: a code cannot trickle.
 */

// Gathering host candidates is near-instant; this is only a stuck-state guard.
const GATHER_TIMEOUT_MS = 3000;
const HELLO_EVERY_MS = 3000;
/**
 * The viewer's side starts connectivity checks the moment it shows its reply,
 * but the streamer may take a while to scan it. Only give up after this long.
 */
const REPLY_WAIT_MS = 3 * 60_000;

/** Recordings handed over this link (face to face, no internet). */
export interface LinkTransfer {
  /** We are offering ours; how many the other device has confirmed. */
  sending: boolean;
  /** Recordings offered in the latest round (0: nothing new here). */
  offered: number | null;
  sent: number;
  /** Seconds of the recording currently going out / coming in. */
  outgoing: { done: number; total: number } | null;
  incoming: { done: number; total: number } | null;
  /** Complete, verified recordings received from the other device. */
  received: number;
  refused: string[];
}

export interface OfflineLinkView {
  id: number;
  label: string;
  phase: LinkPhase;
  /** The other side reports it is recording a copy. */
  peerRecording: boolean;
  connectedAt: number | null;
  transfer: LinkTransfer | null;
}

interface Link {
  id: number;
  label: string;
  role: "stream" | "watch";
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  createdAt: number;
  handshakeAt: number | null;
  channelOpen: boolean;
  everConnected: boolean;
  connectedAt: number | null;
  lastHeardAt: number | null;
  peerRecording: boolean;
  closedByUs: boolean;
  mediaAdded: boolean;
  negotiating: boolean;
  renegotiateAfter: boolean;
  sync: LinkSync | null;
}

interface LinkSync {
  wire: ChannelWire;
  sender: ReturnType<typeof createSyncSender> | null;
  receiver: ReturnType<typeof createSyncReceiver>;
  view: LinkTransfer;
}

export function useOfflinePair() {
  const links = shallowRef<OfflineLinkView[]>([]);
  const remoteStream = shallowRef<MediaStream | null>(null);
  const error = ref<string | null>(null);

  const all = new Map<number, Link>();
  let nextId = 1;
  let viewersInvited = 0;
  let pending: Link | null = null;
  let localStream: MediaStream | null = null;
  let recording = false;

  function phaseOf(l: Link, now: number): LinkPhase {
    if (l.role === "watch" && !l.everConnected && !l.closedByUs) {
      // Until the streamer scans our reply there is nothing to connect to.
      return now - l.createdAt > REPLY_WAIT_MS ? "timed-out" : "awaiting-reply";
    }
    return linkPhase({
      handshakeAt: l.handshakeAt,
      channelOpen: l.channelOpen,
      everConnected: l.everConnected,
      connectionState: l.pc.connectionState,
      lastHeardAt: l.lastHeardAt,
      closedByUs: l.closedByUs,
      now,
    });
  }

  function publish() {
    const now = Date.now();
    links.value = Array.from(all.values(), (l) => ({
      id: l.id,
      label: l.label,
      phase: phaseOf(l, now),
      peerRecording: l.peerRecording,
      connectedAt: l.connectedAt,
      transfer: l.sync ? { ...l.sync.view } : null,
    }));
  }

  function send(l: Link, msg: LinkMsg) {
    if (l.dc?.readyState !== "open") return;
    try {
      l.dc.send(encodeLinkMsg(msg));
    } catch {
      /* channel closing; the phase tick will notice */
    }
  }

  function hello(l: Link) {
    send(l, { t: "hello", role: l.role, recording });
  }

  // Heartbeats double as the liveness signal, and let the person filming see
  // that each viewer is really keeping a copy.
  const ticker = setInterval(() => {
    for (const l of all.values()) if (l.channelOpen) hello(l);
    if (all.size > 0) publish();
  }, HELLO_EVERY_MS);

  function createLink(role: "stream" | "watch", label: string): Link {
    const pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: "max-bundle" });
    const l: Link = {
      id: nextId++,
      label,
      role,
      pc,
      dc: null,
      createdAt: Date.now(),
      handshakeAt: null,
      channelOpen: false,
      everConnected: false,
      connectedAt: null,
      lastHeardAt: null,
      peerRecording: false,
      closedByUs: false,
      mediaAdded: false,
      negotiating: false,
      renegotiateAfter: false,
      sync: null,
    };
    pc.onconnectionstatechange = () => publish();
    // The viewer's control channel, and — either way — the recording
    // hand-over channel the other side opens when it sends.
    pc.ondatachannel = (e) => {
      if (e.channel.label === "sync") attachSync(l, e.channel);
      else if (role === "watch" && e.channel.label === "ctl") adoptChannel(l, e.channel);
    };
    pc.ontrack = (e) => {
      if (role !== "watch") return;
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      if (remoteStream.value !== stream) remoteStream.value = stream;
    };
    all.set(l.id, l);
    return l;
  }

  function adoptChannel(l: Link, dc: RTCDataChannel) {
    l.dc = dc;
    dc.onopen = () => {
      l.channelOpen = true;
      l.everConnected = true;
      l.connectedAt ??= Date.now();
      l.lastHeardAt = Date.now();
      hello(l);
      if (l.role === "stream") attachMedia(l);
      publish();
    };
    dc.onclose = () => {
      l.channelOpen = false;
      publish();
    };
    dc.onmessage = (e) => {
      onMessage(l, e.data).catch((err) => console.warn("[offline] control message failed:", err));
    };
  }

  async function onMessage(l: Link, raw: unknown) {
    const msg = decodeLinkMsg(raw);
    if (!msg) return;
    l.lastHeardAt = Date.now();
    if (msg.t === "hello") {
      l.peerRecording = msg.recording;
    } else if (msg.t === "bye") {
      l.pc.close();
      l.channelOpen = false;
    } else if (msg.t === "sdp") {
      if (msg.d.type === "offer" && l.role === "watch") {
        await l.pc.setRemoteDescription(msg.d);
        await l.pc.setLocalDescription(await l.pc.createAnswer());
        send(l, { t: "sdp", d: { type: "answer", sdp: l.pc.localDescription?.sdp ?? "" } });
      } else if (msg.d.type === "answer" && l.role === "stream") {
        await l.pc.setRemoteDescription(msg.d);
        l.negotiating = false;
        capVideoSendersWithRetry(l.pc);
        if (l.renegotiateAfter) {
          l.renegotiateAfter = false;
          await renegotiate(l);
        }
      }
    }
    publish();
  }

  // Only the streamer ever offers after the handshake, so offers cannot cross.
  async function renegotiate(l: Link) {
    if (l.negotiating) {
      l.renegotiateAfter = true;
      return;
    }
    l.negotiating = true;
    try {
      await l.pc.setLocalDescription(await l.pc.createOffer());
      send(l, { t: "sdp", d: { type: "offer", sdp: l.pc.localDescription?.sdp ?? "" } });
    } catch (err) {
      l.negotiating = false;
      console.warn("[offline] renegotiation failed:", err);
    }
  }

  function attachMedia(l: Link) {
    if (!localStream || l.mediaAdded) return;
    l.mediaAdded = true;
    for (const track of localStream.getTracks()) l.pc.addTrack(track, localStream);
    void renegotiate(l);
  }

  /** Resolve once ICE gathering finishes, so the code carries every candidate. */
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

  function localSdp(pc: RTCPeerConnection): string {
    const sdp = pc.localDescription?.sdp ?? "";
    if (!/a=candidate:/.test(sdp)) {
      throw new Error(
        "This device isn't on any network. Turn on a hotspot (or join the other device's), then try again.",
      );
    }
    return sdp;
  }

  // --- streamer -------------------------------------------------------------

  /** Build an invite code for the next viewer. An unanswered invite is replaced. */
  async function createInvite(stream: MediaStream): Promise<string> {
    error.value = null;
    localStream = stream;
    markMotionContent(stream);
    if (pending) {
      closeLink(pending.id, false);
      viewersInvited--;
    }
    const l = createLink("stream", `Viewer ${++viewersInvited}`);
    adoptChannel(l, l.pc.createDataChannel("ctl", { ordered: true }));
    await l.pc.setLocalDescription(await l.pc.createOffer());
    await waitForGathering(l.pc);
    pending = l;
    publish();
    return encodeSignal({ v: 2, t: "offer", s: localSdp(l.pc) });
  }

  /** Finish the handshake with the viewer's reply code. */
  async function acceptAnswer(code: string): Promise<void> {
    const signal = await decodeSignal(code);
    if (signal.t !== "answer") throw new Error("That's an invite code — scan the reply shown on the other device.");
    if (!pending) throw new Error("No invite is waiting for a reply — add a viewer to make a new one.");
    const l = pending;
    await l.pc.setRemoteDescription({ type: "answer", sdp: signal.s });
    l.handshakeAt = Date.now();
    pending = null;
    publish();
  }

  /** Swap in a new camera stream (e.g. after the OS killed the old one) without re-pairing. */
  async function replaceLocalStream(stream: MediaStream) {
    localStream = stream;
    markMotionContent(stream);
    for (const l of all.values()) {
      if (!l.mediaAdded) continue;
      for (const sender of l.pc.getSenders()) {
        const next = stream.getTracks().find((t) => t.kind === sender.track?.kind);
        if (next) await sender.replaceTrack(next).catch(() => {});
      }
    }
  }

  // --- watcher --------------------------------------------------------------

  /** Consume the streamer's invite and produce the reply code. */
  async function acceptOffer(code: string): Promise<string> {
    error.value = null;
    const signal = await decodeSignal(code);
    if (signal.t !== "offer") throw new Error("That's a reply code — scan the code shown on the filming device.");
    for (const l of Array.from(all.values())) closeLink(l.id, false);
    remoteStream.value = null;
    const l = createLink("watch", "Streamer");
    await l.pc.setRemoteDescription({ type: "offer", sdp: signal.s });
    await l.pc.setLocalDescription(await l.pc.createAnswer());
    await waitForGathering(l.pc);
    l.handshakeAt = Date.now();
    publish();
    return encodeSignal({ v: 2, t: "answer", s: localSdp(l.pc) });
  }

  /** Inbound video byte/frame counters, for noticing a frozen picture. */
  async function sampleInboundVideo(): Promise<{ bytesReceived: number; framesDecoded: number } | null> {
    let bytesReceived = 0;
    let framesDecoded = 0;
    let saw = false;
    for (const l of all.values()) {
      if (l.role !== "watch" || l.closedByUs) continue;
      const report = await l.pc.getStats().catch(() => null);
      report?.forEach((e: any) => {
        if (e.type === "inbound-rtp" && e.kind === "video") {
          saw = true;
          bytesReceived += e.bytesReceived ?? 0;
          framesDecoded += e.framesDecoded ?? 0;
        }
      });
    }
    return saw ? { bytesReceived, framesDecoded } : null;
  }

  // --- handing recordings over, face to face --------------------------------

  function attachSync(l: Link, dc: RTCDataChannel): LinkSync {
    if (l.sync) return l.sync;
    const view: LinkTransfer = { sending: false, offered: null, sent: 0, outgoing: null, incoming: null, received: 0, refused: [] };
    let sync: LinkSync | null = null;
    const wire = channelWire(dc, {
      onMsg: (msg) => {
        sync?.receiver.handle(msg, "peer");
        sync?.sender?.handle(msg, "peer");
      },
      onChunk: (id, p, bytes) => sync?.receiver.handleChunk(id, p, bytes),
    });
    // Anything a paired device sends is accepted — but only stored once its
    // signature verifies and every chunk matches it.
    const receiver = createSyncReceiver(wire, makeInbox(), {
      onProgress: ({ have, total }) => {
        view.incoming = { done: have, total };
        publish();
      },
      onComplete: () => {
        view.incoming = null;
        view.received++;
        publish();
      },
      onRejected: (id, reason) => {
        view.refused = [...view.refused, `${id.slice(0, 8)}: ${reason}`];
        publish();
      },
    });
    sync = { wire, sender: null, receiver, view };
    l.sync = sync;
    publish();
    return sync;
  }

  /** Offer this device's signed recordings to the device on the other end of a link. */
  function sendRecordings(id: number) {
    const l = all.get(id);
    if (!l || !l.channelOpen) return;
    const sync = l.sync ?? attachSync(l, l.pc.createDataChannel("sync", { ordered: true }));
    if (!sync.sender) {
      sync.sender = createSyncSender(sync.wire, makeOutbox(`link-${l.id}`, { remember: false }), {
        onOffered: (count) => {
          sync.view.offered = count;
          publish();
        },
        onProgress: ({ sent, total }) => {
          sync.view.outgoing = { done: sent, total };
          publish();
        },
        onDelivered: () => {
          sync.view.outgoing = null;
          sync.view.sent++;
          publish();
        },
        onRefused: (rid, reason) => {
          sync.view.refused = [...sync.view.refused, `${rid.slice(0, 8)}: ${reason}`];
          publish();
        },
      });
    }
    sync.view.sending = true;
    publish();
    // A channel created just now opens a moment later; sends wait for it.
    sync.sender.offerTo("peer");
  }

  // --- both -----------------------------------------------------------------

  function setRecording(value: boolean) {
    recording = value;
    for (const l of all.values()) hello(l);
  }

  function closeLink(id: number, publishNow = true) {
    const l = all.get(id);
    if (!l) return;
    send(l, { t: "bye" });
    l.closedByUs = true;
    if (pending === l) pending = null;
    try {
      l.pc.close();
    } catch {
      /* already closed */
    }
    l.sync?.sender?.stop();
    l.sync?.wire.close();
    all.delete(id);
    if (publishNow) publish();
  }

  function reset() {
    for (const id of Array.from(all.keys())) closeLink(id, false);
    pending = null;
    localStream = null;
    viewersInvited = 0;
    remoteStream.value = null;
    error.value = null;
    publish();
  }

  onUnmounted(() => {
    clearInterval(ticker);
    reset();
  });

  return {
    links,
    remoteStream,
    error,
    createInvite,
    acceptAnswer,
    replaceLocalStream,
    acceptOffer,
    sampleInboundVideo,
    setRecording,
    sendRecordings,
    closeLink,
    reset,
  };
}
