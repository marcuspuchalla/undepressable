<template>
  <div class="h-full flex flex-col">
    <!-- Video Preview with Overlay Controls -->
    <div class="flex-1 relative bg-black">
      <video
        ref="videoPreview"
        autoplay
        playsinline
        muted
        class="w-full h-full object-cover"
      />
      
      <!-- Video Overlay Controls -->
      <div class="absolute inset-0 pointer-events-none">
        <!-- Recording Indicator -->
        <div v-if="isRecording" class="absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 bg-red-600/90 rounded-full pointer-events-auto">
          <div class="w-3 h-3 bg-white rounded-full animate-pulse" />
          <span class="text-sm font-medium">{{ formatDuration(recordingDuration) }}</span>
        </div>

        <!-- Live swarm counts -->
        <div class="absolute top-4 right-4 flex gap-2">
          <div class="px-3 py-1.5 bg-primary-600/90 rounded-full flex items-center gap-1.5" title="People watching your stream">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            <span class="text-sm font-medium tabular-nums">{{ counts.watching }}</span>
          </div>
          <div class="px-3 py-1.5 bg-red-600/90 rounded-full flex items-center gap-1.5" title="People recording a copy right now">
            <div class="w-2.5 h-2.5 bg-white rounded-full" />
            <span class="text-sm font-medium tabular-nums">{{ counts.recording }}</span>
          </div>
        </div>

        <!-- Strategy Badges -->
        <div v-if="isRoomJoined" class="absolute bottom-24 left-4 flex gap-2">
          <span class="px-2 py-1 bg-gray-800/80 rounded text-xs">🌊 BitTorrent</span>
          <span class="px-2 py-1 bg-gray-800/80 rounded text-xs">🐦 Nostr</span>
        </div>

        <!-- Room Info -->
        <div v-if="roomCode && isRoomJoined" class="absolute top-16 left-4 pointer-events-auto">
          <button 
            @click="showQRModal = true"
            class="px-3 py-1.5 bg-black/70 rounded-lg hover:bg-black/90 transition-colors"
          >
            <span class="font-mono text-lg font-bold">{{ roomCode }}</span>
          </button>
        </div>

        <!-- Main Controls - Overlay at Bottom -->
        <div class="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/90 via-black/50 to-transparent">
          <!-- Recording Buttons -->
          <div class="flex items-center justify-center gap-4 mb-4">
            <template v-if="!isRecording">
              <button
                class="w-16 h-16 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center shadow-lg transition-all hover:scale-105 active:scale-95"
                @click="startRecording"
                :disabled="!isRoomJoined"
                title="Start Recording"
              >
                <div class="w-6 h-6 bg-white rounded-sm" />
              </button>
            </template>
            <template v-else>
              <button
                class="w-16 h-16 rounded-full bg-gray-200 hover:bg-white flex items-center justify-center shadow-lg transition-all hover:scale-105 active:scale-95"
                @click="stopRecording"
                title="Stop Recording"
              >
                <div class="w-6 h-6 bg-red-600 rounded-sm" />
              </button>
            </template>

            <!-- Toggle QR Button -->
            <button
              v-if="isRoomJoined"
              class="w-12 h-12 rounded-full bg-gray-800/80 hover:bg-gray-700 flex items-center justify-center backdrop-blur-sm transition-colors"
              @click="showQRModal = true"
              title="Show QR Code"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4h2v-4zM6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>

            <!-- End Stream Button -->
            <button
              v-if="isRoomJoined"
              class="w-12 h-12 rounded-full bg-gray-800/80 hover:bg-red-900/80 flex items-center justify-center backdrop-blur-sm transition-colors"
              @click="endStream"
              title="End Stream"
            >
              <svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Error Message -->
        <div v-if="trystero.error" class="absolute inset-x-4 bottom-32 p-4 bg-red-900/90 rounded-lg text-center">
          <p class="text-red-200">{{ trystero.error }}</p>
        </div>
      </div>
    </div>

    <!-- Room Code Modal -->
    <Teleport to="body">
      <div
        v-if="showQRModal"
        class="fixed inset-0 bg-black/90 z-50 flex flex-col"
        @click.self="showQRModal = false"
      >
        <div class="flex-none p-4 flex items-center justify-between border-b border-gray-800">
          <h2 class="text-lg font-semibold">Share Stream</h2>
          <button
            class="p-2 hover:bg-gray-800 rounded-lg"
            @click="showQRModal = false"
          >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="flex-1 flex flex-col items-center justify-center p-6 space-y-6">
          <!-- QR Code -->
          <div class="bg-white p-6 rounded-xl">
            <canvas ref="qrCanvas" class="w-48 h-48" />
          </div>

          <!-- Room Code -->
          <div class="text-center">
            <p class="text-sm text-gray-400 mb-2">Room Code</p>
            <div 
              class="font-mono text-4xl font-bold tracking-widest cursor-pointer hover:text-primary-400 transition-colors"
              @click="copyRoomCode"
            >
              {{ roomCode }}
            </div>
            <p v-if="copied" class="text-sm text-green-400 mt-2">Copied!</p>
          </div>

          <!-- Share URL -->
          <div class="w-full max-w-md space-y-2">
            <p class="text-sm text-gray-400">Share URL</p>
            <div class="flex gap-2">
              <code class="flex-1 p-3 bg-gray-900 rounded-lg text-sm font-mono break-all text-gray-300">
                {{ shareUrl }}
              </code>
              <button
                class="flex-none px-4 py-2 bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
                @click="copyShareUrl"
              >
                Copy
              </button>
            </div>
          </div>

          <!-- Share via Web Share -->
          <button
            v-if="canShare"
            class="px-6 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg flex items-center gap-2"
            @click="shareViaNative"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            Share
          </button>

          <!-- Instructions -->
          <div class="text-center text-sm text-gray-400 max-w-sm">
            <p>Share this code or QR with collectors to join your stream.</p>
            <p class="mt-2">Both BitTorrent and Nostr are being used for maximum reliability.</p>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useTrystero } from '../composables/useTrystero'
