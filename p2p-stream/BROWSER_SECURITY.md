# Browser Security & File Protocol

## The Short Answer

**No, you cannot reliably use camera or WebRTC by opening an HTML file directly from Downloads (file:// protocol).**

This is a deliberate browser security feature, not a bug in our code.

---

## What Works and What Doesn't

| Feature | `file://` (Downloads) | `http://localhost` | `https://` |
|---------|----------------------|-------------------|------------|
| **Camera (getUserMedia)** | ❌ Blocked on iOS Safari<br>⚠️ Sometimes works on Chrome<br>❌ Blocked on Firefox | ✅ Works | ✅ Works |
| **WebRTC (RTCPeerConnection)** | ❌ Blocked - requires secure context | ✅ Works | ✅ Works |
| **WebRTC DataChannel** | ❌ Blocked | ✅ Works | ✅ Works |
| **OPFS (file storage)** | ✅ Works | ✅ Works | ✅ Works |
| **IndexedDB** | ✅ Works | ✅ Works | ✅ Works |

---

## Why This Restriction Exists

### The "Secure Context" Requirement

Browsers define a "secure context" as:
- `https://` URLs
- `http://localhost` or `http://127.0.0.1`
- `file://` is **explicitly excluded** from secure contexts for most APIs

### Why?

Imagine if any HTML file you downloaded could:
1. Access your camera without permission
2. Open P2P connections to arbitrary servers
3. Bypass normal security checks

Malicious websites could trick you into downloading an HTML file that spies on you.

---

## Test It Yourself

I've created two test files:

### 1. `test-camera-inline.html`
A minimal camera test with everything inline.

**Try this:**
1. Download the file to your phone
2. Open it from Downloads
3. Click "Test Camera"

**On iOS Safari:** Will fail with "getUserMedia is undefined"  
**On Chrome Android:** Might work in some versions  
**On Firefox:** Will fail

### 2. `test-webrtc-inline.html`
Tests both camera and WebRTC.

**Try this:**
1. Download and open the file
2. Click "Test Camera" - may or may not work
3. Click "Test WebRTC" - will likely fail on connection

---

## Workarounds That Actually Work

Since browsers won't let us use `file://`, here are practical workarounds:

### Option 1: Use a File Server App (Recommended)

**iOS:**
1. Install "Documents by Readdle" (free)
2. Transfer the HTML file to the app
3. Enable its built-in WiFi sharing
4. Open the provided URL (e.g., `http://192.168.1.5:8080`)

**Android:**
1. Install "MiXplorer" or "Simple HTTP Server"
2. Select the HTML file → "Share" → "HTTP Server"
3. Open the URL in any browser

### Option 2: Python One-Liner

If you have Python on any device:

```bash
# In the folder with your HTML file
python3 -m http.server 8080

# Or on Windows
python -m http.server 8080
```

Then open `http://device-ip:8080` on phones.

### Option 3: Node.js serve

```bash
npx serve -s . -p 8080
```

### Option 4: ngrok (for internet sharing)

```bash
# Expose your local server to internet
ngrok http 8080

# Share the https://xxx.ngrok.io URL
```

---

## The Fundamental Problem

We need WebRTC for P2P streaming. WebRTC requires:
1. A secure context (HTTPS or localhost)
2. ICE servers for NAT traversal (STUN/TURN)
3. Signaling to establish the connection

**None of these work reliably with `file://`.**

### Why Not Just Use HTTP Instead of WebRTC?

- HTTP requires a server
- The whole point of this app is **serverless P2P**
- HTTP doesn't give us the real-time streaming we need

---

## What About "Isolated Web Apps" or New APIs?

There are some experimental approaches:

### 1. **Isolated Web Apps** (Chrome only, experimental)
- Requires special packaging
- Not available on mobile
- Not practical for emergency use

### 2. **Trusted Web Activities** (Android only)
- Requires Android app wrapper
- Defeats the purpose of a web app

### 3. **File System Access API**
- Only works on `file://` for reading
- Still requires HTTPS for camera

### 4. **WebTransport or WebSocket over Bluetooth**
- Not supported for video streaming
- Bandwidth too low

---

## Our Recommended Emergency Workflow

### Before the Event
1. Build the standalone file: `npm run build:standalone`
2. Distribute to everyone via Signal/Wire
3. Everyone installs a file server app

### At the Event
1. **No internet needed!**
2. One person creates a WiFi hotspot (no internet required)
3. Others connect to that hotspot
4. One person serves the HTML file using their file server app
5. Everyone opens the local URL (e.g., `http://192.168.1.5:8080`)
6. Now camera and WebRTC work!

### Why This Works
- The file server app serves via `http://` (local network)
- Local network IPs are treated as secure enough for WebRTC
- No internet required
- No external servers

---

## Summary

| Question | Answer |
|----------|--------|
| Can I open the HTML from Downloads? | Yes, but camera won't work |
| Can I use it completely offline? | Yes, with a file server app or hotspot |
| Can I avoid installing anything? | No, you need some way to serve the file |
| Is this a bug in your code? | No, it's a browser security feature |
| Will future browsers change this? | Unlikely - it's a fundamental security model |

---

## Technical References

- [Secure Contexts - MDN](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)
- [WebRTC Security](https://webrtc-security.github.io/)
- [getUserMedia Permissions](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#privacy_and_security)
