// A pairing code small enough to scan instantly — or to paste as text.
//
// The first offline pairing codes carried a whole audio+video SDP: ~1.7 KB,
// a version-30 QR code with 137×137 modules — under 2 px per module on a
// phone screen, which a second phone's camera struggles to read.
//
// Almost none of that SDP is information. If the first connection carries
// only a data channel, a description is fully determined by: ICE username
// fragment and password, the DTLS certificate fingerprint, the DTLS role, the
// media id, and the host candidates. Everything else is boilerplate the other
// side can rebuild from a template. Video is then negotiated over the data
// channel itself, where size does not matter.
//
// Binary layout (then base64url, prefixed "UND2"):
//   u8  version (2: host candidates only; 3: any candidate type)
//   u8  flags: bit0 = answer, bits1-2 = setup (0 actpass, 1 active, 2 passive)
//   str ufrag, str pwd            (u8 length + ASCII)
//   32  sha-256 fingerprint
//   str mid
//   u8  candidate count, then per candidate:
//       v3 only: u8 type (0 host, 1 srflx, 2 relay, 3 prflx)
//       u8 kind (0 IPv4, 1 IPv6, 2 mDNS UUID, 3 other name), address, u16 port
//
// Version 3 exists for pairing across the internet by any messenger: the
// code then carries the public address STUN saw (srflx) and the relay's
// address (relay), so two devices connect without any discovery server.
// Local-only codes stay version 2, readable by older copies of the app.
//
// Anything outside that shape (a non-sha-256 certificate, media in the first
// offer, TCP-only candidates…) returns null and the caller falls back to the
// full-SDP format.

export type CompactSetup = "actpass" | "active" | "passive";
export type CompactCandidateType = "host" | "srflx" | "relay" | "prflx";

export interface CompactCandidate {
  address: string;
  port: number;
  /** Omitted means host. */
  type?: CompactCandidateType;
}

export interface CompactDescription {
  type: "offer" | "answer";
  ufrag: string;
  pwd: string;
  /** sha-256 fingerprint, 32 bytes. */
  fingerprint: Uint8Array;
  setup: CompactSetup;
  mid: string;
  candidates: CompactCandidate[];
}

export const COMPACT_PREFIX = "UND2";
const VERSION_LOCAL = 2;
const VERSION_ANY = 3;
const SETUPS: CompactSetup[] = ["actpass", "active", "passive"];
const TYPES: CompactCandidateType[] = ["host", "srflx", "relay", "prflx"];
/** Enough for Wi-Fi + hotspot + IPv6 addresses; more only bloats the code. */
const MAX_CANDIDATES = 8;
/** Across the internet: a few public and relay addresses on top. */
const MAX_CANDIDATES_ANY = 12;
const MAX_PER_REMOTE_TYPE = 4;

// --- SDP → compact ---------------------------------------------------------

/**
 * @param opts.internet keep public (srflx) and relay candidates too — for
 *   codes sent over a messenger rather than shown to a device next to you.
 */
export function extractCompact(
  sdp: string,
  type: "offer" | "answer",
  opts: { internet?: boolean } = {},
): CompactDescription | null {
  if (typeof sdp !== "string") return null;
  const lines = sdp.split(/\r\n|\n/);
  const media = lines.filter((l) => l.startsWith("m="));
  if (media.length !== 1 || !/^m=application \d+ UDP\/DTLS\/SCTP webrtc-datachannel/.test(media[0])) return null;

  const value = (prefix: string) => lines.find((l) => l.startsWith(prefix))?.slice(prefix.length).trim() ?? null;
  const ufrag = value("a=ice-ufrag:");
  const pwd = value("a=ice-pwd:");
  const fp = value("a=fingerprint:");
  const setup = value("a=setup:") as CompactSetup | null;
  const mid = value("a=mid:");
  if (!ufrag || !pwd || !fp || !setup || mid === null) return null;
  if (!SETUPS.includes(setup)) return null;
  if (ufrag.length > 255 || pwd.length > 255 || mid.length > 255) return null;

  const [algo, hex] = fp.split(/\s+/);
  if (algo?.toLowerCase() !== "sha-256" || !hex) return null;
  const fingerprint = hexToBytes(hex);
  if (!fingerprint || fingerprint.length !== 32) return null;

  const found: CompactCandidate[] = [];
  for (const line of lines) {
    if (!line.startsWith("a=candidate:")) continue;
    const parts = line.slice("a=candidate:".length).split(/\s+/);
    // foundation component transport priority address port typ type
    if (parts.length < 8 || parts[1] !== "1" || parts[2].toLowerCase() !== "udp") continue;
    const ctype = parts[7] as CompactCandidateType;
    if (!TYPES.includes(ctype) || (ctype !== "host" && !opts.internet)) continue;
    const port = Number(parts[5]);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) continue;
    if (encodeAddress(parts[4]) === null) continue;
    // Link-local IPv6 never crosses a router: dead weight in a messenger code.
    if (opts.internet && /^fe[89ab]/i.test(parts[4])) continue;
    if (found.some((c) => c.address === parts[4] && c.port === port)) continue;
    found.push(ctype === "host" ? { address: parts[4], port } : { address: parts[4], port, type: ctype });
  }
  // Across the internet the relay and public addresses are what connect;
  // keep them first, then fill up with local ones (same Wi-Fi still wins).
  const remote = (t: CompactCandidateType) => found.filter((c) => (c.type ?? "host") === t).slice(0, MAX_PER_REMOTE_TYPE);
  const candidates = opts.internet
    ? [...remote("relay"), ...remote("srflx"), ...remote("prflx"), ...found.filter((c) => !c.type)].slice(0, MAX_CANDIDATES_ANY)
    : found.slice(0, MAX_CANDIDATES);
  if (candidates.length === 0) return null;
  return { type, ufrag, pwd, fingerprint, setup, mid, candidates };
}

