# P2P Emergency Stream - Quick Start Guide

## 🎯 Working Prototype Status

This is a functional P2P live streaming application with the following capabilities:

### ✅ Implemented Features

1. **PWA Setup**
   - Installable as mobile app
   - Works offline after first load
   - Service worker for caching

2. **Camera & Media**
   - Front/back camera selection
   - Quality settings (240p - 720p)
   - Audio/video toggle

3. **WebRTC Peer-to-Peer**
   - Direct browser-to-browser video streaming
   - Multiple peer connections (streamer → collectors)
   - ICE/STUN for NAT traversal

4. **Signaling Server**
   - WebSocket-based peer discovery
   - Campaign creation/joining
   - SDP offer/answer exchange

5. **Recording (Critical for Confiscation Protection)**
   - 1-second chunked recording
   - Immediate persistence to OPFS
   - Recording playback and download

6. **QR Code Integration**
   - QR generation for campaign sharing
   - QR scanner for joining streams

## 🚀 Running the Application

### Step 1: Start the Signaling Server

```bash
cd p2p-stream/server
npm start
```

Server runs on `ws://localhost:3001`

### Step 2: Start the Client (Terminal 1 - Streamer)

```bash
cd p2p-stream
npm run dev
```

Open http://localhost:3000 in your browser

### Step 3: Start Another Client (Terminal 2 - Collector)

Open another browser window/tab to http://localhost:3000

## 📱 Using the App

### As a Streamer:

1. Click **"Stream"** tab
2. Select camera and quality
3. Click **"Start Streaming"**
4. Share the QR code or Campaign ID with collectors
5. Wait for collectors to connect
6. Click **"Stop Streaming"** when done

### As a Collector:

1. Click **"Collect"** tab
2. Scan the QR code or enter Campaign ID
3. Recording starts automatically
4. Watch the live stream
5. Click **"Leave & Save"** when done
6. Go to **"Recordings"** tab to download

## 🔧 Architecture

```
Streamer (Browser A)
  ├─ Camera captures video
  ├─ MediaRecorder creates 1-second chunks
  ├─ WebRTC streams to Collectors
  └─ Signaling Server helps establish connection

Collector (Browser B, C, D...)
  ├─ Connects via WebRTC
  ├─ Receives video stream
  ├─ Records to OPFS (chunked)
  └─ Can download complete recording
```

## 📁 Key Files

| File | Purpose |
|------|---------|
| `src/views/StreamView.vue` | Streamer interface |
| `src/views/CollectView.vue` | Collector interface |
| `src/composables/useWebRTC.ts` | WebRTC peer management |
| `src/utils/signaling.ts` | WebSocket signaling client |
| `src/composables/useOPFS.ts` | File system storage |
| `server/index.js` | Signaling server |

## ⚠️ Known Limitations

1. **TypeScript Errors**: Some type warnings exist but don't affect runtime
2. **Single File**: Currently creates separate chunks, not combined file
3. **No TURN Server**: May fail on strict NATs (corporate networks)
4. **No Multi-Hop**: Direct P2P only (no forwarding yet)

## 🔒 Security Notes

- Video is encrypted via WebRTC DTLS/SRTP
- No central media server sees your content
- Recordings stored locally only
- OPFS is origin-isolated (other sites can't access)

## 🛠️ Next Steps for Production

1. Add TURN servers for strict NAT traversal
2. Implement hierarchical forwarding (primary → secondary collectors)
3. Combine chunks into single downloadable file
4. Add encryption at rest option
5. Implement QR-code-only mode (no signaling server)
6. Add libp2p fallback for censorship resistance

## 📊 Bundle Size

- JS: ~410 KB (gzipped: ~143 KB)
- CSS: ~19 KB (gzipped: ~4 KB)
- Total: ~430 KB

## 🧪 Testing Checklist

- [ ] Camera starts on Stream page
- [ ] QR code generates
- [ ] Collector can scan QR
- [ ] Peer connection established
- [ ] Video flows between browsers
- [ ] Recording indicator shows
- [ ] Chunks are saved
- [ ] Recording can be downloaded
- [ ] Works on mobile browsers

## 🐛 Troubleshooting

**Camera not working:**
- Ensure HTTPS or localhost
- Check browser permissions
- Try different camera

**Peer not connecting:**
- Check signaling server is running
- Verify both on same network (for testing)
- Check firewall settings

**Recording not saving:**
- Check browser storage permissions
- Verify OPFS is supported (modern browsers)
- Check available storage space

## 📄 License

MIT - See LICENSE file
