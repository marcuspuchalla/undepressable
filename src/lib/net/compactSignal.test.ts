import { describe, it, expect } from "vitest";
import {
  extractCompact,
  buildSdp,
  packCompact,
  unpackCompact,
  toBase64Url,
  fromBase64Url,
  ipv6ToBytes,
  bytesToIpv6,
} from "./compactSignal";
import { encodeSignal, decodeSignal, isOfflineSignal } from "./offlinePair";

// Shape of a real Chrome data-channel-only offer gathered with iceServers: [].
const FP = "7B:8E:3A:11:02:9C:4D:5E:6F:70:81:92:A3:B4:C5:D6:E7:F8:09:1A:2B:3C:4D:5E:6F:70:81:92:A3:B4:C5:D6";
const DC_OFFER = [
  "v=0",
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0",
  "a=extmap-allow-mixed",
  "a=msid-semantic: WMS",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 0.0.0.0",
  "a=candidate:1510613869 1 udp 2122260223 192.168.43.12 54107 typ host generation 0 network-id 1",
  "a=candidate:3491578113 1 udp 2122194687 2a02:810a:83c0:1::7 54108 typ host generation 0 network-id 2",
  "a=candidate:2999745851 1 udp 2122129151 fe80::1c2b:3aff:fe4d:5e6f 54109 typ host generation 0 network-id 3",
  "a=candidate:1 1 udp 2122063615 1f4712db-ea17-4bcf-a596-105139dfd8bf.local 54110 typ host generation 0",
  "a=candidate:4233069003 1 tcp 1518280447 192.168.43.12 9 typ host tcptype active generation 0",
  "a=ice-ufrag:x6Ls",
  "a=ice-pwd:GhS9YpAsI3G3wYRl8fdzm5hk",
  "a=ice-options:trickle",
  `a=fingerprint:sha-256 ${FP}`,
  "a=setup:actpass",
  "a=mid:0",
  "a=sctp-port:5000",
  "a=max-message-size:262144",
  "",
].join("\r\n");

describe("extractCompact", () => {
  it("keeps exactly what a data-channel description needs", () => {
    const d = extractCompact(DC_OFFER, "offer")!;
    expect(d).toMatchObject({ type: "offer", ufrag: "x6Ls", pwd: "GhS9YpAsI3G3wYRl8fdzm5hk", setup: "actpass", mid: "0" });
    expect(d.fingerprint).toHaveLength(32);
    // UDP host candidates only: TCP "active" candidates (port 9) cannot be dialled.
    expect(d.candidates.map((c) => c.address)).toEqual([
      "192.168.43.12",
      "2a02:810a:83c0:1::7",
      "fe80::1c2b:3aff:fe4d:5e6f",
      "1f4712db-ea17-4bcf-a596-105139dfd8bf.local",
    ]);
  });

  it("refuses what the template cannot rebuild — the caller falls back to the full SDP", () => {
    expect(extractCompact(DC_OFFER.replace("m=application 9 UDP/DTLS/SCTP webrtc-datachannel", "m=video 9 UDP/TLS/RTP/SAVPF 96"), "offer")).toBeNull();
    expect(extractCompact(DC_OFFER + "m=audio 9 UDP/TLS/RTP/SAVPF 111\r\n", "offer")).toBeNull();
    expect(extractCompact(DC_OFFER.replace("sha-256", "sha-1"), "offer")).toBeNull();
    expect(extractCompact(DC_OFFER.replace(/a=candidate:.*udp.*\r\n/g, ""), "offer")).toBeNull();
    expect(extractCompact(DC_OFFER.replace("a=ice-pwd:GhS9YpAsI3G3wYRl8fdzm5hk\r\n", ""), "offer")).toBeNull();
    expect(extractCompact(null as any, "offer")).toBeNull();
  });
});

