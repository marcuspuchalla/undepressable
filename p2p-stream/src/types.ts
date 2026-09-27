import type { RecordingProof } from "./lib/integrity";
import type { SealedKey } from "./lib/seal/crypto";

// User roles in the P2P network
export type UserRole = 'streamer' | 'collector'

// Connection states
export type ConnectionState = 'new' | 'connecting' | 'connected' | 'failed' | 'closed'
// 'receiving': arriving from another device (home sync), not complete yet.
export type RecordingStatus = 'recording' | 'completed' | 'failed' | 'cancelled' | 'receiving'

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
  // Set when this copy came from another device rather than this one's camera.
  origin?: RecordingOrigin
  // Set when the stored chunks are encrypted (lib/seal): only the holders of
  // the recipients' private keys can open them.
  sealed?: RecordingSeal
}

export interface RecordingSeal {
  v: 1
  /** The recording's content key, wrapped for each recipient. */
  keys: SealedKey[]
  /**
   * Proof over the stored, encrypted chunks (same signer as `proof`, which
   * covers the footage itself): anyone can check a sealed copy is intact
   * without being able to open it.
   */
  proof?: RecordingProof
}

export interface RecordingOrigin {
  /** imported: from an evidence file; synced: sent by a paired device. */
  kind: 'imported' | 'synced'
  /** ISO time the copy arrived here. */
  at: string
  /** Every chunk was checked against the signed proof on arrival. */
  verified: boolean
  /** It arrived sealed and was opened here (with this device's key). */
  opened?: boolean
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

// ICE (STUN/TURN) configuration lives in lib/net/iceConfig.ts — evaluated at
// join time so a runtime-configured TURN relay applies without a rebuild.
export { getRtcConfig, STUN_SERVERS } from './lib/net/iceConfig'

// Nostr relays used for peer discovery/signaling.
//
// Trystero's built-in default relay list has rotted: several of its defaults
// now reject our ephemeral signaling events ("blocked: not on white-list",
// "invalid: ephemeral event expired", "auth-required", "NIP-05 verification
// needed"), which made peer discovery take minutes or fail outright. We pin a
// curated set of open relays that accept Trystero's ephemeral events.
//
// Re-verified 2026-09-25 by publishing a Trystero-format event on one socket
// and receiving it on another (docs/RELIABILITY_AUDIT_3.md §5): the first six
// relayed it end-to-end. relay.primal.net opened but did not relay from the
// test machine; it worked in July's on-device runs, so it stays as an extra.
//
// Why not more: every relay that delivers a peer's announce makes Trystero
// open one more parallel connection attempt to that peer. Seven relays is
// already seven attempts per announce — each allocating a port on the TURN
// relay when one is configured. Past a handful, redundancy costs more than it
// buys; any one relay both peers share is enough for them to meet.
export const NOSTR_RELAYS = [
  'wss://relay.damus.io',
  'wss://nostr.mom',
  'wss://relay.snort.social',
  'wss://nostr-pub.wellorder.net',
  'wss://nostr.oxtr.dev',
  'wss://nostr.bitcoiner.social',
  'wss://relay.primal.net'
]

// WebTorrent trackers for the torrent strategy. Trystero's defaults connect to
// the first three of its list, one of which (tracker.btorrent.xyz) has been
// dead since at least July — so a third of torrent discovery was wasted.
// The first two relayed offers end-to-end on 2026-09-25; files.fm listens on a
// non-443 port the test machine could not reach, so it is unverified.
export const TORRENT_TRACKERS = [
  'wss://tracker.webtorrent.dev',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.files.fm:7073/announce'
]
