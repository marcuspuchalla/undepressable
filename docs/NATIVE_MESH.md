# Native proximity mesh — design (not built yet)

What a native build could add beyond the web app's off-grid features, and how,
without giving up what the web version already guarantees. Nothing here is
implemented: it needs real phones to build and test, which the web-only test
setup cannot provide. Read [`OFFLINE_AND_PROXIMITY.md`](OFFLINE_AND_PROXIMITY.md)
first for what works today.

## What the web app already does off-grid

| Need | Web app today |
|---|---|
| Introduce two devices with no internet | Code exchange (QR or text over AirDrop / Quick Share / Bluetooth share) |
| Carry live video between them | WebRTC over a shared hotspot or Wi-Fi, host candidates only |
| Reach people out of the filming phone's range | Viewers **share onward**: chains A → B → C, each hop paired by code |
| Get footage to a safe place | Evidence files through the OS share sheet (which itself uses Bluetooth / peer-to-peer Wi-Fi); face-to-face **hand-over** over the pairing link; store-and-forward to the home archive once online |
| Trust what arrives | Every chunk re-hashed against the signed Merkle proof on arrival |

The two things a browser cannot do: **find nearby devices by itself** and
**connect them without a shared network**. Both are what a native layer would add.

## Building blocks per platform

| | Discovery | Bulk link without a shared network | Gives WebRTC an IP network? |
|---|---|---|---|
| Android | BLE advertise/scan | Wi-Fi Direct group (all devices), Wi-Fi Aware (some devices, API 26+) | **Yes** — a Wi-Fi Direct group is an ordinary IP subnet (192.168.49.0/24) |
| iOS | CoreBluetooth, MultipeerConnectivity | Peer-to-peer Wi-Fi (AWDL) via MultipeerConnectivity or Network.framework | Unclear — WebRTC in WKWebView is not known to gather AWDL interfaces; needs a spike |
| iPhone ↔ Android | BLE (both can advertise and scan) | **None in common** (AWDL vs Wi-Fi Direct) | Only via a hotspot, as today |

Google's Nearby Connections would cover Android discovery and transport in one
API, but it ships in Play Services — unavailable on de-Googled phones and
blocked for F-Droid ([`ANDROID_FDROID.md`](ANDROID_FDROID.md)). Use the
platform APIs directly.

## Design

1. **Pairing channel: BLE instead of scanning codes.** A Capacitor plugin
   advertises and scans for a service. The existing compact handshake
   (~100 characters, `compactSignal.ts`) fits in two GATT writes, so the
   offline flow stays the same — the codes just travel by radio instead of by
   camera. Advertise only while the pairing screen is open, and derive the
   advertised service data from a group secret (like the home-archive key)
   that rotates: a constant app UUID broadcast at a protest identifies
   everyone carrying the app.
2. **Video link, Android: Wi-Fi Direct.** The plugin forms (or joins) a Wi-Fi
   Direct group, then hands over to the unchanged WebRTC offline path: the
   group is a real IP network, so host candidates connect. This removes the
   "turn on a hotspot" step without touching media, recording or integrity code.
3. **Video link, iOS:** first spike whether WKWebView's WebRTC connects over
   AWDL. If not, carry the handshake over MultipeerConnectivity and keep the
   hotspot requirement for video — do not build a second media stack.
4. **Store-and-forward mesh for recordings.** The hand-over protocol
   (`lib/transfer/syncProtocol.ts`) only needs something that moves bytes
   (`SyncWire`). Over a BLE/Wi-Fi Direct channel, every device can offer its
   signed recordings to every device it meets; receivers verify before
   storing; recordings spread device to device (deduplicated by id and Merkle
   root) until one carrier reaches the internet and the paired home archive.
   Needed on top: per-recording opt-in ("let this spread"), storage caps, and
   an expiry, so a phone never silently fills up with strangers' footage.
5. **Background:** filming with the screen off needs a foreground service
   (Android, type `camera`/`connectedDevice`) — the one capability no browser offers.

## Permissions this adds

Android 12+: `BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT`;
Android 13+: `NEARBY_WIFI_DEVICES` (declared `neverForLocation`). iOS:
`NSBluetoothAlwaysUsageDescription`; `NSLocalNetworkUsageDescription` and
`NSBonjourServices` (the first is already declared).

## Testing it

Needs at least two Android phones (one with Wi-Fi Aware), two iPhones, and
one mixed pair; add the flows to [`ON_DEVICE_TESTING.md`](ON_DEVICE_TESTING.md).
The existing E2E suite keeps covering everything above the transport, since
the hand-over protocol and the offline WebRTC path stay the same.
