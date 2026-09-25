// Every RTCPeerConnection Trystero opens, observed and gently corrected.
//
// Trystero accepts an `rtcPolyfill` — the constructor it uses for peer
// connections. We hand it a subclass of the browser's own RTCPeerConnection
// that does three things Trystero does not (see peerPolicy.ts for why):
//
//   * completes ICE gathering as soon as the useful candidates are in,
//   * lets a negotiation that already reached the far side finish instead of
//     being destroyed by Trystero's ~4.8 s offer prune,
//   * gives a `disconnected` connection a few seconds to recover.
//
// It also records what happened to each attempt, which is the only way to
// tell "we never found the other device" (discovery) apart from "we found it
// but the networks would not let us connect" (NAT) — the difference between
// "check the room code" and "you need a relay".

import { candidatesFromSdp, parseCandidate, remoteKeyOf, uniqueTypes, type CandidateType } from "./candidates";
import { gatherVerdict, shouldDeferClose, PEER_TUNING, type PeerTuning } from "./peerPolicy";

export type AttemptOutcome = "pending" | "connected" | "failed" | "timeout" | "closed";
export type PathKind = "lan" | "direct" | "relay";

export interface PathInfo {
  kind: PathKind;
  local: CandidateType;
  remote: CandidateType;
  protocol: string;
  relayProtocol?: string;
  rttMs?: number;
}

/** One negotiation with a peer that actually answered (remote description applied). */
export interface AttemptRecord {
  id: number;
  createdAt: number;
  remoteAt: number;
  connectedAt: number | null;
  endedAt: number | null;
  outcome: AttemptOutcome;
  localTypes: CandidateType[];
  remoteTypes: CandidateType[];
  remoteKey: string;
  path: PathInfo | null;
  /** Trystero asked to close this while it was still negotiating. */
  closeDeferred: boolean;
  /** …and it connected anyway: a connection Trystero would have thrown away. */
  rescued: boolean;
}

export interface CandidateErrorInfo {
  url: string;
  code: number;
  text: string;
}

export interface ConnectionReport {
  startedAt: number;
  attempts: AttemptRecord[];
  /** Local candidates gathered across every connection this session, by type. */
  gathered: Record<CandidateType, number>;
  /** TURN servers were configured for this session. */
  wantRelay: boolean;
  /** Recent TURN errors (bad credentials, unreachable relay). */
  relayErrors: CandidateErrorInfo[];
}

interface PeerState {
  id: number;
  createdAt: number;
  wantSrflx: boolean;
  wantRelay: boolean;
  gatherStart: number | null;
  lastCandidateAt: number | null;
  have: Set<CandidateType>;
  early: boolean;
  /** The current gathering phase finished (natively or early). */
  phaseDone: boolean;
  gatherTimer: ReturnType<typeof setTimeout> | null;
  userConnHandler: ((this: RTCPeerConnection, ev: Event) => unknown) | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
  closeRequested: boolean;
  closeTimer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
  channelOpen: boolean;
  attempt: AttemptRecord | null;
  localTypes: Set<CandidateType>;
  /** TURN urls configured on this connection, and those that reported failure. */
  turnUrlCount: number;
  failedTurnUrls: Set<string>;
}

export interface ConnectionMonitor {
  /** The RTCPeerConnection subclass to hand Trystero as `rtcPolyfill`. */
  peerClass(): typeof RTCPeerConnection;
  report(): ConnectionReport;
  /** Session over: close every connection that is not carrying a live peer. */
  end(): void;
  readonly ended: boolean;
}

export interface MonitorOptions {
  base?: typeof RTCPeerConnection;
  now?: () => number;
  tuning?: Partial<PeerTuning>;
  onChange?: () => void;
  /** Cap on remembered attempts (a crowded room would otherwise grow without bound). */
  maxAttempts?: number;
}

const MAX_RELAY_ERRORS = 8;

function findDescriptor(proto: object | null, name: string): PropertyDescriptor | undefined {
  while (proto) {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (d) return d;
    proto = Object.getPrototypeOf(proto);
  }
  return undefined;
}

