# Multi-site results — 2026-11-19

Plan and harness: [`MULTISITE_TEST_PLAN.md`](MULTISITE_TEST_PLAN.md). Five
machines on four networks, real public discovery (Nostr, BitTorrent trackers,
MQTT). Times run from opening the link to the first decoded frames. Each
scenario ran **once per build**, so single numbers can vary run to run; treat
small differences as noise.

**Build `0.1.0+e8a1379` (current `main`): 17 of 19 pass.** The two failures
share one cause in the test setup (a self-signed certificate on the test
relay's TLS port), not in the app. The same suite earlier ran on round 5
(`3bd6090`); that column is kept for comparison, because round 9's offer-pool
change shows up clearly.

## Results

| Scenario | Path (e8a1379) | First frame e8a1379 | round 5 | Notes |
|----------|----------------|--------------------:|--------:|-------|
| `home-to-home` mac → nas (two home NATs) | direct, NAT-mapped UDP | 5.5 s ✅ | 6.1 s | 1280×720, 0 freezes (round 5: 320×180, 15 freezes) |
| `server-to-home` Iceland → mac | direct, NAT-mapped UDP | 2.4 s ✅ | 6.2 s | 1280×720, 0 freezes |
| `home-to-server` nas → fmp | direct, NAT-mapped UDP | 2.1 s ✅ | 2.0 s | 7–18 fps: the NAS's **uplink** limits it (WebRTC: `qualityLimitationReason = bandwidth`) |
| `server-to-server` log → Iceland | direct, NAT-mapped UDP | 2.1 s ✅ | 2.2 s | |
| `vpn-home-to-home` nas (host net) → mac, both on NetBird | direct over the **public** internet | 2.0 s ✅ | 3.1 s | Finding 3 |
| `vpn-server-to-server` log → Iceland, both host net | direct over the **public** internet | 3.3 s ✅ | 3.1 s | Finding 3 |
| `blocked-no-relay` both strict, no relay | none | — ✅ | — ✅ | Viewer told *"your networks block a direct connection"* |
| `relay-via-link` both strict | TURN/UDP (viewer side) | 6.3 s ✅ | 6.2 s | Relay came in the share link; viewer configured nothing |
| `relay-one-side` both strict; streamer's relay, not shared | TURN/UDP (streamer side) | 5.9 s ✅ | 5.5 s | |
| `relay-tcp-udp-blocked` viewer has no UDP at all | TURN over TCP | **2.2 s** ✅ | 13.4 s | 1280×720 (round 5: stuck at 320×180) |
| `relay-tls-hostile` viewer: only 443 + relay's TLS port | none | — ❌ | — ❌ | Finding 5. Discovery over 443 alone worked |
| `relay-tls-hostile-remote` same, viewer on another host | none | — ❌ | — ❌ | Same cause |
| `force-relay-privacy` "always connect through the relay" | TURN/UDP | 2.4 s ✅ | 2.7 s | Viewer only ever saw the relay's IP, never the home IP |
| `bad-mobile-viewer` viewer uplink 350 ms / 8 % / 600 kbit | direct | 7.5 s ✅ | 7.8 s | Shapes the viewer's uplink only (netem is egress-only) |
| `lossy-streamer-uplink` streamer 150 ms / 3 % / 2 Mbit | direct | 7.7 s ✅ | 6.7 s | 44 packets lost; settled at 960×540 and **held 20 fps** |
| `internet-drops` all TCP cut on both ends mid-stream | direct | 2.2 s ✅ | 2.4 s | Video kept arriving for 85 s with every discovery link dead (0.3 → 6.6 MB) |
| `home-archive` mac → phone (Iceland) → NAS | direct, both hops | phone 2.1 s ✅ | 2.2 s | NAS: "Recording a forwarded stream … DIRECT" |
| `crowd` mac → 6 viewers on 4 machines | relay tree | 1.7–2.1 s (NAS 6.1) ✅ | 1.8–2.3 s | Peak **2** simultaneous uploads; all 7 devices: 6 watching / 7 recording |
| `crowd-seed-dies` same, Iceland seed killed | relay tree | 1.6–2.2 s (NAS 6.4) ✅ | 1.8–2.3 s | All 5 survivors had fresh frames a minute later; uploads ≤ 2 throughout |

## Findings

### 1. Round 9's smaller offer pools work: ~6× fewer relay allocations

One streamer with a relay configured and **no viewers**, 60 seconds, counted in
the relay's verbose log:

| Relay URLs in the config | round 5 (`3bd6090`) | current (`e8a1379`) |
|---|---:|---:|
| three (`turn:` UDP, `turn:` TCP, `turns:`) | 333 | **54** |
| one (`turn:` UDP) | 90 | **22** |

Round 5 behaved as `scripts/patch-deps.mjs` describes: Trystero built 20 offers
per discovery network and refreshed them every ~57 s, each allocating on every
relay URL. During the round-5 run, that exhausted the test relay's 150-per-user
quota, and a later scenario failed with `486 Allocation Quota Reached`, which
the app named correctly. On the current build the cost is "a few dozen", as
`SELF_HOSTING.md` says. It still scales with the number of relay URLs, so a
single URL in links you hand out costs less than half as much.

### 2. The relay tree holds the uplink at two copies across real networks

Six viewers on four machines over the public internet: the streamer never
uploaded more than two copies at once. That's counted as video uploads whose
byte counters grew between 5-second reports, and it held while a seed was
killed and its viewers re-seated. Every device agreed on the counts. The NAS is
consistently the slowest viewer to first frame (5–6 s against ~2 s); that's
probably its slow CPU loading the app, but this run didn't separate the two.

### 3. A VPN mesh doesn't carry the media when a normal path works

With NetBird on both ends, ICE chose the public internet path every time (two
builds, two site pairs). The likely reason, which I haven't verified: Chrome's
WebRTC treats VPN adapters as high-cost networks and avoids them while a cheaper
one works. Connectivity is fine either way. The consequence is that being on a
VPN doesn't route media through it. If you want to hide your IP from the other
side, the app's *Always connect through the relay* option does that (scenario
`force-relay-privacy`).

