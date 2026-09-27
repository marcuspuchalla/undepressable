# Reliability audit, round 3 — 2026-09-25: connecting across networks

Follows [`RELIABILITY_AUDIT.md`](RELIABILITY_AUDIT.md) (round 1) and
[`RELIABILITY_AUDIT_2.md`](RELIABILITY_AUDIT_2.md) (round 2).

**Trigger — a field report.** A Mac on Wi-Fi, connected through a VPN with an
exit in Iceland, starts a stream. A phone on a German mobile network scans the
QR code. The connection is never established, and nothing says why.

Method unchanged: every finding was read in code (file:line), reproduced in
real Chromium, or both. New this round: a committed end-to-end harness
(`scripts/e2e/scenarios.mjs`) that simulates the report at the ICE level — two
Chromium instances, a firewall rule dropping direct UDP between them (what two
strict NATs do), and a local TURN server as the only way through.

Status: **FIXED (this round)** · **MITIGATED** · **OPEN** · **DECISION**.

---

## The reported scenario, explained

Why the Mac and the phone could not connect, in order of how much it matters:

1. **Two strict NATs meet.** A VPN exit and a mobile carrier's CGNAT both
   commonly use *endpoint-dependent mapping* ("symmetric NAT"): the public
   port changes for every destination, so the address a STUN server reports is
   useless to the other peer. Symmetric ↔ symmetric has no direct path —
   whatever the app does. IPv6 does not rescue it either: most VPNs block or
   NAT IPv6. **Only a relay (TURN) connects this pair**, and the app ships
   none by default (DECISION D1, still open).
2. **Nothing said so.** Discovery (finding each other through Nostr/torrent
   relays) very likely *worked*; ICE then failed silently. To the user that is
   indistinguishable from a mistyped room code. (§1)
3. **The QR code may not have been openable at all.** It encoded wherever the
   app happened to run — `http://localhost`, a LAN IP, `tauri://localhost`. A
   phone on mobile data can open none of those with its camera app. (§5)
4. **Even with a relay, the connection was fragile.** Relayed connections
   through a VPN are the slowest to set up, and Trystero destroys a pending
   offer ~4.8 s after sending it (§2) — while waiting up to 5 s for ICE
   gathering on every offer and answer (§3).

What happens now, verified end to end (see *Verification*):

- Both devices say, within ~20 s: **"Found the streamer, but your networks
  block a direct connection … A relay (TURN) server is needed; setting one up
  on either device is enough"**, with a *Set up a relay* button.
- The relay is entered once (Network page, or straight from that button),
  tested in-app, and **travels inside the share link / QR**, so the viewer
  needs no setup. One side having it is enough.
- If the streamer adds a relay while a viewer is already waiting, the room
  re-opens with it and the waiting viewer connects on its own (measured 1.2 s).
- Status shows **LOCAL / DIRECT / RELAY** for every live connection.

What the user still has to supply: **a relay**. See *For the reported
scenario* below.

---

## 1. Strict-NAT failures were silent — and looked like a wrong room code

**Severity: Critical · Status: FIXED**

- Trystero reports a peer only once its data channel opens
  (`node_modules/trystero/src/room.js` `onPeer` → `onPeerJoin`), so an ICE
  failure produced no event at all. The collector's watchdog then showed "The
  streamer may not be live, or a strict network is blocking the connection"
  after 12 s — the same text for every cause.
