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

- **Unit:** 339 tests (was 312). New: pairing-code v3 (typed candidates,
  priorities, relay-only codes, v2 unchanged for local codes), release
  manifests and signatures (signed, forged, changed after signing, unsigned,
  key rotation), hash-routed links and link parameters, WHIP (headers,
  resource, DELETE, every error kind, source replacement).
- **End to end, one run:** all 22 scenarios in `scenarios.mjs` pass, plus:

  | New check | Result |
  |---|---|
  | messenger-pair: discovery dead, direct UDP dropped, relay on one side | 115-char invite, 103-char reply; video 1.0 s via the relay |
  | messenger-pair-late: reply sent back after 90 s | video 1.0 s |
  | updates.mjs: signed update / intruder-signed update | offered and installed / warning, no install button, reload keeps the trusted copy |
  | portable.mjs: file from the web app | byte-identical to the release (0.96 MB) |
  | two copies opened from disk | pair and stream; the viewer's recording verifies (IndexedDB) |
  | a copy of the copy | runs, no errors |
  | mirror under an arbitrary path | share link `…/mirror/any/path/#/collect/CODE?relays=…`; a fresh viewer joins and watches |
  | amplify-streamer / amplify-viewer | wrong token refused; live; stand-in server decodes the video; stop sends DELETE / viewer re-broadcasts the room's stream |
  | extension.mjs | now also hands out the single-file app |
  | pwa-offline.mjs | still passes with updates on "prompt" |

- **Owed on real devices and servers:** messenger pairing between a real VPN
  and a real carrier; the single file in Firefox and Safari; a real IPFS
  gateway; MediaMTX and Cloudflare Stream as WHIP targets with an
  H.264-capable browser (the test browser sent VP8); the update warning in an
  installed home-screen app on Android and iOS.

### Round 5 known limits

- Signed releases need a developer key to be set up before they protect
  anyone (THREAT_MODEL §2); until then updates show as "cannot check".
- A browser applies a waiting update when every window is closed. The
  warning comes first; it cannot stop that.
- Pairing codes sent over a messenger are good for a few minutes and reveal
  network addresses to whoever carries them.
- Recordings are still not encrypted on the device.
- WebRTC and TURN traffic is not disguised; deep packet inspection can
  recognise and block it (a relay on 443 raises the bar, no more).


---

## Part 5 — round 6: what a taken phone shows, and proof of when

### 31. A seized phone showed everything it had filmed

Recordings were stored in the clear: whoever unlocked the phone could watch
them and identify the people in them — often the greater danger than losing
the footage. **Sealed recordings** (off by default) are encrypted while they
are recorded: a random AES-256-GCM key per recording, a fresh IV per chunk,
the key wrapped per recipient with ephemeral X25519 + HKDF-SHA256 + AES-GCM
(`lib/seal/crypto.ts`, on @noble/curves, @noble/hashes and WebCrypto). Two
recipients are possible: the **home archive** (its public key travels in the
pairing link; the phone itself can then never open the recording) and a
**passphrase key** on the device (kept encrypted, PBKDF2-SHA256 600 000
rounds, unlocked for the session only). Recording needs no secret at all.

Sealing must not cost the evidence chain: the recorder signs a second Merkle
proof over the *encrypted* chunks with the same key, so anyone can check a
sealed copy is intact without opening it. Transfers and evidence files carry
sealed copies as they are; a friend can carry one to safety without seeing
it (blind carrier); the home archive opens arrivals with its key and checks
the footage against the footage proof.

### 32. Proof of *when* was missing

A signature shows a recording is unaltered since signing — not when it was
made. Recordings can now be **timestamped with OpenTimestamps**: a nonce'd
fingerprint of `root.txt` (the proof's Merkle root) goes to public
calendars, which anchor it in Bitcoin within hours; the app upgrades pending
proofs and checks the block header against a block explorer. The `.ots`
format is implemented from the specification and checked against the
OpenTimestamps project's own example (byte-identical round trip; it reaches
the real Merkle root of block 358391). Evidence bundles include `root.txt`
and `root.txt.ots` for `ots verify`; timestamps travel with transfers and are
dropped unless they stamp that very proof. The calendars answer browsers
(`Access-Control-Allow-Origin: *`) but not CORS preflights, so every request
is a "simple" one — asserted by the E2E test.

