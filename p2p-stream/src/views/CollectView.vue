<template>
  <div class="h-full flex flex-col">
    <!-- Header with Debug Button -->
    <div class="flex-none p-3 bg-gray-900 border-b border-gray-800 flex items-center justify-between">
      <h1 class="font-semibold">Collector</h1>
      <button
        class="p-2 text-gray-400 hover:text-white transition-colors"
        @click="debugModal?.open()"
        title="Debug logs"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>
    </div>

    <!-- Video Preview -->
    <div class="flex-1 relative bg-black">
      <video
        v-if="remoteStream"
        ref="videoPlayer"
        :srcObject="remoteStream"
        autoplay
        playsinline
        class="w-full h-full object-cover"
        @canplay="handleVideoCanPlay"
      />
      
      <!-- QR Scanner View -->
      <div v-else-if="showQRScanner" class="absolute inset-0 bg-black">
        <video
          ref="qrVideo"
          autoplay
          playsinline
          muted
          class="w-full h-full object-cover"
        />
        <canvas ref="qrCanvas" class="hidden" />
        
        <!-- Scanner Overlay -->
        <div class="absolute inset-0 flex flex-col items-center justify-center">
          <div class="w-48 h-48 border-2 border-primary-500/80 rounded-lg relative">
            <div class="absolute -top-1 -left-1 w-4 h-4 border-t-4 border-l-4 border-primary-500/80" />
            <div class="absolute -top-1 -right-1 w-4 h-4 border-t-4 border-r-4 border-primary-500/80" />
            <div class="absolute -bottom-1 -left-1 w-4 h-4 border-b-4 border-l-4 border-primary-500/80" />
            <div class="absolute -bottom-1 -right-1 w-4 h-4 border-b-4 border-r-4 border-primary-500/80" />
          </div>
          <p class="mt-4 text-white/90 text-sm">Point camera at QR code</p>
        </div>

        <!-- Camera Selector for Scanner -->
        <div v-if="availableCameras.length > 1" class="absolute bottom-4 left-4 right-4">
          <select
            v-model="selectedCameraId"
            class="w-full bg-gray-900/90 text-white text-sm rounded-lg px-3 py-2 border border-gray-700"
            @change="restartQRScanner"
          >
            <option v-for="cam in availableCameras" :key="cam.deviceId" :value="cam.deviceId">
              {{ cam.label || `Camera ${cam.deviceId.slice(0, 4)}...` }}
            </option>
          </select>
        </div>

        <!-- Close Scanner Button -->
        <button
          class="absolute top-4 right-4 p-2 bg-gray-900/80 rounded-full"
          @click="stopQRScanner"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div v-else class="absolute inset-0 flex items-center justify-center">
        <div class="text-center p-6">
          <div class="w-20 h-20 mx-auto mb-4 rounded-full bg-gray-800 flex items-center justify-center">
            <svg class="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
            </svg>
          </div>
          <p class="text-gray-400 mb-2">Waiting for stream...</p>
          <p v-if="isConnecting" class="text-sm text-gray-500">Connecting...</p>
          <div v-else-if="noStreamHint" class="mt-2 max-w-xs mx-auto">
            <p class="text-sm text-yellow-400/90 font-medium">Couldn't reach the stream yet</p>
            <p class="text-xs text-gray-500 mt-1">
              The streamer may not be live, or a strict network is blocking the connection. This will connect
              automatically once they're reachable.
            </p>
          </div>
        </div>
      </div>

      <!-- Recording Indicator -->
      <div v-if="isRecording" class="absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 bg-red-600/80 rounded-full">
        <div class="w-3 h-3 bg-white rounded-full animate-pulse" />
        <span class="text-sm font-medium">{{ formatDuration(recordingDuration) }}</span>
      </div>

      <!-- Live swarm counts -->
      <div v-if="isConnected || remoteStream" class="absolute top-4 right-4 flex gap-2">
        <div class="px-3 py-1.5 bg-black/70 rounded-full flex items-center gap-1.5" title="People watching this stream">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
          <span class="text-sm font-medium tabular-nums">{{ counts.watching }}</span>
        </div>
        <div class="px-3 py-1.5 bg-red-600/80 rounded-full flex items-center gap-1.5" title="People recording a copy right now">
          <div class="w-2.5 h-2.5 bg-white rounded-full" />
          <span class="text-sm font-medium tabular-nums">{{ counts.recording }}</span>
        </div>
      </div>

      <!-- Strategy Badges -->
      <div v-if="isConnecting || remoteStream" class="absolute bottom-4 left-4 flex gap-2">
        <span class="px-2 py-1 bg-gray-800/80 rounded text-xs">🌊 BitTorrent</span>
        <span class="px-2 py-1 bg-gray-800/80 rounded text-xs">🐦 Nostr</span>
      </div>

      <!-- Connection Error -->
      <div v-if="trystero.error" class="absolute inset-x-4 bottom-20 p-4 bg-red-900/90 rounded-lg text-center">
        <p class="text-red-200 mb-2">{{ trystero.error }}</p>
        <button
          v-if="!isRetrying"
          class="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-white text-sm"
          @click="retryConnection"
        >
          Retry
        </button>
      </div>
    </div>

    <!-- Controls -->
    <div class="flex-none p-4 bg-gray-900 border-t border-gray-800 space-y-4">
      <!-- Home archive forwarding -->
      <div class="flex items-center gap-2 text-xs">
        <svg class="w-4 h-4 shrink-0" :class="pairedHome ? 'text-moss' : 'text-slate-500'" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
        <template v-if="pairedHome">
          <span class="text-slate-400">
            Home archive
            <span class="font-mono text-slate-300">{{ pairedHome }}</span>:
            <span :class="forwarding ? 'text-moss' : 'text-slate-500'">{{ forwarding ? 'forwarding ✓' : (remoteStream ? 'connecting…' : 'ready') }}</span>
          </span>
          <button class="ml-auto text-slate-500 hover:text-slate-300 underline" @click="unpairHome">unpair</button>
        </template>
        <template v-else>
          <span class="text-slate-500">No home archive.</span>
          <button class="text-glow hover:underline" @click="showPair = !showPair">Forward to a home device</button>
        </template>
      </div>
      <div v-if="showPair && !pairedHome" class="flex gap-2">
        <input
          v-model="pairInput"
          placeholder="Home code (8 chars)"
          class="input flex-1 text-center font-mono uppercase text-sm"
          @input="pairInput = pairInput.toUpperCase().replace(/[^A-Z0-9]/g, '')"
        />
        <button class="btn-secondary px-4 text-sm" @click="pairHome">Pair</button>
      </div>

      <!-- Connection Controls -->
      <div v-if="!isConnected && !remoteStream && !showQRScanner" class="space-y-3">
        <!-- Room Code Input with Scan Button -->
        <div v-if="!props.roomCode" class="space-y-2">
          <label class="text-sm text-gray-400">Enter 6-digit Room Code</label>
          <div class="flex gap-2">
            <input
              v-model="inputRoomCode"
              type="text"
              maxlength="6"
              placeholder="A1B2C3"
              class="input flex-1 text-center font-mono text-xl tracking-widest uppercase"
              @input="inputRoomCode = inputRoomCode.toUpperCase().replace(/[^A-Z0-9]/g, '')"
              @keyup.enter="isValidRoomCode(inputRoomCode) && joinStream(inputRoomCode)"
            />
            <button
              class="flex-none px-4 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
              @click="startQRScanner"
              title="Scan QR Code"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4h2v-4zM6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Manual Join Button -->
        <button
          v-if="!props.roomCode"
          class="w-full btn-emergency py-4 text-lg"
          :disabled="!isValidRoomCode(inputRoomCode) || isConnecting"
          @click="joinStream(inputRoomCode)"
        >
          <span v-if="isConnecting">Connecting...</span>
          <span v-else>Join Stream</span>
        </button>

        <!-- Auto-join info (from URL) -->
        <div v-else-if="isConnecting" class="text-center text-gray-400">
          <div class="w-8 h-8 mx-auto mb-2 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p>Connecting to {{ props.roomCode }}...</p>
        </div>
      </div>

      <!-- Connected State -->
      <div v-else-if="isConnected || remoteStream" class="space-y-3">
        <div class="flex gap-2">
          <!-- Recording Control -->
          <button
            v-if="!isRecording && !savedRecording"
            class="flex-1 btn-emergency py-3"
            @click="startRecording"
            :disabled="!remoteStream"
          >
            Record
          </button>
          <button
            v-else-if="isRecording"
            class="flex-1 bg-red-600 hover:bg-red-700 text-white font-medium py-3 rounded-lg transition-colors"
            @click="stopRecording"
          >
            Stop Recording
          </button>

          <!-- Disconnect Button -->
          <button
            class="flex-none px-4 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
            @click="disconnect"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>

        <p v-if="remoteStream && !isRecording && !savedRecording" class="text-sm text-center text-gray-500">
          Auto-recording when stream starts
        </p>
      </div>

      <!-- Saved Recording Info -->
      <div v-if="savedRecording" class="card bg-green-900/20 border-green-700/50">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-medium text-green-400">Recording Saved</span>
          <span class="text-xs text-gray-500">{{ formatDuration(savedRecording.chunks.reduce((a,c)=>a+c.duration,0)) }}</span>
        </div>
        <code class="block p-2 bg-gray-900 rounded text-sm font-mono break-all text-xs mb-3">
          {{ savedRecording.id.slice(0, 16) }}...
        </code>
        <div class="flex gap-2">
          <button
            class="flex-1 py-2 bg-green-600 hover:bg-green-700 rounded text-white text-sm"
            @click="downloadRecording"
          >
            Download
          </button>
          <button
            class="flex-1 py-2 bg-primary-600 hover:bg-primary-700 rounded text-white text-sm"
            @click="playRecording"
          >
            Play
          </button>
        </div>
      </div>

      <!-- Recording Playback -->
      <div v-if="playbackUrl" class="card">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-medium text-gray-400">Recording Playback</span>
          <button 
            class="text-xs text-gray-500 hover:text-gray-300"
            @click="closePlayback"
          >
            Close
          </button>
        </div>
        <video
          :src="playbackUrl"
          controls
          class="w-full rounded bg-black"
          style="max-height: 200px;"
        />
      </div>
    </div>

    <!-- Debug Modal -->
    <DebugModal ref="debugModal" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useTrystero } from '../composables/useTrystero'