- **Fix:** `src/lib/net/connectionMonitor.ts` instruments every
  RTCPeerConnection Trystero opens, via Trystero's own `rtcPolyfill` config
  hook (a subclass of the browser's RTCPeerConnection — no fork, no patch). A
  connection whose remote description was applied is an *attempt*: the other
  device demonstrably answered. Its local and remote candidate types, ICE
  outcome, and the selected path (`getStats`) are recorded.
  `src/lib/net/diagnosis.ts` turns that into one verdict: searching /
  negotiating / connected (lan, direct, relay) / **blocked — needs relay** /
  relay unreachable / relay rejected credentials / relay out of capacity /
  failed even through relay / discovery servers unreachable / offline.
  Shown live on the Stream and Collect screens (`ConnectionDoctor.vue`), with
  the one action that would help.
- A subtlety the E2E run caught: Trystero retries on every announce, so a
  doomed pair *always* has a fresh attempt in flight. The first version waited
  for the retries to stop and so never reached a verdict. Two dead ends with no
  success in between is now the verdict.
- The collector's watchdog no longer tears down a negotiation that is making
  progress (it rejoined every 12 s — killing slow relay paths mid-flight), and
  no longer rejoins when the verdict is a NAT block (rejoining cannot fix it;
  discovery keeps running in the open room).

## 2. Trystero destroyed relay paths before they could connect

**Severity: Critical · Status: FIXED (unit-tested; observed in E2E)**

- A nostr/mqtt offer that has not connected `announceInterval × 0.9` ≈ 4.8 s
  after it was sent is destroyed (`trystero/src/strategy.js:338-341`,
  `prunePendingOffer`). Signaling round-trip + the answerer's ICE gathering +
  connectivity checks through a TURN relay + DTLS routinely exceed that across
  a VPN — so the one path that *could* work was the one killed first, every
  retry.
- **Fix:** the instrumented connection defers Trystero's `close()` (and the
  data channel's) while the negotiation has a remote description and is still
  within a 15 s window. If ICE connects, the data channel opens and Trystero's
  still-installed handlers adopt the peer normally; parallel attempts to the
  same device are then closed. A second close request, a failure, or the end
  of the window closes it for real. Policy: `src/lib/net/peerPolicy.ts`.
- Observed: in the blocked E2E scenario the records show `closeDeferred: true`
  on streamer-side attempts — the prune happens in practice. The *rescue*
  itself is unit-tested (fake timers); the local harness has near-zero latency,
  so a rescue under real VPN latency is **owed an on-device check** (TEST_PLAN).

## 3. Every offer and answer waited up to 5 s for ICE gathering

**Severity: High · Status: FIXED — measured**

- Trystero strips trickle ICE and waits for gathering to *complete*, capped at
  5 s (`trystero/src/peer.js:3,28-45`). Completion waits for the slowest STUN
  server — so one blocked server, or an IPv6 route that does not exist (common
  behind VPNs), made every answer wait the full 5 s.
- **Fix:** the instrumented connection reports gathering complete as soon as
  the candidates that matter are in: one STUN answer (then 400 ms of quiet),
  or a relay candidate when a relay is configured (capped at 3 s), or 2.5 s
  with host candidates only when STUN is unreachable. `localDescription`
  already carries every candidate gathered so far (verified in Chromium).
- **Measured** (two Chromium instances, STUN unreachable, 3 runs each):
  time to first video **5.9 s → 3.4 s**. With a dead TURN host configured:
  **4.6 s → 2.4 s**. `localStorage.undepressable_no_instrument = "1"` turns
  all instrumentation off, for comparison and as a field safety valve.

## 4. A broken relay could block even direct connections

**Severity: High · Status: FIXED — regression-tested**

- Found in this round's own intermediate design, and the same class as the
  dead bundled TURN of round 1 §1: holding every offer for a relay candidate
  that never comes (wrong password, dead host) delays answers past Trystero's
  4.8 s prune — so *no* nostr connection forms, not even one that needed no
  relay.
- **Fix:** relay wait capped at 3 s; a connection stops waiting as soon as all
  its TURN URLs report an error (401/701/508…); later connections in the
  session skip the wait once the relay has errored without ever producing a
  candidate.
- Verified: open network + relay with a wrong password → video in 2.1 s, and
  the streamer is warned "Your relay is not working, so viewers on strict
  networks won't get in" while there is still time to fix it.

## 5. Share links and QR codes pointed at unreachable addresses

**Severity: High · Status: FIXED**

- `useLocalIP.getShareUrl()` produced `http://<LAN-IP>:4400` from a localhost
  dev server (a VPN makes it the *tunnel* IP), `tauri://localhost` in the
  desktop app, `https://localhost` in the Android shell. A phone camera cannot
  open any of them from mobile data. A plain-http LAN link is broken even on
  the same Wi-Fi: browsers withhold the camera **and WebCrypto** (which
  Trystero's signaling encryption needs) outside secure contexts.
- **Fix:** `src/lib/net/shareLink.ts` — the link uses, in order: a public
  address set on the device (Network page), `VITE_PUBLIC_URL`, the current
  origin if public. The share sheet says plainly when the link will only open
  on this device / this LAN / over insecure http, and points to the in-app
  scanner (which reads the code from any of these links) and to the setting.

## 6. The relay could only be configured from the console, and never travelled

**Severity: High · Status: FIXED**

- Runtime TURN existed (`?turn=` links, `localStorage`) but no UI; the
  streamer's share link never carried it; a scanned QR's params were ignored
  (the in-app scanner only extracted the code).
- **Fix:** Network page + relay sheet (`NetworkView.vue`, `RelaySetup.vue`):
  enter a TURN server *or a credentials URL* (an HTTPS endpoint returning
  short-lived ICE servers — Metered, Cloudflare, Xirsys and Twilio-style
  shapes parsed; cached with TTL; stale credentials used if the endpoint is
  down), **test it in place** (relay-only gathering; reports UDP/TCP/TLS and
  401/701/486/508 in words), include it in share links (default on), and an
  opt-in **"always connect through the relay"** that hides your IP address
  from the people you connect to. The share link carries `?turn=` / `?ice=`;
  the in-app scanner adopts them exactly like opening the link.
- Relay changes re-open the room (streamer) or rejoin (viewer), since ICE
  servers apply only to connections made afterwards.

## 7. A rejoin within ~100 ms of leaving got a dead room

**Severity: High (found by the E2E harness) · Status: FIXED**

- Trystero returns the *existing* room object for a room id until that room's
  async `leave()` completes (`strategy.js:232-234`, deletion in
  `onSelfLeave`). Re-opening the same code sooner — the streamer applying a new
  relay — returned a room about to shut itself down. The streamer silently
  stopped announcing.
- **Fix:** in-flight leaves are tracked per `strategy:roomId`; a rejoin waits
  for them (capped at 2 s). The collector's retry path already waited 500 ms,
  which is why this never showed before.

## 8. Connections were torn down on the first `disconnected`

**Severity: Medium · Status: FIXED — owed a device check**

- `peer.js:71-75` closes on `disconnected`, which on mobile is usually a 2–5 s
  blip (cell handover, a tunnel) that ICE recovers from by itself. Tearing
  down costs a full re-discovery and splits the recording into a new segment.
- **Fix:** 6 s grace before Trystero hears about a `disconnected`; `failed`
  passes straight through. The collector's byte-level stall monitor (round 2
  §2) still runs underneath, so a real outage is still caught.

## 9. Leaks on every retry: offer pools and relay sockets

**Severity: Medium · Status: FIXED (torrent, nostr) · OPEN (mqtt)**

- Trystero never closes its pre-built offer pool (20 connections per
  transport) on leave and builds a fresh one on each rejoin; each pooled
  connection holds sockets — and, with a relay configured, a TURN allocation —
  indefinitely. The monitor now closes every connection that is not carrying a
  live peer when the session ends.
- Round 1 §11: each rejoin re-created relay websockets and never closed the
  old ones, which reconnect forever. Old torrent/nostr sockets are now closed
  (reconnect handler disarmed first) once no room uses them. MQTT sockets
  belong to mqtt.js, which would reconnect them; still leaked, bounded by
  retries.

## 10. `iceCandidatePoolSize: 10` multiplied gathering tenfold

**Severity: Medium · Status: FIXED**

- Trystero already pre-builds and pre-gathers 20 offers per transport; the
  candidate pool on top made each gather 10× — hundreds of STUN requests, and
  with a relay configured hundreds of TURN allocations, the moment a room
  opened. Now 0, plus `bundlePolicy: max-bundle`.

## 11. Relay allocation churn is inherent to Trystero

**Severity: Medium · Status: MITIGATED · OPEN upstream**

- Found when the E2E TURN server (101 ports) ran out mid-test (`508 TURN
  allocate error`). With a relay configured, *every* connection attempt
  allocates a relay port: the offer pools, plus one parallel offer per Nostr
  relay per announce. While two devices are blocked that is roughly two
  allocations per second per side, freed as attempts close.
- Self-hosted coturn (thousands of ports) is unaffected. A provider with a low
  per-user concurrent-allocation cap will answer 486/508. Mitigations: the
  Nostr list was trimmed back to 7 (each relay multiplies parallel attempts);
  486/508 are named in the status ("the relay is out of capacity / at its
  quota") instead of "unreachable"; SELF_HOSTING.md recommends a generous
  `user-quota`. The real fix — trickle ICE and lazy offers — is upstream.

## 12. Discovery infrastructure, re-verified

**Status: FIXED for the lists; the rot itself is permanent**

Probed 2026-09-25 from a cloud machine by *functional* test — publish a
Trystero-format event / offer on one socket, receive it on another — not just
"does the socket open":

| Transport | Result |
|---|---|
| Nostr | relay **works**: damus, nostr.mom, snort, nostr-pub.wellorder.net, nostr.oxtr.dev, nostr.bitcoiner.social (also offchain.pub again, binaryrobot, sathoarder, yabu.me/v2, nostr.data.haus). **Rejects**: einundzwanzig (NIP-05 required), relay.nostraddress.com (auth), nostromo (whitelist), wirednet.jp (blocks ephemeral kinds), oldenburg (pubkey), purplerelay (disk full), nostr.land (paid), fountain.fm (kinds). **No answer from here**: nos.lol, relay.primal.net, and several Trystero defaults. |
| Torrent | webtorrent.dev and openwebtorrent.com relay offers. **tracker.btorrent.xyz — one of Trystero's three defaults — is dead**, so a third of torrent discovery was wasted; the list is now pinned. files.fm is on a non-443 port the test machine could not reach. |
| MQTT | Unverifiable here (non-443 ports blocked by the test network) — which is itself the point: any network that allows only 443 loses MQTT entirely. |

- Pinned Nostr list: the six verified above + relay.primal.net (worked in
  July's device runs). nos.lol dropped after timing out on every probe.
- New: **custom discovery relays** on the Network page (a self-hosted relay on
  443 is the censored-network answer; it used to require editing `types.ts`
  and rebuilding). They go first, travel in share links (`?relays=`), and an
  "only my relays" mode turns public discovery off entirely.

## 13. Smaller things fixed on the way

- **An empty red error box was always visible** on Stream and Collect (with a
  "Retry" button on Collect): templates tested `trystero.error` — a Ref nested
  in a plain object, which Vue does not unwrap, so always truthy.
- **A viewer who joined from a link and then left had no way back in** — the
  code input is hidden on the link route. Now: *Join again* / *Other code*.
- A phone coming back online (`online` event) now rejoins immediately instead
  of waiting out the watchdog.
- The debug panel lists connection attempts (outcome, candidate types, path,
  rescued) and relay errors, and includes them in *Copy logs*.

---

## Part 2 — offline, face-to-face and home-archive scenarios

The same round covered the in-app guide's other scenarios. Findings, ranked
the same way:

### 14. Offline pairing codes were at the edge of what a phone can scan

**Severity: High · Status: FIXED — measured**

- The code carried a whole audio+video SDP: **1717 characters, QR version 30
  (137×137 modules)** — under 2 px per module on a phone screen.
- **Fix:** the first connection is a bare data channel, fully described by
  ICE credentials, DTLS fingerprint, role, mid and host addresses; that packs
  into a binary form (`compactSignal.ts`, "UND2") and the SDP is rebuilt from
  a template on the other side. Video is negotiated over the data channel.
  **Now 103 characters** (~QR version 6), with room for medium error
  correction. The old "UND1" format is still read.

### 15. Offline pairing served one viewer, and a second pairing killed the first

**Severity: High · Status: FIXED — verified**

- `useOfflinePair` held a single RTCPeerConnection; "Start over" was the only
  way to pair again. Now each invite is its own link; the filming device adds
  viewers while earlier ones keep watching, and lists each one's state and
  whether it is recording a copy (heartbeat over the data channel).

### 16. Offline failures showed a blank screen; the filming phone kept no copy

**Severity: High · Status: FIXED — verified**

- After the reply was scanned, the UI switched to "live" regardless of
  whether anything connected; if ICE failed, nothing was shown at all. Now:
  *couldn't reach them* within ~15–20 s with the causes that actually happen
  (device on mobile data, hotspot client isolation, VPN, iOS Local Network
  permission); the viewer sees the same tips after 30 s of waiting.
- The filming device now records its own signed copy (as online), and swaps a
  fresh camera into every link if the OS kills the old one.
- The viewer's recording is finalized when the link is lost or the picture
  freezes (byte-level stall detection, as online) and restarts when it flows.

### 17. Pairing needed a camera on both devices

**Severity: Medium · Status: FIXED**

- Codes can now be copied, sent (AirDrop / Nearby Share / messenger — all work
  between side-by-side devices without internet) and pasted. The filming
  device scans replies with the camera it is already filming with; phones
  often cannot open a second camera, and the scan must not stop the broadcast.
- While a code is produced from a scan, the camera stays on: Safari only
  reveals real local addresses (not `.local` names a hotspot may not resolve)
  during an active capture.

### 18. iOS app lacked the Local Network usage description

**Severity: Medium · Status: FIXED (needs an iOS build to confirm)**

- iOS 14+ gates local-network traffic behind a permission; the Capacitor
  app's `Info.plist` did not declare `NSLocalNetworkUsageDescription` (the
  Tauri one did). Added.

### 19. Home archive: its pairing link could not be opened, and it recorded twice

**Severity: High · Status: FIXED — verified end to end for the first time**

- The pairing QR used `location.origin` — `tauri://localhost` when the archive
  is the desktop app, the very setup the guide recommends. It now uses the
  public address, carries the archive's relay and discovery relays, and warns
  when it will only open inside the app. The Collect scanner now accepts
  pairing QRs (it rejected them as "Invalid QR code").
- **Two recorders at once:** Trystero reports a stream once per track, and the
  archive started a recording for each. One of the two was never finalized or
  signed. Now deduplicated and serialized; a phone that reconnects rolls the
  recording into a new segment. The preview video also stayed paused (its
  stream was attached while hidden).
- The collector opened the archive room twice for the same reason.
- **Zombie connections after a leave:** a negotiation in flight when a room is
  left can complete afterwards and attach to the old room. The other device
  then believes it is connected and ignores the real connection — a deadlock
  that left the archive "connected" with no video. Handlers of a left room
  are now inert, and such a connection is closed so the other side frees
  itself. This affects any quick leave/rejoin, including the collector's
  automatic retry.
- The archive and the phone's forwarding row show the same diagnosis as the
  Stream/Collect screens ("can't reach home — needs a relay" + *fix*). A home
  router and a phone on mobile data are often a strict-NAT pair too.

### 20. Use case 03 (internet drops mid-stream) — verified

- Connected over a local path, then discovery killed: the picture was still
  playing 15 s later, with no "interrupted" overlay (`internet-drops`).
  When discovery servers are unreachable, the status card now offers *Pair
  face to face* directly.

## Verification

- **Unit (E1):** 273 tests (was 138). New: candidate parsing, NAT
  classification, gathering and close policy, the instrumented connection
  against a fake RTCPeerConnection with fake timers, diagnosis verdicts, ICE
  credential parsing/caching/propagation, share links, discovery config.
- **End to end (E2, `scripts/e2e/scenarios.mjs`):** two to four isolated
  Chromium instances, fake camera, a local Nostr relay, and — for the NAT
  scenarios — `iptables` dropping all direct UDP between the peers, with a
  local TURN server as the only path. All eleven pass:

  | Scenario | Result |
  |---|---|
  | open network | video 1.2 s, `LOCAL` |
  | direct UDP blocked, no relay | both sides: *found, but networks block a direct connection — set up a relay* |
  | blocked, relay in the share link | video 1.3 s, `RELAY` |
  | blocked, relay on the streamer only (not shared) | video 3.8 s, `RELAY` |
  | blocked, relay with wrong password | both sides: *relay rejected its username/password* |
  | blocked; streamer adds a relay from the status card | waiting viewer's video 1.2 s later, viewer did nothing |
  | crowd: 1 streamer, 3 viewers (one seated under a seed) | all three receive video |
  | internet drops mid-stream (use case 03) | still playing 15 s after discovery died |
  | offline: two viewers, codes pasted as text | 103-char codes; both play ~1 s after their reply; "recording a copy" shown |
  | offline: devices cannot reach each other | "couldn't reach them" + tips in ~15 s |
  | home archive: streamer → phone → home (use case 04) | phone and home both play; home records exactly once |

  Also checked against the production build (`vite preview`).
- **Not verified — owed on real devices** (TEST_PLAN E4): the actual VPN ↔
  German-carrier pair; a rescue under real relay latency; the 6 s
  `disconnected` grace across a real cell handover; iOS Safari/WKWebView and
  Firefox with the instrumented RTCPeerConnection subclass (standard ES class
  extension of a DOM constructor, expected to work, not run here); the NAT
  classifier on real symmetric NATs (the test machine has no UDP egress, so it
  correctly reads "UDP blocked").

## For the reported scenario: what to do today

1. **Get a relay.** Self-host coturn (`docs/SELF_HOSTING.md`, ~10 minutes,
   use `turns:` on 443) or use a TURN provider's free tier.
2. On the Mac, open **Network** (tap the *Online* pill in the header) → paste
   the server and credentials, or the provider's credentials link → **Test** →
   **Save**.
3. Share as usual. The QR carries the relay; the phone needs no setup.
4. If it still fails, the status card names the reason, and **Network → Check**
   shows what kind of network each device is on.

## Decisions (not made here)

- **D1 — a default relay.** Everything above makes a relay one paste away and
  automatic from then on; it does not *provide* one. For zero-config success
  in exactly the reported situation (VPN ↔ mobile, the most common way
  activists will actually be connected), the app needs a relay out of the box:
  a funded project TURN (best UX; one more thing to block or subpoena —
  mitigated by `turns:443`, several jurisdictions, short-lived credentials via
  a credentials URL) versus ship-nothing (today). `VITE_TURN_*` and
  `VITE_ICE_SERVERS_URL` are ready for either.
- **D2 — invite keys.** Share links can now carry relay credentials, which
  makes a leaked link slightly more valuable (it lends out relay bandwidth).
  Prefer short-lived credentials (credentials URL) for public events. An invite
  key would also protect those.

## Known limits (do not overstate)

- **Strict NAT ↔ strict NAT still needs a relay.** That is physics. What
  changed is that the app now says so, and a relay is easy to add and
  propagates itself.
- **A share link's relay is visible to anyone who sees the link or QR**, and a
  link from someone malicious can route your connections through *their*
  relay (it sees who connects to whom, never the video — DTLS-SRTP is end to
  end). The relay sheet says when a relay came from a link and offers removal.
- **Discovery relays from a link are added and kept** (`?relays=`). A
  malicious link can so add an observer of your room *topics* — which any
  public relay operator already is (round 1 §7). They are listed, and
  removable, on the Network page.
- **NAT classification is a heuristic** (two STUN servers, port comparison).
  With several local interfaces behind one NAT and mDNS-hidden bases it can
  over-report "strict".
- **A rescue only works if the answer arrived before Trystero's prune**; an
  answer arriving later is dropped by Trystero itself. Faster gathering (§3)
  makes that rare.
- **MQTT sockets still leak per retry** (bounded), and MQTT is dead on
  443-only networks.

---

## Part 3 — round 4: more ways through, and getting footage out

The follow-up asked for: public relays for people with none, every "Ways to
use it" scenario tested (one-to-many, hotspot, home forwarding), the app
installable for offline use, a browser extension, relaying footage to a safe
place without internet, and off-grid meshing.

### 21. No relay of your own → tested public relays, opt-in

When the app sees a strict network (the NAT check says *UDP blocked*, or a
collector has been searching for 10 s with no relay configured) the status
card now says so up front (`strict-network`), and the relay sheet opens with
**Try free public ones**: each candidate is tested *on this network* first
(stopping at the first relay candidate, ~1.6 s), results are listed per
server, and only those that answered are used — after an explicit tap, with
the warning that volunteers run them, they can vanish, and they see who
connects to whom (never the video). Public relays are not put into share
links. Honest finding from the research: there is no dependable public TURN
without sign-up. The list holds the two recently reported to work
(`freestun.net`, `relay.backups.cz`); when none answers, the sheet says so
and points at free provider tiers (ExpressTURN, Metered, Cloudflare) or
self-hosting.

**Extra STUN.** A network that blocks the usual STUN servers gets *More STUN
servers*: a tested built-in list, or a fresh list fetched from
`pradt2/always-online-stun` (re-tested hourly upstream), spread across
providers, at most four kept.

### 22. One to many, at scale

`crowd-large`: one streamer, six viewers. Every device shows the same counts
(6 watching, 7 recording — the streamer keeps a copy too), the streamer
uploads to at most two direct children, and at least four viewers are served
by other viewers (relay tree).

### 23. Use it once, then without the site

- **PWA, verified with the server gone** (`scripts/e2e/pwa-offline.mjs`):
  two profiles visit the production build once; the web server is then
  killed. The home page, deep links (`/offline`, `/collect/ABC123`,
  `/recordings`, `/network`, `/guide`) and the lazily loaded streaming code
  all load from the device, and two devices pair face to face and stream.
- **Evidence is not evictable:** the app asks for persistent storage when
  installed and when a recording starts (`navigator.storage.persist()`); the
  home screen offers *Install app* where the browser supports it.
- **Browser extension** (`npm run build:extension`): the same app with hash
  routes and no service worker, as Chromium (MV3 service worker) and Firefox
  (MV3 background script) packages plus zips that can be passed around and
  loaded offline. No permissions. `scripts/e2e/extension.mjs` loads it into
  Chromium: all routes render, no CSP or chunk errors, the share sheet warns
  that `chrome-extension://` links open nowhere else, and it streams to a
  web-app viewer by room code and face to face. Firefox: packaged, not run here.

### 24. Relay to a safe place — three ways, all verified on arrival

- **Evidence files.** Recordings → share icon: the video plus its proof as
  one stored `.zip`, or the video + `.evidence.txt` where a share sheet
  refuses zips (Chrome's Web Share accepts media, text and PDF only). The
  proof carries every chunk's size, so a receiver cuts the video back into the
  exact pieces that were hashed and signed. Recordings → *Import* re-hashes
  each one and names the second that was altered. Standard `unzip` opens the
  bundle; a README inside explains verification without the app.
- **Store and forward to the home archive.** The phone offers its signed
  recordings; the home asks only for chunks it lacks (resumable), drops any
  chunk whose hash does not match the signed proof, and refuses evidence
  whose signature does not verify or that does not match the offer.
- **Face to face.** On an offline link, *Hand over my recordings* runs the
  same protocol over a second data channel, framed for chunks larger than one
  data-channel message and paced by `bufferedAmount`.

`lib/transfer/syncProtocol.ts` is transport-agnostic; it runs over Trystero
(`useTrystero.addChannel`) and over a plain `RTCDataChannel`.

### 25. Off-grid chains

A face-to-face viewer can **Share onward**: it invites further devices and
forwards what it receives, so the picture spreads A → B → C with no
internet, and the person filming uploads only to the devices next to them.
Re-pairing upstream keeps the downstream links and feeds them the new
picture. Bluetooth discovery and Wi-Fi Direct video need native code: design
in [`NATIVE_MESH.md`](NATIVE_MESH.md).

### 26. Evidence bugs found on the way

- **Two chunks could share an index.** The recorder read its chunk counter
  after awaiting the storage write. Two `dataavailable` events back to back —
  which is exactly what `stop()` produces (`requestData()` plus the final
  chunk) — got the same index: the second overwrote the first on disk, and
  the proof's hash order could differ from the footage. Indexes are now
  claimed synchronously; the proof follows chunk order.
- **Playback and download were in directory order.** `readAllChunks` sorted
  by a `name` that Blobs read back from files do not have, so every
  comparison was 0. OPFS iteration order is unspecified. Now sorted by the
  zero-padded file name.
- **"Verify integrity" only checked the proof against itself** (Merkle root
  and signature over the stored hashes) — not the footage. It now re-hashes
  the stored chunks.

### Round 4 verification

- **Unit (E1):** 312 tests (was 273). New: evidence manifest, bundle
  round-trip (and `unzip -t` on the result), tamper/cut/padded/forged
  detection, the sync protocol (delivery, resume, damaged chunk re-asked,
  chunks that never verify, forged signature, evidence not matching the
  offer, declined offers), data-channel framing and backpressure.
- **End to end (E2):** every scenario, in one run against the dev server,
  plus the production build and the extension package:

  | Scenario | Result |
  |---|---|
  | open network | video 1.1 s, `LOCAL` |
  | blocked, no relay | *networks block a direct connection — set up a relay* |
  | blocked, relay in the link / streamer only | video 1.3 s / 3.7 s, `RELAY` |
  | blocked, wrong relay password | *relay rejected its username/password* |
  | public relays, one live and one dead stand-in | live one ✓ in 1.6 s, dead one ✗; video 8.8 s after opting in |
  | relay added while a viewer waits | viewer's video 1.3 s later |
  | crowd (3) / crowd-large (6 viewers) | all play; counts 6/7 on all seven devices; streamer uploads to 2, 4 served by seeds |
  | internet drops mid-stream | still playing 15 s after discovery died |
  | offline: two viewers / isolated | 103-char codes, both ~0.9 s / "couldn't reach them" + tips |
  | home archive live forward | phone and home both play; home records |
  | evidence file | export, import on a second device "✓ Verified and imported"; one flipped byte: "Second 3 … does not match what was signed", nothing stored |
  | home sync | two recordings delivered in 0.5–0.7 s; both verify at home |
  | offline hand-over | both directions "received ✓ verified"; copy verifies |
  | offline chain A → B → C | C plays A via B; A serves one viewer |
  | offline chain repair | B re-pairs with a new filming phone; C decodes 43 frames in 3 s without re-pairing |
  | PWA, server killed | home, 5 deep links and lazy streaming code load; two devices pair and stream |
  | extension (Chromium) | all routes, no CSP/chunk errors; streams by room code and face to face |

- **Owed on real devices:** the public relays from a real VPN and a real
  carrier (the test used local stand-ins); AirDrop / Quick Share / Bluetooth
  carrying evidence files (headless Chromium has no share sheet); PWA
  install and offline start on iOS and Android; the extension in Firefox;
  chains over a real iPhone hotspot (guests may be isolated from each other —
  make the relaying phone the hotspot).

### Round 4 known limits

- **Public relays are a stopgap.** They may be down, full or throttled at any
  time, and their operators see connection metadata. The app tests before use
  and never shares them in links; it cannot make them reliable.
- **An evidence bundle holds up to ~4 GB** (no ZIP64); larger recordings go
  as the video plus its evidence file.
- **Store and forward runs while Recordings is open** on the phone and Home
  archive on the home device — browsers give pages no background sync that
  could carry this reliably.
- **A chain adds one re-encode per hop** (each relay decodes and re-encodes),
  so quality and latency degrade along long chains, and a relaying phone
  spends battery on every device it serves.
- **Bluetooth discovery and Wi-Fi Direct video are not built** — design in
  [`NATIVE_MESH.md`](NATIVE_MESH.md).


---

## Part 4 — round 5: censorship resistance

Asked for: evolve this into the most censorship-resistant way to record and
distribute live streams. The weak points found, in order of how completely
they could stop someone:

### 27. Discovery servers were a single thing to block

Every connection over the internet started at public Nostr relays, BitTorrent
trackers or MQTT brokers. A firewall that blocks those stops two devices from
ever meeting, even when direct traffic or a relay would work. **Pair by
messenger** removes discovery entirely: the face-to-face codes now also carry
public (STUN) and relay (TURN) addresses (pairing-code format v3, local codes
stay v2 for older copies), so two codes sent over any chat app connect the
devices across the internet. The "can't reach any discovery server" verdict
now offers exactly that. Verified with discovery pointed at a dead server and
direct UDP between the devices dropped: ~115-character invite, video in ~1 s,
also with the reply sent back 90 s later.

### 28. Whoever held the domain could silently replace the app

The PWA used `autoUpdate` + `skipWaiting`: any new build on the site took over
every installed copy at once, mid-stream included. After a seizure that is the
most dangerous path of all. Now nothing updates silently; the installed copy
checks a waiting update's Ed25519-signed release manifest against keys it
carries, offers signed updates, and warns — without an install button — about
anything else. A browser still applies a waiting update once all windows are
closed, which the warning says. Signing keys are not set up yet
(THREAT_MODEL §2 lists the steps). Verified with three real builds served in
turn from one origin.

### 29. The app could not outlive its website — and the "standalone" build was broken

`build:standalone` inlined only the entry script; the lazily loaded streaming
code still pointed at `/assets/…`, so the file could never stream on its own
(its docs also claimed `file://` could not work at all — in Chromium it does).
The portable build now inlines everything, uses hash routes and relative
links, and produces one file that runs from disk and from any mirror path;
share and pairing links point back at whichever copy made them. From
`file://` the private file system (OPFS) is unavailable, so recordings would
have lived in memory only: recording storage now falls back to IndexedDB.
*Pass the app on* hands the file around; the web app only hands out a copy
that matches its signed release.

### 30. Distribution stopped at people who have the app

*Amplify* pushes the stream over WHIP to any broadcast server, from the phone
filming or from any viewer — so a viewer abroad can put a stream from a
blocked network onto the open web. Found on the way: the share sheet did not
scroll, so on a phone everything below the QR code was out of reach.

### Round 5 verification

