import { describe, it, expect } from "vitest";
import { gatherVerdict, shouldDeferClose, PEER_TUNING, type GatherState } from "./peerPolicy";

const base: GatherState = {
  elapsedMs: 0,
  sinceLastCandidateMs: 0,
  haveAny: true,
  haveSrflx: false,
  haveRelay: false,
  wantSrflx: true,
  wantRelay: false,
};

describe("gatherVerdict", () => {
  it("waits while nothing has been gathered", () => {
    expect(gatherVerdict({ ...base, haveAny: false })).toEqual({ done: false, recheckInMs: null });
  });

  it("completes once a STUN answer is in and candidates went quiet", () => {
    const s = { ...base, haveSrflx: true, elapsedMs: 300, sinceLastCandidateMs: 50 };
    expect(gatherVerdict(s)).toEqual({ done: false, recheckInMs: PEER_TUNING.quietMs - 50 });
    expect(gatherVerdict({ ...s, sinceLastCandidateMs: PEER_TUNING.quietMs })).toEqual({ done: true });
  });

  it("does not wait for slow or unreachable STUN servers beyond the cap", () => {
    // Host only: e.g. UDP blocked, or a STUN server that never answers.
    const early = gatherVerdict({ ...base, elapsedMs: 1000, sinceLastCandidateMs: 1000 });
    expect(early).toEqual({ done: false, recheckInMs: PEER_TUNING.srflxCapMs - 1000 });
    expect(gatherVerdict({ ...base, elapsedMs: PEER_TUNING.srflxCapMs })).toEqual({ done: true });
  });

  it("holds out for a relay candidate when TURN is configured", () => {
    const s = { ...base, wantRelay: true, haveSrflx: true, elapsedMs: 1000, sinceLastCandidateMs: 900 };
    expect(gatherVerdict(s)).toEqual({ done: false, recheckInMs: PEER_TUNING.relayCapMs - 1000 });
    expect(gatherVerdict({ ...s, haveRelay: true })).toEqual({ done: true });
  });

  it("stops waiting for a relay that never answers, well before Trystero's offer prune", () => {
    const s = { ...base, wantRelay: true, haveSrflx: true, elapsedMs: PEER_TUNING.relayCapMs, sinceLastCandidateMs: 2000 };
    expect(gatherVerdict(s)).toEqual({ done: true });
    expect(PEER_TUNING.relayCapMs).toBeLessThan(4000);
  });

  it("with no ICE servers at all (offline), completes once host candidates settle", () => {
    const s = { ...base, wantSrflx: false, sinceLastCandidateMs: PEER_TUNING.quietMs };
    expect(gatherVerdict(s)).toEqual({ done: true });
  });
});

describe("shouldDeferClose", () => {
  const ctx = {
    remoteAt: 1000,
    now: 5800, // Trystero's nostr prune fires ~4.8 s after the offer
    connectionState: "connecting" as RTCPeerConnectionState,
    channelOpen: false,
    sessionEnded: false,
  };

  it("keeps a negotiation that already reached the far side", () => {
    expect(shouldDeferClose(ctx)).toBe(true);
  });

  it("never defers when the peer never answered", () => {
    expect(shouldDeferClose({ ...ctx, remoteAt: null })).toBe(false);
  });

  it("never defers a live peer, a failed one, or after the session ended", () => {
    expect(shouldDeferClose({ ...ctx, channelOpen: true })).toBe(false);
    expect(shouldDeferClose({ ...ctx, connectionState: "failed" })).toBe(false);
    expect(shouldDeferClose({ ...ctx, sessionEnded: true })).toBe(false);
  });

  it("gives up once the negotiation window has passed", () => {
    expect(shouldDeferClose({ ...ctx, now: ctx.remoteAt + PEER_TUNING.negotiationWindowMs })).toBe(false);
  });
});
