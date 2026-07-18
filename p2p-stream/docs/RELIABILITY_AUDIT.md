# Reliability & Resilience Audit — 2026-07-18

Scope: end-to-end P2P connectivity and recording durability on bad networks
(congested, high-latency, lossy, NAT-restricted, throttled, censored, hostile).

Method: every finding below was either **read in code** (file:line cited) or
**measured/reproduced live** (raw STUN/TURN probes from this machine; two
isolated browser tabs driving the real app composables over the real public
relays, including killing individual RTCPeerConnections mid-stream). Findings
are ranked by real-world impact for someone streaming at a protest on a bad
phone connection — not by ease of fixing. Every item is ✓ VERIFIED unless
explicitly marked otherwise.

Status legend: **FIXED (`commit`)** — implemented in this audit;
**OPEN** — not fixed, see rationale; **DECISION** — needs a product call,
deliberately not decided unilaterally (see last section).

---

## 1. The bundled TURN relay is dead — no cross-NAT path existed at all

**Severity: Critical · Status: FIXED (`30a3a7d`) — with an honest caveat**

- Measured 2026-07-18: `openrelay.metered.ca:80` answers **HTTP** (nginx 502),
  `:443` refuses TCP outright, `staticauth.openrelay.metered.ca:443` times out.
  The free "Open Relay Project" no longer exists as a TURN service.
- Failure scenario: streamer on carrier CGNAT + watcher behind strict NAT
  (the *normal* mobile-to-mobile case in many countries) → ICE finds no direct
  path, no relay exists → connection never establishes, forever, with no error
  pointing at the cause.
- It was worse than "no TURN": Trystero strips trickle ICE and waits for
  gathering to complete (5 s timeout) before sending *every* offer/answer
  (`node_modules/trystero/src/peer.js:3,28-45`). An unreachable TURN server
  forces that timeout on both sides — **~10 s added to every connection**,
  including ones that never needed a relay. This plausibly accounts for most of
  the ~13 s discovery time seen in earlier field testing.
- Fix shipped: no default TURN (honest STUN-only default); TURN configurable at
  **runtime** — `localStorage`, or a `?turn=urls|user|pass` share-link param so
  an organizer can distribute a relay together with the room link — plus the
  existing build-time `VITE_TURN_*`. STUN diversity raised from Google-only to
  Google + Cloudflare + Nextcloud:443 (all probed alive; Google is blocked in
  several countries). `src/lib/net/iceConfig.ts`, unit-tested.
- **Caveat (known limit):** out of the box, strict-NAT↔strict-NAT pairs still
  cannot connect. That is physics, not a bug: relaying requires *some* relay.
  See DECISION D1 (funded default TURN) and `docs/SELF_HOSTING.md` (coturn on
  `turns:443` in ~10 minutes).

## 2. Streamer uploaded one full video copy per transport per watcher (up to 3×)

**Severity: Critical · Status: FIXED (`ce9e42e`) — verified live**

- Each Trystero strategy (torrent/nostr/mqtt) opens its **own**
  RTCPeerConnection to the same peer — there is no cross-strategy dedup
  (`node_modules/trystero/src/strategy.js` keeps per-room `connectedPeers`;
  `selfId` is page-global, `utils.js:12`). The old `onPeerJoin` handler added
  the stream on every room join (`useTrystero.ts`, pre-fix), so with all three
  transports connected the phone encoded and uploaded the video three times per
  watcher. Confirmed live: a single collector produced three "Peer joined"
  events and (pre-fix logic) three `addStream` calls.
- Failure scenario: 2 watchers on a phone uplink → 6 × 2.5 Mbps ≈ 15 Mbps of
  requested uplink → total collapse of the stream for everyone, plus 3× encode
  CPU/battery/heat.
- Fix shipped: per-peer media ownership map (`src/lib/swarm/streamRouting.ts`,
  unit-tested). The first room a peer connects through carries the media; other
  transports stay signaling/data-only; if the owning connection dies while
  another survives, the stream is re-sent over a survivor. Verified live:
  "Sending stream … via nostr" exactly once; killing the owner produced
  "Media handover … nostr → torrent" with video continuing.
- Bonus bug fixed in the same change: a peer leaving *one* room deleted it from
  the app's peer/stat maps even though it was still connected via another
  transport (`useTrystero.ts` old `onPeerLeave`), corrupting counts.

