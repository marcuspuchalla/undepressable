// The control channel of an offline pairing, and how to read a link's state.
//
// An offline link starts as a bare data channel (it is what fits in a small
// QR code — see compactSignal.ts). Everything after that travels over the
// channel itself: the streamer's video is negotiated there, and both sides
// say every few seconds whether they are still there and still recording, so
// the person filming can see that a copy is actually being kept.

import { isAttestationShape, type Attestation } from "../corroborate/attest";

export type LinkMsg =
  | { t: "sdp"; d: { type: "offer" | "answer"; sdp: string } }
  | { t: "hello"; role: "stream" | "watch"; recording: boolean }
  // The filming device's signed fingerprint of its picture (lib/corroborate),
  // passed down a chain unchanged.
  | { t: "att"; a: Attestation }
  | { t: "bye" };

/** Cap on what we will parse from the peer; an SDP with media is a few KB. */
const MAX_MSG_BYTES = 64 * 1024;

export function encodeLinkMsg(msg: LinkMsg): string {
  return JSON.stringify(msg);
}

export function decodeLinkMsg(raw: unknown): LinkMsg | null {
  if (typeof raw !== "string" || raw.length > MAX_MSG_BYTES) return null;
  let m: any;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object") return null;
  if (m.t === "sdp") {
    const d = m.d;
    if (!d || (d.type !== "offer" && d.type !== "answer") || typeof d.sdp !== "string") return null;
    return { t: "sdp", d: { type: d.type, sdp: d.sdp } };
  }
  if (m.t === "hello") {
    if ((m.role !== "stream" && m.role !== "watch") || typeof m.recording !== "boolean") return null;
    return { t: "hello", role: m.role, recording: m.recording };
  }
  if (m.t === "att") {
    const a = m.a;
    if (!isAttestationShape(a)) return null;
    return { t: "att", a: { v: 1, s: a.s, n: a.n, t: a.t, f: a.f, pk: a.pk, sig: a.sig } };
  }
  if (m.t === "bye") return { t: "bye" };
  return null;
}

export type LinkPhase =
  | "awaiting-reply" // streamer: invite shown, their reply not scanned yet
  | "connecting" // handshake done, ICE/DTLS in progress
  | "connected" // control channel open
  | "timed-out" // never connected
  | "lost" // was connected, now gone
  | "closed"; // ended on purpose

export interface LinkFacts {
  /** When the peer's description was applied (null: not yet). */
  handshakeAt: number | null;
  channelOpen: boolean;
  everConnected: boolean;
  connectionState: RTCPeerConnectionState;
  /** Last control message from the peer. */
  lastHeardAt: number | null;
  closedByUs: boolean;
  now: number;
}

/** Local networks connect in well under a second; this is generous. */
export const OFFLINE_CONNECT_TIMEOUT_MS = 20_000;
/** Heartbeats every few seconds; silence this long means the peer is gone. */
export const OFFLINE_SILENCE_MS = 15_000;

export function linkPhase(f: LinkFacts): LinkPhase {
  if (f.closedByUs) return "closed";
  if (f.handshakeAt === null) return "awaiting-reply";
  const dead = f.connectionState === "failed" || f.connectionState === "closed";
  if (f.everConnected) {
    if (dead) return "lost";
    if (f.lastHeardAt !== null && f.now - f.lastHeardAt > OFFLINE_SILENCE_MS) return "lost";
    return f.channelOpen ? "connected" : "lost";
  }
  if (dead || f.now - f.handshakeAt > OFFLINE_CONNECT_TIMEOUT_MS) return "timed-out";
  return "connecting";
}

/**
 * What to try when two devices on "the same network" cannot reach each other.
 * Ordered by how often each is the actual cause.
 */
export const OFFLINE_CONNECT_TIPS = [
  "Both devices must be on the same Wi-Fi or hotspot — check that neither is only on mobile data.",
  "Some hotspots (notably iPhone's) keep the phones that join them apart. Make one of these two devices the hotspot itself: the hotspot phone can always reach its guests.",
  "Turn off any VPN on either device — many block local network traffic.",
  "In the iPhone app, allow Local Network access (Settings → Privacy & Security → Local Network).",
];

/** The same, for two devices paired across the internet by codes sent over a messenger. */
export const INTERNET_CONNECT_TIPS = [
  "Both devices need a working internet connection (the discovery servers may be blocked — that's fine).",
  "Strict networks on both sides — a VPN, or mobile data — need a relay. Set one up under Network on either device (the free public ones there are worth a try), then make a new invite.",
  "Send the reply back within a few minutes. After that, start over with a fresh invite.",
  "Networks that block UDP completely need a relay reachable on port 443 (turns:…:443).",
];
