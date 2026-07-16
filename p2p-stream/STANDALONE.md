# Standalone / Offline Usage Guide

Due to browser security restrictions, **WebRTC and Camera require HTTPS or localhost** - they don't work with `file://` protocol (opening HTML directly from Downloads).

However, you can still use this app in offline/emergency scenarios with these workarounds:

## Option 1: Single File Distribution (Easiest)

Build a standalone HTML file with everything inlined:

```bash
npm run build:standalone
```

This creates `dist/p2p-stream-standalone.html` (~330 KB).

### How to use on phones:

#### A) AirDrop/Transfer to a friend with WiFi Hotspot
1. Person A creates a WiFi hotspot on their phone
2. Person B (with hotspot access) opens the standalone HTML file using a **File Server app**:
   - **iOS**: "Documents by Readdle", "File Hub", or "Caddy" (free file server)
   - **Android**: "File Manager +", "MiXplorer", or "Simple HTTP Server"
3. Person B shares the local URL (e.g., `http://192.168.1.5:8080`) with Person A
4. Both can now stream!

#### B) Transfer to a laptop
1. Put the HTML file on a laptop
2. Run a quick server:
   ```bash
   # If you have Node.js
   npx serve -s . -p 4400
   
   # Or Python
   python3 -m http.server 4400
   
   # Or PHP
   php -S localhost:4400
   ```
3. Connect phones to laptop's WiFi hotspot
4. Open `http://laptop-ip:4400/p2p-stream-standalone.html`

#### C) Use ngrok for quick sharing
```bash
# Install ngrok
npm install -g ngrok

# Serve the file
npx serve -s dist -p 4400

# In another terminal, expose via HTTPS
ngrok http 4400
```
Share the ngrok HTTPS URL.

---

## Option 2: Bluetooth Transfer (Limited)

Unfortunately, **Web Bluetooth** doesn't support file transfers or WebRTC signaling. But you can:

1. Use native Bluetooth file sharing to transfer the standalone HTML
2. Recipient opens it via a file server app (see Option 1)

---

## Option 3: WiFi Direct (Android Only)

Some Android devices support WiFi Direct which works without internet:

1. Enable WiFi Direct in Android Settings
2. Connect devices directly
3. Use a file server app to serve the HTML
4. Access via local IP

---

## Option 4: Portable Router / Offline Network

For protests/events, bring a small portable WiFi router (no internet needed):

1. Set up router with a simple password
2. All participants connect to the same WiFi
3. One person serves the HTML file
4. Everyone accesses via local network

---

## Why `file://` Doesn't Work

Browsers block these APIs on `file://` protocol:

| Feature | Requires |
|---------|----------|
| Camera (`getUserMedia`) | HTTPS or localhost |
| WebRTC | HTTPS or localhost |
| Service Worker | HTTPS or localhost |
| OPFS (file storage) | Works on file:// |

This is a security feature to prevent malicious websites from accessing your camera without permission.

---

## Recommended Emergency Workflow

### Scenario: Phone confiscation risk

**Before the event:**
1. Build standalone file: `npm run build:standalone`
2. Distribute to all participants via Signal/Wire beforehand
3. Everyone installs a file server app

**At the event:**
1. One person enables WiFi hotspot
2. Others connect and serve the file locally
3. Streamer starts broadcast
4. Collectors join via local network

**If internet is blocked:**
- The WiFi hotspot doesn't need internet
- Trystero's BitTorrent DHT works over local network
- Nostr can use offline relays

---

## Technical Limitations

We cannot bypass these browser restrictions:
- ❌ Open from Downloads and use camera
- ❌ Pure P2P without any network (Bluetooth LE bandwidth is too low for video)
- ❌ WebRTC over Bluetooth

But these workarounds enable practical offline usage:
- ✅ Local WiFi hotspot (no internet needed)
- ✅ Portable router
- ✅ File server apps
- ✅ Laptop as hub
