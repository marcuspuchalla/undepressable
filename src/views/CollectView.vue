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
        :muted="videoMuted"
        class="w-full h-full object-cover"
        @canplay="handleVideoCanPlay"
      />
      <!-- Muted-by-default so the browser always autoplays; toggle sound on/off. -->
      <button
        v-if="remoteStream"
        class="absolute bottom-20 right-4 z-10 px-3 py-1.5 bg-black/70 hover:bg-black/85 rounded-full text-white text-xs flex items-center gap-1.5"
        @click="toggleMute"
      >
        <svg v-if="videoMuted" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l4-4m0 4l-4-4" /></svg>
        <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728" /></svg>
        {{ videoMuted ? 'Tap for sound' : 'Mute' }}
      </button>
      
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
          <!-- What is actually happening: searching, negotiating, or blocked by NAT -->
          <ConnectionDoctor
            v-else-if="isConnected"
            :diagnosis="diagnosis"
            class="mt-3 max-w-sm mx-auto"
            @action="onDoctorAction"
          />
        </div>
      </div>

      <!-- Sound only: the link is too slow for the picture; the stream itself is fine -->
      <div v-if="soundOnly && !streamInterrupted && remoteStream" class="absolute inset-x-0 top-14 z-10 flex justify-center px-4" data-testid="sound-only">
        <div class="px-3 py-2 rounded-lg bg-black/80 text-center text-xs max-w-sm">
          <p class="text-yellow-200 font-medium">🔊 Sound only — the connection is too slow for the picture right now</p>
          <p class="text-gray-400 mt-0.5">Still recording. The picture comes back when the connection allows.</p>
        </div>
      </div>

      <!-- Stream interrupted: keep the last frame visible, be honest about state -->
      <div v-if="streamInterrupted && remoteStream" class="absolute inset-0 z-10 flex items-center justify-center bg-black/60">
        <div class="text-center p-6">
          <div class="w-8 h-8 mx-auto mb-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
          <p class="text-yellow-300 font-medium">Stream interrupted</p>
          <p class="text-xs text-gray-400 mt-1">Reconnecting automatically. Your recording so far is saved.</p>
          <ConnectionDoctor
            v-if="diagnosis.level === 'error' || diagnosis.level === 'warn'"
            :diagnosis="diagnosis"
            compact
            class="mt-3 max-w-sm mx-auto"
            @action="onDoctorAction"
          />
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

      <!-- Strategy Badges: the transports actually open right now -->
      <div v-if="isConnecting || remoteStream" class="absolute bottom-4 left-4 flex gap-2">
        <span
          v-for="s in trystero.connectedStrategies.value"
          :key="s"
          class="px-2 py-1 bg-gray-800/80 rounded text-xs"
        >{{ STRATEGY_LABELS[s] }}</span>
        <span
          v-if="remoteStream && diagnosis.path"
          class="px-2 py-1 rounded text-xs"
          :class="diagnosis.path === 'relay' ? 'bg-glow/20 text-glow' : 'bg-moss/20 text-moss'"
          :title="diagnosis.path === 'relay' ? 'Video comes through your relay (still end-to-end encrypted)' : 'Video comes straight from the streamer'"
        >{{ PATH_LABELS[diagnosis.path] }}</span>
      </div>

      <!-- Storage warning: footage may stop persisting soon -->
      <div v-if="recording.storageWarning.value" class="absolute inset-x-4 top-16 p-3 bg-yellow-900/90 rounded-lg text-center z-10">
        <p class="text-yellow-200 text-sm">{{ recording.storageWarning.value }}</p>
      </div>

      <!-- Connection Error (never over a stream that's actually playing) -->
      <div v-if="trystero.error.value && !remoteStream" class="absolute inset-x-4 bottom-20 p-4 bg-red-900/90 rounded-lg text-center">
        <p class="text-red-200 mb-2">{{ trystero.error.value }}</p>
        <button
          v-if="!isRetrying"
          class="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-white text-sm"
          @click="retryConnection()"
        >
          Retry
        </button>
      </div>
    </div>

    <!-- Controls -->
    <div class="flex-none p-4 bg-gray-900 border-t border-gray-800 space-y-4">
      <!-- Relay tree: help carry the stream to others (hybrid: on by default) -->
      <div v-if="isConnected || remoteStream" class="flex items-center gap-2 text-xs">
        <svg class="w-4 h-4 shrink-0" :class="trystero.relayingToCount.value > 0 ? 'text-moss' : 'text-slate-500'" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
        <span class="text-slate-400">
          <template v-if="trystero.relayingToCount.value > 0">
            Relaying to {{ trystero.relayingToCount.value }} viewer{{ trystero.relayingToCount.value === 1 ? '' : 's' }}
          </template>
          <template v-else-if="trystero.relayEnabled.value">Ready to relay for others</template>
          <template v-else>Not relaying (saves data)</template>
        </span>
        <button
          class="ml-auto text-glow hover:underline"
          @click="trystero.setRelayEnabled(!trystero.relayEnabled.value)"
        >{{ trystero.relayEnabled.value ? 'Turn off (uses upload data)' : 'Turn on' }}</button>
      </div>

      <!-- Home archive forwarding -->
      <div class="flex items-center gap-2 text-xs">
        <svg class="w-4 h-4 shrink-0" :class="pairedHome ? 'text-moss' : 'text-slate-500'" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
        <template v-if="pairedHome">
          <span class="text-slate-400">
            Home archive
            <span class="font-mono text-slate-300">{{ pairedHome }}</span>:
            <span :class="archiveStatus.tone">{{ archiveStatus.text }}</span>
            <button
              v-if="archiveStatus.action"
              class="ml-1 text-glow underline"
              @click="onDoctorAction(archiveStatus.action)"
            >fix</button>
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
        <button class="btn-secondary px-4 text-sm" @click="pairHome()">Pair</button>
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
              @keyup.enter="isValidRoomCode(inputRoomCode) && joinStream(inputRoomCode, null)"
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
          @click="joinStream(inputRoomCode, null)"
        >
          <span v-if="isConnecting">Connecting...</span>
          <span v-else>Join Stream</span>
        </button>

        <!-- Auto-join info (from URL) -->
        <div v-else-if="isConnecting" class="text-center text-gray-400">
          <div class="w-8 h-8 mx-auto mb-2 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p>Connecting to {{ props.roomCode }}...</p>
        </div>
        <!-- Joined from a link, then left: offer the way back in -->
        <div v-else class="flex gap-2">
          <button class="flex-1 btn-emergency py-3" @click="joinStream(props.roomCode!)">Join {{ props.roomCode }} again</button>
          <button class="flex-none px-4 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm" @click="enterAnotherCode">Other code</button>
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
            @click="stopRecordingManually"
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
        <p v-if="attestedSeconds > 0" class="text-xs text-center text-moss" data-testid="attested-count">
          ✓ The filming phone signs its picture twice a second — {{ attestedSeconds }} kept with your copy{{ filmerKey ? '' : ' (key not in your link: compare it with the filmer)' }}
        </p>

        <!-- Pass it on to a broadcast server (e.g. from where the server isn't blocked) -->
        <AmplifyPanel v-if="remoteStream" :amp="amplify" :stream="remoteStream" role="viewer" />
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
        <p v-if="savedRecording.sealed" class="text-xs text-amber-200 leading-relaxed" data-testid="saved-sealed">
          🔒 Sealed as it was recorded — this phone keeps no readable copy. Open or send it from Recordings.
        </p>
        <div v-else class="flex gap-2">
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
    <RelaySetup v-model:open="showRelay" :auto-test="relayAutoTest" :show-stun="diag.natKind.value === 'blocked'" @saved="onRelaySaved" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useTrystero } from '../composables/useTrystero'
import { useRecording } from '../composables/useRecording'
import { useQRScanner } from '../composables/useQRScanner'
import { useWakeLock } from '../composables/useWakeLock'
import type { Recording } from '../types'
import { getFullRoomId, isValidShortRoomId } from '../utils/roomId'
import { getPairedHome, setPairedHome, clearPairedHome, archiveRoomId } from '../lib/archive'
import { setPairedHomeSealKey } from '../lib/seal/keys'

// The `seal` parameter of a scanned pairing link (in the query or the hash).
function sealKeyFromLink(link: string): string | null {
  const q = link.indexOf('?')
  return q >= 0 ? new URLSearchParams(link.slice(q + 1)).get('seal') : null
}
import { createStallMonitor } from '../lib/net/streamHealth'
import { extractRoomCode, extractHomeKey } from '../lib/net/shareLink'
import { isOfflineSignal } from '../lib/net/offlinePair'
import { adoptRelayFromUrl } from '../lib/net/iceConfig'
import { adoptDiscoveryFromUrl } from '../lib/net/discoveryConfig'
import type { DiagnosisAction } from '../lib/net/diagnosis'
import { useConnectionDiagnosis } from '../composables/useConnectionDiagnosis'
import DebugModal from '../components/DebugModal.vue'
import ConnectionDoctor from '../components/ConnectionDoctor.vue'
import RelaySetup from '../components/RelaySetup.vue'
import AmplifyPanel from '../components/AmplifyPanel.vue'
import { useAmplify } from '../composables/useAmplify'
import { useRouter } from 'vue-router'
import type { RoomChannel } from '../composables/useTrystero'
import { createIntake } from '../lib/corroborate/log'
import type { Attestation } from '../lib/corroborate/attest'
import { linkSearch } from '../lib/appLocation'

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
const videoMuted = ref(true)

// Display labels for the live connection badges.
const STRATEGY_LABELS: Record<string, string> = {
  torrent: '🌊 BitTorrent',
  nostr: '🐦 Nostr',
  mqtt: '📡 MQTT',
}
const PATH_LABELS: Record<string, string> = { lan: '⇄ local', direct: '⇄ direct', relay: '⇄ via relay' }
const qrVideo = ref<HTMLVideoElement>()
const qrCanvas = ref<HTMLCanvasElement>()
const debugModal = ref<InstanceType<typeof DebugModal>>()
const remoteStream = ref<MediaStream | null>(null)
const amplify = useAmplify(remoteStream)
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
const streamInterrupted = ref(false)
const soundOnly = ref(false)
// Auto-record every stream (including post-reconnect segments) until the user
// explicitly presses Stop.
const autoRecord = ref(true)
const wakeLock = useWakeLock()
let durationInterval: number | null = null
let streamWatchdog: number | null = null

// Serialize recording lifecycle transitions. Stream-loss finalization and
// reconnect segment-rolls arrive from independent events and would otherwise
// interleave stop/start on the recorder.
let recOps: Promise<unknown> = Promise.resolve()
function queueRecordingOp(fn: () => Promise<void>): Promise<unknown> {
  recOps = recOps.then(fn, fn)
  return recOps
}

// How long to wait after joining before telling the user we can't reach the
// stream. It keeps trying in the background; this is just honest feedback.
const STREAM_TIMEOUT_MS = 12000
// Silently re-establish the connection a couple of times before bothering the
// user with a manual "Retry" — a fresh join often lands on faster relays.
const MAX_AUTO_RETRIES = 2
const autoRetries = ref(0)
// A connection that found the streamer and is mid-negotiation (often a relay
// path through a VPN) must not be torn down by the rejoin — that would restart
// it from zero with the same odds. Give it a few more rounds instead.
const MAX_WATCHDOG_EXTENSIONS = 3
let watchdogExtensions = 0
// How often we ask WebRTC whether bytes are still arriving.
const STALL_POLL_MS = 2000
const stallMonitor = createStallMonitor()
let stallTimer: number | null = null

const counts = computed(() => trystero.counts.value)
const router = useRouter()

// --- the filmer's live attestations (lib/corroborate) ---
// The share link carries the key the filming phone signs with (fk=…): then
// only attestations under that key are kept, whoever relays them. Joined by
// typing the code there is no key to hold them to, so only what the peer
// sending the stream says counts.
const filmerKey = ref<string | null>(null)
const attestedSeconds = ref(0)
let attestChannel: RoomChannel | null = null
function filmerKeyFrom(search: string): string | null {
  const k = new URLSearchParams(search).get('fk')?.toLowerCase() ?? null
  return k && /^[0-9a-f]{64}$/.test(k) ? k : null
}
function listenForAttestations() {
  attestChannel?.remove()
  const take = createIntake({ expectedKey: filmerKey.value, isSource: (peerId) => trystero.isStreamerPeer(peerId) })
  attestChannel = trystero.addChannel('attest', {
    onData(data, peerId) {
      const a = take(data, peerId)
      if (!a) return
      // Only while the picture is arriving: a moment recorded as a frozen
      // frame (sound only, or interrupted) would read as a cut when checked.
      if (soundOnly.value || streamInterrupted.value) return
      if (recording.noteAttestation(a)) attestedSeconds.value++
      forwardAttestation(a)
    },
  })
}

// --- connection status + relay setup ---
const diag = useConnectionDiagnosis(trystero, {
  role: 'collector',
  hasStream: () => !!remoteStream.value && !streamInterrupted.value,
})
const diagnosis = diag.diagnosis
const showRelay = ref(false)
const relayAutoTest = ref(false)

function onDoctorAction(action: DiagnosisAction) {
  if (action === 'setup-relay' || action === 'test-relay') {
    relayAutoTest.value = action === 'test-relay'
    showRelay.value = true
  } else if (action === 'check-code') {
    enterAnotherCode()
  } else if (action === 'pair-offline') {
    router.push('/offline')
  } else if (action === 'pair-messenger') {
    router.push('/offline?over=internet')
  } else if (action === 'retry') {
    retryConnection()
  }
}

// Relay settings only reach connections made after them — rejoin.
function onRelaySaved() {
  diag.refreshRelay()
  if (isConnected.value || remoteStream.value) retryConnection()
}

function enterAnotherCode() {
  const code = props.roomCode || inputRoomCode.value
  disconnect()
  inputRoomCode.value = code ?? ''
  if (props.roomCode) router.push('/collect')
}

// A phone moving between networks (Wi-Fi → mobile, or back from a dead
// zone) fires 'online'. Rejoin promptly instead of waiting out the watchdog.
function onBackOnline() {
  if (!isConnected.value || (remoteStream.value && !streamInterrupted.value)) return
  console.log('[CollectView] Network came back — reconnecting')
  setTimeout(() => {
    if (!remoteStream.value || streamInterrupted.value) retryConnection(true)
  }, 1500)
}
window.addEventListener('online', onBackOnline)

// --- home archive forwarding ---
// A second, independent P2P connection: while this phone watches the demo, it
// re-broadcasts the received stream to the friend's home device so a copy is
// safe there too. The streamer is unaffected — it still sends just one stream.
const archiveFwd = useTrystero()
// The filmer's attestations go home with the picture: they are signed, so the
// archive needs to trust nobody on the way.
const archiveAttest = archiveFwd.addChannel('attest', { onData: () => {} })
function forwardAttestation(a: Attestation) {
  if (forwarding.value) archiveAttest.broadcast(a)
}
const pairedHome = ref<string | null>(getPairedHome())
const forwarding = ref(false)
const showPair = ref(false)
const pairInput = ref('')
watch(() => archiveFwd.peerCount.value, (n) => (forwarding.value = n > 0))

// Why forwarding to home is or isn't happening. A home router and a phone on
// mobile data are often a strict-NAT pair as well — the fix is the same relay.
const archiveDiag = useConnectionDiagnosis(archiveFwd, { role: 'streamer' })
const archiveStatus = computed<{ text: string; tone: string; action?: DiagnosisAction }>(() => {
  const d = archiveDiag.diagnosis.value
  if (forwarding.value) return { text: d.path === 'relay' ? 'forwarding ✓ via relay' : 'forwarding ✓', tone: 'text-moss' }
  if (!remoteStream.value) return { text: 'ready', tone: 'text-slate-500' }
  switch (d.code) {
    case 'blocked-no-relay':
      return { text: "can't reach home — needs a relay", tone: 'text-yellow-300', action: 'setup-relay' }
    case 'relay-unreachable':
    case 'relay-rejected':
    case 'failed-with-relay':
      return { text: "can't reach home — relay problem", tone: 'text-yellow-300', action: 'test-relay' }
    case 'no-signaling':
    case 'offline':
      return { text: "can't reach the discovery servers", tone: 'text-yellow-300' }
    default:
      return { text: 'connecting to home…', tone: 'text-slate-500' }
  }
})

// Trystero reports a stream once per track (audio, then video); re-opening
// the archive room for the second report tore down the first connection.
let forwardedStream: MediaStream | null = null
async function startForwarding(stream: MediaStream) {
  if (!pairedHome.value) return
  if (forwardedStream === stream) return
  forwardedStream = stream
  try {
    await archiveFwd.init(['both'])
    await archiveFwd.createRoom(archiveRoomId(pairedHome.value), ['both'], stream)
    console.log('[CollectView] Forwarding stream to home archive', pairedHome.value)
  } catch (e) {
    console.warn('[CollectView] Failed to start home forwarding:', e)
  }
}
function stopForwarding() {
  forwardedStream = null
  archiveFwd.leaveRoom()
  forwarding.value = false
}
function pairHome(sealKey: string | null = null) {
  if (setPairedHome(pairInput.value)) {
    // A typed code carries no sealing key; never keep a previous archive's.
    setPairedHomeSealKey(sealKey)
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
  setPairedHomeSealKey(null)
  pairedHome.value = null
}

onMounted(async () => {
  // Auto-join from URL only - don't request camera permission
  if (props.roomCode && isValidShortRoomId(props.roomCode)) {
    console.log('[CollectView] Auto-joining from URL:', props.roomCode)
    await joinStream(props.roomCode, filmerKeyFrom(linkSearch()))
  }
})

// Another share link opened while this view is up — on the single-file build
// a link that differs only after the # does not reload the page, so the view
// sees a new room code instead: leave the old room and join the new one.
watch(
  () => props.roomCode,
  async (code, prev) => {
    if (!code || code === prev || !isValidShortRoomId(code)) return
    if (isConnected.value || isConnecting.value || remoteStream.value) disconnect()
    await joinStream(code, filmerKeyFrom(linkSearch()))
  },
)

/** `key`: the filmer's key from the link (null: none; left out: keep the current one, e.g. on a retry). */
async function joinStream(shortCode: string, key?: string | null) {
  if (!shortCode || !isValidShortRoomId(shortCode)) {
    console.error('Invalid room code:', shortCode)
    return
  }
  if (key !== undefined) {
    // A new link, not a retry: the count of moments kept starts over.
    filmerKey.value = key
    attestedSeconds.value = 0
  }

  const fullRoomId = getFullRoomId(shortCode)
  console.log('[CollectView] Joining room:', shortCode, '->', fullRoomId)
  
  // Stop QR scanner if running
  stopQRScanner()
  
  isConnecting.value = true
  savedRecording.value = null
  playbackUrl.value = null
  autoRecord.value = true
  streamInterrupted.value = false
  
  try {
    // Initialize Trystero with both strategies (try both)
    const initialized = await trystero.init(['both'])
    if (!initialized) {
      throw new Error('Failed to initialize Trystero')
    }

    listenForAttestations()

    // Join room with both strategies
    const joined = await trystero.joinRoom(fullRoomId, ['both'])
    if (!joined) {
      throw new Error('Failed to join room')
    }
    
    isConnected.value = true

    // Reachability watchdog: if no stream arrives in time, silently re-establish
    // the connection a couple of times before surfacing a manual retry.
    watchdogExtensions = 0
    armStreamWatchdog()

    // Set up stream received callback
    trystero.setOnStreamReceived(async (stream: MediaStream) => {
      console.log('[CollectView] Received remote stream')
      const isReplacement = remoteStream.value !== null && remoteStream.value !== stream
      remoteStream.value = stream
      streamInterrupted.value = false
        autoRetries.value = 0
      watchdogExtensions = 0
      trystero.error.value = null // clear any stale connection error now that video is here
      if (streamWatchdog) { clearTimeout(streamWatchdog); streamWatchdog = null }
      watchStreamHealth(stream)
      wakeLock.request()

      if (isReplacement) {
        // The connection healed and delivered a NEW MediaStream. The recorder
        // is still bound to the dead one and would silently record nothing —
        // finalize that segment (it stays verifiable) and start the next.
        queueRecordingOp(async () => {
          if (isRecording.value) {
            console.log('[CollectView] Stream replaced mid-recording — rolling to a new segment')
            await stopRecording()
          }
          if (autoRecord.value && remoteStream.value) await startRecording()
        })
      } else if (autoRecord.value && !isRecording.value) {
        // Auto-start recording (first stream, or a reconnect after a segment
        // was finalized) unless the user explicitly stopped.
        setTimeout(() => {
          queueRecordingOp(async () => {
            if (autoRecord.value && !isRecording.value && remoteStream.value) await startRecording()
          })
        }, 1000)
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

// Watchdog for "joined but no (live) stream": silently re-establish the
// connection a couple of times, then surface an honest hint. Re-armed when a
// playing stream dies so reconnects get a fresh retry budget.
function armStreamWatchdog() {
  if (streamWatchdog) clearTimeout(streamWatchdog)
  streamWatchdog = window.setTimeout(() => {
    if (remoteStream.value && !streamInterrupted.value) return
    const code = diagnosis.value.code
    if ((code === 'negotiating' || code === 'waiting-for-video') && watchdogExtensions < MAX_WATCHDOG_EXTENSIONS) {
      watchdogExtensions++
      console.log(`[CollectView] Negotiation in progress — waiting (${watchdogExtensions}/${MAX_WATCHDOG_EXTENSIONS})`)
      armStreamWatchdog()
      return
    }
    // Rejoining cannot fix a NAT block or a broken relay; discovery keeps
    // running in the open room, and the status card says what would help.
    if (code === 'blocked-no-relay' || code === 'relay-unreachable' || code === 'relay-rejected' || code === 'failed-with-relay') {
      console.log(`[CollectView] Not rejoining: ${code}`)
      return
    }
    if (autoRetries.value < MAX_AUTO_RETRIES) {
      autoRetries.value++
      console.log(`[CollectView] No live stream — auto-retry ${autoRetries.value}/${MAX_AUTO_RETRIES}`)
      retryConnection(true)
    }
  }, STREAM_TIMEOUT_MS)
}

// Surface a dead/muted remote track instead of leaving a frozen frame, and
// finalize the in-progress segment so what's already captured is safe.
function watchStreamHealth(stream: MediaStream) {
  const track = stream.getVideoTracks()[0]
  if (!track) return
  track.onended = () => onStreamLost('track ended')
  track.onmute = () => { streamInterrupted.value = true }
  track.onunmute = () => { streamInterrupted.value = false }
  startStallMonitor()
}

// Track events only catch clean teardowns. On a congested or silently broken
// path the track stays 'live' while nothing arrives — the watcher stares at a
// frozen frame believing it is recording the scene. Watch the byte counters.
function startStallMonitor() {
  stopStallMonitor()
  stallMonitor.reset()
  stallTimer = window.setInterval(async () => {
    if (!remoteStream.value) return
    const sample = await trystero.sampleInboundVideo()
    if (!sample) return
    const health = stallMonitor.observe({ ...sample, at: Date.now() })
    // Sound only: the filming phone switched the picture off because the link
    // is too slow for it. The connection is alive and still being recorded.
    soundOnly.value = health === 'audio-only'

    if (health === 'stalled') {
      if (!streamInterrupted.value) onStreamLost('no media for 8s')
    } else if ((health === 'flowing' || health === 'audio-only') && streamInterrupted.value) {
      // Bytes are moving again — clear the overlay the track events never will.
      streamInterrupted.value = false
    }
  }, STALL_POLL_MS)
}

function stopStallMonitor() {
  if (stallTimer) { clearInterval(stallTimer); stallTimer = null }
}

function onStreamLost(reason: string) {
  if (remoteStream.value === null) return // already disconnected deliberately
  console.warn(`[CollectView] Stream lost (${reason})`)
  streamInterrupted.value = true
  autoRetries.value = 0
  // Ask the relay tree's root to re-seat us (our seed may have silently
  // died); the room-level watchdog stays as the outer safety net.
  trystero.reportStreamLost()
  armStreamWatchdog()
  queueRecordingOp(async () => {
    // The recorder would silently capture nothing from ended tracks; bank the
    // finished segment now. A reconnect starts the next one automatically.
    if (isRecording.value) await stopRecording()
  })
}

async function retryConnection(isAuto = false) {
  if (isRetrying.value) return
  // A manual retry gives a fresh budget of automatic retries.
  if (!isAuto) autoRetries.value = 0

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
  stopStallMonitor()
  remoteStream.value = null
  isConnected.value = false
  streamInterrupted.value = false
  wakeLock.release()
  if (streamWatchdog) { clearTimeout(streamWatchdog); streamWatchdog = null }
}

async function startRecording() {
  if (!remoteStream.value) return
  
  console.log('[CollectView] Starting recording')
  // Under the room's name: copies of one stream then belong together even
  // without the filmer's attestations (Recordings → Combine copies).
  const room = (props.roomCode || inputRoomCode.value || '').toUpperCase()
  const success = await recording.startRecording(remoteStream.value, 'medium', room ? `room-${room}` : undefined)
  if (success) {
    isRecording.value = true
    trystero.setRecording(true)
    recordingDuration.value = 0
    
    durationInterval = window.setInterval(() => {
      recordingDuration.value += 1000
    }, 1000)
  }
}

// User pressed Stop: also opt out of auto-starting new segments on reconnect.
async function stopRecordingManually() {
  autoRecord.value = false
  await stopRecording()
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
  const v = videoPlayer.value
  if (!v) return
  // Force the muted property (Vue doesn't reliably set it on first render) so
  // autoplay is allowed, then play. If somehow still blocked, retry muted.
  v.muted = videoMuted.value
  v.play().catch(() => {
    v.muted = true
    videoMuted.value = true
    v.play().catch(err => console.warn('Auto-play failed even muted:', err))
  })
}

function toggleMute() {
  videoMuted.value = !videoMuted.value
  const v = videoPlayer.value
  if (!v) return
  v.muted = videoMuted.value
  // Unmuting can require a fresh play() on some browsers; if it's rejected,
  // fall back to muted so playback never stalls.
  v.play().catch(() => {
    videoMuted.value = true
    v.muted = true
  })
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
      
      // A share link may carry a relay and discovery relays — adopt them
      // exactly as if the link had been opened, then read the room code.
      let scannedKey: string | null = null
      try {
        const url = new URL(data.trim())
        // Hash-routed copies carry their parameters after the route (#/collect/CODE?…).
        const search = linkSearch(url)
        adoptRelayFromUrl(search)
        adoptDiscoveryFromUrl(search)
        diag.refreshRelay()
        scannedKey = filmerKeyFrom(search)
      } catch {
        /* not a URL: a bare room code */
      }
      // A home-archive pairing QR: pair with it here instead of rejecting it.
      const homeKey = extractHomeKey(data)
      if (homeKey) {
        stopQRScanner()
        pairInput.value = homeKey
        pairHome(sealKeyFromLink(data))
        return
      }
      if (isOfflineSignal(data)) {
        stopQRScanner()
        alert('That is a face-to-face pairing code. Open “Pair face to face” (Home → No internet?) to use it.')
        return
      }

      const roomCode = extractRoomCode(data) ?? ''

      if (isValidShortRoomId(roomCode)) {
        inputRoomCode.value = roomCode
        joinStream(roomCode, scannedKey)
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
  window.removeEventListener('online', onBackOnline)
  if (durationInterval) clearInterval(durationInterval)
  if (streamWatchdog) clearTimeout(streamWatchdog)
  if (isRecording.value) {
    recording.stopRecording()
  }
  if (playbackUrl.value) {
    URL.revokeObjectURL(playbackUrl.value)
  }
  stopQRScanner()
  stopStallMonitor()
  attestChannel?.remove()
  archiveAttest.remove()
  trystero.leaveRoom()
  archiveFwd.leaveRoom()
})

// Expose validation function to template
function isValidRoomCode(code: string): boolean {
  return isValidShortRoomId(code)
}
</script>
