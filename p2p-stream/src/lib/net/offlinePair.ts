// Direct peer pairing with NO infrastructure at all.
//
// Every normal discovery path (BitTorrent trackers, Nostr relays, MQTT brokers)
// dials a public `wss://` host, so when the internet is cut or jammed — the
// exact situation this app exists for — two phones on the same hotspot cannot
// find each other, even though the local network between them works fine.
//
// The way out is to carry the WebRTC handshake by hand: the streamer shows its
// offer as a QR code, the watcher scans it and shows its answer back. After
// that the media flows directly over the local network. No server, no relay,
// no internet — just two screens and two cameras.
//
// Constraints that shape the format:
//   * A QR code holds ~2 900 bytes; an SDP with all candidates can exceed that.
//     We strip candidates that cannot work without internet (srflx/relay) and
//     deflate the rest, which brings a typical local offer to a few hundred
//     bytes.
//   * There is no trickle ICE over a QR code, so gathering must finish before
//     the code is drawn (see useOfflinePair).
//   * The first connection now carries only a data channel, which packs into
//     the ~100-byte "UND2" format (compactSignal.ts); video is negotiated over
//     that channel afterwards. "UND1" (a whole SDP, deflated) remains the
//     fallback for anything the compact format cannot express.

import { COMPACT_PREFIX, extractCompact, packCompact, unpackCompact, buildSdp, toBase64Url, fromBase64Url } from "./compactSignal";

export type OfflineSignalKind = "offer" | "answer";

export interface OfflineSignal {
  /** Envelope version, so a future format can be rejected clearly. */
  v: 1 | 2;
  t: OfflineSignalKind;
  /** The session description. */
  s: string;
}

const PREFIX = "UND1";
const COMPRESSED = "Z";
const PLAIN = "P";

/** Cheap check used by the scanner to ignore unrelated QR codes. */
export function isOfflineSignal(text: string): boolean {
  if (typeof text !== "string") return false;
  const t = text.trim();
  return t.startsWith(PREFIX) || t.startsWith(COMPACT_PREFIX);
}

/**
 * Drop ICE candidates that cannot possibly work with no internet.
 *
 * `srflx`/`prflx`/`relay` candidates are discovered through STUN/TURN servers;
 * offline they are unreachable noise that only inflates the QR code. Host
 * candidates (and mDNS `.local` ones) are what actually connect two devices on
 * the same Wi-Fi or hotspot.
 */
export function stripNonHostCandidates(sdp: string): string {
  return sdp
    .split(/\r\n|\n/)
    .filter((line) => {
      if (!line.startsWith("a=candidate:")) return true;
      return / typ host( |$)/.test(line);
    })
    .join("\r\n");
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function deflate(input: Uint8Array): Promise<Uint8Array | null> {
  const C = (globalThis as any).CompressionStream;
  if (!C) return null;
  try {
    const stream = new Blob([input as BlobPart]).stream().pipeThrough(new C("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function inflate(input: Uint8Array): Promise<Uint8Array | null> {
  const D = (globalThis as any).DecompressionStream;
  if (!D) return null;
  try {
    const stream = new Blob([input as BlobPart]).stream().pipeThrough(new D("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Pack a session description into the shortest text that still round-trips,
 * so it fits in a single scannable QR code.
 *
 * Compression is best-effort: where `CompressionStream` is missing we fall back
 * to plain base64 and mark it, rather than failing the pairing outright.
 */
export async function encodeSignal(signal: OfflineSignal): Promise<string> {
  const compact = extractCompact(signal.s, signal.t);
  if (compact) return COMPACT_PREFIX + toBase64Url(packCompact(compact));
  const payload = JSON.stringify({ ...signal, s: stripNonHostCandidates(signal.s) });
  const raw = new TextEncoder().encode(payload);
  const packed = await deflate(raw);
  return packed && packed.length < raw.length
    ? PREFIX + COMPRESSED + toBase64(packed)
    : PREFIX + PLAIN + toBase64(raw);
}

/** Reverse of `encodeSignal`. Throws with a human-readable reason. */
export async function decodeSignal(input: string): Promise<OfflineSignal> {
  if (!isOfflineSignal(input)) throw new Error("Not a pairing code");
  // Pasted codes pick up line breaks and spaces from chat apps.
  const text = input.replace(/\s+/g, "");
  if (text.startsWith(COMPACT_PREFIX)) {
    let desc;
    try {
      desc = unpackCompact(fromBase64Url(text.slice(COMPACT_PREFIX.length)));
    } catch (err) {
      throw err instanceof Error && /version|damaged/.test(err.message) ? err : new Error("Pairing code is damaged");
    }
    return { v: 2, t: desc.type, s: buildSdp(desc) };
  }
  const mode = text[PREFIX.length];
  const body = text.slice(PREFIX.length + 1);

  let bytes: Uint8Array;
  try {
    bytes = fromBase64(body);
  } catch {
    throw new Error("Pairing code is damaged");
  }

  if (mode === COMPRESSED) {
    const out = await inflate(bytes);
    if (!out) throw new Error("This device cannot read compressed pairing codes");
    bytes = out;
  } else if (mode !== PLAIN) {
    throw new Error("Unsupported pairing code version");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Pairing code is damaged");
  }

  if (parsed?.v !== 1 || (parsed.t !== "offer" && parsed.t !== "answer") || typeof parsed.s !== "string") {
    throw new Error("Unsupported pairing code version");
  }
  return { v: 1, t: parsed.t, s: parsed.s };
}

/** A QR code tops out near this many bytes; used to warn before drawing. */
export const QR_BYTE_LIMIT = 2900;

export function fitsInQr(text: string): boolean {
  return text.length <= QR_BYTE_LIMIT;
}
