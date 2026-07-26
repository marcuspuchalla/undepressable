# Offline, proximity and Bluetooth — what actually works

Written to be checked against reality, because people may plan around it in
situations where being wrong is expensive. Where something does not work, this
says so plainly rather than describing the version we would like to ship.

Companion docs: [`RELIABILITY_AUDIT_2.md`](RELIABILITY_AUDIT_2.md),
[`FEASIBILITY.md`](FEASIBILITY.md), [`TEST_PLAN.md`](TEST_PLAN.md).

---

## 1. The four degrees of "offline"

People say "offline" to mean very different situations. The app behaves
differently in each, so they are worth separating.

| # | Situation | Does the app work? |
|---|---|---|
| A | App already open, connection already live, then internet dies | **Yes** — media is peer-to-peer; an established link survives. Discovery is already done. |
| B | Both devices on one hotspot, no internet, starting fresh | **Yes, via `/offline`** (QR pairing). Normal room codes cannot work — see below. |
| C | Devices on different networks, internet cut on one side | **No.** Nothing local connects them; that is what the internet was for. |
| D | App not installed yet, no internet | **No.** The app has to reach the device somehow — install the PWA or APK beforehand. |

### Why normal room codes cannot work offline

Every discovery path dials a public host over `wss://`:

| Transport | Reaches | Needs internet |
|---|---|---|
| torrent | WebTorrent trackers (`tracker.webtorrent.dev`, …) | yes |
| nostr | relays (`nos.lol`, `relay.primal.net`, …) | yes |
| mqtt | brokers (`broker.emqx.io`, …) | yes |

There is no local-discovery option, and there cannot be one in a browser:
**browsers expose no mDNS/Bonjour, no UDP broadcast, and no local network
scanning to JavaScript.** A page cannot announce itself on a LAN. This is a
deliberate platform restriction, not a gap in the library.

> An earlier version of `OFFLINE_PWA.md` claimed Trystero discovers peers via
> "mDNS/Bonjour" and that "BitTorrent DHT works over local network". Both were
> wrong, and the claim has been corrected. If you read that before, re-read it.

### What `/offline` does instead

If the network cannot introduce two devices, the humans do it. The filming
device shows its WebRTC offer as a QR code; the receiving device scans it and
shows its answer back. After that, media flows directly across the local
network.

- No server, no relay, no internet at any point.
- ICE uses **host candidates only** (`iceServers: []`) — STUN/TURN are
  unreachable offline and would only stall gathering.
- Recordings are hashed, Merkle-rooted and signed exactly as online.
- **Requires:** both devices on one hotspot/Wi-Fi, and a camera on each.
- **Limit:** one streamer→watcher link per exchange. No room, no relay tree;
  more watchers means repeating the swap per device.

Verified with `iceServers: []` and no relays: both peers connected and real
video decoded. Offer QR ~1.9 KB, answer ~1.7 KB — each fits one code.

---

## 2. Bluetooth: the honest answer

Short version: **Bluetooth cannot carry this video, and in a browser it cannot
even introduce two phones.** It is a native-app feature at best, and even then
it is the *pairing* channel, not the *video* channel.

### Why not in the browser

Web Bluetooth is a **central-only** API. A page can connect *to* a peripheral
(a heart-rate strap, a thermometer) after the user picks it from a chooser. A
page **cannot advertise itself as a peripheral**, so two phones running this
app in a browser can never see each other over Bluetooth. There is no API that
would let them. Safari on iOS does not implement Web Bluetooth at all, and
Firefox does not either.

### Why not for video, even natively

Bluetooth throughput and video bitrates are orders of magnitude apart:

| Link | Realistic throughput | Our capped video |
|---|---|---|
| BLE GATT (typical) | ~5–100 kbps | 1.2 Mbps |
| Bluetooth Classic (A2DP-class) | ~1–2 Mbps | 1.2 Mbps |
| Wi-Fi Direct / Wi-Fi Aware | ~20–250 Mbps | 1.2 Mbps |

