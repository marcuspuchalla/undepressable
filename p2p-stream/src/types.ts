import type { RecordingProof } from "./lib/integrity";

// User roles in the P2P network
export type UserRole = 'streamer' | 'collector'

// Connection states
export type ConnectionState = 'new' | 'connecting' | 'connected' | 'failed' | 'closed'
export type RecordingStatus = 'recording' | 'completed' | 'failed' | 'cancelled'

// Video quality presets
export type VideoQuality = 'low' | 'medium' | 'high'

export interface VideoConstraints {
  label: string
  resolution: { width: number; height: number }
  bitrate: number
  fps: number
}

// Recording chunk metadata
export interface RecordingChunk {
  index: number
  timestamp: Date
  duration: number
  size: number
  opfsPath: string
  checksum: string
}

// Recording metadata
export interface Recording {
  id: string
  campaignId: string
  recordedBy: string
  startedAt: Date
  endedAt?: Date
  status: RecordingStatus
  chunks: RecordingChunk[]
  metadata: {
    resolution: { width: number; height: number }
    bitrate: number
    codec: string
  }
  // Tamper-evidence: Merkle root over chunk hashes, signed by an anonymous key.
  proof?: RecordingProof
}

// Peer information
export interface PeerInfo {
  id: string
  displayName: string
  role: UserRole
  connectionState: ConnectionState
  joinedAt: Date
}

// Campaign/Room information
export interface Campaign {
  id: string
  createdAt: Date
  streamerId: string
  peers: PeerInfo[]
}

// Signal message types
export type SignalType = 'offer' | 'answer' | 'ice-candidate' | 'peer-joined' | 'peer-left'

export interface SignalMessage {
  type: SignalType
  from: string
  to?: string
  data?: any
}

// Predefined video quality presets
export const VIDEO_QUALITIES: VideoConstraints[] = [
  {
    label: '720p',
    resolution: { width: 1280, height: 720 },
    bitrate: 2500000,
    fps: 30
  },
  {
    label: '480p',
    resolution: { width: 854, height: 480 },
    bitrate: 1500000,
    fps: 30
  },
  {
    label: '360p',
    resolution: { width: 640, height: 360 },
    bitrate: 800000,
    fps: 24
  }
]

// ICE Server configuration.
//
// STUN lets peers discover their public address for direct P2P. When peers are
// behind strict/symmetric NAT (common on mobile carriers) a direct path is
// impossible and the encrypted (DTLS-SRTP) media must be *relayed* through a
// TURN server — an optional "friendly-jurisdiction relay" in the whitepaper's
// terms. We ship the free Open Relay Project TURN so cross-network streaming
// works out of the box with no backend to run. To self-host a relay instead,
// override VITE_TURN_URL / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL at build.
const env = (import.meta as any).env ?? {}

const TURN: RTCIceServer[] = env.VITE_TURN_URL
  ? [
      {
        urls: String(env.VITE_TURN_URL).split(',').map((s: string) => s.trim()),
        username: env.VITE_TURN_USERNAME ?? '',
        credential: env.VITE_TURN_CREDENTIAL ?? ''
      }
    ]
  : [
      {
        urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443'],
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ]

export const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    ...TURN
  ]
}

// WebRTC configuration
export const RTC_CONFIG: RTCConfiguration = {
  iceServers: ICE_SERVERS.iceServers,
  iceCandidatePoolSize: 10
}

// Nostr relays used for peer discovery/signaling.
//
// Trystero's built-in default relay list has rotted: several of its defaults
// now reject our ephemeral signaling events ("blocked: not on white-list",
// "invalid: ephemeral event expired"), which made peer discovery take minutes
// or fail outright. We pin a curated set of large, open relays that accept
// ephemeral events, so two peers find each other in seconds.
export const NOSTR_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://offchain.pub',
  'wss://relay.snort.social'
]