import { useRecording } from '../composables/useRecording'
import { useLocalIP } from '../composables/useLocalIP'
import { generateShortRoomId } from '../utils/roomId'
import QRCode from 'qrcode'

const router = useRouter()
const trystero = useTrystero()
const recording = useRecording()
const localIP = useLocalIP()

// State
const videoPreview = ref<HTMLVideoElement>()
const qrCanvas = ref<HTMLCanvasElement>()
const localStream = ref<MediaStream | null>(null)
const roomCode = ref('')
const shareUrl = ref('')
const isRoomJoined = ref(false)
const showQRModal = ref(false)
const canShare = ref(typeof navigator !== 'undefined' && !!navigator.share)
const isRecording = ref(false)
const recordingDuration = ref(0)
const copied = ref(false)
let durationInterval: number | null = null

const peerCount = computed(() => trystero.peerCount.value)
const counts = computed(() => trystero.counts.value)

onMounted(async () => {
  // Generate room code
  roomCode.value = generateShortRoomId()
  
  // Detect local IP
  localIP.detectIP()
  
  // Build share URL using localIP composable
  const baseUrl = localIP.getShareUrl()
  shareUrl.value = `${baseUrl}/collect/${roomCode.value}`
  
  console.log('[StreamView] Generated room:', roomCode.value)
  console.log('[StreamView] Share URL:', shareUrl.value)
  
  // Initialize camera and stream
  await initStream()
})

async function initStream() {
  try {
    // Initialize Trystero with both strategies (try both)
    const initialized = await trystero.init(['both'])
    if (!initialized) {
      throw new Error('Failed to initialize Trystero')
    }

    // Get camera stream
    localStream.value = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: true
    })

    if (videoPreview.value) {
      videoPreview.value.srcObject = localStream.value
    }

    // Open the room AS the streamer, handing it the stream so every peer —
    // including ones who join later — receives the video via onPeerJoin.
    const fullRoomId = `p2pstream-v1-${roomCode.value}`
    const created = await trystero.createRoom(fullRoomId, ['both'], localStream.value)
    if (!created) {
      throw new Error('Failed to create room')
    }

    isRoomJoined.value = true

    console.log('[StreamView] Stream initialized and room created')
    
    // Auto-start recording when stream is ready
    setTimeout(() => {
      if (isRoomJoined.value && !isRecording.value) {
        startRecording()
      }
    }, 1500)

  } catch (err: any) {
    console.error('[StreamView] Error initializing stream:', err)
    trystero.error.value = err.message || 'Failed to initialize stream'
  }
}

async function startRecording() {
  if (!localStream.value) return
  
  console.log('[StreamView] Starting recording')
  const success = await recording.startRecording(localStream.value)
  if (success) {
    isRecording.value = true
    trystero.setRecording(true)
    recordingDuration.value = 0
    
    durationInterval = window.setInterval(() => {
      recordingDuration.value += 1000
    }, 1000)
    
    // Show QR modal to encourage sharing
    if (peerCount.value === 0) {
      showQRModal.value = true
    }
  }
}

async function stopRecording() {
  console.log('[StreamView] Stopping recording')
  
  if (durationInterval) {
    clearInterval(durationInterval)
    durationInterval = null
  }
  
  await recording.stopRecording()
  isRecording.value = false
  trystero.setRecording(false)
}

function endStream() {
  console.log('[StreamView] Ending stream')
  
  if (isRecording.value) {
    stopRecording()
  }
  
  trystero.leaveRoom()
  localStream.value?.getTracks().forEach(t => t.stop())
  
  router.push('/')
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

function copyRoomCode() {
  navigator.clipboard.writeText(roomCode.value)
  copied.value = true
  setTimeout(() => copied.value = false, 2000)
}

function copyShareUrl() {
  navigator.clipboard.writeText(shareUrl.value)
  copied.value = true
  setTimeout(() => copied.value = false, 2000)
}

async function shareViaNative() {
  try {
    await navigator.share({
      title: 'P2P Stream',
      text: `Join my stream with code: ${roomCode.value}`,
      url: shareUrl.value
    })
  } catch (err) {
    console.log('Share cancelled')
  }
}

// Generate QR code when modal is shown
watch(showQRModal, async (show) => {
  if (show && qrCanvas.value) {
    await nextTick()
    try {
      await QRCode.toCanvas(qrCanvas.value, shareUrl.value, {
        width: 192,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      })
    } catch (err) {
      console.error('Failed to generate QR code:', err)
    }
  }
})

// Cleanup
onUnmounted(() => {
  if (durationInterval) clearInterval(durationInterval)
  if (isRecording.value) {
    recording.stopRecording()
  }
  trystero.leaveRoom()
  localStream.value?.getTracks().forEach(t => t.stop())
})
</script>