// Standard type preferences (RFC 8445 §5.1.2.2), so checks run host first,
// then public addresses, then the relay.
const TYPE_PREF: Record<CompactCandidateType, number> = { host: 126, prflx: 110, srflx: 100, relay: 0 };

// --- compact → SDP ---------------------------------------------------------

/** Rebuild a standard data-channel-only session description. */
export function buildSdp(d: CompactDescription, sessionId = randomSessionId()): string {
  const fp = Array.from(d.fingerprint, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
  const lines = [
    "v=0",
    `o=- ${sessionId} 2 IN IP4 127.0.0.1`,
    "s=-",
    "t=0 0",
    `a=group:BUNDLE ${d.mid}`,
    "a=msid-semantic: WMS",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 0.0.0.0",
    ...d.candidates.map((c, i) => {
      const t = c.type ?? "host";
      // Priorities only order the checks; within a type keep the original order.
      const priority = TYPE_PREF[t] * 2 ** 24 + (65535 - i) * 256 + 255;
      const related = t === "host" ? "" : " raddr 0.0.0.0 rport 0";
      return `a=candidate:${i + 1} 1 udp ${priority} ${c.address} ${c.port} typ ${t}${related} generation 0`;
    }),
    "a=end-of-candidates",
    `a=ice-ufrag:${d.ufrag}`,
    `a=ice-pwd:${d.pwd}`,
    "a=ice-options:trickle",
    `a=fingerprint:sha-256 ${fp}`,
    `a=setup:${d.setup}`,
    `a=mid:${d.mid}`,
    "a=sctp-port:5000",
    "a=max-message-size:262144",
  ];
  return lines.join("\r\n") + "\r\n";
}

// --- binary packing --------------------------------------------------------

export function packCompact(d: CompactDescription): Uint8Array {
  const any = d.candidates.some((c) => c.type && c.type !== "host");
  const out: number[] = [any ? VERSION_ANY : VERSION_LOCAL, (d.type === "answer" ? 1 : 0) | (SETUPS.indexOf(d.setup) << 1)];
  const str = (s: string) => {
    out.push(s.length);
    for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0x7f);
  };
  str(d.ufrag);
  str(d.pwd);
  out.push(...d.fingerprint);
  str(d.mid);
  out.push(d.candidates.length);
  for (const c of d.candidates) {
    const enc = encodeAddress(c.address);
    if (!enc) throw new Error("unencodable candidate address");
    if (any) out.push(TYPES.indexOf(c.type ?? "host"));
    out.push(...enc, (c.port >> 8) & 0xff, c.port & 0xff);
  }
  return Uint8Array.from(out);
}