import { useRecording } from '../composables/useRecording'
import { useQRScanner } from '../composables/useQRScanner'
import type { Recording } from '../types'
import { getFullRoomId, isValidShortRoomId } from '../utils/roomId'
import { getPairedHome, setPairedHome, clearPairedHome, archiveRoomId } from '../lib/archive'
import DebugModal from '../components/DebugModal.vue'

const qrScanner = useQRScanner()

// Props for URL-based joining
const props = defineProps<{
  roomCode?: string
}>()

// Initialize composables
const trystero = useTrystero()
const recording = useRecording()

// State
const videoPlayer = ref<HTMLVideoElement>()
const qrVideo = ref<HTMLVideoElement>()
const qrCanvas = ref<HTMLCanvasElement>()
const debugModal = ref<InstanceType<typeof DebugModal>>()
const remoteStream = ref<MediaStream | null>(null)
const inputRoomCode = ref('')
const isConnected = ref(false)
const isConnecting = ref(false)
const isRecording = ref(false)
const recordingDuration = ref(0)
const savedRecording = ref<Recording | null>(null)
const isRetrying = ref(false)
const playbackUrl = ref<string | null>(null)
const showQRScanner = ref(false)
const selectedCameraId = ref('')
const availableCameras = ref<MediaDeviceInfo[]>([])
const noStreamHint = ref(false)
let durationInterval: number | null = null
let streamWatchdog: number | null = null