## 3. Recording silently died on reconnect; auto-stopped recordings were never signed

**Severity: Critical (evidence loss) · Status: FIXED (`c6d3b8b`, `a478213`) — verified live**

- Three compounding defects:
  1. After a connection drop, Trystero re-discovers the peer (announce loop
     every ~5.3 s, `strategy.js:18`) and delivers a **new** `MediaStream`. The
     collector re-bound the video element but the active MediaRecorder stayed
     bound to the dead stream — recording indicator on, **zero footage
     captured** (old `CollectView` only started recording `if (!isRecording…)`).
  2. A MediaRecorder whose tracks end auto-stops; `stopRecording()` then
     returned `null` without finalizing → chunks sat in OPFS but **no metadata,
     no Merkle proof, no signature** — worthless as evidence.
  3. `useRecording` kept all recorder state in shared mutable variables read by
     `onstop` across `await`s; overlapping stop/start (exactly what a reconnect
     causes) resolved the wrong recording object, flipped `isRecording` off
     under a live recorder, and could mis-file a late chunk of the old segment
     into the new segment's OPFS directory. (Found by reproducing the reconnect
     live, not by reading — the first implementation of the segment-roll
     exposed it.)
- Fix shipped: per-recording `LiveSession` object captured by recorder
  closures; stop detaches the session before finalizing; finalization always
  runs (including the auto-stopped path); CollectView serializes stop/start
  through a queue and rolls to a new segment on stream replacement. Each
  segment is independently signed and verifiable — a reconnect costs the gap,
  not the footage. Verified live: owner-kill → segment 1 saved (70 chunks +
  proof) → handover → segment 2 recording, counts correct.
- The frozen-last-frame problem is also gone: a dead/muted track now shows an
  honest "Stream interrupted — reconnecting" overlay driven by track
  `ended`/`mute` events, and re-arms the auto-retry watchdog with a fresh
  budget.

## 4. Screen lock killed the stream (observed in the field)

**Severity: High · Status: FIXED (`c6d3b8b`) — needs on-device verification**

- Mobile OSes suspend capture and end camera tracks on screen lock /
  backgrounding; the app had no wake lock and no recovery — the stream died
  permanently until manual restart.
- Fix shipped: Screen Wake Lock (re-acquired on return to foreground) while
  streaming and while recording (`src/composables/useWakeLock.ts`); on the
  streamer, camera recovery on track-death or return-to-foreground — fresh
  `getUserMedia`, swapped into live connections, recording rolled to a new
  segment.
- Known limit: if the OS still suspends the page (user presses power button —
  wake lock only prevents *idle* lock), the web app cannot capture in the
  background. Only the Capacitor/native build (foreground service) truly fixes
  this; documented in FEASIBILITY terms. iOS Safari < 16.4 has no wake lock.

## 5. Uncapped video bitrate stalled weak uplinks

**Severity: High · Status: FIXED (`2ec59b1`) — cap verified applied live; behavior under real congestion needs device testing**

- The camera stream was sent with no `RTCRtpSender` parameters: 720p ≈
  2.5+ Mbps requested. On a congested uplink, queues grow, latency balloons,
  and the stream freezes for all watchers rather than degrading.
- Fix shipped: per-sender `maxBitrate` 1.2 Mbps (`src/lib/net/senderTuning.ts`,
  applied after negotiation with retry; verified `[[1200000]]` on the live
  connection) and `contentHint='motion'` so encoders drop resolution before
  frame rate. WebRTC's built-in bandwidth estimation adapts below the cap.

## 6. Relay-list rot is ongoing (this audit found more of it)

**Severity: High (it recurs) · Status: partially FIXED (`03365e0`); monitoring is OPEN**

- Live-verified this session: pinned Nostr relay `offchain.pub` rejects every
  event ("Policy violated and pubkey is not in our web of trust") → dropped.
  `relay.damus.io` rate-limits the 5.3 s announce cadence but still delivers
  discovery → kept. Torrent tracker `tracker.btorrent.xyz` (a Trystero default)
  fails WebSocket handshake (525). MQTT default `test.mosquitto.org` /
  `broker.emqx.io` / `broker.hivemq.com` are public *test* brokers with no SLA.