### 33. Found on the way

- **Saving a recording taken from the list failed** ("could not be cloned"):
  the list holds reactive proxies, which IndexedDB refuses. The database
  layer now stores plain copies. (Hit by the first feature that re-saved a
  listed recording — timestamps; sealing and sync save fresh objects.)
- **Verify showed the previous verdict while re-checking** — misleading right
  after unlocking a sealed recording. It now clears first.
- A device holding a recording sealed for someone else was told to "unlock
  with your passphrase"; it now says the recording is sealed for someone
  else, and can still be checked and passed on.

### Round 6 verification

- **Unit:** 361 tests (was 339). New: sealing (each recipient opens, others
  and tampered seals do not, chunk encryption round trip and tamper
  refusal, passphrase lock incl. Unicode normalisation), sealed evidence
  (intact without the key, refused if the sealed proof is from another
  device, opened into verified footage, bundles), OpenTimestamps (the
  project's reference proof parsed and rewritten byte for byte and leading
  to block 358391's Merkle root, a real calendar answer, stamping with a
  nonce and without preflight, upgrading, the block-header check), and
  timestamps only accepted for the proof they stamp.
- **End to end, one run:** all 26 scenarios pass — the four new ones:

  | New check | Result |
  |---|---|
  | sealed-home | phone: no WebM on disk, playback refused, "Intact (sealed — not opened)"; sent home; home: "arrived sealed · opened here", "Unaltered", plain footage on disk |
  | sealed-passphrase | locked after reload; wrong passphrase refused; unlocked → "Unaltered" and playing |
  | sealed-blind-carrier | sealed evidence file → friend: imported, intact, cannot open → friend sends home → home: "Unaltered" |
  | timestamp | requested → still pending → "Existed by Bitcoin block #870123 … ✓ checked"; bundle's root.txt.ots stamps its root.txt; no CORS preflight sent |

  Plus pwa-offline, portable, updates and extension — all passing.
- **Owed:** real OpenTimestamps calendars end to end (a proof confirmed
  hours later, then `ots verify` on it); sealing on real phones at a scene,
  including a phone locked or taken before the recordings reach home.

### Round 6 known limits

- Sealing is off by default, and only applies to recordings started after
  turning it on.
- Footage passes through memory in the clear while it is being recorded; a
  phone taken while unlocked (or with the passphrase unlocked) shows what it
  can open.
- Fingerprints of sealed footage stay readable: they reveal nothing about
  the content, but can confirm that this phone recorded a video someone
  already has.
- Timestamps take hours to anchor, prove "existed by", and contacting the
  calendars is visible to the network; they stay off unless asked for.


## Part 6 — round 7: copies that check back to the camera, and throttled links

### 34. A viewer's copy could not be linked to what the camera saw

Every copy is signed by the device that recorded it — which proves nothing
about the picture before it got there. Since viewers' copies are the ones
that survive when the filming phone is taken, that was the weakest link in
the evidence chain. **Live attestations** (`lib/corroborate/`): once a
second the filming phone fingerprints its own camera picture (dHash + aHash
of a 64×64 grayscale thumbnail, 128 bits) and signs `stream id, sequence,
ms since start, fingerprint` with Ed25519 — with a key made for this stream
and never stored, so two streams of one phone cannot be linked through it.
The share link carries the key (`fk=`); viewers who joined through it keep
only attestations under that key (others: only from the peer sending the
stream), signature-checked and rate-limited. They travel wherever the
picture does — rooms, relay trees, home forwarding, face-to-face chains
(`LinkMsg 'att'`), syncs and evidence files.