function wantsFrom(config?: RTCConfiguration): { wantSrflx: boolean; wantRelay: boolean; turnUrlCount: number } {
  const urls: string[] = [];
  for (const s of config?.iceServers ?? []) {
    for (const u of Array.isArray(s.urls) ? s.urls : [s.urls]) if (typeof u === "string") urls.push(u);
  }
  const turnUrlCount = urls.filter((u) => /^turns?:/i.test(u)).length;
  const relayOnly = config?.iceTransportPolicy === "relay";
  const wantSrflx = !relayOnly && urls.some((u) => /^(stun|turns?):/i.test(u));
  return { wantSrflx, wantRelay: turnUrlCount > 0, turnUrlCount };
}

export function classifyPath(local: CandidateType, remote: CandidateType): PathKind {
  if (local === "relay" || remote === "relay") return "relay";
  if (local === "host" && remote === "host") return "lan";
  return "direct";
}

/**
 * Find the candidate pair actually carrying traffic in a getStats() dump.
 * Chrome/Safari name it on the transport; Firefox flags the pair itself.
 */
export function selectedPathFromStats(entries: any[]): PathInfo | null {
  const byId = new Map<string, any>();
  for (const e of entries) if (e && typeof e.id === "string") byId.set(e.id, e);

  let pair: any = null;
  for (const e of entries) {
    if (e?.type === "transport" && e.selectedCandidatePairId) {
      pair = byId.get(e.selectedCandidatePairId) ?? null;
      if (pair) break;
    }
  }
  if (!pair) {
    pair =
      entries.find((e) => e?.type === "candidate-pair" && e.selected) ??
      entries.find((e) => e?.type === "candidate-pair" && e.nominated && e.state === "succeeded") ??
      null;
  }
  if (!pair) return null;

  const local = byId.get(pair.localCandidateId);
  const remote = byId.get(pair.remoteCandidateId);
  if (!local?.candidateType || !remote?.candidateType) return null;

  const info: PathInfo = {
    kind: classifyPath(local.candidateType, remote.candidateType),
    local: local.candidateType,
    remote: remote.candidateType,
    protocol: local.protocol ?? "udp",
  };
  if (local.relayProtocol) info.relayProtocol = local.relayProtocol;
  if (typeof pair.currentRoundTripTime === "number") info.rttMs = Math.round(pair.currentRoundTripTime * 1000);
  return info;
}

let nextId = 1;