- This is the third relay-rot incident in this project's short history (Trystero
  Nostr defaults, openrelay TURN, now offchain.pub). **Treat public
  infrastructure as perishable.** Recommendation (OPEN): a startup relay
  health-check that surfaces per-relay status in the debug modal
  (`getRelaySockets()` exists on every strategy), and a documented cadence —
  before any planned action, run the 2-device check in TEST_PLAN. A build-time
  probe would also work but can't help an already-deployed PWA.

## 7. Signaling and metadata leak to relay operators and network observers

**Severity: High (for the threat model) · Status: documented here; mitigations are DECISION D2**

What an observer learns (✓ read from Trystero source):

- **Relay/tracker operators** (and anyone wiretapping them): your IP, the
  room's hashed topic (`sha1('Trystero@p2p-es-v1@p2pstream-v1-CODE')`,
  `strategy.js:39-41`), join/leave times, and pairwise interest (who signals
  whom). SDP payloads are encrypted only with a key derived from `appId+roomId`
  (`crypto.js` via `genKey(config.password || '', …)`) — **anyone who knows the
  room code decrypts them**; without the code, relays see only that two peers
  are exchanging something.
- **A network observer near a peer**: WebRTC media flows directly between peer
  IPs (DTLS-SRTP — content encrypted, but peer IPs are mutually visible; a
  TURN relay hides your IP from the far peer at the cost of the relay seeing
  both).
- **Anyone who obtains/guesses the room code**: full join + watch + record
  capability, and decryption of signaling. Codes are 6 chars of A-Z0-9 ≈ 2.2 ×
  10⁹ — fine against remote brute force through rate-limited relays, weak
  against a code leaked or photographed (QR is the intended distribution).
- Bottom line for users: **room codes are capabilities; treat them like the
  footage itself.** The app is censorship-*resistant*, not anonymous.

## 8. Swarm counts are unauthenticated hints

**Severity: Medium · Status: flood-bounded FIXED (`5a36073`); spoofing accepted, documented**

- Any peer can claim any role/recording state (`stats.ts` validates shape only)
  — counts are morale/coordination hints, not facts. A spoofer can inflate
  "watching/recording". Authenticating counts would need signed stats + an
  identity layer; not worth the complexity for a display hint (and a malicious
  peer in the room can *record* regardless — see D2).
- The unbounded-memory variant is fixed: the stat map refuses new entries past
  500 peers (`canTrackStat`, unit-tested).

## 9. Storage exhaustion was silent until footage stopped persisting

**Severity: Medium · Status: FIXED (`5a36073`)**

- ~1.1 GB/h at 2.5 Mbps; browsers fail chunk writes with no warning at quota.
  Previously `writeChunk` failures only hit the console (`useRecording.ts`
  old ondataavailable), so an hours-long vigil could quietly stop persisting.
- Fix shipped: headroom assessed at start and every ~30 s (`low` < 500 MB,
  `critical` < 100 MB, minutes-left estimate — `src/lib/storageGuard.ts`,
  unit-tested); repeated write failures surface too. Warning banner in both
  Stream and Collect views.

## 10. Remaining connection-path latency

**Severity: Medium · Status: OPEN (upstream-constrained), instrumentation partial**

Where time goes on join (from code + live observation, single-network):

| Step | Cost | Bound by |
|---|---|---|
| Relay websocket connects | ~0.3–2 s | relay RTT/health |
| First announce heard | 0–5.3 s (announce interval) | `strategy.js:18` |
| Offer/answer exchange | 2 × ICE-gathering wait, now fast with live STUN (was +10 s with dead TURN) | `peer.js:3` |
| DTLS + first frame | ~0.5–1 s | network |

- Local-network discovery this session: ~3–8 s to first frame. The earlier
  ~13 s field number should now be substantially lower (dead-TURN wait removed,
  dead relay pruned) — **re-measure on two real devices** (TEST_PLAN E3/E4).
- Not app-fixable without forking Trystero: no trickle ICE; 5.3 s announce
  cadence (vs. damus rate-limiting, a tension to watch); peers destroyed on
  `disconnected` with no ICE-restart grace (`peer.js:71-75` + `room.js:303`) —
  recovery is re-discovery (works, verified live, but costs seconds).
  An upstream issue/PR would benefit every Trystero app. OPEN.