// How long to wait after joining before telling the user we can't reach the
// stream. It keeps trying in the background; this is just honest feedback.
const STREAM_TIMEOUT_MS = 20000

const counts = computed(() => trystero.counts.value)

// --- home archive forwarding ---
// A second, independent P2P connection: while this phone watches the demo, it
// re-broadcasts the received stream to the friend's home device so a copy is
// safe there too. The streamer is unaffected — it still sends just one stream.
const archiveFwd = useTrystero()
const pairedHome = ref<string | null>(getPairedHome())
const forwarding = ref(false)
const showPair = ref(false)
const pairInput = ref('')
watch(() => archiveFwd.peerCount.value, (n) => (forwarding.value = n > 0))

async function startForwarding(stream: MediaStream) {
  if (!pairedHome.value) return
  try {
    await archiveFwd.init(['both'])
    await archiveFwd.createRoom(archiveRoomId(pairedHome.value), ['both'], stream)
    console.log('[CollectView] Forwarding stream to home archive', pairedHome.value)
  } catch (e) {
    console.warn('[CollectView] Failed to start home forwarding:', e)
  }
}
function stopForwarding() {
  archiveFwd.leaveRoom()
  forwarding.value = false
}
function pairHome() {
  if (setPairedHome(pairInput.value)) {
    pairedHome.value = pairInput.value.toUpperCase()
    showPair.value = false
    pairInput.value = ''
    // If already watching, begin forwarding immediately.
    if (remoteStream.value) startForwarding(remoteStream.value)
  }
}
function unpairHome() {
  stopForwarding()
  clearPairedHome()
  pairedHome.value = null
}

