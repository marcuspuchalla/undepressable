// ICE candidate parsing.
//
// Everything the app can learn about *why* two devices can or cannot reach
// each other is encoded in candidate lines: which address families exist,
// whether a STUN server answered (srflx), whether a TURN relay allocated
// (relay), and what the NAT did to our ports. These helpers turn the raw
// `a=candidate:` grammar (RFC 8839 §5.1) into data the diagnostics can use.

export type CandidateType = "host" | "srflx" | "prflx" | "relay";
export type CandidateFamily = "ipv4" | "ipv6" | "mdns";

export interface ParsedCandidate {
  type: CandidateType;
  protocol: "udp" | "tcp";
  address: string;
  port: number;
  family: CandidateFamily;
  /** The local base a srflx/relay candidate was derived from, when not hidden. */
  relatedAddress: string | null;
  relatedPort: number | null;
}

const TYPES = new Set<CandidateType>(["host", "srflx", "prflx", "relay"]);

function familyOf(address: string): CandidateFamily {
  if (address.endsWith(".local")) return "mdns";
  return address.includes(":") ? "ipv6" : "ipv4";
}

/** Parse one candidate, with or without the `a=` / `candidate:` prefixes. */
export function parseCandidate(line: string): ParsedCandidate | null {
  if (typeof line !== "string") return null;
  const body = line.trim().replace(/^a=/, "").replace(/^candidate:/, "");
  const parts = body.split(/\s+/);
  // foundation component transport priority address port "typ" type ...
  if (parts.length < 8 || parts[6] !== "typ") return null;

  const protocol = parts[2].toLowerCase();
  const type = parts[7] as CandidateType;
  const port = Number(parts[5]);
  if ((protocol !== "udp" && protocol !== "tcp") || !TYPES.has(type) || !Number.isFinite(port)) return null;

  let relatedAddress: string | null = null;
  let relatedPort: number | null = null;
  for (let i = 8; i + 1 < parts.length; i += 2) {
    if (parts[i] === "raddr") relatedAddress = parts[i + 1];
    else if (parts[i] === "rport") relatedPort = Number(parts[i + 1]);
  }
  // Browsers hide the base behind 0.0.0.0/:: when host addresses are
  // mDNS-obfuscated; treat that as unknown rather than as a real address.
  if (relatedAddress === "0.0.0.0" || relatedAddress === "::") {
    relatedAddress = null;
    relatedPort = null;
  }

  const address = parts[4];
  return { type, protocol, address, port, family: familyOf(address), relatedAddress, relatedPort };
}

/** Every candidate carried in an SDP blob (non-trickle SDP holds them all). */
export function candidatesFromSdp(sdp: string): ParsedCandidate[] {
  if (typeof sdp !== "string") return [];
  const out: ParsedCandidate[] = [];
  for (const line of sdp.split(/\r\n|\n/)) {
    if (!line.startsWith("a=candidate:")) continue;
    const c = parseCandidate(line);
    if (c) out.push(c);
  }
  return out;
}

export function uniqueTypes(cands: ParsedCandidate[]): CandidateType[] {
  const order: CandidateType[] = ["host", "srflx", "prflx", "relay"];
  const seen = new Set(cands.map((c) => c.type));
  return order.filter((t) => seen.has(t));
}

/** RFC 1918 / CGNAT (RFC 6598) / link-local / loopback — not reachable from the internet. */
export function isPrivateIPv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    a === 0
  );
}

/** Globally routable IPv6 (excludes link-local fe80::/10, ULA fc00::/7, loopback). */
export function isGlobalIPv6(ip: string): boolean {
  if (!ip.includes(":")) return false;
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return false;
  if (/^fe[89ab]/.test(lower)) return false;
  if (/^f[cd]/.test(lower)) return false;
  return true;
}

/**
 * A stable-ish identity for "the device on the other end", built from the
 * addresses it advertised. Trystero opens one connection per transport and
 * per relay to the same peer, and nothing in the SDP names the peer — but its
 * public/local addresses are the same across all of those attempts.
 */
export function remoteKeyOf(cands: ParsedCandidate[]): string {
  const pick = (pred: (c: ParsedCandidate) => boolean) =>
    Array.from(new Set(cands.filter(pred).map((c) => c.address))).sort();
  const srflx = pick((c) => c.type === "srflx");
  if (srflx.length > 0) return "s:" + srflx.join(",");
  const host = pick((c) => c.type === "host");
  if (host.length > 0) return "h:" + host.join(",");
  const relay = pick((c) => c.type === "relay");
  return relay.length > 0 ? "r:" + relay.join(",") : "unknown";
}
