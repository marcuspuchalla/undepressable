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
device shows a short **invite code**; the receiving device reads it and shows
a **reply code** back. After that, everything flows directly across the local
network.

- No server, no relay, no internet at any point.
- **Small codes (~100 characters).** The first connection carries only a data
  channel, which is fully described by the ICE credentials, the DTLS
  fingerprint and the local addresses — packed into a version-6-ish QR code
  that scans instantly (the first version carried a whole media SDP: ~1.7 KB,
  a 137×137-module code). Video is then negotiated over that data channel.
  `src/lib/net/compactSignal.ts`; the old format is still read.
- **Codes also travel as text.** *Copy* / *Send…* on one device, paste on the
  other. AirDrop, Nearby Share, Bluetooth file transfer and most messengers
  work between two devices side by side with no internet — so a laptop with
  no usable camera can pair too. This is the closest the web app gets to
  "Bluetooth pairing" (§2): the phone's own share sheet carries the handshake.
- **Several viewers.** The filming device adds viewers one exchange at a time;
  earlier viewers keep watching. It lists each viewer as connecting /
  connected / couldn't reach / disconnected, and **whether each is recording
  a copy** (a heartbeat over the data channel).
- **Both sides keep a signed copy.** The filming device records its own
  footage too (as online); each viewer records what it receives. A link that
  drops or freezes finalizes the viewer's segment, so it is signed and
  verifiable; the next picture starts a new one.
- **When it cannot connect, it says so** within ~15–20 s, with the causes that
  actually happen: a device still on mobile data, a hotspot that isolates the
  phones that join it (make one of the two devices the hotspot), a VPN
  blocking local traffic, or the iPhone app's Local Network permission (now
  declared in the iOS app, which iOS 14+ requires).
- ICE uses **host candidates only** (`iceServers: []`) — STUN/TURN are
  unreachable offline and would only stall gathering. While a code is being
  produced from a scan, the camera stays on: Safari reveals real local
  addresses (instead of `.local` names a hotspot may not resolve) only during
  an active capture.
- Recordings are hashed, Merkle-rooted and signed exactly as online.

Verified in two to three Chromium instances (`scripts/e2e/scenarios.mjs
offline-two-viewers offline-isolated`): codes of 103 characters; both
viewers playing ~1 s after their reply is read; the filming device showing
"recording a copy" for each; a second viewer added while the first keeps
watching; a reply read 40 s late still connects; with all traffic between the
devices blocked, the filming device reports "couldn't reach them" with tips.

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

**Today, the code exchange in `/offline` fills exactly this role**, with no
plugin and no platform gatekeeping: it is the pairing channel, done with two
screens and two cameras — or with the phone's own share sheet (AirDrop,
Nearby Share), which itself pairs over Bluetooth and peer-to-peer Wi-Fi. It
still requires the devices to be on a shared hotspot for the *video*, which is
the trade — a native Wi-Fi Direct / Aware path would remove that step.

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
- One of the phones taking part shares a hotspot; the others join it.
- Use `/offline`: the filming phone shows a code, each viewer reads it and
  shows a reply. Scan, or send the codes as text (AirDrop / Nearby Share).
- One exchange per viewer; the filming phone can add as many as its uplink
  carries, and sees who is recording.

**What still cannot be done**
- Reach someone on a different network with no internet on either side.
- Film with the screen off in a browser.
- Use Bluetooth for anything, today.
