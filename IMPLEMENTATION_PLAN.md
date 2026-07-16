# P2P Live Streaming for Emergency Evidence Preservation
## Comprehensive Implementation Plan

> **Project Goal**: Create a censorship-resistant, P2P live streaming application that ensures video evidence survives phone confiscation during protests or emergency situations.

---

## ✅ Update: Trystero Migration Complete (2026-01-29)

### What Changed
- **Removed**: Custom WebSocket signaling server (port 4401)
- **Added**: [Trystero](https://github.com/dmotz/trystero) for serverless P2P signaling
- **Strategies**: BitTorrent DHT (primary) + Nostr (fallback)

### Why Trystero
| Aspect | Before (WebSocket) | After (Trystero) |
|--------|-------------------|------------------|
| Infrastructure | Node.js server required | Zero server |
| Censorship | Server can be blocked | Decentralized DHT |
| Deployment | Multi-service setup | Static files only |
| Discovery | Centralized | Distributed P2P |

### Technical Implementation
```typescript
// Serverless room creation via BitTorrent DHT
const room = joinRoom(
  { appId: 'p2p-emergency-stream-v1' },
  campaignId  // Room ID becomes torrent infohash
)

// Automatic WebRTC mesh with stream forwarding
room.addStream(stream, peerId)  // Send to specific peer
room.onPeerStream((stream, peerId) => {  // Receive from peer
  autoRecord(stream)
})
```

### Files Modified
- ✅ `src/composables/useTrystero.ts` - New composable
- ✅ `src/views/StreamView.vue` - Uses Trystero for streaming
- ✅ `src/views/CollectView.vue` - Uses Trystero for collection
- ✅ `src/components/ConnectionStatus.vue` - Updated for Trystero state
- ❌ `server/` - Deleted entire directory
- ❌ `src/utils/signaling.ts` - Deleted
- ❌ `src/composables/useWebRTC.ts` - Deleted
- ❌ `src/stores/webrtc.ts` - Deleted

---

## Executive Summary

Based on extensive research and five internal review rounds, this document presents a viable architecture for a browser-based P2P live streaming system. The system enables activists to stream live video to multiple collectors who simultaneously record the content locally, ensuring evidence preservation even if the streamer's device is confiscated.

### Key Findings from Research

1. **WebRTC is the only viable browser P2P technology** - No alternatives exist for real-time media streaming between browsers
2. **Full mesh topology fails at 4-6 peers** - Upload bandwidth constraints require hierarchical relay topology
3. **IPFS is unsuitable for real-time signaling** - Latency measured in seconds makes it impractical for live streaming coordination
4. **Chunked recording is essential** - MediaRecorder with `timeslice: 1000` provides near-real-time persistence
5. **Multiple bootstrap strategies required** - No single approach works in all censorship scenarios

---

## System Architecture

### 1. Network Topology: Hierarchical Relay with Redundancy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           STREAMER DEVICE                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                      │
│  │ Primary Conn │  │ Primary Conn │  │ Primary Conn │  (2-3 connections)  │
│  │    (PC1)     │  │    (PC2)     │  │    (PC3)     │                      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                      │
└─────────┼─────────────────┼─────────────────┼──────────────────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ PRIMARY COLLECTOR│ │ PRIMARY COLLECTOR│ │ PRIMARY COLLECTOR│
│      (PC1)       │ │      (PC2)       │ │      (PC3)       │
│  ┌───────────┐   │ │  ┌───────────┐   │ │  ┌───────────┐   │
│  │ Records   │   │ │  │ Records   │   │ │  │ Records   │   │
│  │ + Relays  │   │ │  │ + Relays  │   │ │  │ + Relays  │   │
│  └─────┬─────┘   │ │  └─────┬─────┘   │ │  └─────┬─────┘   │
└────────┼─────────┘ └────────┼─────────┘ └────────┼─────────┘
         │                    │                    │
    ┌────┴────┐          ┌────┴────┐          ┌────┴────┐
    ▼         ▼          ▼         ▼          ▼         ▼
┌───────┐ ┌───────┐  ┌───────┐ ┌───────┐  ┌───────┐ ┌───────┐
│ SC1a  │ │ SC1b  │  │ SC2a  │ │ SC2b  │  │ SC3a  │ │ SC3b  │
│(Record│ │(Record│  │(Record│ │(Record│  │(Record│ │(Record│
│ only) │ │ only) │  │ only) │ │ only) │  │ only) │ │ only) │
└───────┘ └───────┘  └───────┘ └───────┘  └───────┘ └───────┘

SECONDARY COLLECTORS (Record Only, No Relay)
```

**Why This Topology:**
- Streamer uploads only 2-3 streams (manageable on mobile)
- Each primary collector handles relay to 2-4 secondary collectors
- Redundancy: If one primary drops, others continue
- Scales to 10+ collectors with reasonable latency

### 2. Data Flow Architecture

```
┌──────────────┐     WebRTC      ┌──────────────────┐
│   Streamer   │◄───────────────►│  Primary Collector│
│              │   MediaStream   │                  │
│ ┌──────────┐ │                 │ ┌──────────────┐ │
│ │ Camera   │ │                 │ │ Display      │ │
│ └────┬─────┘ │                 │ └──────────────┘ │
│ ┌────▼─────┐ │                 │ ┌──────────────┐ │
│ │MediaRec  │ │                 │ │MediaRecorder │ │
│ │(chunked) │ │                 │ │(chunked)     │ │
│ └────┬─────┘ │                 │ └──────┬───────┘ │
│ ┌────▼─────┐ │                 │ ┌──────▼───────┐ │
│ │WebRTC    │◄┼─────────────────┼►│ OPFS Storage │ │
│ │DataChannel│ │   (forward)     │ │ (persistent) │ │
│ └──────────┘ │                 │ └──────────────┘ │
└──────────────┘                 └──────────────────┘
```

### 3. Component Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                        VUE 3 APPLICATION                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   UI Layer  │  │ State Mgmt  │  │    P2P Network Layer    │ │
│  │  (PrimeVue) │  │   (Pinia)   │  │                         │ │
│  └──────┬──────┘  └──────┬──────┘  │  ┌───────────────────┐  │ │
│         │                │         │  │ WebRTC Manager    │  │ │
│         ▼                ▼         │  │ ┌───────────────┐ │  │ │
│  ┌──────────────────────────┐     │  │ │ Peer Connection│ │  │ │
│  │     Campaign Store       │     │  │ │ Manager        │ │  │ │
│  │  ┌────────────────────┐  │     │  │ └───────┬───────┘ │  │ │
│  │  │ Campaign Registry  │  │◄────┼──┤         │         │  │ │
│  │  │ - Streamer info    │  │     │  │  ┌──────▼──────┐  │  │ │
│  │  │ - Collector list   │  │     │  │  │ Signaling   │  │  │ │
│  │  │ - Connection state │  │     │  │  │ Handler     │  │  │ │
│  │  └────────────────────┘  │     │  │  └──────┬──────┘  │  │ │
│  └──────────────────────────┘     │  │         │         │  │ │
│                                   │  │  ┌──────▼──────┐  │  │ │
│  ┌──────────────────────────┐     │  │  │ Media Stream │  │  │ │
│  │    Recording Store       │     │  │  │ Handler     │  │  │ │
│  │  ┌────────────────────┐  │     │  │  │ (chunks)    │  │  │ │
│  │  │ Active Recordings  │  │     │  │  └─────────────┘  │  │ │
│  │  │ - Chunk management │  │◄────┘  └───────────────────┘  │ │
│  │  │ - OPFS interface   │  │                               │ │
│  │  │ - Export functions │  │                               │ │
│  │  └────────────────────┘  │                               │ │
│  └──────────────────────────┘                               │ │
└─────────────────────────────────────────────────────────────┘
```

---

## Technical Stack

### Core Framework
| Component | Technology | Rationale |
|-----------|------------|-----------|
| Framework | Vue 3 + Composition API | Modern, TypeScript-first, excellent PWA support |
| Language | TypeScript 5.x | Type safety for complex P2P logic |
| Styling | Tailwind CSS 3.x | Utility-first, minimal bundle size |
| UI Components | PrimeVue | Accessible, themeable, Vue-native |
| State | Pinia | Official Vue store, devtools support |
| Build | Vite | Fast HMR, optimized builds |

### P2P & Networking
| Component | Technology | Rationale |
|-----------|------------|-----------|
| WebRTC | Native API + simple-peer | Abstraction for cleaner code |
| Signaling | WebSocket (primary) + libp2p (fallback) | Multiple bootstrap strategies |
| Peer Discovery | Custom + libp2p DHT | Redundancy against censorship |
| Connection Mgmt | Custom hierarchy manager | Optimized for our topology |

### Storage & Recording
| Component | Technology | Rationale |
|-----------|------------|-----------|
| Video Recording | MediaRecorder API | Native, chunked recording support |
| File Storage | OPFS (Origin Private File System) | Large files, streaming writes |
| Metadata | IndexedDB | Structured data, queries |
| Database | SQLite WASM (wa-sqlite) | Complex queries, chunk indexing |
| Encryption | Web Crypto API | Native, performant |

### Deployment
| Component | Technology | Rationale |
|-----------|------------|-----------|
| Hosting | Multiple: GitHub Pages, IPFS, Netlify | Censorship resistance |
| PWA | Workbox | Service worker, offline support |
| Updates | Auto-update with manual override | Security + user control |

---

## Implementation Phases

### Phase 1: Foundation (Weeks 1-4)
**Goal**: Basic P2P video streaming between two browsers

**Deliverables:**
1. Vue 3 + TypeScript project setup with PWA configuration
2. Basic UI layout (Streamer view, Collector view)
3. WebRTC peer connection with simple-peer
4. Camera capture and MediaStream display
5. Basic signaling via WebSocket
6. Single-file recording test

**Technical Tasks:**
- [ ] Project scaffolding with Vite
- [ ] PrimeVue + Tailwind integration
- [ ] MediaDevices API integration (getUserMedia)
- [ ] Simple-peer integration for WebRTC
- [ ] Basic signaling server (Node.js + WebSocket)
- [ ] Video element rendering local/remote streams

**Success Criteria:**
- Two browsers can establish P2P connection
- Video flows from streamer to collector
- Collector can view live stream

### Phase 2: Recording & Storage (Weeks 5-7)
**Goal**: Chunked recording with persistent storage

**Deliverables:**
1. MediaRecorder integration with configurable chunks
2. OPFS storage for video chunks
3. SQLite WASM for chunk metadata/indexing
4. Recording playback from storage
5. Export functionality (download recorded video)

**Technical Tasks:**
- [ ] MediaRecorder with timeslice configuration
- [ ] OPFS directory structure for chunks
- [ ] Chunk naming/numbering scheme
- [ ] wa-sqlite integration for metadata
- [ ] Recording playback from chunks
- [ ] Export to downloadable file

**Success Criteria:**
- Stream is recorded in 1-second chunks
- Chunks persist to OPFS immediately
- Can playback recording while streaming
- Can export complete video file

### Phase 3: Multi-Peer & Hierarchy (Weeks 8-11)
**Goal**: Hierarchical relay topology with multiple collectors

**Deliverables:**
1. Role system (Streamer, Primary Collector, Secondary Collector)
2. Connection manager for multiple peers
3. Video forwarding from primary to secondary collectors
4. Network quality monitoring
5. Automatic role promotion/demotion

**Technical Tasks:**
- [ ] Role assignment UI and state management
- [ ] Multi-peer connection management
- [ ] Video forwarding logic (re-stream received video)
- [ ] RTCDataChannel for control messages
- [ ] Connection quality metrics (packet loss, latency)
- [ ] Automatic quality adaptation

**Success Criteria:**
- 1 streamer can connect to 3 primary collectors
- Each primary can forward to 2-4 secondaries
- Total of 10+ collectors receiving stream
- Graceful handling of peer disconnections

### Phase 4: Campaign Management (Weeks 12-14)
**Goal**: Campaign organization and coordination

**Deliverables:**
1. Campaign creation (streamer announces intent)
2. Campaign joining (collectors volunteer)
3. Campaign state synchronization
4. QR code for quick joining
5. Campaign history/storage

**Technical Tasks:**
- [ ] Campaign data model
- [ ] Campaign list/join UI
- [ ] CRDT-based state sync (Yjs)
- [ ] QR code generation/scanning
- [ ] Campaign metadata persistence

**Success Criteria:**
- Streamer can create campaign with description
- Collectors can browse and join campaigns
- Campaign state syncs across all participants
- QR code enables instant joining

### Phase 5: Censorship Resistance (Weeks 15-17)
**Goal**: Multiple deployment and bootstrap strategies

**Deliverables:**
1. Static build for IPFS deployment
2. Single-file HTML emergency build
3. libp2p fallback signaling
4. QR code SDP exchange (serverless)
5. Domain rotation for signaling servers

**Technical Tasks:**
- [ ] IPFS-ready build configuration
- [ ] Single-file build (inline all assets)
- [ ] libp2p WebRTC transport integration
- [ ] QR code-based SDP exchange
- [ ] Multi-domain signaling configuration

**Success Criteria:**
- App works when deployed to IPFS
- Emergency single-file version works
- Can connect without any signaling server (QR only)
- Signaling falls back to available methods

### Phase 6: Polish & Security (Weeks 18-20)
**Goal**: Production readiness and security hardening

**Deliverables:**
1. End-to-end encryption for video
2. Identity verification system
3. Mobile-optimized UI
4. Offline support
5. Comprehensive testing

**Technical Tasks:**
- [ ] WebRTC DTLS/SRTP encryption verification
- [ ] Identity key generation/storage
- [ ] Responsive mobile UI
- [ ] Service worker for offline functionality
- [ ] Unit and integration tests
- [ ] Security audit

**Success Criteria:**
- Video is encrypted in transit
- Mobile experience is smooth
- App works offline after first load
- Security review passed

---

## Data Models

### Campaign
```typescript
interface Campaign {
  id: string;                    // Unique campaign ID
  createdAt: Date;
  streamer: {
    id: string;                  // Public key
    displayName: string;
    connectionInfo: RTCIceInit;  // For direct connection
  };
  status: 'announced' | 'live' | 'ended';
  description: string;
  location?: string;
  estimatedDuration: number;     // minutes
  maxCollectors: number;
  collectors: Collector[];
  hierarchy: {
    primarySlots: number;        // Usually 2-3
    secondarySlotsPerPrimary: number; // Usually 2-4
  };
}

interface Collector {
  id: string;                    // Public key
  displayName: string;
  role: 'primary' | 'secondary';
  assignedPrimary?: string;      // If secondary, which primary
  connectionState: 'connecting' | 'connected' | 'disconnected';
  joinedAt: Date;
}
```

### Recording
```typescript
interface Recording {
  id: string;
  campaignId: string;
  recordedBy: string;            // Collector ID
  startedAt: Date;
  endedAt?: Date;
  status: 'recording' | 'completed' | 'interrupted';
  chunks: Chunk[];
  metadata: {
    resolution: { width: number; height: number };
    bitrate: number;
    codec: string;
  };
}

interface Chunk {
  index: number;
  timestamp: Date;
  duration: number;              // milliseconds
  size: number;                  // bytes
  opfsPath: string;              // File path in OPFS
  checksum: string;              // SHA-256 for integrity
}
```

### Peer Connection State
```typescript
interface PeerConnection {
  peerId: string;
  role: 'streamer' | 'primary' | 'secondary';
  connection: RTCPeerConnection;
  dataChannel: RTCDataChannel;
  mediaStream?: MediaStream;
  
  // Quality metrics
  stats: {
    packetLoss: number;
    latency: number;
    bitrate: number;
    lastUpdated: Date;
  };
  
  // Forwarding (for primary collectors)
  forwardsTo?: string[];         // Peer IDs of secondaries
}
```

---

## API Specifications

### WebRTC Signaling Protocol

```typescript
// Messages sent over WebSocket or QR code exchange

interface SignalMessage {
  type: 'offer' | 'answer' | 'ice-candidate';
  campaignId: string;
  from: string;                  // Sender peer ID
  to: string;                    // Recipient peer ID
  payload: RTCSessionDescriptionInit | RTCIceCandidateInit;
}

interface ControlMessage {
  type: 'role-assignment' | 'quality-change' | 'heartbeat' | 'disconnect';
  campaignId: string;
  from: string;
  payload: unknown;
}

// Role assignment payload
interface RoleAssignmentPayload {
  role: 'primary' | 'secondary';
  assignedPrimary?: string;      // For secondary collectors
  forwardsTo?: string[];         // For primary collectors (who to forward to)
}

// Quality adaptation payload
interface QualityChangePayload {
  targetBitrate: number;
  targetResolution: { width: number; height: number };
  reason: 'bandwidth' | 'cpu' | 'user';
}
```

### Storage API (Internal)

```typescript
class RecordingStorage {
  // Initialize a new recording
  async createRecording(campaignId: string): Promise<string>;
  
  // Store a chunk immediately (critical for confiscation scenario)
  async appendChunk(recordingId: string, chunk: Blob): Promise<Chunk>;
  
  // Get chunks for playback
  async getChunks(recordingId: string, startIndex: number, count: number): Promise<Blob[]>;
  
  // Export complete recording
  async exportRecording(recordingId: string): Promise<Blob>;
  
  // List all recordings
  async listRecordings(): Promise<Recording[]>;
  
  // Delete old recordings (storage management)
  async deleteRecording(recordingId: string): Promise<void>;
}
```

---

## Security Considerations

### 1. Encryption
- **In Transit**: WebRTC uses DTLS 1.2+ for data channels, SRTP for media
- **At Rest**: Chunks can be encrypted with user-derived keys before OPFS storage
- **Signaling**: WebSocket over WSS (TLS)

### 2. Identity
- Public/private key pairs generated in browser (Web Crypto API)
- No phone numbers or emails required
- Optional: Web of trust for verified identities

### 3. Metadata Protection
- Campaign descriptions are plaintext (intended for public)
- Connection info (ICE candidates) reveals IP addresses to peers
- Consider: Tor integration for IP hiding (advanced)

### 4. Physical Security
- **The Core Threat**: Phone confiscation mid-stream
- **Mitigation**: 1-second chunks persisted immediately to OPFS
- **Recovery**: Any collector has complete recording
- **Wipe Feature**: Optional panic button to delete local data

---

## Deployment Strategies

### Primary Deployment (Normal Circumstances)
```
GitHub Pages (or similar) → CDN → Users
├── Automatic HTTPS
├── Global distribution
└── Easy updates
```

### Censorship-Resistant Deployment
```
1. IPFS (ipfs.io or personal gateway)
   ├── Content-addressed (can't be silently modified)
   └── Multiple gateways available
   
2. Mirror sites
   ├── Netlify mirror
   ├── Cloudflare Pages mirror
   └── Community-hosted mirrors
   
3. Emergency Distribution
   ├── Single HTML file (data URI embed)
   ├── QR code containing full app
   └── Bluetooth/WiFi Direct (if available)
```

### Signaling Server Deployment
```
Short-lived signaling servers:
- Rotate domains every 24-48 hours
- Deploy to multiple cloud providers
- Community-run signaling nodes
- Fallback to libp2p DHT discovery
```

---

## Risk Mitigation Matrix

| Risk | Impact | Mitigation Strategy |
|------|--------|---------------------|
| WebRTC blocked by firewall | High | TURN relay on common ports (443), domain rotation |
| Signaling server blocked | High | Multiple fallback methods (WS, libp2p, QR exchange) |
| Storage quota exceeded | Medium | Auto quality reduction, chunk rotation, compression |
| Poor network quality | Medium | Adaptive bitrate, redundancy (2-3 primaries) |
| Malicious collector | Medium | Encryption, optional identity verification |
| Browser incompatibility | Low | Feature detection, progressive enhancement |
| Streamer phone confiscated | Critical | 1-second chunk persistence design |

---

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Stream latency | < 3 seconds | End-to-end from streamer to collector |
| Chunk persistence | < 100ms | Time from recording to OPFS write |
| Connection establishment | < 10 seconds | With signaling server |
| Max collectors per stream | 15+ | With hierarchical topology |
| Mobile battery life | 2+ hours | Continuous streaming/recording |
| Video quality options | 360p, 480p, 720p | Adaptive based on bandwidth |

---

## Next Steps / Immediate Actions

1. **Set up development environment**
   - Initialize Vue 3 + TypeScript project
   - Configure PWA with Workbox
   - Set up testing framework

2. **Build proof of concept**
   - Two-peer WebRTC connection
   - Basic video streaming
   - Verify MediaRecorder chunked recording

3. **Evaluate signaling options**
   - Set up WebSocket server
   - Test libp2p browser integration
   - Implement QR code exchange

4. **Storage research**
   - Benchmark OPFS on target devices
   - Evaluate SQLite WASM options
   - Test chunk playback performance

5. **Community feedback**
   - Share architecture with potential users
   - Gather requirements for campaign features
   - Identify additional censorship scenarios

---

## Open Questions for Future Research

1. **Long-term storage**: How to aggregate recordings across multiple collectors?
2. **Verification**: How to cryptographically prove video authenticity?
3. **Scalability**: Can we support 50+ collectors with multi-hop relay?
4. **Mobile optimization**: Native app vs. PWA trade-offs?
5. **Integration**: Connect with existing activist tools (Signal, Briar)?

---

*Document Version: 1.0*
*Last Updated: 2026-01-28*
*Based on: 5 internal review rounds + extensive research*
