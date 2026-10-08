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

        <!-- Also going out to a broadcast server -->
        <div v-if="amplify.state.value === 'live'" class="absolute top-16 left-4 flex items-center gap-1.5 px-2.5 py-1 bg-moss/80 rounded-full text-xs text-ink font-medium">
          <span class="w-1.5 h-1.5 rounded-full bg-ink" /> Broadcasting to server
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

        <!-- Viewers on links too slow for the full picture get less of it, down to sound only -->
        <div v-if="slowLinks" class="absolute top-16 right-4 px-2.5 py-1 bg-black/70 rounded-full text-xs text-yellow-200" data-testid="slow-links" title="Their connection cannot carry the full picture; it comes back when it can">
          🐢 {{ slowLinks }}
        </div>

        <!-- Strategy Badges: the transports actually open right now -->
        <div v-if="isRoomJoined" class="absolute bottom-24 left-4 flex gap-2">
          <span
            v-for="s in trystero.connectedStrategies.value"
            :key="s"
            class="px-2 py-1 bg-gray-800/80 rounded text-xs"
          >{{ STRATEGY_LABELS[s] }}</span>
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
        <div class="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/90 via-black/50 to-transparent pointer-events-auto">
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

        <div class="absolute inset-x-4 top-28 space-y-2 max-w-md pointer-events-auto">
          <!-- Live connection status: who found us, how they're connected, what's blocking -->
          <ConnectionDoctor
            v-if="isRoomJoined"
            :diagnosis="diagnosis"
            compact
            @action="onDoctorAction"
          />
          <!-- Storage warning: footage may stop persisting soon -->
          <div v-if="recording.storageWarning.value" class="p-3 bg-yellow-900/90 rounded-lg text-center">
            <p class="text-yellow-200 text-sm">{{ recording.storageWarning.value }}</p>
          </div>
        </div>

        <!-- Error Message -->
        <div v-if="trystero.error.value" class="absolute inset-x-4 bottom-32 p-4 bg-red-900/90 rounded-lg text-center">
          <p class="text-red-200">{{ trystero.error.value }}</p>
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

        <!-- Scrolls on small screens: everything below must stay reachable. -->
        <div class="flex-1 overflow-y-auto">
        <div class="min-h-full flex flex-col items-center justify-center p-6 space-y-6">
          <!-- QR Code -->
          <div class="bg-white p-6 rounded-xl">
            <canvas ref="qrCanvas" class="w-60 h-60" />
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

          <!-- Reachability of the link itself -->
          <div v-if="shareBase.reachability !== 'public'" class="w-full max-w-md text-xs text-yellow-200 bg-yellow-900/40 border border-yellow-500/30 rounded-lg px-3 py-2 leading-relaxed">
            <template v-if="shareBase.reachability === 'lan' && !shareBase.secure">This link only opens on your local network, and over plain http — where browsers switch off the camera and encryption this app needs.</template>
            <template v-else-if="shareBase.reachability === 'lan'">This link only opens on devices on your local network.</template>
            <template v-else>This link only opens on this device.</template>
            Phones elsewhere (e.g. on mobile data) should scan it from inside the app: Collect → Scan.
            <RouterLink to="/network" class="underline" @click="showQRModal = false">Set the app's public address</RouterLink>
            so any camera can open it.
          </div>
          <div v-if="relayInLink" class="w-full max-w-md text-xs text-moss">
            ✓ Your relay is included, so viewers behind strict networks can connect without setup.
          </div>
          <div v-if="attesting" class="w-full max-w-md text-xs text-slate-400" data-testid="attest-note">
            ✓ Every second this phone signs a fingerprint of its picture; viewers keep them with their copies, so each copy
            can later be checked against what this camera showed. The link carries the key (<span class="font-mono">{{ streamKeyHex.slice(0, 8) }}…</span>),
            made for this stream only.
          </div>
          <div v-else-if="!diag.relayConfigured.value" class="w-full max-w-md text-xs text-slate-400">
            No relay configured — viewers on strict networks (VPN, mobile data) may not get through.
            <button class="text-glow underline" @click="openRelay(false)">Set one up</button>
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

          <!-- Beyond the app: a broadcast server for everyone else -->
          <AmplifyPanel :amp="amplify" :stream="localStream" role="streamer" class="w-full max-w-md" />

          <!-- Instructions -->
          <div class="text-center text-sm text-gray-400 max-w-sm">
            <p>Share this code or QR with collectors to join your stream.</p>
            <p class="mt-2">BitTorrent, Nostr and MQTT are all used for maximum reliability.</p>
          </div>
        </div>
        </div>
      </div>
    </Teleport>

    <RelaySetup v-model:open="showRelay" :auto-test="relayAutoTest" :show-stun="diag.natKind.value === 'blocked'" @saved="onRelaySaved" @share-changed="settingsTick++" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useTrystero } from '../composables/useTrystero'