*Check against the filmer* plays a copy through at 8–16× unseen, samples a
fingerprint every 200 ms of video time, finds the offset between the
filmer's clock and the copy's by voting (every look-alike pair proposes
one), and reports per signing key how many attested moments inside the copy
have a matching frame within ±0.7 s — naming the times that do not, where a
cut or a swap would be. Fewer than 3 attested moments: "too few"; a scene
that never changed is flagged as saying little. What it proves, and what it
does not (whose key, bytes vs. picture), is in THREAT_MODEL §4.

### 35. Throttling turned a stream into a stalling smear

Congestion control lowers the bitrate but never decides a link is too slow
for video: on a policed 50–300 kbit/s link the picture stalled and crowded
out the sound. Each sending link now steps through a ladder (`linkShaper.ts`
logic, `linkShaping.ts` WebRTC) from what the connection measures — full,
reduced (½ resolution, 450 kbit/s, 24 fps), small (¼, 130 kbit/s, 12 fps),
sound only (video encoding switched off, sound at high priority). Down: as
far as the estimate says after two samples (4 s), but on loss alone at most
one step — a single burst (a keyframe hitting a policer) once threw a
picture straight to sound only. Up: one step at a time, each step a trial
(fails on repeated heavy loss, or when the estimate, given 15 s, does not
hold it); after a failed trial the next waits 30 s, then 60 (round 8: and
no longer, see §41) —
under a policer the estimate runs ahead of reality and retries flapped every
20 s before this. The viewer's stall monitor now tells *sound only* from a
dead stream (audio bytes still moving), so a throttled viewer keeps
recording instead of tearing the connection down and reconnecting.

### 36. Found on the way

- **The filming screen's bottom buttons could not be pressed** — record/stop,
  QR, end stream sat inside a `pointer-events-none` overlay since the
  baseline. Found when the corroboration test tried to end a stream.
- **New recording fields were silently dropped on save**: the database layer
  copies an explicit field list. A test now round-trips every field.
- **Large messages over plain data channels failed**: Chrome caps a message at
  256 KB. The evidence of a recording carries a hash per second, so handing
  over anything longer than about an hour face to face failed; with
  attestations, about a quarter of an hour. Such messages are now framed
  like chunks.
- **A sealed recording kept the stream's attestations in the clear** — their
  key is in a public link, so a seized phone could be tied to a stream. They
  are sealed with the footage now.
- **A viewer on sound only kept collecting attestations** while its copy
  recorded a frozen frame: checked later, that stretch would have read as a
  cut. Attestations are now kept (and forwarded home) only while the picture
  is arriving.
- **The test harness lost discovery for the rest of a run** when
  `internet-drops` failed mid-way (it stops the local relay). It now always
  brings it back.

### Round 7 verification

- **Unit:** 398 tests (was 361). New: fingerprints (stable under noise,
  brightness shift and rescaling; distinct scenes far apart; flat pictures
  steady), attestations (any changed field breaks the signature), matching
  (offset found under network delay; another stream's footage not
  corroborated; a spliced stretch named; bad signatures dropped; each signer
  reported separately; a still scene flagged), attestation logs and intake
  (link key enforced whoever relays; without one, only the stream's source;
  rate limit), evidence (attestations carried and shape-checked; sealed with
  sealed recordings and opened with the footage), framed large data-channel
  messages, every stored recording field round-tripped, the link ladder
  (straight down on the estimate, one step on loss, every step up on trial,
  doubling back-off), and sound-only told from a dead stream.
- **End to end, one clean run:** all 30 scenarios pass. New or extended:

  | Check | Result |
  |---|---|
  | corroborate | two cameras with different generated pictures; one viewer records both through the links: each copy kept only its link's key; A: "10 of 10 signed moments match", C: "10 of 10"; A given C's attestations: "✗ … 0 of 10"; the filmer's own recording: 34 of 36; attestations in the evidence file |
  | corroborate-offline | A films, B relays, C records, face to face: C's copy 10 of 10, signed by A's key |
  | corroborate-sealed | viewer sealing to home: no attestation in the clear on the phone and the stream key absent from its record; the check there says it is sealed; sent home, opened: 11 of 11 |
  | archive | the filmer's attestations reach the home archive with the forwarded picture (6 in 6 s) |
  | throttled | `iptables hashlimit` policer: ~320 kbit/s → small/reduced picture, moving in 10/10 samples, never sound only; ~56 kbit/s → "sound only" on both ends, still recording, no "interrupted"; lifted → picture back without reconnecting |

  Plus pwa-offline, portable, updates and extension — all passing.