onMounted(async () => {
  // Auto-join from URL only - don't request camera permission
  if (props.roomCode && isValidShortRoomId(props.roomCode)) {
    console.log('[CollectView] Auto-joining from URL:', props.roomCode)
    await joinStream(props.roomCode)
  }
})

async function joinStream(shortCode: string) {
  if (!shortCode || !isValidShortRoomId(shortCode)) {
    console.error('Invalid room code:', shortCode)
    return
  }
  
  const fullRoomId = getFullRoomId(shortCode)
  console.log('[CollectView] Joining room:', shortCode, '->', fullRoomId)
  
  // Stop QR scanner if running
  stopQRScanner()
  
  isConnecting.value = true
  savedRecording.value = null
  playbackUrl.value = null
  
  try {
    // Initialize Trystero with both strategies (try both)
    const initialized = await trystero.init(['both'])
    if (!initialized) {
      throw new Error('Failed to initialize Trystero')
    }

    // Join room with both strategies
    const joined = await trystero.joinRoom(fullRoomId, ['both'])
    if (!joined) {
      throw new Error('Failed to join room')
    }
    
    isConnected.value = true

    // Reachability watchdog: if no stream arrives in time, say so (keeps trying).
    noStreamHint.value = false
    if (streamWatchdog) clearTimeout(streamWatchdog)
    streamWatchdog = window.setTimeout(() => {
      if (!remoteStream.value) noStreamHint.value = true
    }, STREAM_TIMEOUT_MS)

    // Set up stream received callback
    trystero.setOnStreamReceived((stream: MediaStream) => {
      console.log('[CollectView] Received remote stream')
      remoteStream.value = stream
      noStreamHint.value = false
      if (streamWatchdog) { clearTimeout(streamWatchdog); streamWatchdog = null }

      // Auto-start recording when stream received
      if (!isRecording.value && !savedRecording.value) {
        setTimeout(() => startRecording(), 1000)
      }

      // If a home archive is paired, forward this stream on to it so a copy is
      // safe at home even if this phone is later seized.
      if (pairedHome.value) startForwarding(stream)
    })

    console.log('[CollectView] Successfully joined room')
    
  } catch (err: any) {
    console.error('[CollectView] Error joining stream:', err)
    trystero.error.value = err.message || 'Failed to connect'
  } finally {
    isConnecting.value = false
  }
}

async function retryConnection() {
  if (isRetrying.value) return
  
  const roomCode = props.roomCode || inputRoomCode.value
  if (!roomCode || !isValidShortRoomId(roomCode)) {
    console.error('Cannot retry: no valid room code')
    return
  }
  
  isRetrying.value = true
  
  disconnect()
  
  await new Promise(r => setTimeout(r, 500))
  await joinStream(roomCode)
  
  isRetrying.value = false
}

function disconnect() {
  console.log('[CollectView] Disconnecting')
  
  if (isRecording.value) {
    stopRecording()
  }
  
  trystero.leaveRoom()
  stopForwarding()
  remoteStream.value = null
  isConnected.value = false
  noStreamHint.value = false
  if (streamWatchdog) { clearTimeout(streamWatchdog); streamWatchdog = null }
}

async function startRecording() {
  if (!remoteStream.value) return
  
  console.log('[CollectView] Starting recording')
  const success = await recording.startRecording(remoteStream.value)
  if (success) {
    isRecording.value = true
    trystero.setRecording(true)
    recordingDuration.value = 0
    
    durationInterval = window.setInterval(() => {
      recordingDuration.value += 1000
    }, 1000)
  }
}

