import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Recording } from '../types'
import { v4 as uuidv4 } from 'uuid'

const DB_NAME = 'P2PStreamRecordings'
const DB_VERSION = 1
const STORE_NAME = 'recordings'

export const useRecordingStore = defineStore('recording', () => {
  // State
  const recordings = ref<Recording[]>([])
  const activeRecording = ref<Recording | null>(null)
  const isRecording = ref(false)
  const chunks = ref<Blob[]>([])
  const storageQuota = ref<{ used: number; total: number } | null>(null)
  
  // Computed
  const hasActiveRecording = computed(() => activeRecording.value !== null)
  const recordingDuration = computed(() => {
    if (!activeRecording.value) return 0
    return Date.now() - activeRecording.value.startedAt.getTime()
  })
  
  // Initialize IndexedDB
  async function initDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        }
      }
    })
  }
  
  // Check storage quota
  async function checkStorageQuota() {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate()
      storageQuota.value = {
        used: estimate.usage || 0,
        total: estimate.quota || 0
      }
    }
  }
  
  // Start recording
  async function startRecording(
    stream: MediaStream, 
    campaignId: string,
    onChunk: (chunk: Blob, index: number) => void
  ): Promise<MediaRecorder> {
    const recordingId = uuidv4()
    
    // Determine supported MIME type
    const mimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4'
    ]
    
    let selectedMimeType = ''
    for (const mimeType of mimeTypes) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        selectedMimeType = mimeType
        break
      }
    }
    
    if (!selectedMimeType) {
      throw new Error('No supported MIME type found for recording')
    }
    
    // Create recorder with 1-second chunks (critical for confiscation scenario)
    const recorder = new MediaRecorder(stream, {
      mimeType: selectedMimeType,
      videoBitsPerSecond: 1500000
    })
    
    let chunkIndex = 0
    
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.value.push(event.data)
        onChunk(event.data, chunkIndex++)
      }
    }
    
    // Create recording metadata
    activeRecording.value = {
      id: recordingId,
      campaignId,
      recordedBy: 'local',
      startedAt: new Date(),
      status: 'recording',
      chunks: [],
      metadata: {
        resolution: { width: 1280, height: 720 },
        bitrate: 1500000,
        codec: selectedMimeType
      }
    }
    
    isRecording.value = true
    
    // Start with 1-second timeslice for immediate persistence
    recorder.start(1000)
    
    return recorder
  }
  
  // Stop recording
  async function stopRecording(recorder: MediaRecorder): Promise<Recording | null> {
    return new Promise((resolve) => {
      if (!recorder || recorder.state === 'inactive') {
        resolve(activeRecording.value)
        return
      }
      
      recorder.onstop = async () => {
        if (activeRecording.value) {
          activeRecording.value.endedAt = new Date()
          activeRecording.value.status = 'completed'
          
          // Save to IndexedDB
          await saveRecording(activeRecording.value)
          
          recordings.value.push(activeRecording.value)
        }
        
        isRecording.value = false
        resolve(activeRecording.value)
      }
      
      recorder.stop()
    })
  }
  
  // Save recording metadata to IndexedDB
  async function saveRecording(recording: Recording) {
    const db = await initDB()
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      
      // Create a completely plain object for IndexedDB
      // IndexedDB can't store objects with methods or complex prototypes
      const serialized: any = {
        id: recording.id,
        campaignId: recording.campaignId,
        recordedBy: recording.recordedBy,
        startedAt: recording.startedAt.toISOString(),
        status: recording.status,
        metadata: {
          resolution: { ...recording.metadata.resolution },
          bitrate: recording.metadata.bitrate,
          codec: recording.metadata.codec
        }
      }
      
      if (recording.endedAt) {
        serialized.endedAt = recording.endedAt.toISOString()
      }
      
      if (recording.chunks && recording.chunks.length > 0) {
        serialized.chunks = recording.chunks.map(c => ({
          index: c.index,
          timestamp: c.timestamp.toISOString(),
          duration: c.duration,
          size: c.size,
          opfsPath: c.opfsPath,
          checksum: c.checksum
        }))
      } else {
        serialized.chunks = []
      }
      
      const request = store.put(serialized)
      
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
  
  // Load all recordings from IndexedDB
  async function loadRecordings() {
    const db = await initDB()
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.getAll()
      
      request.onsuccess = () => {
        // Parse dates back from strings
        recordings.value = request.result.map((r: any) => ({
          ...r,
          startedAt: new Date(r.startedAt),
          endedAt: r.endedAt ? new Date(r.endedAt) : undefined,
          chunks: r.chunks?.map((c: any) => ({
            ...c,
            timestamp: new Date(c.timestamp)
          })) || []
        }))
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
  }
  
  // Delete recording
  async function deleteRecording(recordingId: string) {
    const db = await initDB()
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.delete(recordingId)
      
      request.onsuccess = () => {
        recordings.value = recordings.value.filter(r => r.id !== recordingId)
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
  }
  
  // Export recording as downloadable file
  async function exportRecording(recording: Recording): Promise<Blob> {
    // Combine all chunks
    return new Blob(chunks.value, { type: recording.metadata.codec })
  }
  
  // Clear active recording state
  function clearActiveRecording() {
    activeRecording.value = null
    chunks.value = []
    isRecording.value = false
  }
  
  return {
    // State
    recordings,
    activeRecording,
    isRecording,
    chunks,
    storageQuota,
    // Computed
    hasActiveRecording,
    recordingDuration,
    // Actions
    checkStorageQuota,
    startRecording,
    stopRecording,
    loadRecordings,
    deleteRecording,
    exportRecording,
    clearActiveRecording
  }
})
