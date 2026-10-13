import { describe, it, expect } from "vitest";
import { classifyNat, relayProtocolFromUrl, describeRelayError } from "./natProbe";
import { parseCandidate, type ParsedCandidate } from "./candidates";

const c = (line: string) => parseCandidate(line) as ParsedCandidate;
const HOST = c("candidate:1 1 udp 2122260223 192.168.1.20 54321 typ host");
const MDNS = c("candidate:2 1 udp 2122260223 6f1c.local 54321 typ host");

describe("classifyNat", () => {
  it("easy: the same local socket keeps one public port for every STUN server", () => {
    const v = classifyNat([HOST, c("candidate:3 1 udp 1 203.0.113.7 61000 typ srflx raddr 192.168.1.20 rport 54321")]);
    expect(v.kind).toBe("easy");
    expect(v.publicAddresses).toEqual(["203.0.113.7"]);
  });

  it("hard: one local socket shows up on several public ports (symmetric NAT)", () => {
    const v = classifyNat([
      HOST,
      c("candidate:3 1 udp 1 203.0.113.7 61000 typ srflx raddr 192.168.1.20 rport 54321"),
      c("candidate:4 1 udp 1 203.0.113.7 61007 typ srflx raddr 192.168.1.20 rport 54321"),
    ]);
    expect(v.kind).toBe("hard");
  });

  it("hard even when the browser hides the local base behind mDNS", () => {
    const v = classifyNat([
      MDNS,
      c("candidate:3 1 udp 1 198.51.100.4 40001 typ srflx raddr 0.0.0.0 rport 0"),
      c("candidate:4 1 udp 1 198.51.100.4 40444 typ srflx raddr 0.0.0.0 rport 0"),
    ]);
    expect(v.kind).toBe("hard");
  });

  it("does not mistake a VPN plus the Wi-Fi under it for symmetric NAT", () => {
    const v = classifyNat([
      MDNS,
      c("candidate:3 1 udp 1 203.0.113.7 61000 typ srflx raddr 0.0.0.0 rport 0"), // home router
      c("candidate:4 1 udp 1 185.0.0.9 51000 typ srflx raddr 0.0.0.0 rport 0"), // VPN exit
    ]);
    expect(v.kind).toBe("easy");
    expect(v.publicAddresses).toEqual(["185.0.0.9", "203.0.113.7"]);
  });

  it("open: the public address is the device's own", () => {
    const v = classifyNat([
      c("candidate:1 1 udp 1 203.0.113.50 5000 typ host"),
      c("candidate:3 1 udp 1 203.0.113.50 5000 typ srflx raddr 203.0.113.50 rport 5000"),
    ]);
    expect(v.kind).toBe("open");
  });

  it("open over IPv6 when there is no IPv4 mapping", () => {
    const v = classifyNat([c("candidate:1 1 udp 1 2a02:810a:1:2::5 5000 typ srflx raddr 0.0.0.0 rport 0")]);
    expect(v.kind).toBe("open");
    expect(v.ipv6).toBe(true);
  });

  it("blocked: host candidates but no STUN answer", () => {
    expect(classifyNat([HOST]).kind).toBe("blocked");
  });

  it("unknown: nothing at all", () => {
    expect(classifyNat([]).kind).toBe("unknown");
  });
});

describe("relay helpers", () => {
  it("infers the relay transport from its url", () => {
    expect(relayProtocolFromUrl("turns:r.example:443")).toBe("tls");
    expect(relayProtocolFromUrl("turn:r.example:3478?transport=tcp")).toBe("tcp");
    expect(relayProtocolFromUrl("turn:r.example:3478")).toBe("udp");
  });

  it("explains the relay errors users can act on", () => {
    expect(describeRelayError(401)).toMatch(/username\/password/);
    expect(describeRelayError(701)).toMatch(/could not be reached/);
    expect(describeRelayError(999)).toMatch(/999/);
  });
});