- **Owed:** corroboration on real phones, including a copy re-encoded by a
  messenger before it is checked; throttling on real networks (a carrier's
  post-cap fallback speed, a 2G-only setting) and with several viewers of
  which only one is throttled.

### Round 7 known limits

- A match means the same coarse picture, not the same bytes; a crafted video
  with the same coarse picture would pass, and a still scene matches easily
  (the check says so). Who the key belongs to has to be established outside
  the app — the link the filmer shared.
- Joined by room code alone, a viewer cannot hold attestations to a key, and
  takes those of whoever announces itself as the filmer.
- One attestation per second: shorter edits between two can go unnoticed.
- Checking plays the copy at 8–16×: an hour of footage takes a few minutes.
- The ladder shapes each link separately; a filming phone whose own upload is
  throttled shares it among its direct viewers, so relaying viewers matter
  more. Below ~50 kbit/s even sound breaks up.

## Part 7 — round 8: one record out of many, blending in, and evidence that checks itself

### 37. Each viewer's copy stood alone

Every viewer records on its own, so when one phone is taken or drops out
the others' copies have their gaps at different moments — and nothing put
them together. **Combined records** (`lib/combine/`): copies of one stream
are grouped by the filmer's key and stream id (by room without
attestations), placed on the filmer's clock — exactly, from the picture
check; roughly, from when the attestations arrived (their receipt times are
now kept in the logs); as a last resort, from device clocks, tied to the
placed copies — and covered with the fewest switches, best-aligned copy
first. The timeline plays through one video element, switching copies, and
renders into one signed recording through a canvas at the copies' own
picture size (a letterboxed re-encode no longer matches the filmer's
fingerprints), with gaps drawn at full length so the clock stays linear:
the rendered video still checks out against the filmer. Its record names
every source copy's signed root and key; a combined bundle carries each
copy as its own evidence bundle under `sources/`, and importing one
imports and verifies them all. Viewers' and the filmer's own recordings
are now filed under the room, so copies group even without attestations.

### 38. The app's traffic said what it was

Deep packet inspection recognises WebRTC before it knows the app: STUN to
public servers, DTLS between peers, TURN in the clear. **Blend in**
(`lib/net/blendIn.ts`, Network page) needs a `turns:` relay on 443 and
then: relay candidates only, only TLS relays in the configuration, no STUN
servers, no NAT probe, discovery over Nostr/WSS only. Without a TLS relay
the setting cannot apply, and says so. `docs/TRAFFIC.md` says what each
component looks like on the wire and what still shows — hostnames, the
steady shape of a live stream, TURN's TLS handshake without ALPN; no
pluggable transports, which a web page cannot do.

### 39. Evidence depended on the app that made it

The README in a bundle described the check in words; actually doing it
without the app meant writing code. Every bundle now carries
`verify.html` — 49 KB, built from the same modules (`vite --mode verify`,
inlined like the single-file app, handed to the app through a virtual
module) — which checks the signature over every second, the filmer's
attestations, a timestamp's presence and a combined record's sources, in
any browser from disk, uploading nothing.

### 40. Half a second to hide in

Attestations were signed once a second, so an edit shorter than a second
between two of them could pass. The filming device now signs twice a
second (the logs allow six hours at that rate).

### 41. Found on the way

- **Chromium sends TURN over TCP/TLS through the system's HTTPS proxy.** On
  this machine every outbound TCP went through the container's agent proxy,
  which refused the relay: `turns:` "failed to establish connection" while
  `turn:` over UDP worked. The harness launches the blend-in browsers with
  `--no-proxy-server`. Worth knowing in the field: a phone with a configured
  HTTP proxy routes `turns:` through it.
