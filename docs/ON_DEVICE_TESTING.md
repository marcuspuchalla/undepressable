# On-device testing runbook

How to actually run the [`TEST_PLAN.md`](TEST_PLAN.md) scenarios on real phones.
This covers the one thing that blocks naive attempts — **the camera only turns
on in a secure context (HTTPS or localhost)** — and gives you two ready tracks.

## The secure-context rule (read this first)

`getUserMedia` (camera + mic) is refused on plain `http://` origins on phones.
So `http://192.168.1.247:4400` will show the UI but **cannot go live**. Use one
of these instead:

| Track | Secure context? | Best for |
|-------|-----------------|----------|
| **A. HTTPS tunnel** (cloudflared) | ✅ real trusted cert | iPhone + Android web/PWA, any network |
| **B. Native APK** | ✅ WebView is secure | Android camera test with zero setup |

---

## Track A — HTTPS tunnel (works on every phone, incl. iPhone)

This is already running for you. Two background processes:

```bash
# 1. the dev server (LAN + tunnel host allowed)
npm run dev              # → http://localhost:4400

# 2. the tunnel giving a public HTTPS URL
cloudflared tunnel --url http://localhost:4400
```

The tunnel prints a URL like `https://<random>.trycloudflare.com`. Open **that**
on the phones (scan the QR I sent, or type it). The camera will be allowed.

Notes:
- The URL is public but random and ephemeral; it changes every time you restart
  cloudflared. It only serves the app shell — the actual video streams still go
  peer-to-peer, not through the tunnel.
- If you restart cloudflared, re-share the new URL.
- To install as a PWA from the tunnel: iPhone Safari → Share → Add to Home
  Screen; Android Chrome → menu → Install app.

### Restarting the tunnel

```bash
pkill -f "cloudflared tunnel"          # stop
cloudflared tunnel --url http://localhost:4400 &   # start; note the new URL
```

---

## Track B — Native Android APK (fastest camera test)

The debug APK (`undepressable-debug.apk`, sent separately, or build with
`cd android && ./gradlew assembleDebug`) loads from the WebView's local secure
context, so the camera works with **no tunnel and no HTTPS**.

1. On the Android phone: Settings → allow "Install unknown apps" for your file
   manager / browser.
2. Open the APK, install, launch.
3. Grant camera + microphone on the first prompt.
4. Go live — this is the real end-to-end camera path.

For iOS the equivalent is building from Xcode onto a device — see
[`IOS_CAPACITOR.md`](IOS_CAPACITOR.md). Until then, use Track A on iPhone.

---

## Running the scenarios

Map each to [`TEST_PLAN.md`](TEST_PLAN.md). Minimum kit: two phones (A, B); for
the archive scenario also a computer (H).

### 1 & 2 — One-to-one / one-to-many

1. Phone A: open the HTTPS URL → **Go live**, allow camera. Note the code / show the QR.
2. Phone B: open the URL → **Scan & collect** → scan A's QR.
3. Check: B sees A's video and auto-records; A's counter shows `watching 1`.
4. Add more watchers for scenario 2; watch the counters climb; confirm each keeps its own recording.
5. B → **Recordings** → **Verify integrity** → expect **Unaltered**.

### 3 — Personal hotspot (offline)

1. Phone A: turn on Personal Hotspot. Phone B: join A's hotspot Wi-Fi.
2. Both open the app. **For a fully offline test, install the PWA / use the APK first while online**, then go offline — a fresh tunnel load won't work with no internet.
3. A goes live; B scans the QR (works offline).
4. Turn A's mobile data OFF; confirm the stream keeps running.
5. iPhone caveat: if B can't connect, it's iOS hotspot client-isolation — retry with an Android hotspot. (See FEASIBILITY.md.)

### 4 — Home archive (relay to a safe place)

1. Computer H: open the URL → **Set up a home archive**. Leave it open. Note its pairing QR.
2. Phone B (the one going "to the scene"): scan H's pairing QR → **"Home archive paired"**.
3. Phone A goes live; Phone B → Collect → scans A's code.
4. Check: B's bottom bar shows **forwarding ✓**; H shows **"Recording a forwarded stream"** and the video.
5. Stop the stream → H lists it under **Archived this session** and in **Recordings**.

### 5 — Off-grid mesh

Not testable yet (native-only). Skip.

---

## What to record for each run

For every scenario, note: did it connect, how long discovery took, did the
camera work, did recording + integrity pass, and on which OS/browser. Drop the
results into the status column of [`TEST_PLAN.md`](TEST_PLAN.md) so the
platform × scenario matrix fills in.

## Cross-network test (scenario 1 variant)

Put B on cellular (not A's Wi-Fi) and repeat scenario 1. This exercises the
bundled TURN relay for NAT traversal. Expect it to still connect; if a strict
network blocks it, B shows a clear "couldn't reach the stream" state.
