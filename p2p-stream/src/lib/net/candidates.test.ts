import { describe, it, expect } from "vitest";
import {
  parseCandidate,
  candidatesFromSdp,
  uniqueTypes,
  isPrivateIPv4,
  isGlobalIPv6,
  remoteKeyOf,
} from "./candidates";

const HOST = "candidate:1 1 udp 2122260223 192.168.1.20 54321 typ host generation 0";
const MDNS = "candidate:2 1 udp 2122260223 6f1c-4a.local 54322 typ host generation 0";
const SRFLX = "candidate:3 1 udp 1686052607 203.0.113.7 61000 typ srflx raddr 192.168.1.20 rport 54321";
const SRFLX_HIDDEN = "candidate:4 1 udp 1686052607 203.0.113.7 61001 typ srflx raddr 0.0.0.0 rport 0";
const RELAY = "candidate:5 1 udp 41885439 198.51.100.9 3478 typ relay raddr 203.0.113.7 rport 61000";
const TCP = "candidate:6 1 tcp 1518280447 192.168.1.20 9 typ host tcptype active";
const V6 = "candidate:7 1 udp 2122262783 2a02:810a:1:2::5 50000 typ host";

describe("parseCandidate", () => {
  it("parses host, srflx and relay candidates", () => {
    expect(parseCandidate(HOST)).toMatchObject({ type: "host", protocol: "udp", address: "192.168.1.20", port: 54321, family: "ipv4" });
    expect(parseCandidate(SRFLX)).toMatchObject({ type: "srflx", relatedAddress: "192.168.1.20", relatedPort: 54321 });
    expect(parseCandidate(RELAY)).toMatchObject({ type: "relay", address: "198.51.100.9" });
  });

  it("accepts the a= SDP prefix and tcp candidates", () => {
    expect(parseCandidate("a=" + TCP)).toMatchObject({ type: "host", protocol: "tcp", port: 9 });
  });

  it("recognises mDNS-obfuscated and IPv6 addresses", () => {
    expect(parseCandidate(MDNS)?.family).toBe("mdns");
    expect(parseCandidate(V6)?.family).toBe("ipv6");
  });

  it("treats a hidden base (0.0.0.0) as unknown", () => {
    const c = parseCandidate(SRFLX_HIDDEN)!;
    expect(c.relatedAddress).toBeNull();
    expect(c.relatedPort).toBeNull();
  });

  it("rejects malformed lines", () => {
    expect(parseCandidate("")).toBeNull();
    expect(parseCandidate("candidate:1 1 udp 1 1.2.3.4 5 host")).toBeNull();
    expect(parseCandidate("candidate:1 1 sctp 1 1.2.3.4 5 typ host")).toBeNull();
    expect(parseCandidate("candidate:1 1 udp 1 1.2.3.4 5 typ weird")).toBeNull();
    expect(parseCandidate(undefined as any)).toBeNull();
  });
});

describe("candidatesFromSdp", () => {
  it("extracts every a=candidate line and ignores the rest", () => {
    const sdp = ["v=0", "a=" + HOST, "a=ice-ufrag:x", "a=" + SRFLX, "a=" + RELAY, ""].join("\r\n");
    const cands = candidatesFromSdp(sdp);
    expect(cands.map((c) => c.type)).toEqual(["host", "srflx", "relay"]);
    expect(uniqueTypes(cands)).toEqual(["host", "srflx", "relay"]);
  });

  it("copes with LF-only SDP and garbage", () => {
    expect(candidatesFromSdp(["a=" + HOST, "a=candidate:broken"].join("\n"))).toHaveLength(1);
    expect(candidatesFromSdp(null as any)).toEqual([]);
  });
});

describe("address classification", () => {
  it("flags private, CGNAT and link-local IPv4", () => {
    for (const ip of ["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "100.64.0.1", "169.254.1.1", "127.0.0.1"]) {
      expect(isPrivateIPv4(ip)).toBe(true);
    }
    for (const ip of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "203.0.113.7"]) {
      expect(isPrivateIPv4(ip)).toBe(false);
    }
    expect(isPrivateIPv4("not-an-ip")).toBe(false);
  });

  it("recognises globally routable IPv6", () => {
    expect(isGlobalIPv6("2a02:810a:1:2::5")).toBe(true);
    expect(isGlobalIPv6("fe80::1")).toBe(false);
    expect(isGlobalIPv6("fd00::1")).toBe(false);
    expect(isGlobalIPv6("::1")).toBe(false);
    expect(isGlobalIPv6("192.168.1.1")).toBe(false);
  });
});

describe("remoteKeyOf", () => {
  it("prefers public (srflx) addresses so every attempt to one device shares a key", () => {
    const a = candidatesFromSdp(["a=" + HOST, "a=" + SRFLX].join("\n"));
    const b = candidatesFromSdp(["a=" + SRFLX_HIDDEN, "a=" + MDNS].join("\n"));
    expect(remoteKeyOf(a)).toBe("s:203.0.113.7");
    expect(remoteKeyOf(b)).toBe(remoteKeyOf(a));
  });

  it("falls back to host, then relay, then unknown", () => {
    expect(remoteKeyOf(candidatesFromSdp("a=" + HOST))).toBe("h:192.168.1.20");
    expect(remoteKeyOf(candidatesFromSdp("a=" + RELAY))).toBe("r:198.51.100.9");
    expect(remoteKeyOf([])).toBe("unknown");
  });
});