- **Headless Chromium phones home.** With the proxy out of the way the net
  log showed DNS and QUIC to Google (account checks, push registration, DoH
  probes) — none of it the app's. The blend-in scenario refuses to resolve
  anything but localhost and the relay, and classifies what remains by
  Chromium's own net log.
- **The test TURN server only spoke UDP.** `turn-tcp-bridge.mjs` fronts it
  over TCP and TLS with RFC 5766 stream framing, so `turns:…:443` is
  exercised for real (a self-signed certificate, accepted by the test
  browser only).

- **Sound only could stay sound only for minutes after the throttle lifted.**
  With video switched off nothing is sent that could raise the link's
  estimate, so the climb back is by timed tries — and the back-off between
  tries had grown to two minutes. Now at most a minute (a few seconds of
  broken picture a minute on a link that stays slow), and a link whose
  estimate jumps two tiers above the current one steps up at once.

### Round 8 verification

- **Unit:** 412 tests (was 398). New: the combined timeline (fewest
  switches, gaps, a copy inside another never played, alignment ranking),
  grouping and placing copies (by stream and by room; picture, signals and
  clock placements; a non-matching copy left out; clock copies tied to placed
  ones), blend-in (TLS-relay detection incl. port 443, configuration
  reduced to TLS relays and relay candidates, readiness levels), evidence
  manifests with `combined`, and the link ladder's recovery rules.
- **End to end, one run:** 32 of 33 scenarios pass; `throttled` brought the
  picture back after the throttle lifted but not the full picture within the
  budget (the ladder fix in §41 follows from it; its re-run is recorded
  below the table). New:

  | Check | Result |
  |---|---|
  | combine | two viewers, 10 s each with a 3 s pause, bundles imported on a third device: placed by the filmer's signals, then "Matched against the filmer" ×2; "0:23 covered, 0:05 in gaps, 2 stretches"; play-through switched copies and showed the gap; rendered 27 s [copy 11, gap 6, copy 12], signed, "rendered from 2 copies", 19 of 19 moments match the filmer; the combined record imported on a fourth device with both source copies verified |
  | blend-in | every UDP packet from the host dropped and counted: on — video via RELAY, rooms ["nostr"], **0 UDP packets attempted**, the app's only host beyond localhost the TLS relay (Chromium net log); off, same relay — 58 UDP packets, rooms mqtt/nostr/torrent, every public tracker and broker contacted |
  | self-check | a viewer's bundle unzipped; verify.html (49 KB) from disk in a plain browser: video + evidence.json → "Unaltered, 9 s", 16 moments matched against the filmer; the .zip → unaltered; one byte flipped → "Second 4 … does not match what was signed" |
  | corroborate, -offline, -sealed, archive | pass at two attestations a second (20–21 kept in 10 s) |

  `throttled` re-run with the ladder fix: pending.

  Plus pwa-offline, portable (the single file now 1.10 MB with the checker
  inside), updates and extension — all passing on the round's build.
- **Owed:** `docs/DEVICE_CHECKLIST.md` — everything across all rounds that
  needs real phones, networks and services, in one list.

### Round 8 known limits

- Combining needs the copies on one device, and plays the record through in
  real time to render it: an hour of footage takes an hour. Copies that
  cannot be aligned by the filmer's signatures are placed by device clocks,
  which can be seconds off; the result says which alignment it got.
- A rendered video is a re-encode: evidence is the copies it names, which
  is why a combined record carries them.
- Blend in needs a `turns:` relay on 443 and makes everything go through
  it; what still shows is in `TRAFFIC.md`. A device with a system HTTP proxy
  sends `turns:` through that proxy.
- `verify.html` needs a browser; it checks what the bundle carries, not
  whose key it is. An app built without `npm run build:verify` makes bundles
  without it.
- Two attestations a second double their size (about 400 bytes a second);
  an edit shorter than half a second between two can still pass.
