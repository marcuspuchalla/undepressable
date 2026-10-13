// Turn what the connection monitor saw into one honest sentence and one
// thing to do about it.
//
// The failure the user hit — a Mac behind a VPN, a phone on a German mobile
// network — used to look identical to a typo in the room code: an endless
// "connecting". It is not the same problem and does not have the same fix.
// Discovery can work perfectly (both devices find each other through the
// relays) while the two NATs make any direct path impossible. Only the
// attempt records can tell those apart, so this is where they get read.

import type { AttemptRecord, ConnectionReport, PathKind } from "./connectionMonitor";
import { PEER_TUNING } from "./peerPolicy";
import { describeRelayError, type NatKind } from "./natProbe";

export type DiagnosisCode =
  | "offline"
  | "no-signaling"
  | "searching"
  | "searching-long"
  | "negotiating"
  | "waiting-for-video"
  | "connected"
  | "idle"
  | "blocked-no-relay"
  | "relay-unreachable"
  | "relay-rejected"
  | "failed-with-relay"
  | "strict-network";

export type DiagnosisAction = "setup-relay" | "test-relay" | "check-code" | "retry" | "pair-offline" | "pair-messenger";

export interface Diagnosis {
  code: DiagnosisCode;
  level: "ok" | "info" | "warn" | "error";
  title: string;
  detail: string;
  action?: DiagnosisAction;
  /** How the (most recent) live connection is carried, when there is one. */
  path?: PathKind | null;
  /** Devices that found us but could not connect. */
  blockedPeers: number;
}

export interface DiagnosisInput {
  /** archive: a home archive waiting for its paired phone to forward a stream. */
  role: "streamer" | "collector" | "archive";
  now: number;
  /** When this device opened its rooms (null: not joined). */
  joinedAt: number | null;
  report: ConnectionReport | null;
  /** Peers Trystero considers connected (data channel open). */
  peerCount: number;
  /** Collector: video is actually arriving. */
  hasStream: boolean;
  relayConfigured: boolean;
  relayHealth: { open: number; total: number } | null;
  online: boolean;
  /** This device's network, from a quick STUN check (null: not measured yet). */
  natKind?: NatKind | null;
}

export interface AttemptSummary {
  negotiating: number;
  /** Distinct remote devices with a live connection, by how it is carried. */
  connectedPaths: PathKind[];
  /** Distinct remote devices that answered but never connected. */
  blocked: number;
  /** …of which a relay candidate was on the table, i.e. even the relay failed. */
  blockedDespiteRelay: number;
  latestPath: PathKind | null;
}

const SEARCH_PATIENCE_MS = 25_000;
const SIGNALING_GRACE_MS = 6000;
const RELAY_GRACE_MS = 8000;
const STRICT_HINT_AFTER_MS = 10_000;

function isNegotiating(a: AttemptRecord, now: number): boolean {
  return a.outcome === "pending" && a.connectedAt === null && now - a.remoteAt < PEER_TUNING.negotiationWindowMs;
}

function isDeadEnd(a: AttemptRecord, now: number): boolean {
  if (a.connectedAt !== null) return false;
  if (a.outcome === "failed" || a.outcome === "timeout") return true;
  // Still "pending" long after the window: ICE never got anywhere.
  return a.outcome === "pending" && now - a.remoteAt >= PEER_TUNING.negotiationWindowMs;
}

export function summarizeAttempts(attempts: AttemptRecord[], now: number): AttemptSummary {
  const groups = new Map<string, AttemptRecord[]>();
  for (const a of attempts) {
    const list = groups.get(a.remoteKey);
    if (list) list.push(a);
    else groups.set(a.remoteKey, [a]);
  }

  let negotiating = 0;
  let blocked = 0;
  let blockedDespiteRelay = 0;
  const connectedPaths: PathKind[] = [];
  let latestPath: PathKind | null = null;
  let latestConnectedAt = -Infinity;

  for (const list of groups.values()) {
    const live = list.filter((a) => a.connectedAt !== null && a.endedAt === null);
    const everConnected = list.some((a) => a.connectedAt !== null);
    const negotiatingHere = list.some((a) => isNegotiating(a, now));
    const deadEnds = list.filter((a) => isDeadEnd(a, now)).length;
    // Trystero retries on every announce, so a doomed pair always has a
    // fresh attempt in flight. Two dead ends with no success in between is
    // the verdict; waiting for the retries to stop would mean waiting forever.
    const blockedHere = live.length === 0 && !everConnected && (deadEnds >= 2 || (deadEnds >= 1 && !negotiatingHere));
    if (negotiatingHere && !blockedHere) negotiating++;
    if (live.length > 0) {
      const best = live.reduce((x, y) => ((y.connectedAt ?? 0) > (x.connectedAt ?? 0) ? y : x));
      const kind = best.path?.kind ?? "direct";
      connectedPaths.push(kind);
      if ((best.connectedAt ?? 0) > latestConnectedAt) {
        latestConnectedAt = best.connectedAt ?? 0;
        latestPath = best.path?.kind ?? null;
      }
    } else if (blockedHere) {
      blocked++;
      if (list.some((a) => a.localTypes.includes("relay") || a.remoteTypes.includes("relay"))) blockedDespiteRelay++;
    }
  }
  return { negotiating, connectedPaths, blocked, blockedDespiteRelay, latestPath };
}