### 4. UDP-blocked networks: TCP relay is now as fast as anything else

With no UDP at all, the viewer connected through the relay over TCP in 2.2 s at
1280×720. On round 5 the same case took 13.4 s and never left 320×180. That's
consistent with round 9/10's changes (fewer connection attempts per join; a
UDP relay doubling as STUN), but this run doesn't show which change did it.

### 5. TURN over TLS needs a real certificate (test-setup limit)

Chrome opened 179 TLS connections to the test relay's port 5349 and closed every
one right after the handshake, without sending a single TURN request: the
self-signed certificate for a bare IP was rejected. A real `turns:` relay needs
a CA-signed certificate for a hostname, ideally on 443, which is taken on every
server used here. What these runs do show: **discovery worked with only port
443 open**. The app found the streamer and correctly reported that the relay
couldn't be reached.

### 6. A home uplink is a real ceiling

Streaming *from* the NAS, the encoder ran at 7–18 fps, and WebRTC itself reported
the limit as `bandwidth`, not `cpu`. So that home connection's upload capacity
caps 720p video; the app's bitrate cap and motion hint keep it moving rather than
stalling. Anyone streaming from a similar line will see the same.

### 7. Infrastructure note (not an app issue)

- On `fmp` and the NAS, containers can't resolve DNS, because the host's resolver
  is NetBird's (`100.113.x.x`), which isn't reachable from Docker's bridge. The
  harness passes `--dns 1.1.1.1`. Other containers on those hosts that use the
  default DNS have the same problem.

## Harness corrections made during the round-5 run

Four first-run failures were the harness's fault; all were fixed before the
`e8a1379` run:

- `no-direct` first blocked **all** UDP except to the relay, so STUN failed and
  viewers never learned their public address. A TURN relay only forwards to
  addresses it has a permission for. Real strict NATs let STUN through. The
  profile now drops UDP only to the other participants' public IPs, as the
  single-machine harness does.
- The test relay's quota (150 per user) ran out because of finding 1. Raised to
  1,000.
- The crowd verdict counted every viewer that *ever* received a direct stream
  over minutes of re-seating. It now measures simultaneous uploads per report
  and compares counts at one shared instant.
- The Mac's public-IP lookup used a service that's blocked on its network; it now
  tries several.

## Not covered

Real phones on mobile data (CGNAT), Mullvad (its daemon wasn't running),
`turns:` on 443 with a real certificate, a real camera, and repeated runs for
variance. See the test plan.
