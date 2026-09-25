import { ref } from 'vue'
import { ensurePersistentStorage } from '../lib/persistence'
import { useOPFS } from './useOPFS'
import { checkStorage, type StorageAssessment } from '../lib/storageGuard'
import type { Recording, RecordingChunk, VideoQuality } from '../types'
import { v4 as uuidv4 } from 'uuid'
import {
  sha256,
  toHex,
  buildProof,
  verifyProof,
  generateIdentity,
  serializeIdentity,
  deserializeIdentity,
  type Identity,
  type VerificationResult,
} from '../lib/integrity'

// A single anonymous Ed25519 identity per browser, used to sign recording
// proofs. Persisted (no PII — just a random keypair) so a device's recordings
// share one verifiable signer.
const IDENTITY_KEY = 'undepressable_identity'
let cachedIdentity: Identity | null = null
function getIdentity(): Identity {
  if (cachedIdentity) return cachedIdentity
  try {
    const saved = localStorage.getItem(IDENTITY_KEY)
    if (saved) {
      cachedIdentity = deserializeIdentity(JSON.parse(saved))
      return cachedIdentity
    }
  } catch {
    /* corrupt/absent — regenerate below */
  }
  cachedIdentity = generateIdentity()
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(serializeIdentity(cachedIdentity)))
  } catch {
    /* storage blocked; identity still valid for this session */
  }
  return cachedIdentity
}

// In-memory storage for continuous recording (for download)
interface RecordingSession {
  chunks: Blob[]
  mimeType: string
  recording: Recording
}

const activeSessions = new Map<string, RecordingSession>()

// Background save state
interface BackgroundSaveState {
  recordingId: string
  campaignId: string
  chunkCount: number
  lastChunkIndex: number
  timestamp: number
  status: 'recording' | 'completed'
}

// Beacon sync state tracking
// This could be used in the future for recovery UI to show last known state
// const lastBeaconState: BackgroundSaveState | null = null