function pathTitle(kind: PathKind | null | undefined): string {
  if (kind === "relay") return "Connected through your relay";
  if (kind === "lan") return "Connected on the local network";
  return "Connected directly";
}

function describePaths(paths: PathKind[]): string {
  const relay = paths.filter((p) => p === "relay").length;
  const direct = paths.length - relay;
  if (relay === 0) return "All connections are direct peer-to-peer.";
  if (direct === 0) return "All connections go through your relay (still end-to-end encrypted).";
  return `${direct} direct, ${relay} through your relay (still end-to-end encrypted).`;
}

export function diagnose(input: DiagnosisInput): Diagnosis {
  const { role, now, report } = input;
  const other = role === "collector" ? "the streamer" : role === "archive" ? "your phone" : "a viewer";
  const receiving = role !== "streamer";
  const elapsed = input.joinedAt === null ? 0 : now - input.joinedAt;
  const s = summarizeAttempts(report?.attempts ?? [], now);
  const relayErrors = report?.relayErrors ?? [];
  const rejected = relayErrors.find((e) => e.code === 401 || e.code === 403);
  // Quota/capacity: every connection attempt allocates a relay port (Trystero
  // pre-builds offers), so a relay with a low allocation cap runs out.
  const exhausted = relayErrors.find((e) => e.code === 486 || e.code === 508);
  const relaySilent =
    input.relayConfigured &&
    !exhausted &&
    report !== null &&
    report.gathered.relay === 0 &&
    report.gathered.host > 0 &&
    now - report.startedAt > RELAY_GRACE_MS;
  const signalingDown =
    input.relayHealth !== null &&
    input.relayHealth.total > 0 &&
    input.relayHealth.open === 0 &&
    elapsed > SIGNALING_GRACE_MS;

  if (!input.online) {
    return {
      code: "offline",
      level: "error",
      title: "This device is offline",
      detail: "Reconnect to Wi-Fi or mobile data. With no internet at all, use “Pair face to face” instead.",
      action: "pair-offline",
      blockedPeers: s.blocked,
    };
  }

  const blockedDiagnosis = (): Diagnosis | null => {
    if (s.blocked === 0) return null;
    const who =
      role === "collector"
        ? "Found the streamer"
        : role === "archive"
          ? "Your phone found this archive"
          : `${s.blocked === 1 ? "A viewer" : `${s.blocked} viewers`} found you`;
    if (input.relayConfigured && (relaySilent || rejected || exhausted)) {
      return {
        code: "relay-unreachable",
        level: "error",
        title: `${who}, but your relay isn't answering`,
        detail: rejected
          ? "Your networks block a direct connection, and the relay rejected its username/password."
          : exhausted
            ? `Your networks block a direct connection, and ${describeRelayError(exhausted.code)}. Raise its allocation quota, or try again shortly.`
            : "Your networks block a direct connection, and the configured relay could not be reached from here. Test the relay, or try one on port 443 (turns:).",
        action: "test-relay",
        blockedPeers: s.blocked,
      };
    }
    if (input.relayConfigured || s.blockedDespiteRelay > 0) {
      return {
        code: "failed-with-relay",
        level: "error",
        title: `${who}, but even the relay connection failed`,
        detail:
          "Both devices exchanged addresses, including a relay address, and still could not connect. The relay may block this traffic or be overloaded — test it, or try a relay on port 443 (turns:).",
        action: "test-relay",
        blockedPeers: s.blocked,
      };
    }
    return {
      code: "blocked-no-relay",
      level: "error",
      title: `${who}, but your networks block a direct connection`,
      detail:
        "Both devices are behind strict NAT — typical for VPNs and mobile carriers — so no direct path exists. A relay (TURN) server is needed; setting one up on either device is enough.",
      action: "setup-relay",
      blockedPeers: s.blocked,
    };
  };

  if (receiving) {
    if (input.hasStream) {
      return {
        code: "connected",
        level: "ok",
        title: role === "archive" ? "Receiving your phone's stream" : pathTitle(s.latestPath),
        detail: s.latestPath === "relay" ? "Video is relayed, still end-to-end encrypted." : "Video flows peer-to-peer.",
        path: s.latestPath,
        blockedPeers: 0,
      };
    }
    if (input.peerCount > 0) {
      return {
        code: "waiting-for-video",
        level: "info",
        title: role === "archive" ? "Paired phone connected" : "Connected — waiting for video",
        detail:
          role === "archive"
            ? "Recording starts automatically when your phone forwards a stream."
            : "The streamer is sending the picture; this usually takes a second or two.",
        path: s.latestPath,
        blockedPeers: 0,
      };
    }
  } else if (input.peerCount > 0 && s.blocked === 0) {
    // Everyone so far got in directly — but a broken relay will shut out the
    // next viewer on a strict network, so say so while there is time to fix it.
    const relayBroken = input.relayConfigured && (rejected || relaySilent);
    return {
      code: "connected",
      level: relayBroken ? "warn" : "ok",
      title: `${input.peerCount} ${input.peerCount === 1 ? "viewer" : "viewers"} connected`,
      detail: relayBroken
        ? `${describePaths(s.connectedPaths)} Your relay is not working, so viewers on strict networks won't get in.`
        : describePaths(s.connectedPaths),
      action: relayBroken ? "test-relay" : undefined,
      path: s.latestPath,
      blockedPeers: 0,
    };
  }

  if (rejected) {
    return {
      code: "relay-rejected",
      level: "error",
      title: "Your relay rejected its username/password",
      detail: "Connections that need the relay will fail until the credentials are fixed.",
      action: "test-relay",
      blockedPeers: s.blocked,
    };
  }

  const blocked = blockedDiagnosis();
  if (blocked) {
    // A streamer with some viewers connected still needs to hear about the
    // ones who could not get in — but it is a warning, not a failure.
    if (role === "streamer" && input.peerCount > 0) return { ...blocked, level: "warn", path: s.latestPath };
    return blocked;
  }

  if (s.negotiating > 0) {
    return {
      code: "negotiating",
      level: "info",
      title: role === "streamer" ? "A viewer is connecting…" : `Found ${other} — connecting…`,
      detail: "Trying direct paths first, then the relay if one is configured.",
      blockedPeers: 0,
    };
  }

  if (signalingDown) {
    return {
      code: "no-signaling",
      level: "error",
      title: "Can't reach any discovery server",
      detail:
        "This network seems to block the servers devices use to find each other. You don't need them: swap two codes over any messenger and connect directly — or try another network.",
      action: "pair-messenger",
      blockedPeers: 0,
    };
  }

  if (relaySilent) {
    return {
      code: "relay-unreachable",
      level: "warn",
      title: "Your relay isn't answering",
      detail: "Direct connections still work, but devices behind strict NAT won't reach you. Test the relay settings.",
      action: "test-relay",
      blockedPeers: 0,
    };
  }

  // Seen before anything fails: this network cannot reach other strict
  // networks without a relay. The streamer hears it while waiting for
  // viewers; a viewer only once the search is taking a while.
  const strict = !input.relayConfigured && (input.natKind === "hard" || input.natKind === "blocked");
  if (strict && (role !== "collector" || elapsed > STRICT_HINT_AFTER_MS)) {
    const blockedUdp = input.natKind === "blocked";
    return {
      code: "strict-network",
      level: "warn",
      title: blockedUdp ? "This network blocks direct connections" : "Strict network detected — VPN or mobile data?",
      detail: blockedUdp
        ? "No STUN server answered over UDP, so only a relay reachable over TCP/TLS can connect you. Try a free public relay, more STUN servers, or add your own relay."
        : `Devices on similar networks (VPNs, mobile carriers) can't connect to this one directly. A relay fixes that — try a free public one, or add your own. ${role === "collector" ? "The streamer may still be reachable directly." : "Viewers on ordinary networks can still connect."}`,
      action: "setup-relay",
      blockedPeers: 0,
    };
  }

  if (role === "streamer") {
    return {
      code: "idle",
      level: "info",
      title: "Waiting for viewers",
      detail: "Share the code or QR. Viewers appear here as they connect.",
      blockedPeers: 0,
    };
  }

  if (role === "archive") {
    // An archive waits for hours by design; there is nothing to escalate.
    return {
      code: "searching",
      level: "info",
      title: "Waiting for your paired phone",
      detail: "Leave this open and online. When your phone watches a stream, it forwards it here.",
      blockedPeers: 0,
    };
  }

  if (elapsed > SEARCH_PATIENCE_MS) {
    return {
      code: "searching-long",
      level: "warn",
      title: `Still looking for ${other}`,
      detail: "Check the room code, and that the streamer's app is open and live. Discovery keeps running in the background.",
      action: "check-code",
      blockedPeers: 0,
    };
  }
  return {
    code: "searching",
    level: "info",
    title: `Looking for ${other}…`,
    detail: "Asking the discovery servers who else is in this room.",
    blockedPeers: 0,
  };
}
