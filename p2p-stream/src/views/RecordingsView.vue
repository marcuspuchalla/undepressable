<template>
  <div class="h-full overflow-y-auto p-4">
    <h2 class="text-xl font-bold mb-4">Recordings</h2>
    
    <!-- Storage Info -->
    <div class="card mb-4">
      <div class="flex items-center justify-between mb-2">
        <span class="text-sm text-gray-400">Storage</span>
        <button 
          class="text-xs text-primary-400 hover:text-primary-300"
          @click="refreshRecordings"
        >
          Refresh
        </button>
      </div>
      <div class="h-2 bg-gray-700 rounded-full overflow-hidden">
        <div 
          class="h-full bg-primary-500 transition-all"
          :style="{ width: storagePercent + '%' }"
        />
      </div>
      <div class="flex justify-between mt-2 text-xs text-gray-500">
        <span>{{ formatBytes(storageUsed) }} used</span>
        <span v-if="storageQuota">{{ formatBytes(storageQuota) }} total</span>
      </div>
    </div>

    <!-- Empty State -->
    <div v-if="recordings.length === 0" class="card text-center py-12">
      <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-800 flex items-center justify-center">
        <svg class="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
        </svg>
      </div>
      <h3 class="text-lg font-medium mb-2">No Recordings Yet</h3>
      <p class="text-gray-400 mb-4">Start collecting a stream to save recordings.</p>
      <RouterLink to="/collect" class="btn-primary">
        Collect Stream
      </RouterLink>
    </div>

    <!-- Recordings List -->
    <div v-else class="space-y-3">
      <div 
        v-for="recording in recordings" 
        :key="recording.id"
        class="card"
      >
        <div class="flex items-start gap-4">
          <!-- Thumbnail -->
          <div class="w-24 h-16 bg-gray-900 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg class="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>

          <!-- Info -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span 
                class="px-2 py-0.5 rounded text-xs font-medium"
                :class="recording.status === 'completed' ? 'bg-green-900/50 text-green-400' : 'bg-yellow-900/50 text-yellow-400'"
              >
                {{ recording.status }}
              </span>
              <span class="text-xs text-gray-500">
                {{ formatDate(recording.startedAt) }}
              </span>
            </div>
            
            <p class="text-sm text-gray-400 truncate">
              Campaign: {{ recording.campaignId.slice(0, 8) }}...
            </p>
            
            <div class="flex items-center gap-4 mt-2 text-xs text-gray-500">
              <span>{{ recording.chunks.length }} chunks</span>
              <span>{{ recording.metadata.resolution.width }}x{{ recording.metadata.resolution.height }}</span>
              <span v-if="recording.endedAt">
                {{ formatDuration(recording.endedAt.getTime() - recording.startedAt.getTime()) }}
              </span>
            </div>

            <!-- Tamper-evidence -->
            <div v-if="recording.proof" class="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <button
                class="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 flex items-center gap-1 transition-colors"
                @click="verify(recording)"
              >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Verify integrity
              </button>
              <span
                v-if="verifyResults[recording.id]"
                :class="verifyResults[recording.id].valid ? 'text-green-400' : 'text-red-400'"
                class="font-medium"
              >
                {{ verifyResults[recording.id].valid ? '✓ Unaltered' : '✗ ' + verifyResults[recording.id].reason }}
              </span>
              <span class="text-gray-600 font-mono" title="Anonymous signing key">signer {{ recording.proof.pubKey.slice(0, 8) }}…</span>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex flex-col gap-2">
            <button 
              class="p-2 hover:bg-gray-700 rounded-lg transition-colors"
              title="Play"
              @click="playRecording(recording)"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            <button 
              class="p-2 hover:bg-gray-700 rounded-lg transition-colors"
              title="Download"
              @click="downloadRecording(recording)"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
            <button 
              class="p-2 hover:bg-red-900/50 text-red-400 rounded-lg transition-colors"
              title="Delete"
              @click="deleteRecording(recording)"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Player Modal -->
    <div v-if="playingRecording" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90" @click.self="closePlayer">
      <div class="w-full max-w-4xl">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-medium">Playback</h3>
          <button @click="closePlayer" class="p-2 hover:bg-gray-800 rounded-lg">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <video
          ref="playerVideo"
          class="w-full rounded-lg"
          controls
          autoplay
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRecordingStore } from '../stores/recording'
import { useOPFS } from '../composables/useOPFS'
import { useRecording } from '../composables/useRecording'
import type { Recording } from '../types'
import type { VerificationResult } from '../lib/integrity'

const recordingStore = useRecordingStore()
const opfs = useOPFS()
const recorder = useRecording()

// State
const recordings = computed(() => recordingStore.recordings)
const storageUsed = ref(0)
const storageQuota = ref(0)
const playingRecording = ref<Recording | null>(null)
const playerVideo = ref<HTMLVideoElement>()
const verifyResults = ref<Record<string, VerificationResult>>({})

function verify(recording: Recording) {
  verifyResults.value = { ...verifyResults.value, [recording.id]: recorder.verifyRecording(recording) }
}

const storagePercent = computed(() => {
  if (!storageQuota.value) return 0
  return (storageUsed.value / storageQuota.value) * 100
})

// Methods
async function refreshRecordings() {
  await recordingStore.loadRecordings()
  const usage = await opfs.getStorageUsage()
  if (usage) {
    storageUsed.value = usage.used
    storageQuota.value = usage.remaining + usage.used
  }
}

async function playRecording(recording: Recording) {
  playingRecording.value = recording
  
  // Load chunks and create blob
  const chunks = await opfs.readAllChunks(recording.campaignId, recording.id)
  if (chunks.length > 0 && playerVideo.value) {
    const blob = new Blob(chunks, { type: recording.metadata.codec })
    playerVideo.value.src = URL.createObjectURL(blob)
  }
}

function closePlayer() {
  if (playerVideo.value) {
    playerVideo.value.pause()
    playerVideo.value.src = ''
  }
  playingRecording.value = null
}

async function downloadRecording(recording: Recording) {
  const chunks = await opfs.readAllChunks(recording.campaignId, recording.id)
  if (chunks.length === 0) return
  
  const blob = new Blob(chunks, { type: recording.metadata.codec })
  const url = URL.createObjectURL(blob)
  
  const a = document.createElement('a')
  a.href = url
  a.download = `recording-${recording.id.slice(0, 8)}-${formatDateForFilename(recording.startedAt)}.webm`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  
  URL.revokeObjectURL(url)
}

async function deleteRecording(recording: Recording) {
  if (!confirm('Are you sure you want to delete this recording?')) return
  
  await opfs.deleteRecording(recording.campaignId, recording.id)
  await recordingStore.deleteRecording(recording.id)
  await refreshRecordings()
}

// Utilities
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(date))
}

function formatDateForFilename(date: Date): string {
  return new Date(date).toISOString().split('T')[0]
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  
  if (hours > 0) {
    return `${hours}:${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
  }
  return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// Lifecycle
onMounted(() => {
  refreshRecordings()
})
</script>
