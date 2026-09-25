import { describe, it, expect } from "vitest";
import {
  encodeLinkMsg,
  decodeLinkMsg,
  linkPhase,
  OFFLINE_CONNECT_TIMEOUT_MS,
  OFFLINE_SILENCE_MS,
  type LinkFacts,
} from "./offlineLink";

describe("control messages", () => {
  it("round-trips each message kind", () => {
    for (const m of [
      { t: "sdp", d: { type: "offer", sdp: "v=0\r\n" } },
      { t: "hello", role: "watch", recording: true },
      { t: "bye" },
    ] as const) {
      expect(decodeLinkMsg(encodeLinkMsg(m as any))).toEqual(m);
    }
  });

  it("drops malformed or oversized input from the peer", () => {
    expect(decodeLinkMsg("not json")).toBeNull();
    expect(decodeLinkMsg(JSON.stringify({ t: "sdp", d: { type: "pranswer", sdp: "" } }))).toBeNull();
    expect(decodeLinkMsg(JSON.stringify({ t: "hello", role: "admin", recording: true }))).toBeNull();
    expect(decodeLinkMsg(JSON.stringify({ t: "hello", role: "watch" }))).toBeNull();
    expect(decodeLinkMsg(JSON.stringify({ t: "other" }))).toBeNull();
    expect(decodeLinkMsg(new ArrayBuffer(4))).toBeNull();
    expect(decodeLinkMsg("x".repeat(70 * 1024))).toBeNull();
  });
});

describe("linkPhase", () => {
  const base: LinkFacts = {
    handshakeAt: 1000,
    channelOpen: false,
    everConnected: false,
    connectionState: "connecting",
    lastHeardAt: null,
    closedByUs: false,
    now: 2000,
  };

  it("walks awaiting-reply → connecting → connected", () => {
    expect(linkPhase({ ...base, handshakeAt: null })).toBe("awaiting-reply");
    expect(linkPhase(base)).toBe("connecting");
    expect(linkPhase({ ...base, channelOpen: true, everConnected: true, connectionState: "connected", lastHeardAt: 1900 })).toBe("connected");
  });

  it("times out a handshake that never connects, or fails outright", () => {
    expect(linkPhase({ ...base, now: 1000 + OFFLINE_CONNECT_TIMEOUT_MS + 1 })).toBe("timed-out");
    expect(linkPhase({ ...base, connectionState: "failed" })).toBe("timed-out");
  });

  it("calls a link lost when it dies or goes silent after connecting", () => {
    const live = { ...base, channelOpen: true, everConnected: true, connectionState: "connected" as const, lastHeardAt: 1900 };
    expect(linkPhase({ ...live, connectionState: "failed" })).toBe("lost");
    expect(linkPhase({ ...live, channelOpen: false })).toBe("lost");
    expect(linkPhase({ ...live, now: 1900 + OFFLINE_SILENCE_MS + 1 })).toBe("lost");
  });

  it("a link we closed is closed, whatever else is true", () => {
    expect(linkPhase({ ...base, closedByUs: true, connectionState: "failed" })).toBe("closed");
  });
});
