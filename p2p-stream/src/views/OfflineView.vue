<template>
  <div class="h-full overflow-y-auto">
    <section class="organic-veil px-5 pt-8 pb-4 text-center">
      <p class="text-xs uppercase tracking-[0.2em] text-moss/80 mb-3">No internet needed</p>
      <h1 class="font-display font-black text-slate-50 text-3xl mb-3">Pair face to face</h1>
      <p class="text-slate-400 max-w-md mx-auto text-sm leading-relaxed">
        When the network is cut or jammed, phones can still talk to each other over one Wi-Fi hotspot. Hold the two
        devices together and swap two QR codes — no server, no relay, no internet at any point.
      </p>
    </section>

    <div class="px-4 pb-8 space-y-4">
      <!-- Prerequisite everyone forgets -->
      <div class="card bg-glow/5 border-glow/20">
        <p class="text-sm text-slate-300 leading-relaxed">
          <strong class="text-glow">First:</strong> put both devices on the same network — turn on one phone's Personal
          Hotspot and have the other join it. Nothing here reaches the internet; the video travels straight between the
          two devices.
        </p>
      </div>

      <!-- Role picker -->
      <div v-if="!role" class="grid sm:grid-cols-2 gap-3">
        <button class="card text-left hover:border-ember/50 transition-colors" @click="startStreaming">
          <h2 class="font-display font-bold text-lg text-slate-100 mb-1">I'm filming</h2>
          <p class="text-sm text-slate-400">Use this device's camera and hand the picture to someone next to you.</p>
        </button>
        <button class="card text-left hover:border-glow/50 transition-colors" @click="startWatching">
          <h2 class="font-display font-bold text-lg text-slate-100 mb-1">I'm receiving</h2>
          <p class="text-sm text-slate-400">Watch and keep a signed copy of what the other device is filming.</p>
        </button>
      </div>

      <!-- Errors -->
      <div v-if="uiError" class="card bg-ember/10 border-ember/40">
        <p class="text-sm text-ember">{{ uiError }}</p>
        <button class="mt-3 btn-secondary py-2 px-4 text-sm" @click="restart">Start over</button>
      </div>

      <!-- ============ STREAMER ============ -->
      <template v-if="role === 'stream'">
        <div v-if="step === 'show-offer'" class="card">
          <div class="flex items-center gap-2 mb-3">
            <span class="font-mono text-[11px] text-slate-500">STEP 1 · LET THEM SCAN THIS</span>
            <span class="h-px flex-1 bg-line" />
          </div>
          <div class="bg-white p-3 rounded-xl w-fit mx-auto">
            <canvas ref="offerCanvas" class="block" />
          </div>
          <p class="text-sm text-slate-400 mt-3 text-center">
            On the other device: open this page, choose <em>I'm receiving</em>, and scan this code.
          </p>
          <button class="btn-primary w-full mt-4 py-3" @click="scanAnswer">They scanned it — show me their code</button>
        </div>

        <div v-else-if="step === 'scan-answer'" class="card">
          <div class="flex items-center gap-2 mb-3">
            <span class="font-mono text-[11px] text-slate-500">STEP 2 · SCAN THEIR REPLY</span>
            <span class="h-px flex-1 bg-line" />
          </div>
          <div class="relative rounded-xl overflow-hidden bg-black aspect-video">
            <video ref="scanVideo" autoplay playsinline muted class="w-full h-full object-cover" />
            <canvas ref="scanCanvas" class="hidden" />
            <div class="absolute inset-0 grid place-items-center pointer-events-none">
              <div class="w-40 h-40 border-2 border-glow/80 rounded-lg" />
            </div>
          </div>
          <p class="text-sm text-slate-400 mt-3 text-center">Point at the reply code on the other device.</p>
        </div>
      </template>

      <!-- ============ WATCHER ============ -->
      <template v-if="role === 'watch'">
        <div v-if="step === 'scan-offer'" class="card">
          <div class="flex items-center gap-2 mb-3">
            <span class="font-mono text-[11px] text-slate-500">STEP 1 · SCAN THEIR CODE</span>
            <span class="h-px flex-1 bg-line" />
          </div>
          <div class="relative rounded-xl overflow-hidden bg-black aspect-video">
            <video ref="scanVideo" autoplay playsinline muted class="w-full h-full object-cover" />
            <canvas ref="scanCanvas" class="hidden" />
            <div class="absolute inset-0 grid place-items-center pointer-events-none">
              <div class="w-40 h-40 border-2 border-glow/80 rounded-lg" />
            </div>
          </div>
          <p class="text-sm text-slate-400 mt-3 text-center">Point at the code on the filming device.</p>
        </div>

        <div v-else-if="step === 'show-answer'" class="card">
          <div class="flex items-center gap-2 mb-3">
            <span class="font-mono text-[11px] text-slate-500">STEP 2 · SHOW THEM THIS</span>
            <span class="h-px flex-1 bg-line" />
          </div>
          <div class="bg-white p-3 rounded-xl w-fit mx-auto">
            <canvas ref="answerCanvas" class="block" />
          </div>
          <p class="text-sm text-slate-400 mt-3 text-center">
            Hold this up to the filming device — it scans this to finish the link.
          </p>
        </div>
      </template>

      <!-- ============ LIVE ============ -->
      <div v-if="connected || (role === 'watch' && remoteStream)" class="card">
        <div class="flex items-center gap-3 mb-3">
          <span
            class="w-2.5 h-2.5 rounded-full shrink-0"
            :class="connected ? 'bg-moss' : 'bg-yellow-400 animate-pulse'"
          />
          <div class="flex-1">
            <p class="text-sm font-medium text-slate-100">
              {{ connected ? 'Connected — no internet involved' : 'Linking…' }}
            </p>
            <p class="text-xs text-slate-500">
              {{ role === 'stream' ? 'Your camera is going straight to the other device.' : recordingLabel }}
            </p>
          </div>
        </div>
        <video
          v-if="role === 'watch'"
          ref="remoteVideo"
          autoplay
          playsinline
          muted
          class="w-full rounded-xl bg-black max-h-72"
        />
        <video
          v-else
          ref="localVideo"
          autoplay
          playsinline
          muted
          class="w-full rounded-xl bg-black max-h-72"
        />
        <button class="btn-secondary w-full mt-3 py-2.5 text-sm" @click="restart">Stop</button>
      </div>

      <p v-if="role" class="text-xs text-slate-500 text-center px-6 leading-relaxed">
        Recordings made here are hashed and signed exactly like online ones, and stay on the receiving device.
      </p>
      <div v-else class="text-center">
        <RouterLink to="/guide" class="text-xs text-glow hover:underline">How else can I use this? →</RouterLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onUnmounted, computed, watch } from 'vue'
