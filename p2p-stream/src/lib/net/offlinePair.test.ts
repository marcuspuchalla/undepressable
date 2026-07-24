import { describe, it, expect } from "vitest";
import {
  encodeSignal,
  decodeSignal,
  stripNonHostCandidates,
  isOfflineSignal,
  fitsInQr,
  QR_BYTE_LIMIT,
} from "./offlinePair";

// A realistic-shaped local offer: host candidates plus the srflx/relay ones a
// STUN/TURN server would have added while online.
const SDP = [
  "v=0",
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=video 9 UDP/TLS/RTP/SAVPF 96",
  "c=IN IP4 0.0.0.0",
  "a=ice-ufrag:F7gI",
  "a=ice-pwd:x9cml/YzichV2+XlhiMu8g",
  "a=fingerprint:sha-256 AB:CD:EF",
  "a=candidate:1 1 udp 2122260223 192.168.1.42 51234 typ host generation 0",
  "a=candidate:2 1 udp 1686052607 203.0.113.7 51234 typ srflx raddr 192.168.1.42 rport 51234",
  "a=candidate:3 1 udp 41885439 198.51.100.9 60000 typ relay raddr 203.0.113.7 rport 51234",
  "a=candidate:4 1 udp 2122260222 fe80::1 51235 typ host generation 0",
].join("\r\n");

describe("stripNonHostCandidates", () => {
  it("keeps host candidates and drops ones that need a STUN/TURN server", () => {
    const out = stripNonHostCandidates(SDP);
    expect(out).toContain("192.168.1.42");
    expect(out).toContain("fe80::1");
    expect(out).not.toContain("typ srflx");
    expect(out).not.toContain("typ relay");
  });

  it("leaves every non-candidate line untouched", () => {
    const out = stripNonHostCandidates(SDP).split("\r\n");
    expect(out).toContain("a=ice-ufrag:F7gI");
    expect(out).toContain("m=video 9 UDP/TLS/RTP/SAVPF 96");
    expect(out[0]).toBe("v=0");
  });

  it("handles bare-LF line endings", () => {
    const out = stripNonHostCandidates(SDP.replace(/\r\n/g, "\n"));
    expect(out).toContain("typ host");
    expect(out).not.toContain("typ relay");
  });
});

describe("encode/decode round trip", () => {
  it("restores an offer through the full pipeline", async () => {
    const text = await encodeSignal({ v: 1, t: "offer", s: SDP });
    const back = await decodeSignal(text);
    expect(back.t).toBe("offer");
    expect(back.s).toContain("a=ice-ufrag:F7gI");
    expect(back.s).toContain("192.168.1.42");
  });

  it("restores an answer", async () => {
    const text = await encodeSignal({ v: 1, t: "answer", s: SDP });
    expect((await decodeSignal(text)).t).toBe("answer");
  });

  it("drops unusable candidates before transport, not after", async () => {
    const back = await decodeSignal(await encodeSignal({ v: 1, t: "offer", s: SDP }));
    expect(back.s).not.toContain("typ relay");
  });

  it("produces something a single QR code can hold", async () => {
    const text = await encodeSignal({ v: 1, t: "offer", s: SDP });
    expect(fitsInQr(text)).toBe(true);
    expect(text.length).toBeLessThan(QR_BYTE_LIMIT);
  });

  it("stays inside the QR budget for a chatty multi-candidate SDP", async () => {
    const many = Array.from(
      { length: 12 },
      (_, i) => `a=candidate:${i} 1 udp 2122260223 192.168.1.${i} 5123${i} typ host generation 0`,
    ).join("\r\n");
    const text = await encodeSignal({ v: 1, t: "offer", s: `${SDP}\r\n${many}` });
    expect(fitsInQr(text)).toBe(true);
  });
});

describe("decodeSignal rejects bad input", () => {
  it("ignores text that is not a pairing code", async () => {
    await expect(decodeSignal("https://example.com/collect/ABC123")).rejects.toThrow("Not a pairing code");
  });

  it("reports a damaged payload rather than throwing something opaque", async () => {
    await expect(decodeSignal("UND1P!!!not-base64!!!")).rejects.toThrow(/damaged/);
  });

  it("rejects an unknown envelope version", async () => {
    const body = btoa(JSON.stringify({ v: 99, t: "offer", s: SDP }));
    await expect(decodeSignal(`UND1P${body}`)).rejects.toThrow(/version/);
  });

  it("rejects a payload missing the session description", async () => {
    const body = btoa(JSON.stringify({ v: 1, t: "offer" }));
    await expect(decodeSignal(`UND1P${body}`)).rejects.toThrow(/version/);
  });
});

describe("isOfflineSignal", () => {
  it("tells pairing codes apart from room links so the scanner can route both", async () => {
    expect(isOfflineSignal(await encodeSignal({ v: 1, t: "offer", s: SDP }))).toBe(true);
    expect(isOfflineSignal("https://example.com/collect/ABC123")).toBe(false);
    expect(isOfflineSignal("")).toBe(false);
  });
});