import { useRecording } from '../composables/useRecording'
import { useLocalIP } from '../composables/useLocalIP'
import { useWakeLock } from '../composables/useWakeLock'
import { useConnectionDiagnosis } from '../composables/useConnectionDiagnosis'
import { generateShortRoomId } from '../utils/roomId'
import { resolveShareBase, buildCollectUrl, getConfiguredPublicUrl } from '../lib/net/shareLink'
import { appBase, usesHashRoutes } from '../lib/appLocation'
import { relayShareParams } from '../lib/net/iceConfig'
import { discoveryShareParams } from '../lib/net/discoveryConfig'
import type { DiagnosisAction } from '../lib/net/diagnosis'
import ConnectionDoctor from '../components/ConnectionDoctor.vue'
import RelaySetup from '../components/RelaySetup.vue'
import AmplifyPanel from '../components/AmplifyPanel.vue'
import { useAmplify } from '../composables/useAmplify'
import type { RoomChannel } from '../composables/useTrystero'
import { generateIdentity } from '../lib/integrity/identity'
import { toHex } from '../lib/integrity/hashing'
import { startAttestor, type Attestor } from '../lib/corroborate/frames'
import { TIER_LABEL } from '../lib/net/linkShaping'
import { RouterLink } from 'vue-router'
import QRCode from 'qrcode'

const router = useRouter()
const trystero = useTrystero()
const recording = useRecording()
const localIP = useLocalIP()

// State
const videoPreview = ref<HTMLVideoElement>()
const qrCanvas = ref<HTMLCanvasElement>()
const localStream = ref<MediaStream | null>(null)
const amplify = useAmplify(localStream)
const STRATEGY_LABELS: Record<string, string> = {
  torrent: '🌊 BitTorrent',
  nostr: '🐦 Nostr',
  mqtt: '📡 MQTT',
}
const roomCode = ref('')
const isRoomJoined = ref(false)
const showQRModal = ref(false)
const canShare = ref(typeof navigator !== 'undefined' && !!navigator.share)
const isRecording = ref(false)
const recordingDuration = ref(0)
const copied = ref(false)
const wakeLock = useWakeLock()
let durationInterval: number | null = null
let recoveringCamera = false

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: 'environment',
    width: { ideal: 1280 },
    height: { ideal: 720 }
  },
  audio: true
}

// Live attestations (lib/corroborate): a key for this stream alone, never
// stored, so nothing links this stream to the phone's other streams.
const streamKey = generateIdentity()
const streamKeyHex = toHex(streamKey.publicKey)
const attesting = ref(false)
let attestor: Attestor | null = null
const attestChannel: RoomChannel = trystero.addChannel('attest', { onData: () => {} })

