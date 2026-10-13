# Reliability audit, round 2 — 2026-07-26

Follows [`RELIABILITY_AUDIT.md`](RELIABILITY_AUDIT.md) (round 1, 2026-07-18).
Scope this round: the failure modes that remain once the obvious ones are
fixed — silent freezes, dropped control messages, rotting infrastructure, and
the offline story the app had been promising but could not deliver.

Method unchanged: every finding was read in code (file:line) or reproduced
live, and is marked ✓ VERIFIED unless stated otherwise. Ranked by real-world
impact for someone filming at a protest on a bad phone connection.

Status: **FIXED (`commit`)** · **OPEN** · **DECISION** (needs a product call).

---

## 1. "Works offline" was not true for any new connection

**Severity: Critical (a promise made to people at risk) · Status: FIXED (`cca3b31`)**

- Every discovery path dials a public host: the torrent strategy uses
  `wss://` WebTorrent trackers, nostr uses `wss://` relays, mqtt uses `wss://`
  brokers. Enumerated from `node_modules/trystero/src/{torrent,nostr,mqtt}.js`
  and `src/types.ts` — there is no local-network path among them.
- Therefore, with the internet cut or jammed — **the exact situation this app
  exists for** — two phones on the same hotspot could not find each other,
  even though the network between them worked perfectly. Only connections
  established *while still online* survived the cut.
- `OFFLINE_PWA.md` actively told users otherwise, claiming Trystero discovers
  peers via "mDNS/Bonjour (local network discovery)" and that "BitTorrent DHT
  works over local network". Browsers expose no mDNS API to JavaScript at all,
  and the DHT is reached through remote trackers. The document promised a
  capability that did not exist; corrected in this round.
- **Fix shipped:** carry the handshake by hand. The filming device shows its
  WebRTC offer as a QR code, the receiving device scans it and shows its answer
  back (`src/lib/net/offlinePair.ts`, `useOfflinePair.ts`, `/offline`).
  `iceServers: []` so gathering never stalls on unreachable STUN, non-host ICE
  candidates are stripped (useless offline, and they blow the QR budget), and
  the payload is deflated.
- **Verified live** with `iceServers: []` and no relays of any kind: both peers
  reached `connected` and the watcher decoded real video (568 bytes / 4 frames).
  Offer QR 1949 B, answer 1733 B — both inside a single code's ~2900 B budget.
- Offline recordings run through the same hash → Merkle → Ed25519 pipeline, so
  evidence made with no infrastructure verifies identically.

## 2. Frozen video that the track still reported as "live"

**Severity: Critical (silent evidence loss) · Status: FIXED (`629d642`)**

- Stream health was judged only from track `ended`/`mute` events
  (`CollectView.watchStreamHealth`). Those fire on a clean teardown. The
  ordinary failure on a congested or jammed link is different: the path stops
  delivering while the track stays `live` and unmuted.
- Failure scenario: a watcher at the scene sees a frozen frame, believes it is
  still recording, and captures nothing — the recorder is bound to a track that
  produces no data. No detection, no recovery, no warning.
- **Verified by inducing a genuine silent freeze**: sender track stopped with no
  signalling whatsoever. The receiver's track reported `readyState: "live"` for
  the entire freeze, confirming track events can never catch this.
- **Fix shipped:** judge health by whether bytes actually move.
  `src/lib/net/streamHealth.ts` watches inbound byte/frame counters with an 8s
  window; `useTrystero.sampleInboundVideo()` sums `inbound-rtp` video across
  transports; CollectView polls every 2s and routes a stall into the existing
  interrupt/recovery path (bank the segment, ask the tree root to re-seat us,
  re-arm the watchdog), clearing the overlay when bytes resume.
- Observed in the repro: `flowing` while bytes climbed 1215 → 2373, then
  `stalled` once they plateaued past the window. 9 unit tests; one caught a real
  bug where a `0`-valued "unanchored" sentinel let the stall clock re-anchor on
  every poll and therefore never expire.

## 3. The streamer's relay-tree orders were being dropped

**Severity: High · Status: FIXED (`d717842`)**

Tree control messages ("you are now serving these peers") are authorized as
coming from the streamer, because a forged `children` list would turn watchers
into DoS amplifiers. That check read the sender's live swarm stat, and failed
two ways:

1. **Ordering.** The root announced a newcomer's assignment *before* its own
   first stat reached them (`onPeerJoin` called `applyAssignments` ahead of
   `broadcastStat`), so the opening instruction was dropped unread. A watcher
   seated under a seed then received nothing — the root has already stopped
   serving it — until the 12s rejoin watchdog papered over it.
2. **Expiry.** Stats are pruned after `STAT_TTL_MS` (12s) of silence. On a
   congested link — exactly when re-seating matters most — the root's stat
   expires and the watcher begins rejecting every instruction it sends.

