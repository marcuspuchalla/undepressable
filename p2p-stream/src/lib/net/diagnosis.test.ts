import { describe, it, expect } from "vitest";
import { diagnose, summarizeAttempts, type DiagnosisInput } from "./diagnosis";
import type { AttemptRecord, ConnectionReport } from "./connectionMonitor";
import { PEER_TUNING } from "./peerPolicy";

const NOW = 100_000;

function attempt(over: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    id: 1,
    createdAt: NOW - 30_000,
    remoteAt: NOW - 30_000,
    connectedAt: null,
    endedAt: null,
    outcome: "pending",
    localTypes: ["host", "srflx"],
    remoteTypes: ["srflx"],
    remoteKey: "s:198.18.0.5",
    path: null,
    closeDeferred: false,
    rescued: false,
    ...over,
  };
}

function report(attempts: AttemptRecord[], over: Partial<ConnectionReport> = {}): ConnectionReport {
  return {
    startedAt: NOW - 60_000,
    attempts,
    gathered: { host: 4, srflx: 2, prflx: 0, relay: 0 },
    wantRelay: false,
    relayErrors: [],
    ...over,
  };
}

function input(over: Partial<DiagnosisInput> = {}): DiagnosisInput {
  return {
    role: "collector",
    now: NOW,
    joinedAt: NOW - 60_000,
    report: report([]),
    peerCount: 0,
    hasStream: false,
    relayConfigured: false,
    relayHealth: { open: 5, total: 8 },
    online: true,
    ...over,
  };
}

describe("summarizeAttempts", () => {
  it("groups the parallel attempts to one device and counts it once", () => {
    const s = summarizeAttempts(
      [
        attempt({ id: 1, outcome: "timeout", endedAt: NOW - 1000 }),
        attempt({ id: 2, outcome: "failed", endedAt: NOW - 500 }),
        attempt({ id: 3, remoteKey: "s:203.0.113.1", connectedAt: NOW - 100, outcome: "connected", path: { kind: "relay", local: "relay", remote: "srflx", protocol: "udp" } }),
      ],
      NOW,
    );
    expect(s.blocked).toBe(1);
    expect(s.connectedPaths).toEqual(["relay"]);
    expect(s.latestPath).toBe("relay");
  });

  it("a device that connected via another transport is not 'blocked'", () => {
    const s = summarizeAttempts(
      [attempt({ outcome: "timeout", endedAt: NOW }), attempt({ id: 2, connectedAt: NOW - 50, outcome: "connected" })],
      NOW,
    );
    expect(s.blocked).toBe(0);
  });

  it("an attempt still inside the negotiation window is negotiating, not blocked", () => {
    const s = summarizeAttempts([attempt({ remoteAt: NOW - 2000 })], NOW);
    expect(s.negotiating).toBe(1);
    expect(s.blocked).toBe(0);
  });

  it("repeated dead ends are 'blocked' even while Trystero's next retry is in flight", () => {
    const s = summarizeAttempts(
      [
        attempt({ id: 1, outcome: "timeout", endedAt: NOW - 6000 }),
        attempt({ id: 2, outcome: "timeout", endedAt: NOW - 1000 }),
        attempt({ id: 3, remoteAt: NOW - 2000 }),
      ],
      NOW,
    );
    expect(s.blocked).toBe(1);
    expect(s.negotiating).toBe(0);
  });

  it("one dead end while a retry is in flight is not yet a verdict", () => {
    const s = summarizeAttempts([attempt({ outcome: "timeout", endedAt: NOW - 1000 }), attempt({ id: 2, remoteAt: NOW - 2000 })], NOW);
    expect(s.blocked).toBe(0);
    expect(s.negotiating).toBe(1);
  });

  it("a pending attempt stuck past the window counts as a dead end", () => {
    const s = summarizeAttempts([attempt({ remoteAt: NOW - PEER_TUNING.negotiationWindowMs - 1 })], NOW);
    expect(s.blocked).toBe(1);
  });
});

describe("diagnose — the VPN ↔ mobile-carrier case", () => {
  it("says the networks block a direct connection and that a relay is the fix", () => {
    const d = diagnose(input({ report: report([attempt({ outcome: "timeout", endedAt: NOW - 1 })]) }));
    expect(d.code).toBe("blocked-no-relay");
    expect(d.action).toBe("setup-relay");
    expect(d.title).toMatch(/Found the streamer/);
  });

  it("blames the relay when one is configured but never produced an address", () => {
    const d = diagnose(input({ relayConfigured: true, report: report([attempt({ outcome: "failed", endedAt: NOW })], { wantRelay: true }) }));
    expect(d.code).toBe("relay-unreachable");
    expect(d.action).toBe("test-relay");
  });

  it("says even the relay failed when relay addresses were exchanged", () => {
    const d = diagnose(
      input({
        relayConfigured: true,
        report: report([attempt({ outcome: "failed", endedAt: NOW, localTypes: ["host", "relay"] })], {
          wantRelay: true,
          gathered: { host: 2, srflx: 1, prflx: 0, relay: 3 },
        }),
      }),
    );
    expect(d.code).toBe("failed-with-relay");
  });

  it("names an exhausted relay (quota / capacity) instead of calling it unreachable", () => {
    const d = diagnose(
      input({
        relayConfigured: true,
        report: report([attempt({ outcome: "failed", endedAt: NOW })], { wantRelay: true, relayErrors: [{ url: "turn:r", code: 508, text: "" }] }),
      }),
    );
    expect(d.code).toBe("relay-unreachable");
    expect(d.detail).toMatch(/out of capacity/);
  });

  it("surfaces rejected relay credentials", () => {
    const d = diagnose(input({ relayConfigured: true, report: report([], { relayErrors: [{ url: "turn:r", code: 401, text: "" }] }) }));
    expect(d.code).toBe("relay-rejected");
  });
});