## 11. Smaller verified items

- **Retry leaks relay sockets** (Low, OPEN): each full leave+rejoin
  (auto-retry does this) re-runs strategy `init`, creating fresh websockets;
  old nostr sockets are never closed and keep reconnecting
  (`utils.js:106-142`, `strategy.js:224-243`). Bounded by MAX_AUTO_RETRIES=2;
  acceptable, but a Trystero `leave()` that closes sockets would be better
  (upstream).
- **Offer pool cost** (Low, OPEN): 20 pre-created RTCPeerConnections with
  `iceCandidatePoolSize: 10` each pre-gather STUN candidates
  (`strategy.js:17`, our config) — battery/radio cost on mobile; not
  configurable without forking.
- **Archive forwarding benefits automatically** (note): the home-archive
  re-broadcast uses the same composable, so single-copy routing, sender caps,
  and reconnect behavior all apply to it. Not regressed (unit + live smoke of
  the same code path; full archive scenario still owed a device pass).

---

## Product decisions to make (deliberately not decided here)

**D1 — Default relay for strict-NAT users.** Without *some* TURN, two
strict-NAT phones cannot connect out of the box. Options: (a) ship nothing,
rely on `?turn=` links + self-hosting (current state, most honest, zero
infra); (b) fund/run a project TURN (best UX; a server to seize/block —
mitigable via `turns:443` and multiple jurisdictions); (c) partner relays
rotated in-app. This is a values-and-money call.

**D2 — Invite keys / room passwords.** Trystero already supports a `password`
config that encrypts signaling separately from the room id. Adding an invite
key (e.g. `CODE#key` in links/QR, password-derived) would stop
code-guessers/observers from joining or decrypting signaling — but it changes
the share UX (plain 6-char codes stop being sufficient) and does nothing
against a betrayed invite. Worth doing before promoting the app for hostile
environments; needs a UX decision.

**D3 — Watcher relay-tree for crowds.** One streamer → N watchers is N uplink
copies even after the 3× fix. The archive mode already proves re-broadcast
works (a watcher forwards its received stream into another room). A
depth-1 fan-out tree (streamer → k seed watchers → rest) would make crowds
viable on a phone uplink at the cost of added latency per hop, trust in
forwarders (they already have the footage), and real topology code. Biggest
remaining reliability win for large rooms; substantial feature, needs design.

---

## Known limits (do not overstate resilience to users)

1. **Strict-NAT ↔ strict-NAT with no TURN configured: cannot connect.** Same
   Wi-Fi/hotspot always works; one side on unfiltered network usually works.
2. **If all discovery relays are blocked (DPI blocking wss to the pinned
   Nostr/MQTT/tracker hosts), peers cannot find each other.** Local
   hotspot/offline mode is unaffected. A self-hosted Nostr relay on 443 behind
   an innocuous domain is the practical censored-network answer
   (`docs/SELF_HOSTING.md`).
3. **Power-button screen lock / OS backgrounding still suspends web capture.**
   Wake lock prevents *idle* lock only. Native build required for true
   background capture.
4. **Anonymity is out of scope**: relay operators and on-path observers see
   IPs and room activity metadata (see §7). Tor/VPN usage is compatible but
   adds its own latency/fragility.
5. **A reconnect costs the gap**: segments are contiguous footage between
   interruptions; there is no attempt to paper over missing time (by design —
   evidence should not pretend continuity).
6. **Public-infrastructure rot recurs.** Relay lists are pinned and now
   pruned, but this needs periodic re-verification (see §6).

## Verification evidence (this session)

- Raw STUN/TURN probes: Google ×2, Cloudflare, Nextcloud STUN all answer
  (~20 ms); openrelay TURN dead (HTTP 502 / connection refused / timeout).
- Live E2 (two isolated tabs, real public relays, synthetic camera):
  discovery + first frame via all three transports; single-copy media
  ("Sending stream … via <owner>" exactly once); owner-kill → segment
  finalized (70 chunks + Merkle proof) → handover to surviving transport →
  new segment auto-started; non-owner-kill → zero interruption; killed
  transports re-discovered and reconnected automatically; sender cap
  `maxBitrate=1200000` present on the live sender; counts correct throughout.
- `npm run type-check`, 81 unit tests, `npm run build` all pass.