export function createConnectionMonitor(opts: MonitorOptions = {}): ConnectionMonitor {
  const now = opts.now ?? (() => Date.now());
  const tuning: PeerTuning = { ...PEER_TUNING, ...opts.tuning };
  const maxAttempts = opts.maxAttempts ?? 40;
  const startedAt = now();

  const live = new Map<RTCPeerConnection, PeerState>();
  const attempts: AttemptRecord[] = [];
  const gathered: Record<CandidateType, number> = { host: 0, srflx: 0, prflx: 0, relay: 0 };
  const relayErrors: CandidateErrorInfo[] = [];
  let wantRelay = false;
  let ended = false;
  let cls: typeof RTCPeerConnection | null = null;

  const changed = () => {
    try {
      opts.onChange?.();
    } catch {
      /* a UI listener must never break the connection path */
    }
  };

  function pushAttempt(rec: AttemptRecord) {
    attempts.unshift(rec);
    if (attempts.length > maxAttempts) attempts.length = maxAttempts;
  }

  function build(): typeof RTCPeerConnection {
    const Base: typeof RTCPeerConnection | undefined = opts.base ?? (globalThis as any).RTCPeerConnection;
    if (!Base) throw new Error("WebRTC is not available in this environment");

    const states = new WeakMap<RTCPeerConnection, PeerState>();
    const synthetic = new WeakSet<Event>();
    const gatherGetter = findDescriptor(Base.prototype, "iceGatheringState")?.get;
    const baseClose = Base.prototype.close;
    const baseSetRemote = Base.prototype.setRemoteDescription as (
      this: RTCPeerConnection,
      description: RTCSessionDescriptionInit,
    ) => Promise<void>;
    const baseCreateChannel = Base.prototype.createDataChannel;

    const realGathering = (pc: RTCPeerConnection): RTCIceGatheringState =>
      gatherGetter ? gatherGetter.call(pc) : "complete";

    function forceClose(pc: RTCPeerConnection, st: PeerState, outcome?: AttemptOutcome) {
      if (st.closed) return;
      st.closed = true;
      for (const t of [st.gatherTimer, st.graceTimer, st.closeTimer]) if (t) clearTimeout(t);
      st.gatherTimer = st.graceTimer = st.closeTimer = null;
      live.delete(pc);
      if (st.attempt && st.attempt.endedAt === null) {
        st.attempt.endedAt = now();
        if (st.attempt.outcome === "pending" || st.attempt.outcome === "connected") {
          st.attempt.outcome = outcome ?? (st.attempt.connectedAt ? "closed" : "timeout");
        }
      }
      try {
        baseClose.call(pc);
      } catch {
        /* already closed */
      }
      changed();
    }

    function checkGathering(pc: RTCPeerConnection, st: PeerState) {
      st.gatherTimer = null;
      if (st.early || st.closed || realGathering(pc) === "complete") return;
      const t = now();
      const verdict = gatherVerdict(
        {
          elapsedMs: st.gatherStart === null ? 0 : t - st.gatherStart,
          sinceLastCandidateMs: st.lastCandidateAt === null ? 0 : t - st.lastCandidateAt,
          haveAny: st.have.size > 0,
          haveSrflx: st.have.has("srflx"),
          haveRelay: st.have.has("relay"),
          wantSrflx: st.wantSrflx,
          wantRelay: st.wantRelay,
        },
        tuning,
      );
      if (verdict.done) {
        st.early = true;
        st.phaseDone = true;
        const ev = new Event("icegatheringstatechange");
        synthetic.add(ev);
        pc.dispatchEvent(ev);
      } else if (verdict.recheckInMs !== null) {
        st.gatherTimer = setTimeout(() => checkGathering(pc, st), Math.max(10, verdict.recheckInMs));
      }
    }

    function scheduleGatherCheck(pc: RTCPeerConnection, st: PeerState, inMs: number) {
      if (st.gatherTimer) clearTimeout(st.gatherTimer);
      st.gatherTimer = setTimeout(() => checkGathering(pc, st), inMs);
    }

    function onCandidate(pc: RTCPeerConnection, st: PeerState, ev: RTCPeerConnectionIceEvent) {
      if (!ev.candidate?.candidate) return;
      const c = parseCandidate(ev.candidate.candidate);
      if (!c) return;
      if (st.gatherStart === null) st.gatherStart = now();
      st.have.add(c.type);
      st.localTypes.add(c.type);
      st.lastCandidateAt = now();
      gathered[c.type]++;
      if (st.attempt) st.attempt.localTypes = orderTypes(st.localTypes);
      if (!st.early) scheduleGatherCheck(pc, st, tuning.quietMs);
    }

    function onCandidateError(pc: RTCPeerConnection, st: PeerState, ev: Event) {
      const e = ev as RTCPeerConnectionIceErrorEvent;
      const url = typeof e.url === "string" ? e.url : "";
      // STUN hiccups (notably IPv6 routes that don't exist) are routine noise;
      // only relay failures change what we tell the user.
      if (!/^turns?:/i.test(url)) return;
      st.failedTurnUrls.add(url);
      if (st.wantRelay && !st.have.has("relay") && st.failedTurnUrls.size >= st.turnUrlCount) {
        // Every relay this connection knows about has already failed; waiting
        // for a relay candidate now would only delay the offer past its prune.
        st.wantRelay = false;
        if (!st.early && !st.closed) scheduleGatherCheck(pc, st, 0);
      }
      if (relayErrors.some((r) => r.url === url && r.code === e.errorCode)) return;
      relayErrors.unshift({ url, code: e.errorCode, text: e.errorText ?? "" });
      if (relayErrors.length > MAX_RELAY_ERRORS) relayErrors.length = MAX_RELAY_ERRORS;
      changed();
    }

    function recordPath(pc: RTCPeerConnection, st: PeerState) {
      const rec = st.attempt;
      if (!rec || typeof pc.getStats !== "function") return;
      pc.getStats()
        .then((report) => {
          const entries: any[] = [];
          report.forEach((e: any) => entries.push(e));
          const path = selectedPathFromStats(entries);
          if (path) {
            rec.path = path;
            changed();
          }
        })
        .catch(() => {});
    }

    function onConnState(pc: RTCPeerConnection, st: PeerState, ev: Event) {
      const state = pc.connectionState;
      if (state === "disconnected") {
        // Hold Trystero's teardown; if ICE recovers, nobody notices the blip.
        if (!st.graceTimer && !st.closed) {
          st.graceTimer = setTimeout(() => {
            st.graceTimer = null;
            if (pc.connectionState === "disconnected") st.userConnHandler?.call(pc, ev);
          }, tuning.disconnectGraceMs);
        }
        return;
      }
      if (st.graceTimer) {
        clearTimeout(st.graceTimer);
        st.graceTimer = null;
      }
      if (state === "connected" && st.attempt) {
        if (st.attempt.connectedAt === null) st.attempt.connectedAt = now();
        st.attempt.outcome = "connected";
        recordPath(pc, st);
        if (st.closeRequested && st.closeTimer) {
          // Connected after Trystero gave up on it: keep it alive just long
          // enough for the data channel to open and Trystero to adopt it.
          clearTimeout(st.closeTimer);
          st.closeTimer = setTimeout(() => forceClose(pc, st), tuning.adoptAfterConnectMs);
        }
        changed();
      } else if ((state === "failed" || state === "closed") && st.attempt) {
        if (st.attempt.outcome === "pending") st.attempt.outcome = "failed";
        if (st.attempt.endedAt === null && state === "failed") st.attempt.endedAt = now();
        if (st.closeRequested) forceClose(pc, st, "failed");
        changed();
      }
      st.userConnHandler?.call(pc, ev);
    }

    function closeDeferredSiblings(except: PeerState) {
      const key = except.attempt?.remoteKey;
      if (!key || key === "unknown") return;
      for (const [pc, st] of live) {
        if (st !== except && st.closeRequested && st.attempt?.remoteKey === key) forceClose(pc, st, "closed");
      }
    }

    function adoptChannel(pc: RTCPeerConnection, st: PeerState, ch: RTCDataChannel) {
      ch.addEventListener("open", () => {
        st.channelOpen = true;
        if (st.closeRequested) {
          st.closeRequested = false;
          if (st.closeTimer) clearTimeout(st.closeTimer);
          st.closeTimer = null;
          if (st.attempt) st.attempt.rescued = true;
        }
        // One live link to this peer is all Trystero keeps; stop the rest of
        // the parallel attempts we were holding open for it.
        closeDeferredSiblings(st);
        changed();
      });
      const nativeClose = ch.close.bind(ch);
      ch.close = () => {
        // Trystero closes the channel just before the connection. Keep it if
        // the connection is about to be kept too, or the rescue is pointless.
        if (!st.closed && deferrable(pc, st)) return;
        nativeClose();
      };
    }

    function deferrable(pc: RTCPeerConnection, st: PeerState): boolean {
      return shouldDeferClose(
        {
          remoteAt: st.attempt?.remoteAt ?? null,
          now: now(),
          connectionState: pc.connectionState,
          channelOpen: st.channelOpen,
          sessionEnded: ended,
        },
        tuning,
      );
    }

    class InstrumentedPeerConnection extends Base {
      constructor(config?: RTCConfiguration) {
        super(config);
        const wants = wantsFrom(config);
        if (wants.wantRelay) wantRelay = true;
        // Learned this session: the relay errors and has never produced a
        // candidate. Keep asking it (it may recover) but stop waiting for it.
        const relayLooksBroken = relayErrors.length > 0 && gathered.relay === 0;
        const st: PeerState = {
          id: nextId++,
          createdAt: now(),
          wantSrflx: wants.wantSrflx,
          wantRelay: wants.wantRelay && !relayLooksBroken,
          gatherStart: null,
          lastCandidateAt: null,
          have: new Set(),
          early: false,
          phaseDone: false,
          gatherTimer: null,
          userConnHandler: null,
          graceTimer: null,
          closeRequested: false,
          closeTimer: null,
          closed: false,
          channelOpen: false,
          attempt: null,
          localTypes: new Set(),
          turnUrlCount: wants.turnUrlCount,
          failedTurnUrls: new Set(),
        };
        states.set(this, st);
        live.set(this, st);

        this.addEventListener("icecandidate", (e) => onCandidate(this, st, e as RTCPeerConnectionIceEvent));
        this.addEventListener("icecandidateerror", (e) => onCandidateError(this, st, e));
        this.addEventListener("icegatheringstatechange", (e) => {
          if (synthetic.has(e)) return;
          const g = realGathering(this);
          if (g === "gathering") {
            if (st.phaseDone) {
              // An ICE restart: judge the new phase on its own candidates.
              st.phaseDone = false;
              st.early = false;
              st.have.clear();
              st.lastCandidateAt = null;
              st.gatherStart = null;
            }
            if (st.gatherStart === null) st.gatherStart = now();
            if (!st.gatherTimer) scheduleGatherCheck(this, st, tuning.srflxCapMs);
          } else if (g === "complete") {
            st.phaseDone = true;
            if (st.gatherTimer) clearTimeout(st.gatherTimer);
            st.gatherTimer = null;
          }
        });
        this.addEventListener("connectionstatechange", (e) => onConnState(this, st, e));
        this.addEventListener("datachannel", (e) => adoptChannel(this, st, (e as RTCDataChannelEvent).channel));
      }

      async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
        await baseSetRemote.call(this, description);
        const st = states.get(this);
        if (!st || !description?.sdp || description.type === "rollback") return;
        const remote = candidatesFromSdp(description.sdp);
        if (!st.attempt) {
          st.attempt = {
            id: st.id,
            createdAt: st.createdAt,
            remoteAt: now(),
            connectedAt: null,
            endedAt: null,
            outcome: "pending",
            localTypes: orderTypes(st.localTypes),
            remoteTypes: uniqueTypes(remote),
            remoteKey: remoteKeyOf(remote),
            path: null,
            closeDeferred: false,
            rescued: false,
          };
          pushAttempt(st.attempt);
          changed();
        } else if (remote.length > 0) {
          // Renegotiation (media added): same peer, possibly more candidates.
          st.attempt.remoteTypes = orderTypes(new Set([...st.attempt.remoteTypes, ...uniqueTypes(remote)]));
        }
      }

      createDataChannel(label: string, init?: RTCDataChannelInit): RTCDataChannel {
        const ch = baseCreateChannel.call(this, label, init);
        const st = states.get(this);
        if (st) adoptChannel(this, st, ch);
        return ch;
      }

      close(): void {
        const st = states.get(this);
        if (!st || st.closed) {
          baseClose.call(this);
          return;
        }
        // A second request, or nothing worth waiting for: close for real.
        if (st.closeRequested || !deferrable(this, st)) {
          forceClose(this, st);
          return;
        }
        st.closeRequested = true;
        if (st.attempt) st.attempt.closeDeferred = true;
        const remaining = tuning.negotiationWindowMs - (now() - (st.attempt?.remoteAt ?? now()));
        st.closeTimer = setTimeout(() => forceClose(this, st, "timeout"), Math.max(0, remaining));
        changed();
      }
    }

    // Trystero reads `iceGatheringState` and sets `onconnectionstatechange`.
    // lib.dom types both as plain properties, so override them as accessors
    // on the prototype rather than in the class body.
    Object.defineProperty(InstrumentedPeerConnection.prototype, "iceGatheringState", {
      configurable: true,
      get(this: RTCPeerConnection) {
        return states.get(this)?.early ? "complete" : realGathering(this);
      },
    });
    Object.defineProperty(InstrumentedPeerConnection.prototype, "onconnectionstatechange", {
      configurable: true,
      get(this: RTCPeerConnection) {
        return states.get(this)?.userConnHandler ?? null;
      },
      set(this: RTCPeerConnection, fn: PeerState["userConnHandler"]) {
        const st = states.get(this);
        if (st) st.userConnHandler = typeof fn === "function" ? fn : null;
      },
    });

    return InstrumentedPeerConnection;
  }

  return {
    peerClass() {
      if (!cls) cls = build();
      return cls;
    },
    report(): ConnectionReport {
      return {
        startedAt,
        attempts: attempts.map((a) => ({ ...a })),
        gathered: { ...gathered },
        wantRelay,
        relayErrors: relayErrors.map((e) => ({ ...e })),
      };
    },
    end() {
      if (ended) return;
      ended = true;
      // Trystero never closes its pre-built offer pool on leave, and every
      // retry built a fresh one — leaking ~20 connections per transport, each
      // holding sockets (and TURN allocations) open. Connections carrying a
      // live peer are Trystero's to close as it leaves the room.
      for (const [pc, st] of Array.from(live)) {
        if (!st.channelOpen) {
          try {
            pc.close();
          } catch {
            /* already gone */
          }
        }
      }
      changed();
    },
    get ended() {
      return ended;
    },
  };
}

function orderTypes(set: Set<CandidateType>): CandidateType[] {
  return (["host", "srflx", "prflx", "relay"] as CandidateType[]).filter((t) => set.has(t));
}