describe("diagnose — collector states", () => {
  it("connected, with the path", () => {
    const d = diagnose(
      input({
        hasStream: true,
        peerCount: 1,
        report: report([attempt({ connectedAt: NOW - 10, outcome: "connected", path: { kind: "relay", local: "relay", remote: "srflx", protocol: "udp" } })]),
      }),
    );
    expect(d.code).toBe("connected");
    expect(d.title).toMatch(/relay/);
  });

  it("waiting for video once the peer connected", () => {
    expect(diagnose(input({ peerCount: 1 })).code).toBe("waiting-for-video");
  });

  it("negotiating while an answered attempt is in flight", () => {
    expect(diagnose(input({ report: report([attempt({ remoteAt: NOW - 1000 })]) })).code).toBe("negotiating");
  });

  it("searching, then honest about searching for long", () => {
    expect(diagnose(input({ joinedAt: NOW - 3000 })).code).toBe("searching");
    const long = diagnose(input({ joinedAt: NOW - 30_000 }));
    expect(long.code).toBe("searching-long");
    expect(long.action).toBe("check-code");
  });

  it("flags dead discovery servers", () => {
    expect(diagnose(input({ relayHealth: { open: 0, total: 8 } })).code).toBe("no-signaling");
  });

  it("offline beats everything", () => {
    expect(diagnose(input({ online: false, hasStream: true })).code).toBe("offline");
  });

  it("warns about a silent relay even before anyone tried to connect", () => {
    const d = diagnose(input({ joinedAt: NOW - 3000, relayConfigured: true, report: report([], { wantRelay: true }) }));
    expect(d.code).toBe("relay-unreachable");
    expect(d.level).toBe("warn");
  });
});

describe("diagnose — streamer states", () => {
  const streamer = (over: Partial<DiagnosisInput> = {}) => input({ role: "streamer", ...over });

  it("idle until someone shows up", () => {
    expect(diagnose(streamer({ joinedAt: NOW - 60_000 })).code).toBe("idle");
  });

  it("counts viewers and says how they are connected", () => {
    const d = diagnose(
      streamer({
        peerCount: 2,
        report: report([
          attempt({ remoteKey: "a", connectedAt: NOW - 5, outcome: "connected", path: { kind: "direct", local: "srflx", remote: "srflx", protocol: "udp" } }),
          attempt({ remoteKey: "b", connectedAt: NOW - 5, outcome: "connected", path: { kind: "relay", local: "relay", remote: "srflx", protocol: "udp" } }),
        ]),
      }),
    );
    expect(d.code).toBe("connected");
    expect(d.title).toBe("2 viewers connected");
    expect(d.detail).toMatch(/1 direct, 1 through your relay/);
  });

  it("warns a connected streamer whose relay is broken, before a strict-NAT viewer arrives", () => {
    const d = diagnose(
      streamer({
        peerCount: 1,
        relayConfigured: true,
        report: report([attempt({ remoteKey: "a", connectedAt: NOW - 5, outcome: "connected" })], {
          wantRelay: true,
          relayErrors: [{ url: "turn:r", code: 401, text: "" }],
        }),
      }),
    );
    expect(d.code).toBe("connected");
    expect(d.level).toBe("warn");
    expect(d.action).toBe("test-relay");
  });

  it("tells the streamer about a viewer who found them but could not connect", () => {
    const d = diagnose(streamer({ report: report([attempt({ outcome: "timeout", endedAt: NOW })]) }));
    expect(d.code).toBe("blocked-no-relay");
    expect(d.title).toMatch(/A viewer found you/);
  });

  it("…as a warning when other viewers did get in", () => {
    const d = diagnose(
      streamer({
        peerCount: 1,
        report: report([
          attempt({ remoteKey: "a", connectedAt: NOW - 5, outcome: "connected" }),
          attempt({ remoteKey: "b", outcome: "timeout", endedAt: NOW }),
        ]),
      }),
    );
    expect(d.code).toBe("blocked-no-relay");
    expect(d.level).toBe("warn");
  });
});