export function unpackCompact(bytes: Uint8Array): CompactDescription {
  let i = 0;
  const need = (n: number) => {
    if (i + n > bytes.length) throw new Error("Pairing code is damaged");
  };
  const u8 = () => {
    need(1);
    return bytes[i++];
  };
  const str = () => {
    const len = u8();
    need(len);
    let s = "";
    for (let k = 0; k < len; k++) s += String.fromCharCode(bytes[i++]);
    return s;
  };
  const version = u8();
  if (version !== VERSION_LOCAL && version !== VERSION_ANY) throw new Error("Unsupported pairing code version");
  const typed = version === VERSION_ANY;
  const flags = u8();
  const setup = SETUPS[(flags >> 1) & 3];
  if (!setup) throw new Error("Pairing code is damaged");
  const ufrag = str();
  const pwd = str();
  need(32);
  const fingerprint = bytes.slice(i, i + 32);
  i += 32;
  const mid = str();
  const count = u8();
  if (count === 0 || count > (typed ? MAX_CANDIDATES_ANY : MAX_CANDIDATES)) throw new Error("Pairing code is damaged");
  const candidates: CompactCandidate[] = [];
  for (let k = 0; k < count; k++) {
    const ctype = typed ? TYPES[u8()] : "host";
    if (!ctype) throw new Error("Pairing code is damaged");
    const address = decodeAddress(bytes, i);
    i = address.next;
    need(2);
    const port = (bytes[i] << 8) | bytes[i + 1];
    i += 2;
    candidates.push(ctype === "host" ? { address: address.value, port } : { address: address.value, port, type: ctype });
  }
  if (i !== bytes.length) throw new Error("Pairing code is damaged");
  return { type: flags & 1 ? "answer" : "offer", ufrag, pwd, fingerprint, setup, mid, candidates };
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

// --- addresses ---------------------------------------------------------------

const UUID_LOCAL = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i;

function encodeAddress(addr: string): number[] | null {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    return octets.every((o) => o <= 255) ? [0, ...octets] : null;
  }
  const uuid = UUID_LOCAL.exec(addr);
  if (uuid) {
    const hex = uuid.slice(1).join("");
    return [2, ...(hexToBytes(hex) ?? [])];
  }
  if (addr.includes(":")) {
    const v6 = ipv6ToBytes(addr);
    return v6 ? [1, ...v6] : null;
  }
  if (/^[A-Za-z0-9.-]{1,64}\.local$/.test(addr)) {
    return [3, addr.length, ...Array.from(addr, (ch) => ch.charCodeAt(0))];
  }
  return null;
}

function decodeAddress(bytes: Uint8Array, at: number): { value: string; next: number } {
  const kind = bytes[at];
  const take = (n: number) => {
    if (at + 1 + n > bytes.length) throw new Error("Pairing code is damaged");
    return bytes.slice(at + 1, at + 1 + n);
  };
  if (kind === 0) return { value: Array.from(take(4)).join("."), next: at + 5 };
  if (kind === 1) return { value: bytesToIpv6(take(16)), next: at + 17 };
  if (kind === 2) {
    const h = Array.from(take(16), (b) => b.toString(16).padStart(2, "0")).join("");
    return { value: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}.local`, next: at + 17 };
  }
  if (kind === 3) {
    if (at + 1 >= bytes.length) throw new Error("Pairing code is damaged");
    const len = bytes[at + 1];
    const end = at + 2 + len;
    if (end > bytes.length) throw new Error("Pairing code is damaged");
    return { value: String.fromCharCode(...bytes.slice(at + 2, end)), next: end };
  }
  throw new Error("Pairing code is damaged");
}

function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.replace(/:/g, "");
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function ipv6ToBytes(addr: string): number[] | null {
  const zoneless = addr.split("%")[0];
  const halves = zoneless.split("::");
  if (halves.length > 2) return null;
  const part = (s: string) => (s ? s.split(":") : []);
  const head = part(halves[0]);
  const tail = halves.length === 2 ? part(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  return groups.flatMap((g) => {
    const n = parseInt(g, 16);
    return [n >> 8, n & 0xff];
  });
}

export function bytesToIpv6(bytes: Uint8Array | number[]): string {
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) groups.push((bytes[i] << 8) | bytes[i + 1]);
  // Compress the longest run of zero groups (RFC 5952).
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen && j - i > 1) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestStart < 0) return hex.join(":");
  const left = hex.slice(0, bestStart).join(":");
  const right = hex.slice(bestStart + bestLen).join(":");
  return `${left}::${right}`;
}

function randomSessionId(): string {
  const words = new Uint32Array(2);
  (globalThis.crypto ?? ({} as Crypto)).getRandomValues?.(words);
  // Up to 2^53, as a decimal string: valid for every browser's SDP parser.
  return String(((words[0] & 0x1fffff) * 2 ** 32 + words[1]) || 1);
}