function startAttesting(stream: MediaStream) {
  if (attestor) {
    attestor.setStream(stream)
    return
  }
  attestor = startAttestor(stream, streamKey, (a) => {
    attestChannel.broadcast(a)
    // The filmer's own recording carries them too.
    recording.noteAttestation(a)
  })
  attesting.value = true
}
function stopAttesting() {
  attestor?.stop()
  attestor = null
  attesting.value = false
}

const peerCount = computed(() => trystero.peerCount.value)
const slowLinks = computed(() => {
  const tiers = [...trystero.linkTiers.value.values()]
  if (!tiers.length) return ''
  const n = (t: string) => tiers.filter((x) => x === t).length
  const parts = [
    n('reduced') && `${n('reduced')} ${TIER_LABEL.reduced}`,
    n('minimal') && `${n('minimal')} ${TIER_LABEL.minimal}`,
    n('audio') && `${n('audio')} ${TIER_LABEL.audio}`,
  ].filter(Boolean)
  return `${tiers.length} slow ${tiers.length === 1 ? 'link' : 'links'}: ${parts.join(', ')}`
})
const counts = computed(() => trystero.counts.value)

// --- connection status + relay setup ---
const diag = useConnectionDiagnosis(trystero, { role: 'streamer' })
const diagnosis = diag.diagnosis
const showRelay = ref(false)
const relayAutoTest = ref(false)
const settingsTick = ref(0)

function openRelay(autoTest: boolean) {
  relayAutoTest.value = autoTest
  showRelay.value = true
}

function onDoctorAction(action: DiagnosisAction) {
  if (action === 'setup-relay') openRelay(false)
  else if (action === 'test-relay') openRelay(true)
  else if (action === 'retry') restartRoom()
  else if (action === 'pair-offline') router.push('/offline')
  else if (action === 'pair-messenger') router.push('/offline?over=internet')
}

// Relay settings only apply to connections made after them: re-open the
// room (same code) so every new viewer negotiates with the relay available.
async function onRelaySaved() {
  diag.refreshRelay()
  settingsTick.value++
  if (isRoomJoined.value) await restartRoom()
}

async function restartRoom() {
  if (!localStream.value || !roomCode.value) return
  console.log('[StreamView] Re-opening room with updated network settings')
  await trystero.createRoom(`p2pstream-v1-${roomCode.value}`, ['both'], localStream.value)
  trystero.setRecording(isRecording.value)
}

// The link must open on *other* devices: prefer the app's public address,
// and carry the relay + discovery relays so viewers need no setup.
const shareBase = computed(() => {
  void settingsTick.value
  return resolveShareBase({
    origin: appBase(),
    hashRoutes: usesHashRoutes(),
    configured: getConfiguredPublicUrl(),
    envPublicUrl: (import.meta as any).env?.VITE_PUBLIC_URL ?? null,
    lanIp: localIP.localIP.value || null,
  })
})
const linkParams = computed(() => {
  void settingsTick.value
  return { ...relayShareParams(), ...discoveryShareParams(), fk: streamKeyHex }
})
const relayInLink = computed(() => 'turn' in linkParams.value || 'ice' in linkParams.value)
const shareUrl = computed(() => (roomCode.value ? buildCollectUrl(shareBase.value.base, roomCode.value, linkParams.value, shareBase.value.hash) : ''))

onMounted(async () => {
  // Generate room code
  roomCode.value = generateShortRoomId()
  
  // Detect the LAN address (only used when running from a localhost dev server)
  localIP.detectIP()

  console.log('[StreamView] Generated room:', roomCode.value)
  console.log('[StreamView] Share URL:', shareUrl.value)
  
  document.addEventListener('visibilitychange', handleVisibility)

  // Initialize camera and stream
  await initStream()
})