describe("pack / unpack", () => {
  it("round-trips every field", () => {
    const d = extractCompact(DC_OFFER, "offer")!;
    const back = unpackCompact(packCompact(d));
    expect(back).toEqual(d);
  });

  it("is tiny — a small, fast-scanning QR code", () => {
    const bytes = packCompact(extractCompact(DC_OFFER, "offer")!);
    expect(bytes.length).toBeLessThan(140);
    const text = "UND2" + toBase64Url(bytes);
    expect(text.length).toBeLessThan(200); // the old format: ~1700 characters
  });

  it("rejects truncated, trailing or wrong-version data", () => {
    const bytes = packCompact(extractCompact(DC_OFFER, "offer")!);
    expect(() => unpackCompact(bytes.slice(0, 20))).toThrow(/damaged/);
    expect(() => unpackCompact(Uint8Array.from([...bytes, 0]))).toThrow(/damaged/);
    expect(() => unpackCompact(Uint8Array.from([9, ...bytes.slice(1)]))).toThrow(/version/);
  });

  it("base64url survives copy/paste (no +, /, =)", () => {
    const bytes = Uint8Array.from({ length: 64 }, (_, i) => (i * 37) & 0xff);
    const text = toBase64Url(bytes);
    expect(text).not.toMatch(/[+/=]/);
    expect(fromBase64Url(text)).toEqual(bytes);
  });
});

describe("buildSdp", () => {
  it("rebuilds a description carrying the same session parameters and candidates", () => {
    const d = extractCompact(DC_OFFER, "offer")!;
    const sdp = buildSdp(d, "123");
    expect(sdp).toContain("m=application 9 UDP/DTLS/SCTP webrtc-datachannel");
    expect(sdp).toContain("a=ice-ufrag:x6Ls");
    expect(sdp).toContain(`a=fingerprint:sha-256 ${FP}`);
    expect(sdp).toContain("a=setup:actpass");
    expect(sdp).toContain("a=group:BUNDLE 0");
    expect(sdp).toContain("192.168.43.12 54107 typ host");
    expect(sdp).toContain("1f4712db-ea17-4bcf-a596-105139dfd8bf.local 54110 typ host");
    expect(sdp.endsWith("\r\n")).toBe(true);
    // …and extracting from the rebuilt SDP gives the same description back.
    expect(extractCompact(sdp, "offer")).toEqual(d);
  });
});

describe("IPv6 helpers", () => {
  it("round-trips compressed and full forms", () => {
    for (const a of ["2a02:810a:83c0:1::7", "fe80::1c2b:3aff:fe4d:5e6f", "::1", "2001:db8:0:0:1:0:0:1"]) {
      const bytes = ipv6ToBytes(a)!;
      expect(bytes).toHaveLength(16);
      expect(ipv6ToBytes(bytesToIpv6(bytes))).toEqual(bytes);
    }
    expect(bytesToIpv6(ipv6ToBytes("2001:db8:0:0:1:0:0:1")!)).toBe("2001:db8::1:0:0:1");
    expect(ipv6ToBytes("1:2:3")).toBeNull();
    expect(ipv6ToBytes("1::2::3")).toBeNull();
  });
});

describe("offline signal envelope", () => {
  it("uses the compact format for data-channel descriptions", async () => {
    const text = await encodeSignal({ v: 2, t: "offer", s: DC_OFFER });
    expect(text.startsWith("UND2")).toBe(true);
    expect(isOfflineSignal(text)).toBe(true);
    const back = await decodeSignal(text);
    expect(back.t).toBe("offer");
    expect(back.s).toContain("a=ice-ufrag:x6Ls");
  });

  it("accepts a pasted code with line breaks and spaces", async () => {
    const text = await encodeSignal({ v: 2, t: "answer", s: DC_OFFER.replace("a=setup:actpass", "a=setup:active") });
    const mangled = `  ${text.slice(0, 30)}\n${text.slice(30, 60)} ${text.slice(60)}\n`;
    const back = await decodeSignal(mangled);
    expect(back.t).toBe("answer");
    expect(back.s).toContain("a=setup:active");
  });

  it("reports damage rather than crashing", async () => {
    await expect(decodeSignal("UND2@@@@")).rejects.toThrow(/damaged/);
    await expect(decodeSignal("UND2AAAA")).rejects.toThrow(/damaged|version/);
  });
});