import { RouterLink } from 'vue-router'
import QRCode from 'qrcode'
import { useOfflinePair } from '../composables/useOfflinePair'
import { useQRScanner } from '../composables/useQRScanner'
import { useRecording } from '../composables/useRecording'
import { useWakeLock } from '../composables/useWakeLock'
import { isOfflineSignal } from '../lib/net/offlinePair'

const pair = useOfflinePair()
const scanner = useQRScanner()
const recording = useRecording()
const wakeLock = useWakeLock()

type Role = 'stream' | 'watch'
type Step = 'show-offer' | 'scan-answer' | 'scan-offer' | 'show-answer' | 'live'

const role = ref<Role | null>(null)
const step = ref<Step | null>(null)
const uiError = ref<string | null>(null)

const offerCanvas = ref<HTMLCanvasElement>()
const answerCanvas = ref<HTMLCanvasElement>()
const scanVideo = ref<HTMLVideoElement>()
const scanCanvas = ref<HTMLCanvasElement>()
const remoteVideo = ref<HTMLVideoElement>()
const localVideo = ref<HTMLVideoElement>()

let localStream: MediaStream | null = null

const remoteStream = computed(() => pair.remoteStream.value)
const connected = computed(() => pair.connectionState.value === 'connected')
const recordingLabel = computed(() =>
  recording.isRecording.value ? 'Recording a signed copy on this device.' : 'Waiting for picture…',
)

// Same constraints as the online streamer so behaviour matches.
const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
  audio: true,
}

async function drawQR(canvas: HTMLCanvasElement | undefined, text: string) {
  if (!canvas) return
  await QRCode.toCanvas(canvas, text, { width: 260, margin: 1, errorCorrectionLevel: 'L' })
}

function fail(err: unknown, fallback: string) {
  uiError.value = err instanceof Error ? err.message : fallback
  scanner.stopScanning()
}

// --- streamer ---
async function startStreaming() {
  uiError.value = null
  if (!navigator.mediaDevices?.getUserMedia) {
    uiError.value =
      'This page needs a secure context (https:// or localhost) to use the camera. See docs/ON_DEVICE_TESTING.md.'
    return
  }
  try {
    role.value = 'stream'
    localStream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
    const offer = await pair.createOffer(localStream)
    step.value = 'show-offer'
    await nextTick()
    await drawQR(offerCanvas.value, offer)
    await wakeLock.request()
  } catch (err) {
    fail(err, 'Could not start the camera')
  }
}

async function scanAnswer() {
  step.value = 'scan-answer'
  await nextTick()
  await startScan(async (text) => {
    await pair.acceptAnswer(text)
    step.value = 'live'
    await nextTick()
    if (localVideo.value && localStream) localVideo.value.srcObject = localStream
  })
}

// --- watcher ---
async function startWatching() {
  uiError.value = null
  role.value = 'watch'
  step.value = 'scan-offer'
  await nextTick()
  await startScan(async (text) => {
    const answer = await pair.acceptOffer(text)
    step.value = 'show-answer'
    await nextTick()
    await drawQR(answerCanvas.value, answer)
    await wakeLock.request()
  })
}

/** Run the scanner until it sees a pairing code (ignoring unrelated QR codes). */
async function startScan(onCode: (text: string) => Promise<void>) {
  if (!scanner.isSecureContext() || !scanner.isCameraSupported()) {
    uiError.value = 'Camera scanning needs a secure context (https:// or localhost).'
    return
  }
  const ok = await scanner.startScanning(
    scanVideo.value!,
    scanCanvas.value!,
    (data: string) => {
      if (!isOfflineSignal(data)) return // not ours — keep looking
      scanner.stopScanning()
      onCode(data).catch((err) => fail(err, 'That code could not be used'))
    },
    'environment',
  )
  if (!ok) uiError.value = scanner.error.value || 'Could not start the camera'
}

// Show and record the incoming picture as soon as it arrives.
watch(remoteStream, async (stream) => {
  if (!stream || role.value !== 'watch') return
  step.value = 'live'
  await nextTick()
  if (remoteVideo.value) remoteVideo.value.srcObject = stream
  if (!recording.isRecording.value) {
    await recording.startRecording(stream, 'medium', 'offline-pair')
  }
})

async function restart() {
  scanner.stopScanning()
  if (recording.isRecording.value) await recording.stopRecording()
  pair.reset()
  localStream?.getTracks().forEach((t) => t.stop())
  localStream = null
  wakeLock.release()
  role.value = null
  step.value = null
  uiError.value = null
}

onUnmounted(() => {
  scanner.stopScanning()
  if (recording.isRecording.value) recording.stopRecording()
  localStream?.getTracks().forEach((t) => t.stop())
  wakeLock.release()
})
</script>