async function initStream() {
  // navigator.mediaDevices only exists in secure contexts (https:// or
  // localhost). Opening the dev server via a LAN IP over plain http lands
  // here — fail with a message that says how to fix it, not a TypeError.
  if (!navigator.mediaDevices?.getUserMedia) {
    trystero.error.value =
      'Camera unavailable: this page is not a secure context. Open the app via https:// or localhost (for phones, use an HTTPS tunnel — see docs/ON_DEVICE_TESTING.md).'
    return
  }
  try {
    // Initialize Trystero with both strategies (try both)
    const initialized = await trystero.init(['both'])
    if (!initialized) {
      throw new Error('Failed to initialize Trystero')
    }

    // Get camera stream
    localStream.value = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
    watchCameraHealth(localStream.value)

    if (videoPreview.value) {
      videoPreview.value.srcObject = localStream.value
    }
    startAttesting(localStream.value)

    // Open the room AS the streamer, handing it the stream so every peer —
    // including ones who join later — receives the video via onPeerJoin.
    const fullRoomId = `p2pstream-v1-${roomCode.value}`
    const created = await trystero.createRoom(fullRoomId, ['both'], localStream.value)
    if (!created) {
      throw new Error('Failed to create room')
    }

    isRoomJoined.value = true
    trystero.error.value = null
    // Screen lock suspends capture in mobile browsers — hold the screen awake
    // for as long as we're live.
    wakeLock.request()

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

// Mobile OSes end camera tracks on screen lock / backgrounding. When we come
// back (or the track dies in place), grab a fresh camera, swap it into every
// live connection, and roll the recording into a new verifiable segment.
function watchCameraHealth(stream: MediaStream) {
  const track = stream.getVideoTracks()[0]
  if (track) track.onended = () => recoverCamera('camera track ended')
}

function handleVisibility() {
  const track = localStream.value?.getVideoTracks()[0]
  if (document.visibilityState === 'visible' && track && track.readyState === 'ended') {
    recoverCamera('returned to foreground with dead camera')
  }
}

async function recoverCamera(reason: string) {
  if (recoveringCamera || !isRoomJoined.value) return
  recoveringCamera = true
  console.warn(`[StreamView] Recovering camera (${reason})`)
  try {
    const wasRecording = isRecording.value
    if (wasRecording) await stopRecording() // bank the finished segment first
    const fresh = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
    localStream.value?.getTracks().forEach(t => t.stop())
    localStream.value = fresh
    watchCameraHealth(fresh)
    if (videoPreview.value) videoPreview.value.srcObject = fresh
    startAttesting(fresh)
    trystero.updateStream(fresh) // one copy per watcher, via each media-owning room
    trystero.error.value = null
    if (wasRecording) await startRecording()
    console.log('[StreamView] Camera recovered, stream re-sent to peers')
  } catch (err: any) {
    console.error('[StreamView] Camera recovery failed:', err)
    trystero.error.value = 'Camera lost — tap Stream again or check permissions'
  } finally {
    recoveringCamera = false
  }
}

async function startRecording() {
  if (!localStream.value) return
  
  console.log('[StreamView] Starting recording')
  const success = await recording.startRecording(localStream.value, 'medium', roomCode.value ? `room-${roomCode.value}` : undefined)
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
  
  stopAttesting()
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

// Generate QR code when modal is shown.
// Wait for the modal's v-if to render the canvas FIRST — at the moment
// showQRModal flips true the canvas doesn't exist yet, so nextTick must come
// before we read qrCanvas (otherwise the QR silently never draws — blank box).
watch([showQRModal, shareUrl], async ([show]) => {
  if (!show) return
  await nextTick()
  if (!qrCanvas.value || !shareUrl.value) return
  try {
    await QRCode.toCanvas(qrCanvas.value, shareUrl.value, {
      width: 240,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    })
  } catch (err) {
    console.error('Failed to generate QR code:', err)
  }
})

// Cleanup
onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibility)
  if (durationInterval) clearInterval(durationInterval)
  if (isRecording.value) {
    recording.stopRecording()
  }
  stopAttesting()
  attestChannel.remove()
  trystero.leaveRoom()
  localStream.value?.getTracks().forEach(t => t.stop())
})
</script>