**Fix shipped:** `src/lib/swarm/controlAuth.ts` remembers identity rather than
re-proving it (stats are unauthenticated anyway, so expiring them buys no
security, only dropped messages), and holds instructions that arrive before
identity does, replaying them when the role lands. Holding is capped per peer
and in total so an unidentified peer cannot make us buffer without bound.
Stats are now announced before any tree instruction. 9 unit tests.
Verified live: the watcher reports `myParent: "@root"` — previously the assign
was dropped and it stayed `null`.

**Not fixed (unchanged, documented):** a peer can still *claim* the streamer
role, since stats carry no signature. Round 1 §8 accepted this; an invite key
(DECISION D2) is the real answer.

## 4. Relay rot is now observable — and there is more of it

**Severity: High (recurring) · Status: FIXED (`4ec03e1`) for visibility; the rot itself is permanent**

- Round 1 §6 left monitoring OPEN. Shipped: `src/lib/net/relayHealth.ts` folds
  each strategy's `getRelaySockets()` into a report that flags any transport
  whose relays are **all** down — the state where discovery silently degrades —
  surfaced per-relay in the debug panel. It reads existing sockets rather than
  probing, since opening extra connections to every relay would cost battery and
  radio on a phone.
- **Checked live on the way in, and it immediately found more rot:**

  | Transport | State (2026-07-26) |
  |---|---|
  | torrent | 3/3 up (`tracker.webtorrent.dev`, `tracker.openwebtorrent.com`, `tracker.btorrent.xyz`) |
  | nostr | 4/5 up — `relay.damus.io` **closed** |
  | mqtt | **0/3** — `test.mosquitto.org`, `broker.emqx.io`, `broker.hivemq.com` all down |

- That is the fourth and fifth data point for decay measured in weeks. MQTT —
  added only days earlier for path diversity — currently contributes nothing.
  It is left in place because the brokers are public *test* brokers that may
  recover and a dead transport costs only reconnect attempts, but its state is
  now visible rather than assumed.
- **Operating practice, not an incident:** open the debug panel and check relay
  health before any action that matters. See TEST_PLAN.

## 5. A stale service worker kept serving old code

**Severity: Medium (development/QA integrity) · Status: FIXED (`cca3b31`)**

- The dev build ships no service worker, but one registered by an *earlier*
  build keeps serving its precached copy indefinitely. This silently ran stale
  code against a fresh dev server and sent testing down blind alleys twice —
  including this round, where a newly added route appeared not to exist.
- Fix shipped: in dev, any surviving registration is unregistered, its caches
  deleted, and the page reloaded once (`src/main.ts`). Production registration
  is untouched.
- Worth keeping in mind for users too: a released PWA updates via
  `skipWaiting`/`clientsClaim`, so a fixed build reaches people on next load —
  but anyone testing a fix must confirm they are actually running it.

---

## Still open

1. **Relay-tree media plane under real load** (round 1 D3, phase 1 shipped).
   Topology, healing and control are in; what remains is measuring seed
   forwarding under genuine congestion, tuning depth/fan-out, and honest
   behaviour when a relaying watcher drops. Biggest remaining win for crowds.
2. **On-device verification.** Everything this round was verified in browser
   tabs on one machine (E2). Two-phone, cross-network, strict-NAT and
   hotspot-with-no-internet runs are still owed — especially the new offline
   pairing, whose whole point is a situation this environment cannot create.
   See TEST_PLAN E3/E4/E5.
3. **Background tabs throttle P2P.** Observed again this round: a backgrounded
   streamer tab had its timers throttled and the connection dropped. On a phone
   this is the documented screen-lock limit (round 1 §4); in a browser it also
   applies to a merely-backgrounded tab. No in-browser fix exists; the native
   build is the answer.
4. **Trystero upstream limits** (round 1 §10): no trickle ICE, 5.3s announce
   cadence, peers destroyed on `disconnected` with no ICE-restart grace.
   Unchanged.
5. **DECISIONS D1 (default TURN) and D2 (invite keys)** from round 1 remain
   open product calls.

## Known limits (do not overstate resilience to users)

Round 1's list stands, with these amendments:

- **Offline pairing needs both devices on one local network** (a hotspot or
  shared Wi-Fi) and a camera on each to swap the two QR codes. It removes the
  need for internet, not the need for a network.
- **Offline pairing is one link at a time.** Each pairing is a single
  streamer→watcher connection; there is no relay tree and no room. Several
  watchers means repeating the exchange per device.
- **A frozen stream is now detected, not prevented.** Detection takes up to
  ~8s, and recovery still depends on a usable path existing.
- **MQTT currently adds no discovery.** All three public brokers are down.
