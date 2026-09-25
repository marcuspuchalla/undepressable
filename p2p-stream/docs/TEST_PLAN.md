# Test Plan

A scenario-by-scenario plan for verifying undepressable before public release.
Each of the five field scenarios from the in-app **Ways to use it** guide is
documented here with concrete steps and pass criteria, so it can be walked
through on real devices.

Companion docs: [`../TESTING.md`](../TESTING.md) (unit tests + the 2-peer
transport check), [`FEASIBILITY.md`](FEASIBILITY.md) (what each platform can and
can't do), [`DECISIONS.md`](DECISIONS.md).

## Status legend

| Mark | Meaning |
|------|---------|
| ✅ | Verified working |
| 🟡 | Partially verified (logic proven, full-device pass still owed) |
| ⬜ | Not yet tested |
| 🔒 | Planned / needs a native build — cannot pass on the web app |

## Test environments

| # | Environment | Used for | Notes |
|---|-------------|----------|-------|
| E1 | `npm run test:unit` (vitest) | Pure logic: counts, room codes, integrity | Deterministic, in CI |
| E2 | One machine, multiple browser tabs | P2P signaling, counts, stream forwarding, recording | No physical camera in this setup — feed a synthetic `canvas.captureStream()` where a camera is needed (see below) |
| E3 | Two phones, same Wi-Fi / hotspot | Real camera capture, local transport, QR scan | The everyday case |
| E4 | Two phones, **different** networks (one on cellular) | NAT traversal via the bundled TURN relay | The hard network case |
| E5 | A computer left running as the home archive + a phone | Relay-to-safe-place (archive mode) | Long-running, always-on |

### Synthetic camera for E2

Automated/headless Chrome has no camera, so `getUserMedia` yields nothing to
broadcast. To exercise the transport without a camera, inject a moving canvas
stream and drive the app's own composable — this is exactly what the app does
with a real camera stream:

```js
const { useTrystero } = await import('/src/composables/useTrystero.ts')
const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240
const ctx = canvas.getContext('2d'); let t = 0
setInterval(() => { t++; ctx.fillStyle = `hsl(${t%360},70%,45%)`; ctx.fillRect(0,0,320,240)
  ctx.fillStyle='#fff'; ctx.font='28px sans-serif'; ctx.fillText('TEST '+t, 20, 130) }, 100)
const stream = canvas.captureStream(10)
const fwd = useTrystero(); await fwd.init(['both'])
await fwd.createRoom('some-room-id', ['both'], stream)   // now broadcasting
```

### Automated connection scenarios (E2, simulated strict NAT)

`scripts/e2e/scenarios.mjs` runs the app in several isolated Chromium
instances against a local Nostr relay. For the NAT scenarios it drops all
direct UDP between the peers with `iptables` (what two strict NATs do to ICE)
and starts a local TURN server as the only way through:

```bash
npm run dev                                   # in one terminal
npm i --no-save playwright@1 node-turn ws     # harness deps, not app deps
sudo node scripts/e2e/scenarios.mjs           # all; or name some: open blocked relay-link
```

Scenarios: `open`, `blocked`, `relay-link`, `relay-one-side`,
`relay-rejected`, `relay-added-live`, `crowd`. Results and what each proves:
[`RELIABILITY_AUDIT_3.md`](RELIABILITY_AUDIT_3.md). This proves the app's
logic under a faithful ICE-level simulation; it is **not** a substitute for
the real-network pass below (E4).

### Cross-network pass owed on real devices (E4)

The field report that triggered round 3, to be re-run by hand:

1. Streamer on a laptop/phone behind a **VPN**; viewer on **mobile data**
   (another country's carrier if possible). No relay configured.
   **Pass:** both screens show *"… your networks block a direct connection"*
   within ~30 s, with *Set up a relay*. (Before: endless "connecting".)
2. Streamer adds a relay via that button (use `turns:…:443`). **Pass:** the
   waiting viewer connects without touching anything; status shows `RELAY`.
3. Fresh room, relay already configured on the streamer only; viewer scans the
   QR with the **in-app scanner** and, separately, opens the link from the
   phone's **camera app**. **Pass:** both connect, `RELAY`.
4. **Network → Check** on each device. Record the verdicts (VPN and carrier
   are expected to read "Strict NAT"; home Wi-Fi "Standard NAT").
5. While connected via relay, walk the phone into a Wi-Fi ↔ mobile handover.
   **Pass:** a short blip recovers without a new recording segment; a long one
   recovers via rejoin.

---

## Scenario 1 — One to one

**Guide:** Use case 01. Hand your stream to a single trusted person.

- **Participants / devices:** Streamer (phone A), Watcher (phone B). E3.
- **Preconditions:** Both have the app open and online; A has camera permission.

**Steps**

1. A → **Stream** tab, allow camera. Note the room code / show the QR.
2. B → **Collect** tab, scan A's QR (or paste the link / type the code).
3. Watch for B to display A's live video.
4. Confirm B auto-starts recording (⏺ indicator).
5. A: verify the top counter shows `watching 1`.
6. B: **Recordings** → open the new recording → **Verify integrity**.

**Pass criteria**

- B shows A's video within a few seconds. ✅ 2026-07-17 — real iPhone streamer over the HTTPS tunnel, watched from a browser collector; 1280×720 stream received.
- B records automatically; the file appears under Recordings. ✅ 2026-07-17 — recorded from the real camera: 459 chunks, 1280×720, 2:02.
- A's counter reads `watching 1`; B leaving drops it to `0`. ✅ (E2, verified live between tabs)
- Integrity check reports **Unaltered**; a byte-flipped chunk reports **Merkle root mismatch**. ✅ (E1 + E2; and **Unaltered** confirmed on the real-camera recording 2026-07-17)

**Bugs found during this run (owed a fix before launch):**

- **Collector video won't autoplay** — the `<video>` isn't muted and carries
  audio, so browsers block autoplay; the watcher sees black until they tap.
  Fix: mute by default with a tap-to-unmute, or muted-autoplay + a play overlay.
- **Stale "Retry" error bar** — the red Retry bar stays visible over a stream
  that is actually playing (error/no-stream state not cleared once the stream
  arrives).

---

## Scenario 2 — One to many

**Guide:** Use case 02. Share the room code with a group.

- **Participants / devices:** Streamer A + watchers B, C, D… E3 (add tabs in E2).
- **Preconditions:** As Scenario 1; everyone uses the **same** code.

**Steps**

1. A goes live; shares one code/QR with the group.
2. Each watcher joins via Collect.
3. Each watcher confirms its own video + its own recording.
4. A watches the `watching` / `recording` counters climb as people join and record.
5. One watcher leaves; confirm the counter decrements and others are unaffected.

**Pass criteria**

- Every watcher gets the live stream, including **late joiners** (join after A started). ✅ late-joiner forwarding fixed & verified (E2)
- Counters reflect the real number watching/recording, updating within ~1s. ✅ (E2)
- Each watcher holds an **independent** signed copy (no shared/central file). ✅ by design (E1 integrity)

---

## Scenario 3 — Your personal hotspot (survives the internet dropping)

**Guide:** Use case 03. Local phone-to-phone over a personal hotspot.

- **Participants / devices:** Host phone A (hotspot on) + nearby watchers. E3, offline.
- **Preconditions:** A's Personal Hotspot on; watchers joined A's hotspot Wi-Fi.

**Steps**

1. A: enable Personal Hotspot (iOS: Settings → Personal Hotspot; Android: Hotspot & tethering → Wi-Fi hotspot).
2. Watchers join A's hotspot Wi-Fi.
3. A: **Stream**, allow camera, show QR.
4. Watchers: **Collect**, scan the QR (works with no internet) or type the code.
5. **Cut the uplink:** turn A's mobile data OFF (hotspot Wi-Fi stays up).
6. Confirm the stream between A and the watchers keeps running.

**Pass criteria**

- Watchers connect and see the stream while all devices are on the local hotspot only. ⬜ (E3)
- Video keeps flowing after the internet uplink is cut. ⬜ (E3)
- **iOS caveat:** recent iOS may isolate hotspot clients from each other; if watchers can't connect, that's the OS, not the app — retest with an Android hotspot or a normal local Wi-Fi network. See FEASIBILITY.md. 🟡

---

## Scenario 4 — Relay to a safe place (home archive)

**Guide:** Use case 04. A friend at the scene forwards the stream to a home
device that records it, so footage survives even if the phone is seized. The
streamer still sends only one stream.

- **Participants / devices:** Streamer A, friend/collector B (goes to the scene), home node H (stays safe). E5.
- **Preconditions:** H open on `…/archive`; B paired to H beforehand.

**Setup / pairing (before heading out)**

1. On H (a computer, ideally): Home screen → **Set up a home archive**. It shows a pairing QR + 8-char code and joins its private archive room.
2. On B, while still on a good connection: scan H's QR (or open `/pair-home/<CODE>`). Expect **"Home archive paired"**.

**At the scene**

3. A goes live (Scenario 1).
4. B → **Collect** → scans A's code and watches. B's bottom bar shows **Home archive `<CODE>`: forwarding ✓**.
5. H automatically shows **"Recording a forwarded stream"** and the incoming video.
6. Stop the stream (or B leaves): H finalizes and lists the file under **Archived this session**; it also appears in H's **Recordings**.

**Pass criteria**

- Pairing persists on B across reloads (localStorage). ✅ (E2)
- H auto-records the forwarded stream and shows the live video. ✅ verified this session (E2, synthetic stream: H recorded and showed "ARCHIVE TEST" frames)
- On stream end, H finalizes a signed recording. ✅ verified this session (E2: "19 chunks · 0:27", saved & signed)
- The **streamer sends only one stream** — B does the forwarding, not A. ✅ by design (B opens a second Trystero room; A unchanged)
- Full three-real-devices pass with a real camera + camera stream forwarded end to end. 🟡 owed on E5

**Home-node platform notes**

- Computer (E5): best — stays on, online, out of reach. ⬜ full pass owed.
- Spare phone/tablet: works, but keep the app foregrounded, on power, screen-sleep disabled. ⬜.

---

## Scenario 4b — Offline pairing, no internet at all (`/offline`)

**Guide:** the case normal room codes cannot serve — see
[`OFFLINE_AND_PROXIMITY.md`](OFFLINE_AND_PROXIMITY.md).

- **Devices:** two phones, one hotspot, **internet fully off**. E3.
- **Preconditions:** the app is already installed on both (PWA or APK) — it
  cannot be downloaded once the network is gone — and both have a camera.

**Steps**

1. Put both phones in airplane mode, then turn on Wi-Fi and have phone A share
   a Personal Hotspot; join it from phone B. Confirm neither has internet
   (a browser tab to any site should fail).
2. Phone A: open the installed app → **No internet? Pair face to face** →
   *I'm filming*. Allow the camera. An offer QR appears.
3. Phone B: same page → *I'm receiving* → scan A's QR. A reply QR appears.
4. Phone A: tap **They scanned it** → scan B's reply.
5. Expect: B shows A's live picture and starts recording within a few seconds.
6. Stop, then **Recordings → Verify integrity** on B.

**Pass criteria**

- The link establishes with no internet reachable from either device. ⬜ (E3)
- Video plays on B and a segment is recorded. ⬜ (E3)
- Integrity reports **Unaltered** — offline evidence verifies like online. ⬜ (E3)
- ✅ Verified in-browser (E2) with `iceServers: []` and no relays: both peers
  connected, real video decoded, both QR payloads inside one code.

**Known limits to confirm rather than be surprised by:** one streamer→watcher
link per exchange (no room, no relay tree); both devices must be on the same
hotspot; a plain `http://` LAN origin will refuse the camera.

## Scenario 4c — Frozen stream is noticed

**Devices:** any streamer + watcher pair. E3 preferred, E2 acceptable.

1. Establish a stream and confirm the watcher is recording.
2. Kill the media without a clean teardown — e.g. put the streaming phone into
   a faraday-ish dead spot, or disable its Wi-Fi/data abruptly.
3. Expect within ~8s: the watcher shows **Stream interrupted — reconnecting**,
   banks the segment it has, and retries; it must not sit on a frozen frame
   believing it is recording.
4. Restore the network and confirm it recovers into a new segment.

- ✅ Detection verified against real WebRTC (E2) with a sender track stopped
  silently — the receiver's track still reported `live`. ⬜ on devices (E3).

## Scenario 5 — Off-grid mesh (planned, native app)

**Guide:** Use case 05. Bluetooth pairing + device-to-device Wi-Fi when there is
no network at all.

- **Status:** 🔒 Not implemented on the web app. Requires the native Android
  (Nearby Connections / Wi-Fi Aware) or iOS (MultipeerConnectivity) build.
  Bluetooth alone is too slow for video. Tracked for the native milestone; no
  web test applies. See FEASIBILITY.md.

---

## Cross-cutting checks (run once per platform)

| Check | How | Pass | Status |
|-------|-----|------|--------|
| Relay health | Debug panel → relay list, **before** any action that matters | Each transport has ≥1 relay open | ✅ tooling shipped; check per outing |
| PWA install | iOS Safari → Add to Home Screen; Android Chrome → Install app | Opens full-screen, launches offline | ⬜ |
| Offline start | Airplane-mode after install, open app | UI loads; local hotspot flow still works | 🟡 (SW precache verified in build) |
| Integrity — clean | Record, Verify integrity | **Unaltered** | ✅ (E1/E2) |
| Integrity — tamper | Flip one chunk byte, Verify | **Merkle root mismatch** | ✅ (E1/E2) |
| Cross-network | Two phones on different networks (E4) | Connects via bundled TURN; clear message if blocked | ⬜ |
| Reconnect | Kill/restore a watcher's network mid-stream | Reconnects or shows a clear retry state | ⬜ |
| Service worker refresh | Ship a new build, reload twice | New version served (no permanent stale cache) | 🟡 (dev SW needs manual clear; prod auto-update wired) |

## Platform × scenario matrix (target for release)

| Scenario | iPhone (Safari/PWA) | Android (Chrome/PWA) | Computer |
|----------|--------------------|----------------------|----------|
| 1 One-to-one | ⬜ | ⬜ | ⬜ (watcher) |
| 2 One-to-many | ⬜ | ⬜ | ⬜ |
| 3 Personal hotspot | 🟡 (iOS isolation risk) | ⬜ | n/a host |
| 4 Home archive | ⬜ (as phone at scene) | ⬜ | ⬜ (as home node) |
| 5 Off-grid mesh | 🔒 native | 🔒 native | n/a |

## Known environment limitations

- **No camera in automated Chrome (E2):** `getUserMedia` returns nothing, so
  the streamer's own camera path can't be exercised headless. Transport,
  forwarding, counts, and recording are all proven with a synthetic canvas
  stream instead; a real-camera pass is owed on E3/E5.
- **Public DHT/Nostr dependency:** peer discovery uses public infrastructure, so
  discovery time varies (seconds to tens of seconds) and the transport isn't in
  CI — it's covered by the manual E3/E4 passes.
- **Dev service worker caches aggressively:** during development, unregister the
  SW and clear caches before trusting what the browser shows.

## Critical bug found & fixed during on-device testing (2026-07-17)

Real two-device testing surfaced a launch-blocker the synthetic tests had
hidden: **peer discovery was crippled by Trystero's default Nostr relays.**
The streamer's console was flooded with `relay failure … blocked: not on
white-list` / `invalid: ephemeral event expired`, so watchers sat on "waiting
for stream" — only the very first viewer (sometimes) ever connected, and
discovery could take 3+ minutes. Fixed by pinning a curated set of open relays
(`NOSTR_RELAYS` in `src/types.ts`, passed as `relayUrls`). Controlled repro
after the fix: discovery ~13s, and **both early and late joiners** receive the
stream with consistent counts (streaming 1, watching 2, total 3). This confirms
the late-joiner forwarding was always correct — the relays were the bug.

Lesson for the test plan: peer discovery over public relays **must** be
exercised on real, separate devices; a single machine warmed up by prior runs
masks relay failures.

## What has been verified so far (2026-07)

- ✅ **Real phone camera → P2P → collector** (2026-07-17, over the HTTPS tunnel):
  1280×720 stream received, recorded (459 chunks, 2:02), integrity **Unaltered**.
- ✅ Peer discovery reliable after the relay fix; early + late joiners both get video.
- ✅ Unit suite green (see TESTING.md count).
- ✅ Live counts between two tabs: join/record/stop/leave all propagate correctly.
- ✅ Late-joiner receives the stream (streamer re-forwards on peer join).
- ✅ Integrity: clean → valid; tampered chunk → Merkle mismatch.
- ✅ **Archive mode end to end (E2, synthetic stream):** collector forwards into
  the paired archive room → home node auto-records and shows the video →
  finalizes a signed recording on stream end (19 chunks / 0:27).
- 🟡 Everything marked ⬜ above is owed on real devices (E3/E4/E5) before public release.

## Reliability audit pass (2026-07-18) — E2 verified, device re-checks owed

Full findings in [`RELIABILITY_AUDIT.md`](RELIABILITY_AUDIT.md). Measured/live-verified this session:

- ✅ **Bundled TURN was dead** (openrelay: HTTP 502 on :80, refused on :443 —
  raw-socket probes). Removed; TURN now runtime-configurable (`?turn=` link
  param, localStorage, `VITE_TURN_*`); STUN diversified (Google + Cloudflare +
  Nextcloud:443, all probed alive). ⚠️ E4 "cross-network via bundled TURN"
  above is obsolete: cross-network now needs a configured TURN when both ends
  are strict-NAT — retest E4 both with and without a `?turn=` relay.
- ✅ **Single-copy uplink** (was up to 3× per watcher): live two-tab check shows
  "Sending stream … via <transport>" exactly once per watcher.
- ✅ **Media handover**: killing the media-carrying RTCPeerConnection mid-stream
  → stream re-sent over a surviving transport; killing a non-carrying one →
  no interruption at all; killed transports reconnect on their own.
- ✅ **Reconnect recording continuity**: on stream replacement the collector
  finalizes the current segment (Merkle proof + signature intact — verified:
  70-chunk segment saved) and auto-starts the next; "Stream interrupted"
  overlay instead of a frozen last frame.
- ✅ Sender bitrate cap (1.2 Mbps) present on the live video sender.
- ✅ Pinned relay `offchain.pub` found rejecting all our events → dropped.
- ⬜ Owed on real devices: wake lock + screen-lock camera recovery (E3),
  cellular↔Wi-Fi handover mid-stream (E4), time-to-first-frame re-measure
  after the dead-TURN removal (expect well under the old ~13 s), storage-low
  warning on a nearly-full phone.

## Relay tree P1 (2026-07-18, E2 verified — 4 isolated tabs, public relays)

Design: [`RELAY_TREE_DESIGN.md`](RELAY_TREE_DESIGN.md). Verified live on a
night when the public relays were genuinely degraded (damus rate-limiting,
primal.net 502, nostr.mom now demanding 28-bit proof-of-work — logged for the
relay-rot ledger):

- ✅ Root uplink capped: with 3 watchers the root streamed to exactly 2; the
  third was seated under a seed ("seated under seed …").
- ✅ Seed forwarding delivers real video: leaf played 320×240 and auto-recorded
  through the seed hop; seed showed "Relaying to 1 viewer".
- ✅ Seed death heals: closing the seed's tab → orphan report → re-seat → the
  leaf ended up directly on the freed root slot, playing and recording again.
  Transient churn (a brief re-seat onto the dying seed before its departure
  fully registered) converged within seconds.
- ✅ Zero unhandled rejections across all four tabs (regression guard for the
  send-path hardening).
- ⬜ Owed: relay opt-out toggle behavior E2E; >4-watcher load balance across
  two seeds; real-device latency through a seed hop (extra decode/encode);
  seed on Wi-Fi with leaves on cellular.
