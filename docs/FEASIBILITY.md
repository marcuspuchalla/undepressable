# Feasibility study — distribution, Bluetooth, hotspot, relay-to-home

_Analysis only (nothing here is implemented yet). Researched 2026-07 with sources; on-device verification still needed for the items marked UNCERTAIN._

## TL;DR

| Question | Verdict |
|----------|---------|
| iOS + Android release | Possible. **Android is the resilient primary** (APK/F-Droid sideloading); iOS is the fragile secondary (Apple can pull it, sideloading is capped/geofenced). |
| macOS / Linux / Windows desktop | **Basically already there** — the repo has a Tauri v2 shell; just needs build/signing polish. |
| Bluetooth-only fallback when Wi-Fi is jammed | **Not with Bluetooth alone** (too slow for video) and **not from the web layer at all**. Achievable only in a *native* build via Nearby Connections (Android) / MultipeerConnectivity (iOS), which use Bluetooth for discovery and peer **Wi-Fi** for the actual video. |
| Phone on internet *and* sharing hotspot to nearby friends | **Yes** (normal tethering). Local stream survives the uplink dropping — **reliably on Android, with real iOS 18 caveats**. |
| Friend's phone → their home PC archive (seizure-proof) | **Yes, and mostly already possible today** with the current WebRTC stack — no new platform needed. |

---

## 1. App stores & desktop

### Desktop (macOS / Linux / Windows) — the easy win
The project already ships a **Tauri v2** shell (`src-tauri/`). Tauri 2.0 (stable Oct 2024) builds all three desktops from the existing web code. This is the lowest-effort, highest-certainty target: it mostly needs icons, code-signing, and CI. Tauri uses the OS WebView, and desktop WebViews fully support our WebRTC + WebSocket + OPFS stack.

### Android — the resilient primary
- Ship as a **Trusted Web Activity** (PWABuilder/Bubblewrap) or a Capacitor app. Play is comparatively permissive about webview-backed apps.
- The decisive advantage is **sideloading**: a signed **APK** can be self-hosted, mirrored, torrented, or handed peer-to-peer, and **F-Droid** (reproducible builds, privacy audience) is a natural fallback channel. If Google pulls the app, distribution continues. This directly serves the threat model.
- Caveat (native builds): camera/`getUserMedia` in the **Android System WebView** needs deliberate native wiring — the OS permission grant doesn't auto-flow to the WebView (`onPermissionRequest`), `MODIFY_AUDIO_SETTINGS` is required for mic, and the `tauri.localhost` origin must be in the CSP or media is silently blocked. Capacitor handles this more out-of-the-box than Tauri-mobile today.

### iOS — works, but structurally fragile for this use case
- **Technically fine:** WKWebView supports `getUserMedia`/WebRTC since iOS 14.3, plus WebSocket; OPFS is *probably* fine on iOS 17/18 but flaky historically — **keep the IndexedDB fallback** (UNCERTAIN).
- **Policy risk:** App Store **Guideline 4.2** (minimum functionality) actively rejects thin webview wrappers; a live-camera P2P app is more defensible than a content wrapper, but a censorship-resistant UGC streaming tool also invites content-moderation scrutiny. Expect review friction.
- **Distribution is the real problem:** if Apple pulls it, the escape hatches are weak — AltStore Classic caps you at **3 sideloaded apps** with **7-day certificate expiry**; AltStore PAL / DMA marketplaces are **geofenced to the EU/Japan/Brazil**; TestFlight is invite-only, 90-day-expiry, reviewable and throttleable. **Treat iOS as the first thing you lose under pressure.**

### Recommendation
- **Now:** polish the **Tauri desktop** build (macOS + Linux + Windows).
- **Primary mobile:** **Android** via TWA/Capacitor + a downloadable **APK** and F-Droid listing.
- **Secondary mobile:** iOS via **Capacitor** (more proven for WebRTC camera than Tauri-mobile), accepting it's the least durable channel.
- Keep Tauri for desktop; evaluate **Capacitor** specifically for the mobile camera builds rather than forcing one tool everywhere.

---

## 2. Bluetooth fallback ("they jam the Wi-Fi, you only have Bluetooth")

**Short answer: not the way it sounds, but a real version exists — in a native app.**

