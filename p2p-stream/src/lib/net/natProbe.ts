// What kind of network is this device on — and can it reach its relay?
//
// Two devices connect directly only if at least one side's NAT is forgiving.
// The kind that is not — "symmetric" (endpoint-dependent mapping) — hands out
// a different public port for every destination, so the address a STUN server
// reports is useless to anyone else. VPN exits and mobile carriers (CGNAT)
// very often behave this way, and two such devices can only meet via a relay.
//
// A browser can measure this: ask two STUN servers at different addresses
// what our public address is. Same port from both → the mapping is stable
// ("easy"); different ports → symmetric ("hard"). No answer at all → UDP is
// blocked (or a VPN/browser setting disables it) and only TURN over TCP/TLS
// can connect.

import { parseCandidate, isGlobalIPv6, type ParsedCandidate } from "./candidates";

export type NatKind = "open" | "easy" | "hard" | "blocked" | "unknown";

export interface NatVerdict {
  kind: NatKind;
  /** Public IPv4 addresses STUN servers saw us as. */
  publicAddresses: string[];
  /** A globally routable IPv6 address was seen. */
  ipv6: boolean;
  /** Short, technical explanation of the evidence. */
  evidence: string;
}

/** Classify from the candidates a STUN-only gathering produced. Pure. */
export function classifyNat(cands: ParsedCandidate[]): NatVerdict {
  const hosts = cands.filter((c) => c.type === "host");
  const srflx = cands.filter((c) => c.type === "srflx");
  const v4srflx = srflx.filter((c) => c.family === "ipv4");
  const ipv6 = cands.some((c) => (c.type === "host" || c.type === "srflx") && c.family === "ipv6" && isGlobalIPv6(c.address));
  const publicAddresses = Array.from(new Set(v4srflx.map((c) => c.address))).sort();

  if (srflx.length === 0) {
    if (hosts.length === 0) return { kind: "unknown", publicAddresses, ipv6, evidence: "No candidates were gathered." };
    return { kind: "blocked", publicAddresses, ipv6, evidence: "No STUN server answered over UDP." };
  }

  const hostAddrs = new Set(hosts.filter((c) => c.family !== "mdns").map((c) => c.address));
  if (v4srflx.length === 0) {
    // IPv6 only: normally no NAT at all, just a stateful firewall.
    return { kind: "open", publicAddresses, ipv6, evidence: "Reachable over IPv6 without address translation." };
  }
  if (v4srflx.some((c) => hostAddrs.has(c.address))) {
    return { kind: "open", publicAddresses, ipv6, evidence: "The public address is this device's own address (no NAT)." };
  }

  // Group mappings by the local socket they came from. When the browser hides
  // that (mDNS), group by public address instead — a VPN and the Wi-Fi under it
  // have different public addresses, so they still don't get mixed up.
  const mappings = new Map<string, Set<number>>();
  for (const c of v4srflx) {
    const base = c.relatedAddress ? `${c.relatedAddress}:${c.relatedPort}→${c.address}` : `?→${c.address}`;
    let ports = mappings.get(base);
    if (!ports) mappings.set(base, (ports = new Set()));
    ports.add(c.port);
  }
  for (const [base, ports] of mappings) {
    if (ports.size > 1) {
      return {
        kind: "hard",
        publicAddresses,
        ipv6,
        evidence: `One local socket appeared on ${ports.size} different public ports (${base.split("→")[1]}) — symmetric NAT.`,
      };
    }
  }
  return { kind: "easy", publicAddresses, ipv6, evidence: "Each local socket kept one public port across STUN servers." };
}

export interface NatProbeResult extends NatVerdict {
  durationMs: number;
}