BLE is off by 10–100×. Bluetooth Classic is nominally in range but with no
headroom for congestion, retransmits or a second watcher — and neither is
reachable from a browser.

### What Bluetooth is genuinely good for here

**Discovery and pairing, in a native build.** The handshake is small (~2 KB —
we already fit it in a QR code), which BLE can carry comfortably. So the
native design is:

1. Discover the nearby device over BLE (advertise + scan).
2. Exchange the SDP handshake over a GATT characteristic.
3. Carry the **video** over Wi-Fi Direct / Wi-Fi Aware (Android) or
   MultipeerConnectivity's Wi-Fi transport (iOS).

That is precisely what Android **Nearby Connections** (`P2P_CLUSTER` /
`P2P_STAR`) and iOS **MultipeerConnectivity** do internally: Bluetooth for
discovery, Wi-Fi for throughput. Neither is reachable from a browser or from a
plain Capacitor WebView — each needs a native plugin.

**Today, the QR exchange in `/offline` fills exactly this role**, with no
plugin and no platform gatekeeping: it is the pairing channel, done with two
screens and two cameras instead of a radio. It requires the devices to be on a
shared hotspot, which is the trade — BLE pairing would remove that step.

### If we build the native path

Roughly: a Capacitor plugin per platform, wrapping Nearby Connections and
MultipeerConnectivity, exposing "discover / connect / send handshake". The
media path would move off WebRTC to the platform's own transport, which is a
substantial piece of work — the recording and integrity layers stay unchanged.
Tracked as use case 05 (planned) in the in-app guide and §2 of FEASIBILITY.

---

## 3. Browser support

The app is a normal web app; the constraints come from what browsers allow.

| Capability | Chrome/Edge (Android, desktop) | Safari (iOS 16.4+, macOS) | Firefox |
|---|---|---|---|
| WebRTC media | yes | yes | yes |
| Camera/mic (`getUserMedia`) | yes | yes | yes |
| **Secure context required** | yes | yes | yes |
| Install as PWA | yes | yes (Add to Home Screen) | limited |
| Service worker / offline shell | yes | yes | yes |
| Screen Wake Lock | yes | 16.4+ | recent |
| OPFS recording storage | yes | 15.2+ | recent |
| `BarcodeDetector` (QR) | yes | no → jsQR fallback | no → jsQR fallback |
| Web Bluetooth | yes (not usable here, see §2) | **no** | **no** |
| Background capture when hidden | **no** | **no** | **no** |

### The two that bite

**Secure context.** Camera access requires `https://` or `localhost`. A plain
`http://192.168.x.x` LAN address will render the UI and then refuse the camera,
which looks like a broken app. For testing use an HTTPS tunnel or the APK; for
the offline-hotspot case, install the PWA/APK **while still online** so it runs
from a secure origin afterwards.

**Backgrounding.** No browser will keep capturing when the page is hidden or
the screen is locked; timers are throttled and capture is suspended. The wake
lock prevents *idle* lock only — it cannot survive a power-button press.
Observed again in this round's testing: a backgrounded tab had its transport
starved and the connection dropped. Only a native build with a foreground
service can film with the screen off.

---

## 4. Practical guidance

**Before you go somewhere it matters**
- Install the app (PWA or APK) while you still have internet.
- Open the debug panel and check relay health — public relays rot in weeks.
- Decide the roles: who films, who watches, who keeps the home archive.
- If you expect the network to be cut, rehearse the `/offline` QR pairing once.

**At the scene, network usable**
- Normal room code / QR. Watchers each keep their own signed copy.

**At the scene, network cut or jammed**
- One phone shares a hotspot; the others join it.
- Use `/offline` and swap the two QR codes.
- Expect one link per exchange.

**What still cannot be done**
- Reach someone on a different network with no internet on either side.
- Film with the screen off in a browser.
- Use Bluetooth for anything, today.