// A data-channel offer gathered with STUN and TURN configured: host, public
// (srflx) and relay candidates, as Chrome writes them.
const DC_OFFER_INTERNET = DC_OFFER.replace(
  "a=ice-ufrag:x6Ls",
  [
    "a=candidate:842163049 1 udp 1686052607 203.0.113.7 61001 typ srflx raddr 192.168.43.12 rport 54107 generation 0 network-id 1",
    "a=candidate:842163050 1 udp 1686052351 203.0.113.7 61002 typ srflx raddr 192.168.43.12 rport 54111 generation 0 network-id 1",
    "a=candidate:1908491021 1 udp 41885439 198.51.100.20 49170 typ relay raddr 203.0.113.7 rport 61001 generation 0 network-id 1",
    "a=ice-ufrag:x6Ls",
  ].join("\r\n"),
);

describe("codes for pairing across the internet (v3)", () => {
  it("local codes ignore public and relay addresses and stay version 2", () => {
    const d = extractCompact(DC_OFFER_INTERNET, "offer")!;
    expect(d.candidates.every((c) => !c.type)).toBe(true);
    expect(packCompact(d)[0]).toBe(2);
  });

  it("keeps relay and public addresses first, then local ones", () => {
    const d = extractCompact(DC_OFFER_INTERNET, "offer", { internet: true })!;
    expect(d.candidates.slice(0, 3)).toEqual([
      { address: "198.51.100.20", port: 49170, type: "relay" },
      { address: "203.0.113.7", port: 61001, type: "srflx" },
      { address: "203.0.113.7", port: 61002, type: "srflx" },
    ]);
    // Local ones follow (same Wi-Fi still wins); link-local IPv6 is dropped.
    expect(d.candidates.filter((c) => !c.type).map((c) => c.address)).toEqual([
      "192.168.43.12",
      "2a02:810a:83c0:1::7",
      "1f4712db-ea17-4bcf-a596-105139dfd8bf.local",
    ]);
  });

  it("round-trips as version 3 and stays short enough for a chat message or a QR code", () => {
    const d = extractCompact(DC_OFFER_INTERNET, "offer", { internet: true })!;
    const bytes = packCompact(d);
    expect(bytes[0]).toBe(3);
    expect(unpackCompact(bytes)).toEqual(d);
    expect(("UND2" + toBase64Url(bytes)).length).toBeLessThan(200);
  });

  it("rebuilds candidates with their type, related address and a type-ordered priority", () => {
    const d = extractCompact(DC_OFFER_INTERNET, "offer", { internet: true })!;
    const lines = buildSdp(d).split("\r\n").filter((l) => l.startsWith("a=candidate:"))
    const relay = lines.find((l) => / typ relay /.test(l))!
    const srflx = lines.find((l) => / typ srflx /.test(l))!
    const host = lines.find((l) => / typ host /.test(l))!
    expect(relay).toMatch(/198\.51\.100\.20 49170 typ relay raddr 0\.0\.0\.0 rport 0/)
    const prio = (l: string) => Number(l.split(" ")[3])
    expect(prio(host)).toBeGreaterThan(prio(srflx))
    expect(prio(srflx)).toBeGreaterThan(prio(relay))
  });

  it("a relay-only offer (\"always use the relay\") still packs", () => {
    const relayOnly = DC_OFFER_INTERNET.split("\r\n").filter((l) => !l.startsWith("a=candidate:") || / typ relay /.test(l)).join("\r\n");
    const d = extractCompact(relayOnly, "offer", { internet: true })!;
    expect(d.candidates).toEqual([{ address: "198.51.100.20", port: 49170, type: "relay" }]);
    expect(extractCompact(relayOnly, "offer")).toBeNull(); // nothing usable locally
  });

  it("the envelope carries internet codes and older local ones alike", async () => {
    const code = await encodeSignal({ v: 2, t: "offer", s: DC_OFFER_INTERNET }, { internet: true });
    const back = await decodeSignal(code);
    expect(back.s).toMatch(/typ relay/);
    const local = await encodeSignal({ v: 2, t: "offer", s: DC_OFFER_INTERNET });
    expect((await decodeSignal(local)).s).not.toMatch(/typ (relay|srflx)/);
  });
});
