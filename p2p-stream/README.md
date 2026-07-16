# P2P Emergency Stream

Censorship-resistant peer-to-peer live streaming application for emergency evidence preservation.

## Overview

This application enables activists and citizen journalists to stream live video directly to multiple collectors (witnesses) who simultaneously record the content locally. Even if the streamer's phone is confiscated, the video evidence is already preserved on collectors' devices.

## Features

- 🔒 **End-to-End Encryption**: WebRTC's native DTLS/SRTP encryption
- 📡 **Peer-to-Peer**: No central media servers; video flows directly between peers
- 💾 **Instant Recording**: 1-second chunks saved immediately to local storage
- 📱 **PWA**: Works offline after first load; installable on mobile
- 🌐 **Censorship Resistant**: Multiple signaling fallbacks (WebSocket, QR code, libp2p)
- 🚀 **Zero Infrastructure**: Can work entirely without servers using QR code exchange

## Quick Start

### Prerequisites

- Node.js 18+
- Modern browser with WebRTC support (Chrome, Firefox, Safari, Edge)

### Installation

```bash
# Clone repository
git clone <repo-url>
cd p2p-stream

# Install client dependencies
npm install

# Install server dependencies (optional, for signaling)
cd server && npm install && cd ..
```

### Development

```bash
# Terminal 1: Start signaling server (optional)
cd server && npm run dev

# Terminal 2: Start client
npm run dev
```

Open http://localhost:3000 in your browser.

### Production Build

```bash
npm run build
```

## Architecture

### Network Topology

```
Streamer → Primary Collectors (2-3) → Secondary Collectors (2-4 each)
```

- Streamer uploads to 2-3 primary collectors
- Each primary forwards to 2-4 secondary collectors
- Scales to 10+ collectors with manageable bandwidth

### Data Flow

1. Streamer starts camera and creates campaign
2. Collectors join via QR code or campaign ID
3. WebRTC peer connections established
4. Video streamed P2P to collectors
5. Collectors record in 1-second chunks to OPFS
6. If streamer is disconnected, recordings remain on collectors

### Storage

- **OPFS (Origin Private File System)**: Stores video chunks
- **IndexedDB**: Recording metadata
- **SQLite WASM** (future): Chunk indexing and queries

## Project Structure

```
p2p-stream/
├── src/
│   ├── components/      # Vue components
│   ├── composables/     # Reusable composition functions
│   ├── stores/          # Pinia stores
│   ├── types/           # TypeScript types
│   ├── views/           # Page components
│   ├── App.vue          # Root component
│   └── main.ts          # Entry point
├── server/              # Signaling server
├── public/              # Static assets
├── index.html
├── package.json
├── vite.config.ts
└── README.md
```

## Usage

### As a Streamer

1. Open the app and tap "Start Streaming"
2. Allow camera access
3. Share the QR code or campaign ID with collectors
4. Streaming starts automatically when collectors join
5. Tap "Stop Streaming" when done

### As a Collector

1. Open the app and tap "Collect Stream"
2. Scan the streamer's QR code or enter campaign ID
3. Recording starts automatically
4. Video is saved locally in real-time
5. Tap "Leave & Save" when done

### Exporting Recordings

1. Go to "Recordings" tab
2. Tap play to preview
3. Tap download to save to device

## Censorship Resistance

### Deployment Strategies

1. **GitHub Pages**: Primary deployment
2. **IPFS**: Content-addressed, distributed hosting
3. **Single-file HTML**: Emergency distribution via messaging apps
4. **Netlify/Vercel**: Additional mirrors

### Signaling Fallbacks

1. **WebSocket Server**: Primary (can be self-hosted)
2. **libp2p DHT**: Decentralized discovery
3. **QR Code Exchange**: Serverless, manual SDP exchange
4. **Pastebin**: Encrypted SDP via pastebin services

## Security Considerations

- Video is encrypted in transit via WebRTC DTLS/SRTP
- No persistent logs on signaling server
- No user accounts or PII required
- Storage is origin-isolated (same-origin policy)

## Browser Support

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| WebRTC | ✅ | ✅ | ✅ | ✅ |
| MediaRecorder | ✅ | ✅ | ✅ | ✅ |
| OPFS | ✅ | ✅ | ✅ | ✅ |
| PWA | ✅ | ✅ | ✅ | ✅ |

## Roadmap

### Phase 1: Foundation ✅
- [x] Vue 3 + TypeScript setup
- [x] Camera access and preview
- [x] Basic WebRTC peer connection
- [x] MediaRecorder with chunked recording
- [x] OPFS storage
- [x] Simple signaling server

### Phase 2: Multi-Peer (In Progress)
- [ ] Hierarchical relay topology
- [ ] Primary/secondary collector roles
- [ ] Video forwarding
- [ ] Connection quality monitoring

### Phase 3: Campaign Management
- [ ] Campaign creation/joining
- [ ] QR code generation
- [ ] Campaign state synchronization
- [ ] Peer discovery

### Phase 4: Censorship Resistance
- [ ] libp2p fallback
- [ ] QR code SDP exchange
- [ ] Multi-domain deployment
- [ ] Single-file build

### Phase 5: Production
- [ ] Security audit
- [ ] Mobile optimization
- [ ] Comprehensive testing
- [ ] Documentation

## Contributing

Contributions are welcome! Please read our contributing guidelines and submit PRs.

## License

MIT License - See LICENSE file

## Disclaimer

This tool is designed for citizen journalism and evidence preservation. Users are responsible for complying with local laws. Always prioritize personal safety.

## Acknowledgments

- WebRTC community
- Vue.js team
- IPFS/libp2p team
- All contributors and testers
