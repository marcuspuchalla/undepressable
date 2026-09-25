import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createConnectionMonitor, selectedPathFromStats, classifyPath } from "./connectionMonitor";
import { PEER_TUNING } from "./peerPolicy";

// A minimal stand-in for the browser's RTCPeerConnection: just the surface
// Trystero and the monitor touch, with knobs to drive state from the test.
class FakeChannel extends EventTarget {
  readyState: RTCDataChannelState = "connecting";
  closed = false;
  close() {
    this.closed = true;
    this.readyState = "closed";
  }
  open() {
    this.readyState = "open";
    this.dispatchEvent(new Event("open"));
  }
}

class FakePC extends EventTarget {
  static instances: FakePC[] = [];
  config: RTCConfiguration | undefined;
  _gathering: RTCIceGatheringState = "new";
  connectionState: RTCPeerConnectionState = "new";
  closedNatively = false;
  channels: FakeChannel[] = [];
  constructor(config?: RTCConfiguration) {
    super();
    this.config = config;
    FakePC.instances.push(this);
  }
  get iceGatheringState() {
    return this._gathering;
  }
  async setRemoteDescription(_d: RTCSessionDescriptionInit) {}
  createDataChannel(_label: string) {
    const ch = new FakeChannel();
    this.channels.push(ch);
    return ch as unknown as RTCDataChannel;
  }
  close() {
    this.closedNatively = true;
    this.connectionState = "closed";
    for (const ch of this.channels) ch.close();
  }
  async getStats() {
    return new Map();
  }
  // --- test drivers ---
  gather(state: RTCIceGatheringState) {
    this._gathering = state;
    this.dispatchEvent(new Event("icegatheringstatechange"));
  }
  candidate(line: string) {
    const ev = new Event("icecandidate") as any;
    ev.candidate = { candidate: line };
    this.dispatchEvent(ev);
  }
  conn(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.dispatchEvent(new Event("connectionstatechange"));
  }
}

const HOST = "candidate:1 1 udp 2122260223 192.168.1.20 54321 typ host";
const SRFLX = "candidate:3 1 udp 1686052607 203.0.113.7 61000 typ srflx raddr 192.168.1.20 rport 54321";
const RELAY = "candidate:5 1 udp 41885439 198.51.100.9 3478 typ relay raddr 203.0.113.7 rport 61000";
const REMOTE_SDP = "v=0\r\na=candidate:9 1 udp 1686052607 198.18.0.5 40000 typ srflx raddr 0.0.0.0 rport 0\r\n";
const STUN_ONLY: RTCConfiguration = { iceServers: [{ urls: "stun:stun.example:3478" }] };
const WITH_TURN: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.example:3478" }, { urls: "turn:turn.example:3478", username: "u", credential: "p" }],
};