async function stopRecording() {
  console.log('[CollectView] Stopping recording')
  
  if (durationInterval) {
    clearInterval(durationInterval)
    durationInterval = null
  }
  
  const saved = await recording.stopRecording()
  isRecording.value = false
  trystero.setRecording(false)

  if (saved) {
    savedRecording.value = saved
    console.log('[CollectView] Recording saved:', saved.id)
  }
}

async function downloadRecording() {
  if (!savedRecording.value) return
  
  const blob = recording.getRecordingBlob(savedRecording.value.id)
  if (!blob) {
    console.error('No recording blob available')
    return
  }
  
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `collected-${inputRoomCode.value || props.roomCode}-${new Date().toISOString().slice(0,10)}.webm`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  
  console.log('[CollectView] Recording downloaded, size:', (blob.size / 1024 / 1024).toFixed(2), 'MB')
}

function playRecording() {
  if (!savedRecording.value) return
  
  const url = recording.getPlaybackUrl(savedRecording.value.id)
  if (url) {
    playbackUrl.value = url
  }
}

function closePlayback() {
  if (playbackUrl.value) {
    URL.revokeObjectURL(playbackUrl.value)
    playbackUrl.value = null
  }
}

function handleVideoCanPlay() {
  console.log('[CollectView] Video can play')
  if (videoPlayer.value) {
    videoPlayer.value.play().catch(err => {
      console.warn('Auto-play failed:', err)
    })
  }
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

// QR Scanner functions - only called when user clicks scan button
async function startQRScanner() {
  // Check prerequisites first
  if (!qrScanner.isSecureContext()) {
    alert('Camera access requires HTTPS. Please use a secure connection or access via localhost.')
    return
  }
  
  if (!qrScanner.isCameraSupported()) {
    alert('Camera not supported on this browser. Please use a modern mobile browser like Safari or Chrome.')
    return
  }
  
  showQRScanner.value = true
  
  // Get available cameras only when scanner is opened
  availableCameras.value = await qrScanner.getCameras()
  
  await nextTick()
  
  if (!qrVideo.value || !qrCanvas.value) {
    console.error('QR scanner elements not found')
    showQRScanner.value = false
    return
  }
  
  const success = await qrScanner.startScanning(
    qrVideo.value,
    qrCanvas.value,
    (data) => {
      console.log('[CollectView] QR Code detected:', data)
      
      // Extract room code from URL or direct input
      let roomCode = data.trim()
      
      // If it's a URL, extract the room code
      if (data.includes('/collect/')) {
        const match = data.match(/\/collect\/([A-Z0-9]{6})/i)
        if (match) {
          roomCode = match[1].toUpperCase()
        }
      }
      
      if (isValidShortRoomId(roomCode)) {
        inputRoomCode.value = roomCode
        joinStream(roomCode)
      } else {
        console.error('Invalid room code from QR:', roomCode)
        alert('Invalid QR code. Please scan a valid room code.')
      }
    },
    'environment' // Prefer back camera
  )
  
  if (!success) {
    console.error('Failed to start QR scanner:', qrScanner.error.value)
    alert(qrScanner.error.value || 'Failed to start camera. Please ensure you\'ve granted camera permission.')
    showQRScanner.value = false
  }
}

function stopQRScanner() {
  qrScanner.stopScanning()
  showQRScanner.value = false
}

async function restartQRScanner() {
  qrScanner.stopScanning()
  await nextTick()
  await startQRScanner()
}

// Watch for remote stream
watch(remoteStream, (newStream) => {
  if (videoPlayer.value && newStream) {
    videoPlayer.value.srcObject = newStream
  }
}, { immediate: true })

// Cleanup
onUnmounted(() => {
  if (durationInterval) clearInterval(durationInterval)
  if (streamWatchdog) clearTimeout(streamWatchdog)
  if (isRecording.value) {
    recording.stopRecording()
  }
  if (playbackUrl.value) {
    URL.revokeObjectURL(playbackUrl.value)
  }
  stopQRScanner()
  trystero.leaveRoom()
  archiveFwd.leaveRoom()
})

// Expose validation function to template
function isValidRoomCode(code: string): boolean {
  return isValidShortRoomId(code)
}
</script>