- **Web Bluetooth is a dead end here.** iOS Safari doesn't implement it at all (no version); Firefox and desktop Safari don't either; only Chromium has it. And BLE throughput is ~**0.8–1.4 Mbps** best-case (halved by ack-per-message designs) — fine for text/telemetry, **not live video**. Bluetooth *alone* cannot carry a camera feed on any platform.
- **The real "no Wi-Fi router, no internet" video path is native local-mesh:**
  - **Android — Nearby Connections API** (with Wi-Fi Aware / Wi-Fi Direct): uses **Bluetooth for discovery** then **auto-upgrades to peer Wi-Fi** for bandwidth, transparently. It has a **STREAM** payload type built for continuous media, works fully offline with no access point, and reaches Wi-Fi-class speeds (tens of Mbps) — **enough for live video**.
  - **iOS — MultipeerConnectivity**: auto-selects infrastructure Wi-Fi / **peer-to-peer Wi-Fi** / Bluetooth; the video rides peer-to-peer Wi-Fi. Note **Bluetooth-as-transport was disabled since iOS 11** — BT only assists discovery, so "Wi-Fi fully dead, Bluetooth only" gives you **no** video pipe on iOS.
- **Hard constraints:** these APIs are **native-only** (invisible to our WebView/JS), they **don't interoperate** across Android↔iOS, and they'd need a per-platform plugin bolted onto the app. This is the single biggest architectural item — it sits *outside* the current PWA/WebRTC design.

**Verdict:** Feasible as "pair over Bluetooth, stream over device-to-device Wi-Fi" in a native build (Android strongest), a substantial effort, and only in the native app — this is exactly why use-case #05 in the in-app guide is labelled **PLANNED (native app)**. Pure-Bluetooth video: not feasible.

---

## 3. Phone on internet *and* hosting a hotspot for nearby friends

**Yes — this is standard tethering, and the local stream can survive your uplink dropping. The nuance is iOS.**

- Host uses cellular for internet and shares it over Wi-Fi to nearby friends (normal Personal Hotspot). Friends on the hotspot are on a **local subnet with the host**, so **host → friends** WebRTC works locally.
- **If your internet dies, the local Wi-Fi link doesn't** — so the stream between you and the people on your hotspot keeps going. To make this bulletproof from the start (internet down *before* you connect), pair with the **QR/offline signaling** path (the same trick as the sibling "hotel mode") so no server is ever needed.
- **iOS 18 caveat (important):** since iOS 18.0, Personal Hotspot hands every client the **same IP (`192.0.0.2`)**, breaks multicast, and blocks **client-to-client** IPv4 — effective client isolation. **Host→client still works**, but **friend↔friend** on an iPhone hotspot is unreliable. Apple's stated intent: hotspot is for reaching the internet, not a local API. **Android hotspots are friendlier** (clients generally reach each other), though some OEMs add an isolation toggle.
- **Wi-Fi-for-internet + Wi-Fi-hotspot at the same time:** possible on capable **Android** hardware (STA/AP concurrency, Android 12+, dual-band hotspot arriving ~late 2025); **not a supported iOS capability** (iOS hotspot assumes a cellular uplink).

**Design implication:** the "friends behind me on my hotspot" case works best when **you are the hotspot host and stream outward to them** (host→client), which is exactly the demonstration scenario. Don't rely on friend↔friend links over an iPhone hotspot.

---

## 4. Friend's phone → their home PC (so a seized phone doesn't lose the footage)

**Yes — and this is largely possible with the stack we already have.** Two designs:

- **Simplest (works today): home PC as an always-on collector.** A trusted home computer just opens the app (or a headless build) and **joins the same room**; it receives and records the stream independently. If a phone at the scene is seized, the home machine already has a full, signed copy. No relay through the phone needed — as long as the home PC has its own internet, it's just another recorder. This is use-case #04 in the guide and needs only a small "archive mode / auto-join" affordance.
- **True forwarding (small addition): phone relays to home.** If the home node *can't* reach the room directly, the friend's phone re-broadcasts the received stream to a second peer (their home node) — the WebRTC track-forwarding pattern already prototyped in the sibling camCut project. This is the "cascading relay / super-collector" topology in `PROJECT_PLAN.md`. Moderate effort; mainly reconnection/robustness work.

**Recommendation:** ship **archive-mode (home PC auto-joins + records)** first — high value, low effort — and treat phone→home forwarding as a follow-up for the constrained-network case.

---

## Suggested roadmap (if/when you build these)

1. **Desktop release** (Tauri, macOS/Linux/Windows) — mostly packaging. _Low effort._
2. **Android release** — TWA/Capacitor + downloadable APK + F-Droid. _Medium._
3. **Archive mode** — a device (home PC) that auto-joins a room and records, seizure-proofing the footage. _Low–medium, pure web._
4. **QR/offline local signaling** — bulletproof the hotspot case with no server. _Medium, pure web._
5. **iOS release** (Capacitor) — accept fragility. _Medium._
6. **Native off-grid mesh** (Android Nearby Connections first) — the real "Wi-Fi jammed" fallback. _High effort, native plugins._

The first four are all achievable on the current web/WebRTC foundation. Only #6 requires stepping outside it.
