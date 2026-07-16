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

// ICE Server configuration
export const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
}

// WebRTC configuration
export const RTC_CONFIG: RTCConfiguration = {
  iceServers: ICE_SERVERS.iceServers,
  iceCandidatePoolSize: 10
}