function collectCandidates(
  config: RTCConfiguration,
  timeoutMs: number,
  onCandidate?: (ev: RTCPeerConnectionIceEvent) => void,
  onError?: (ev: RTCPeerConnectionIceErrorEvent) => void,
): Promise<ParsedCandidate[]> {
  const PC: typeof RTCPeerConnection | undefined = (globalThis as any).RTCPeerConnection;
  if (!PC) return Promise.reject(new Error("WebRTC is not available"));
  const pc = new PC(config);
  const found: ParsedCandidate[] = [];
  return new Promise<ParsedCandidate[]>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      resolve(found);
    };
    const timer = setTimeout(finish, timeoutMs);
    pc.addEventListener("icecandidate", (ev) => {
      const e = ev as RTCPeerConnectionIceEvent;
      if (!e.candidate) return finish();
      const c = parseCandidate(e.candidate.candidate);
      if (c) found.push(c);
      onCandidate?.(e);
    });
    if (onError) pc.addEventListener("icecandidateerror", (ev) => onError(ev as RTCPeerConnectionIceErrorEvent));
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") finish();
    });
    pc.createDataChannel("probe");
    pc.createOffer()
      .then((o) => pc.setLocalDescription(o))
      .catch(finish);
  });
}

/** Ask the STUN servers what our network looks like. Takes up to `timeoutMs`. */
export async function probeNat(stunServers: RTCIceServer[], timeoutMs = 5000): Promise<NatProbeResult> {
  const started = Date.now();
  const cands = await collectCandidates({ iceServers: stunServers, iceCandidatePoolSize: 0 }, timeoutMs);
  return { ...classifyNat(cands), durationMs: Date.now() - started };
}

export type RelayProtocol = "udp" | "tcp" | "tls";

export interface RelayTestResult {
  ok: boolean;
  /** Transports over which the relay handed us an address. */
  protocols: RelayProtocol[];
  /** Relay errors reported by the browser, e.g. 401 for bad credentials. */
  errors: { url: string; code: number; text: string }[];
  durationMs: number;
}

/** turns: → tls, ?transport=tcp → tcp, else udp. */
export function relayProtocolFromUrl(url: string): RelayProtocol {
  if (/^turns:/i.test(url)) return "tls";
  return /[?&]transport=tcp\b/i.test(url) ? "tcp" : "udp";
}

/**
 * Explain a TURN failure in words. Codes come from RTCPeerConnectionIceErrorEvent:
 * STUN/TURN error codes (RFC 8489/8656) plus 701 for "could not reach it".
 */
export function describeRelayError(code: number): string {
  if (code === 401) return "the relay rejected the username/password";
  if (code === 403) return "the relay refused this request (forbidden)";
  if (code === 437 || code === 438) return "the relay session expired — try again";
  if (code === 486) return "the relay is at its allocation limit (quota reached)";
  if (code === 508) return "the relay is out of capacity";
  if (code === 701) return "the relay could not be reached from this network";
  return `the relay reported error ${code}`;
}

/** Try to get a relay address from the given TURN servers, relay-only. */
export async function testRelay(relayServers: RTCIceServer[], timeoutMs = 8000): Promise<RelayTestResult> {
  const started = Date.now();
  if (relayServers.length === 0) return { ok: false, protocols: [], errors: [], durationMs: 0 };
  const protocols = new Set<RelayProtocol>();
  const errors: RelayTestResult["errors"] = [];
  const cands = await collectCandidates(
    { iceServers: relayServers, iceTransportPolicy: "relay", iceCandidatePoolSize: 0 },
    timeoutMs,
    (ev) => {
      const cand = ev.candidate as (RTCIceCandidate & { relayProtocol?: string; url?: string }) | null;
      if (!cand || cand.type !== "relay") return;
      const proto = cand.relayProtocol ?? ((ev as any).url ? relayProtocolFromUrl((ev as any).url) : null);
      if (proto === "udp" || proto === "tcp" || proto === "tls") protocols.add(proto);
    },
    (ev) => {
      const url = typeof ev.url === "string" ? ev.url : "";
      if (!errors.some((e) => e.url === url && e.code === ev.errorCode)) {
        errors.push({ url, code: ev.errorCode, text: ev.errorText ?? "" });
      }
    },
  );
  const ok = cands.some((c) => c.type === "relay");
  if (ok && protocols.size === 0) protocols.add("udp");
  return { ok, protocols: Array.from(protocols).sort(), errors, durationMs: Date.now() - started };
}