export function useRecording() {
  const opfs = useOPFS()
  
  const isRecording = ref(false)
  const error = ref<string | null>(null)
  // Non-fatal storage state the UI should surface BEFORE footage is lost:
  // quota running out, or chunk writes failing (recording continues in memory).
  const storageWarning = ref<string | null>(null)
  let failedChunkWrites = 0

  // All per-recording state lives in one session object, captured by the
  // recorder's event closures. This is what makes stop/start re-entrant: when
  // a stream reconnects we finalize the old segment WHILE the next one starts,
  // and the finalizer must never read state the new session has replaced
  // (that race silently mis-filed chunks and resolved the wrong recording).
  interface LiveSession {
    recorder: MediaRecorder
    recording: Recording
    campaignId: string
    mimeType: string
    chunks: Blob[]
    hashes: string[] // full SHA-256 hex per chunk, for the Merkle proof
    chunkIndex: number
    pending: number
  }
  let live: LiveSession | null = null
  let lastChunkSaveTime = 0
  let visibilityHandler: ((() => void) | null) = null
  let beforeUnloadHandler: ((() => void) | null) = null
  let pageHideHandler: ((() => void) | null) = null

  function updateStorageWarning(a: StorageAssessment) {
    if (a.level === 'critical') {
      storageWarning.value = `Storage almost full — about ${a.minutesLeft ?? '?'} min of recording left. Free space or download now.`
    } else if (a.level === 'low') {
      storageWarning.value = `Storage getting low — roughly ${a.minutesLeft ?? '?'} min of recording left.`
    } else if (a.level === 'ok' && failedChunkWrites < 3) {
      storageWarning.value = null
    }
  }

  // Sync current recording state to sessionStorage for recovery
  function syncRecordingState() {
    if (!live || !isRecording.value) return

    const state: BackgroundSaveState = {
      recordingId: live.recording.id,
      campaignId: live.campaignId,
      chunkCount: live.recording.chunks.length,
      lastChunkIndex: live.chunkIndex,
      timestamp: Date.now(),
      status: 'recording'
    }
    
    try {
      sessionStorage.setItem('p2pstream_recording_state', JSON.stringify(state))
      lastChunkSaveTime = Date.now()
    } catch (e) {
      // Session storage might be full or unavailable
      console.warn('[useRecording] Failed to sync state:', e)
    }
  }

  // Mark recording as completed in sessionStorage
  function markRecordingComplete() {
    try {
      sessionStorage.removeItem('p2pstream_recording_state')
    } catch (e) {
      // Ignore
    }
  }

  // Check for orphaned recordings on startup
  async function checkForOrphanedRecordings(): Promise<BackgroundSaveState | null> {
    try {
      const saved = sessionStorage.getItem('p2pstream_recording_state')
      if (saved) {
        const state: BackgroundSaveState = JSON.parse(saved)
        // If recording was in progress and less than 1 hour old, consider it orphaned
        const age = Date.now() - state.timestamp
        if (age < 3600000) { // 1 hour
          console.log('[useRecording] Found orphaned recording:', state)
          return state
        }
      }
    } catch (e) {
      console.warn('[useRecording] Error checking for orphaned recordings:', e)
    }
    return null
  }

  // Flush the recorder and persist state when the page is backgrounded or
  // closing — the confiscation scenario. We can't reach a server (P2P, no
  // backend), so "preserve" means: force MediaRecorder to emit its buffered
  // data (so the last second lands in OPFS) and write a recovery marker to
  // sessionStorage. There is no network beacon — a data: URL beacon goes
  // nowhere; the real safety net is that other collectors hold independent
  // copies.
  function flushForBackground() {
    if (!isRecording.value || !live) return
    syncRecordingState()
    if (live.recorder.state !== 'inactive') {
      live.recorder.requestData()
    }
  }

  function handleVisibilityChange() {
    if (document.hidden) flushForBackground()
  }

  function handleBeforeUnload() {
    flushForBackground()
  }

  function handlePageHide(_e: PageTransitionEvent) {
    flushForBackground()
  }

  // Set up background/close handlers
  function setupBackgroundHandlers() {
    // Visibility API for background detection
    visibilityHandler = handleVisibilityChange
    document.addEventListener('visibilitychange', visibilityHandler)
    
    // Before unload for desktop browsers
    beforeUnloadHandler = handleBeforeUnload
    window.addEventListener('beforeunload', beforeUnloadHandler)
    
    // Page hide for mobile browsers
    pageHideHandler = handlePageHide as any
    window.addEventListener('pagehide', pageHideHandler as any)
  }

  // Remove background handlers
  function removeBackgroundHandlers() {
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler)
      visibilityHandler = null
    }
    if (beforeUnloadHandler) {
      window.removeEventListener('beforeunload', beforeUnloadHandler)
      beforeUnloadHandler = null
    }
    if (pageHideHandler) {
      window.removeEventListener('pagehide', pageHideHandler as any)
      pageHideHandler = null
    }
  }

  async function startRecording(
    stream: MediaStream, 
    quality: VideoQuality = 'medium',
    campaignId?: string
  ): Promise<boolean> {
    try {
      error.value = null
      storageWarning.value = null
      failedChunkWrites = 0
      lastChunkSaveTime = 0

      updateStorageWarning(await checkStorage())
      // Evidence must not be one of the things the browser cleans up.
      void ensurePersistentStorage()

      // Check for orphaned recordings first
      const orphaned = await checkForOrphanedRecordings()
      if (orphaned) {
        console.log('[useRecording] Previous recording may be incomplete:', orphaned)
      }

      // Determine MIME type - prefer VP8 for better compatibility
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
          ? 'video/webm;codecs=vp9,opus'
          : 'video/webm'
      
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: quality === 'high' ? 5000000 : quality === 'medium' ? 2500000 : 1000000
      })

      const recCampaignId = campaignId || `rec-${Date.now()}`
      const recordingId = uuidv4()
      const recordedBy = 'local-' + Math.random().toString(36).substring(2, 8)

      const recording: Recording = {
        id: recordingId,
        campaignId: recCampaignId,
        recordedBy,
        startedAt: new Date(),
        status: 'recording',
        chunks: [],
        metadata: {
          resolution: quality === 'high' ? { width: 1920, height: 1080 } : quality === 'medium' ? { width: 1280, height: 720 } : { width: 854, height: 480 },
          bitrate: quality === 'high' ? 5000000 : quality === 'medium' ? 2500000 : 1000000,
          codec: mimeType
        }
      }

      const s: LiveSession = {
        recorder,
        recording,
        campaignId: recCampaignId,
        mimeType,
        chunks: [],
        hashes: [],
        chunkIndex: 0,
        pending: 0
      }

      // Store session for later download
      activeSessions.set(recordingId, {
        chunks: s.chunks,
        mimeType,
        recording
      })

      // Handle data available. Everything is read off `s`, never module state:
      // a late event from a finalizing recorder must not touch the segment
      // that started after it.
      recorder.ondataavailable = async (event) => {
        if (event.data.size === 0) {
          return
        }

        s.pending++

        // Store in memory for continuous playback/download
        s.chunks.push(event.data)

        try {
          // Write to OPFS for persistence
          const opfsPath = await opfs.writeChunk(s.campaignId, s.recording.id, s.chunkIndex, event.data)

          if (!opfsPath) {
            console.error('Failed to write chunk to OPFS')
            failedChunkWrites++
            if (failedChunkWrites >= 3) {
              storageWarning.value =
                'Storage writes are failing — persistent copy incomplete. Download the recording as soon as it stops.'
            }
            return
          }

          // Re-assess headroom periodically (~every 30 s of footage).
          if (s.chunkIndex % 30 === 0) {
            checkStorage().then(updateStorageWarning)
          }

          const buffer = await event.data.arrayBuffer()
          // Full SHA-256 hex feeds the Merkle proof; the chunk's own `checksum`
          // keeps its short prefix for quick display/back-compat.
          const fullHash = toHex(await sha256(buffer))
          s.hashes.push(fullHash)
          const chunk: RecordingChunk = {
            index: s.chunkIndex,
            timestamp: new Date(),
            duration: 1000, // 1 second chunks
            size: event.data.size,
            opfsPath,
            checksum: fullHash.slice(0, 16)
          }

          s.recording.chunks.push(chunk)
          s.chunkIndex++

          // Sync state periodically (every 5 chunks or 10 seconds)
          if (s.chunkIndex % 5 === 0 || Date.now() - lastChunkSaveTime > 10000) {
            syncRecordingState()
          }
        } catch (err: any) {
          console.error('Error saving chunk:', err)
        } finally {
          s.pending = Math.max(0, s.pending - 1)
        }
      }

      // Start recording with 1 second timeslice
      recorder.start(1000)
      live = s
      isRecording.value = true

      // Set up background/close handlers
      setupBackgroundHandlers()

      console.log('[useRecording] Recording started:', recordingId, 'MIME:', mimeType)
      return true

    } catch (err: any) {
      error.value = err.message || 'Failed to start recording'
      console.error('[useRecording] Error:', err)
      return false
    }
  }

  async function stopRecording(): Promise<Recording | null> {
    // Detach the session first: from here on, a new startRecording() may run
    // concurrently and must not interact with this finalizing segment.
    const s = live
    live = null
    if (!s) return null

    // Remove background handlers
    removeBackgroundHandlers()

    const finalize = async (): Promise<Recording | null> => {
      // Wait for any pending chunks to be processed
      let waitCount = 0
      const maxWait = 50 // 5 seconds max

      while (s.pending > 0 && waitCount < maxWait) {
        await new Promise(r => setTimeout(r, 100))
        waitCount++
      }

      if (s.pending > 0) {
        console.warn('[useRecording] Timeout waiting for chunks, proceeding with available data')
      }

      s.recording.endedAt = new Date()
      s.recording.status = 'completed'

      // Build the tamper-evidence proof: Merkle root over all chunk hashes,
      // signed by this device's anonymous key.
      try {
        if (s.hashes.length > 0) {
          s.recording.proof = buildProof(s.recording.id, s.hashes, getIdentity())
          console.log('[useRecording] Proof built, merkle root:', s.recording.proof.merkleRoot.slice(0, 16))
        }
      } catch (e) {
        console.warn('[useRecording] Failed to build integrity proof:', e)
      }

      try {
        // Save metadata to IndexedDB via store
        await saveRecordingMetadata(s.recording)

        // Mark recording as complete (unless a newer segment took over the marker)
        if (!live) markRecordingComplete()

        console.log('[useRecording] Recording saved:', s.recording.id, 'Chunks:', s.chunks.length)
        return s.recording
      } catch (err: any) {
        console.error('[useRecording] Error saving recording:', err)
        error.value = err.message
        return null
      }
    }

    if (!live) isRecording.value = false

    // The recorder auto-stops when all its tracks end (e.g. the remote
    // connection died) — the captured chunks must still be finalized/signed.
    if (s.recorder.state === 'inactive') {
      return finalize()
    }

    return new Promise((resolve) => {
      s.recorder.requestData()
      s.recorder.onstop = () => {
        finalize().then(resolve)
      }
      s.recorder.stop()
    })
  }

  async function saveRecordingMetadata(recording: Recording) {
    const DB_NAME = 'P2PStreamRecordings'
    const DB_VERSION = 1
    const STORE_NAME = 'recordings'
    
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const transaction = db.transaction(STORE_NAME, 'readwrite')
        const store = transaction.objectStore(STORE_NAME)
        
        // Serialize for IndexedDB
        const serialized: any = {
          id: recording.id,
          campaignId: recording.campaignId,
          recordedBy: recording.recordedBy,
          startedAt: recording.startedAt.toISOString(),
          status: recording.status,
          metadata: recording.metadata,
          chunks: recording.chunks.map(c => ({
            index: c.index,
            timestamp: c.timestamp.toISOString(),
            duration: c.duration,
            size: c.size,
            opfsPath: c.opfsPath,
            checksum: c.checksum
          }))
        }
        
        if (recording.endedAt) {
          serialized.endedAt = recording.endedAt.toISOString()
        }

        if (recording.proof) {
          serialized.proof = recording.proof // already a plain JSON object
        }

        const putRequest = store.put(serialized)
        putRequest.onsuccess = () => resolve()
        putRequest.onerror = () => reject(putRequest.error)
      }
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        }
      }
    })
  }

  // Get the continuous Blob for download (properly formatted WebM)
  function getRecordingBlob(recordingId: string): Blob | null {
    const session = activeSessions.get(recordingId)
    if (!session || session.chunks.length === 0) {
      return null
    }
    
    // Create a single Blob from all chunks - this creates a valid WebM
    // because all chunks have the same MIME type and format
    return new Blob(session.chunks, { type: session.mimeType })
  }

  // Get the current in-progress recording blob
  function getCurrentRecordingBlob(): Blob | null {
    if (!live || live.chunks.length === 0) return null
    return new Blob(live.chunks, { type: live.mimeType })
  }

  // Create a URL for playback (works with MediaSource or direct playback)
  function getPlaybackUrl(recordingId: string): string | null {
    const blob = getRecordingBlob(recordingId)
    if (!blob) return null
    return URL.createObjectURL(blob)
  }

  // Cleanup session after download
  function cleanupSession(recordingId: string) {
    activeSessions.delete(recordingId)
  }

  // Re-derive the Merkle root from stored chunk hashes and check the signature,
  // proving the recording hasn't been altered since it was saved.
  function verifyRecording(recording: Recording): VerificationResult {
    if (!recording.proof) return { valid: false, reason: 'No integrity proof was recorded' }
    return verifyProof(recording.proof)
  }

  return {
    isRecording,
    error,
    storageWarning,
    startRecording,
    stopRecording,
    getRecordingBlob,
    getCurrentRecordingBlob,
    getPlaybackUrl,
    cleanupSession,
    checkForOrphanedRecordings,
    verifyRecording,
    getIdentity
  }
}