function setup() {
  const onChange = vi.fn();
  const monitor = createConnectionMonitor({ base: FakePC as unknown as typeof RTCPeerConnection, onChange });
  const PC = monitor.peerClass();
  const make = (config: RTCConfiguration = STUN_ONLY) => {
    const pc = new PC(config);
    return { pc, fake: pc as unknown as FakePC };
  };
  return { monitor, make, onChange };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakePC.instances = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("early gathering completion", () => {
  it("reports complete once STUN answered and candidates went quiet — not after Trystero's 5 s", () => {
    const { make } = setup();
    const { pc, fake } = make();
    const heard: string[] = [];
    pc.addEventListener("icegatheringstatechange", () => heard.push(pc.iceGatheringState));

    fake.gather("gathering");
    fake.candidate(HOST);
    fake.candidate(SRFLX);
    expect(pc.iceGatheringState).toBe("gathering");

    vi.advanceTimersByTime(PEER_TUNING.quietMs + 5);
    expect(pc.iceGatheringState).toBe("complete");
    expect(heard).toContain("complete");
  });

  it("gives up on unreachable STUN after the cap and ships host candidates", () => {
    const { make } = setup();
    const { pc, fake } = make();
    fake.gather("gathering");
    fake.candidate(HOST);
    vi.advanceTimersByTime(PEER_TUNING.srflxCapMs - 100);
    expect(pc.iceGatheringState).toBe("gathering");
    vi.advanceTimersByTime(200);
    expect(pc.iceGatheringState).toBe("complete");
  });

  it("waits for the relay candidate when TURN is configured", () => {
    const { make } = setup();
    const { pc, fake } = make(WITH_TURN);
    fake.gather("gathering");
    fake.candidate(HOST);
    fake.candidate(SRFLX);
    vi.advanceTimersByTime(PEER_TUNING.relayCapMs - 500);
    expect(pc.iceGatheringState).toBe("gathering");
    fake.candidate(RELAY);
    vi.advanceTimersByTime(PEER_TUNING.quietMs + 5);
    expect(pc.iceGatheringState).toBe("complete");
  });

  it("stops waiting as soon as the relay reports failure, and later connections don't wait at all", () => {
    const { make } = setup();
    const first = make(WITH_TURN);
    first.fake.gather("gathering");
    first.fake.candidate(HOST);
    first.fake.candidate(SRFLX);
    vi.advanceTimersByTime(PEER_TUNING.quietMs + 5);
    expect(first.pc.iceGatheringState).toBe("gathering"); // still hoping for a relay
    const err = new Event("icecandidateerror") as any;
    Object.assign(err, { url: "turn:turn.example:3478?transport=udp", errorCode: 401, errorText: "Unauthorized" });
    first.fake.dispatchEvent(err);
    vi.advanceTimersByTime(20);
    expect(first.pc.iceGatheringState).toBe("complete");

    const second = make(WITH_TURN);
    second.fake.gather("gathering");
    second.fake.candidate(HOST);
    second.fake.candidate(SRFLX);
    vi.advanceTimersByTime(PEER_TUNING.quietMs + 5);
    expect(second.pc.iceGatheringState).toBe("complete");
  });

  it("keeps candidates that arrived before the gathering event", () => {
    const { make } = setup();
    const { pc, fake } = make();
    fake.candidate(SRFLX);
    fake.gather("gathering");
    vi.advanceTimersByTime(PEER_TUNING.quietMs + 5);
    expect(pc.iceGatheringState).toBe("complete");
  });
});

describe("negotiation-aware close", () => {
  it("closes immediately when the peer never answered (idle pool offer)", () => {
    const { make } = setup();
    const { pc, fake } = make();
    pc.close();
    expect(fake.closedNatively).toBe(true);
  });

  it("rescues an answered negotiation Trystero gave up on", async () => {
    const { make, monitor } = setup();
    const { pc, fake } = make();
    const ch = pc.createDataChannel("data") as unknown as FakeChannel;
    await pc.setRemoteDescription({ type: "answer", sdp: REMOTE_SDP });

    // Trystero's prune: destroy() closes the channel, then the connection.
    vi.advanceTimersByTime(4800);
    fake.conn("connecting");
    (ch as unknown as RTCDataChannel).close();
    pc.close();
    expect(ch.closed).toBe(false);
    expect(fake.closedNatively).toBe(false);

    // ICE finishes via the relay a few seconds later; the channel opens.
    vi.advanceTimersByTime(3000);
    fake.conn("connected");
    ch.open();
    vi.advanceTimersByTime(PEER_TUNING.negotiationWindowMs);
    expect(fake.closedNatively).toBe(false);

    const [attempt] = monitor.report().attempts;
    expect(attempt.outcome).toBe("connected");
    expect(attempt.closeDeferred).toBe(true);
    expect(attempt.rescued).toBe(true);

    // Trystero rejecting it as a duplicate (or leaving) still closes it.
    pc.close();
    expect(fake.closedNatively).toBe(true);
  });

  it("closes a deferred negotiation that never connects when the window ends", async () => {
    const { make, monitor } = setup();
    const { pc, fake } = make();
    await pc.setRemoteDescription({ type: "answer", sdp: REMOTE_SDP });
    pc.close();
    expect(fake.closedNatively).toBe(false);
    vi.advanceTimersByTime(PEER_TUNING.negotiationWindowMs + 10);
    expect(fake.closedNatively).toBe(true);
    expect(monitor.report().attempts[0].outcome).toBe("timeout");
  });

  it("a second close request is honoured immediately", async () => {
    const { make } = setup();
    const { pc, fake } = make();
    await pc.setRemoteDescription({ type: "answer", sdp: REMOTE_SDP });
    pc.close();
    pc.close();
    expect(fake.closedNatively).toBe(true);
  });

  it("drops the other parallel attempts to the same device once one is adopted", async () => {
    const { make } = setup();
    const a = make();
    const b = make();
    const chA = a.pc.createDataChannel("data") as unknown as FakeChannel;
    await a.pc.setRemoteDescription({ type: "answer", sdp: REMOTE_SDP });
    await b.pc.setRemoteDescription({ type: "answer", sdp: REMOTE_SDP });
    b.pc.close(); // deferred
    expect(b.fake.closedNatively).toBe(false);
    a.fake.conn("connected");
    chA.open();
    expect(b.fake.closedNatively).toBe(true);
  });

  it("gives up if connected but the channel never opens", async () => {
    const { make } = setup();
    const { pc, fake } = make();
    await pc.setRemoteDescription({ type: "answer", sdp: REMOTE_SDP });
    pc.close();
    fake.conn("connected");
    vi.advanceTimersByTime(PEER_TUNING.adoptAfterConnectMs + 10);
    expect(fake.closedNatively).toBe(true);
  });
});

describe("disconnected grace", () => {
  it("hides a blip that recovers from Trystero", () => {
    const { make } = setup();
    const { pc, fake } = make();
    const seen: string[] = [];
    pc.onconnectionstatechange = () => seen.push(pc.connectionState);
    fake.conn("connected");
    fake.conn("disconnected");
    vi.advanceTimersByTime(PEER_TUNING.disconnectGraceMs - 1000);
    fake.conn("connected");
    vi.advanceTimersByTime(PEER_TUNING.disconnectGraceMs);
    expect(seen).toEqual(["connected", "connected"]);
  });

  it("reports a disconnect that persists past the grace period", () => {
    const { make } = setup();
    const { pc, fake } = make();
    const seen: string[] = [];
    pc.onconnectionstatechange = () => seen.push(pc.connectionState);
    fake.conn("disconnected");
    vi.advanceTimersByTime(PEER_TUNING.disconnectGraceMs + 10);
    expect(seen).toEqual(["disconnected"]);
  });

  it("passes failure straight through", () => {
    const { make } = setup();
    const { pc, fake } = make();
    const seen: string[] = [];
    pc.onconnectionstatechange = () => seen.push(pc.connectionState);
    fake.conn("failed");
    expect(seen).toEqual(["failed"]);
  });
});

describe("session end and reporting", () => {
  it("closes leftover connections but leaves live peers to Trystero", async () => {
    const { make, monitor } = setup();
    const idle = make();
    const live = make();
    const ch = live.pc.createDataChannel("data") as unknown as FakeChannel;
    await live.pc.setRemoteDescription({ type: "answer", sdp: REMOTE_SDP });
    live.fake.conn("connected");
    ch.open();
    const negotiating = make();
    await negotiating.pc.setRemoteDescription({ type: "answer", sdp: REMOTE_SDP });

    monitor.end();
    expect(idle.fake.closedNatively).toBe(true);
    expect(negotiating.fake.closedNatively).toBe(true);
    expect(live.fake.closedNatively).toBe(false);
    expect(monitor.ended).toBe(true);
  });

  it("records only negotiations that reached a peer, with candidate types on both sides", async () => {
    const { make, monitor } = setup();
    make(); // pool offer that never gets an answer
    const { pc, fake } = make(WITH_TURN);
    fake.candidate(HOST);
    fake.candidate(RELAY);
    await pc.setRemoteDescription({ type: "offer", sdp: REMOTE_SDP });
    const r = monitor.report();
    expect(r.attempts).toHaveLength(1);
    expect(r.attempts[0].localTypes).toEqual(["host", "relay"]);
    expect(r.attempts[0].remoteTypes).toEqual(["srflx"]);
    expect(r.attempts[0].remoteKey).toBe("s:198.18.0.5");
    expect(r.gathered.relay).toBe(1);
    expect(r.wantRelay).toBe(true);
  });

  it("marks ICE failure", async () => {
    const { make, monitor } = setup();
    const { pc, fake } = make();
    await pc.setRemoteDescription({ type: "answer", sdp: REMOTE_SDP });
    fake.conn("failed");
    expect(monitor.report().attempts[0].outcome).toBe("failed");
  });

  it("collects TURN errors but ignores STUN noise", () => {
    const { make, monitor } = setup();
    const { fake } = make(WITH_TURN);
    const err = (url: string, code: number) => {
      const ev = new Event("icecandidateerror") as any;
      Object.assign(ev, { url, errorCode: code, errorText: "x" });
      fake.dispatchEvent(ev);
    };
    err("stun:stun.example:3478", 701);
    err("turn:turn.example:3478", 401);
    err("turn:turn.example:3478", 401);
    expect(monitor.report().relayErrors).toEqual([{ url: "turn:turn.example:3478", code: 401, text: "x" }]);
  });
});

describe("selectedPathFromStats", () => {
  it("follows the transport's selected pair (Chrome/Safari)", () => {
    const stats = [
      { id: "T", type: "transport", selectedCandidatePairId: "P" },
      { id: "P", type: "candidate-pair", localCandidateId: "L", remoteCandidateId: "R", currentRoundTripTime: 0.084 },
      { id: "L", type: "local-candidate", candidateType: "relay", protocol: "udp", relayProtocol: "tls" },
      { id: "R", type: "remote-candidate", candidateType: "srflx" },
    ];
    expect(selectedPathFromStats(stats)).toEqual({
      kind: "relay",
      local: "relay",
      remote: "srflx",
      protocol: "udp",
      relayProtocol: "tls",
      rttMs: 84,
    });
  });

  it("falls back to the flagged pair (Firefox)", () => {
    const stats = [
      { id: "P", type: "candidate-pair", selected: true, localCandidateId: "L", remoteCandidateId: "R" },
      { id: "L", type: "local-candidate", candidateType: "srflx", protocol: "udp" },
      { id: "R", type: "remote-candidate", candidateType: "prflx" },
    ];
    expect(selectedPathFromStats(stats)?.kind).toBe("direct");
  });

  it("returns null without a usable pair", () => {
    expect(selectedPathFromStats([])).toBeNull();
    expect(selectedPathFromStats([{ id: "P", type: "candidate-pair", selected: true }])).toBeNull();
  });

  it("classifies paths", () => {
    expect(classifyPath("host", "host")).toBe("lan");
    expect(classifyPath("srflx", "host")).toBe("direct");
    expect(classifyPath("host", "relay")).toBe("relay");
  });
});
