export type UserRole = 'streamer' | 'primary' | 'secondary' | 'collector'

export type ConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed'

export type CampaignStatus = 'announced' | 'live' | 'ended'

export type RecordingStatus = 'recording' | 'completed' | 'interrupted'

export interface PeerInfo {
  id: string
  displayName: string
  role: UserRole
  connectionState: ConnectionState
  joinedAt: Date
}

export interface Campaign {
  id: string
  createdAt: Date
  streamer: {
    id: string
    displayName: string
    connectionInfo?: RTCIceCandidateInit
  }
  status: CampaignStatus
  description: string
  location?: string
  maxCollectors: number
  collectors: PeerInfo[]
  hierarchy: {
    primarySlots: number
    secondarySlotsPerPrimary: number
  }
}

export interface Chunk {
  index: number
  timestamp: Date
  duration: number
  size: number
  opfsPath: string
  checksum: string
}

export interface Recording {
  id: string
  campaignId: string
  recordedBy: string
  startedAt: Date
  endedAt?: Date
  status: RecordingStatus
  chunks: Chunk[]
  metadata: {
    resolution: { width: number; height: number }
    bitrate: number
    codec: string
  }
}

export interface SignalMessage {
  type: 'offer' | 'answer' | 'ice-candidate'
  campaignId: string
  from: string
  to: string
  payload: RTCSessionDescriptionInit | RTCIceCandidateInit
}

export interface ControlMessage {
  type: 'role-assignment' | 'quality-change' | 'heartbeat' | 'disconnect' | 'chunk-info'
  campaignId: string
  from: string
  payload: unknown
}

export interface RoleAssignmentPayload {
  role: 'primary' | 'secondary'
  assignedPrimary?: string
  forwardsTo?: string[]
}

export interface QualityChangePayload {
  targetBitrate: number
  targetResolution: { width: number; height: number }
  reason: 'bandwidth' | 'cpu' | 'user'
}

export interface VideoConstraints {
  width: number
  height: number
  bitrate: number
  label: string
}

export const VIDEO_QUALITIES: VideoConstraints[] = [
  { width: 1280, height: 720, bitrate: 1500000, label: '720p HD' },
  { width: 854, height: 480, bitrate: 800000, label: '480p' },
  { width: 640, height: 360, bitrate: 400000, label: '360p' },
  { width: 426, height: 240, bitrate: 200000, label: '240p' }
]
