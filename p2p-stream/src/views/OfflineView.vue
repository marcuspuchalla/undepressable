<template>
  <div class="h-full overflow-y-auto">
    <section class="organic-veil px-5 pt-8 pb-4 text-center">
      <p class="text-xs uppercase tracking-[0.2em] text-moss/80 mb-3">No internet needed</p>
      <h1 class="font-display font-black text-slate-50 text-3xl mb-3">Pair face to face</h1>
      <p class="text-slate-400 max-w-md mx-auto text-sm leading-relaxed">
        When the network is cut or jammed, devices can still talk to each other over one Wi-Fi hotspot. Swap two short
        codes — by QR or as text — and the video goes straight between the devices. No server, no relay, no internet.
      </p>
    </section>

    <div class="px-4 pb-8 space-y-4 max-w-xl mx-auto">
      <!-- Prerequisite everyone forgets -->
      <div v-if="!role" class="card bg-glow/5 border-glow/20">
        <p class="text-sm text-slate-300 leading-relaxed">
          <strong class="text-glow">First:</strong> put the devices on the same network. Easiest: turn on the Personal
          Hotspot of one of the phones taking part and have the others join it — a hotspot phone can always reach its
          guests, while some hotspots keep guests apart from each other.
        </p>
      </div>

      <!-- Role picker -->
      <div v-if="!role" class="grid sm:grid-cols-2 gap-3">
        <button class="card text-left hover:border-ember/50 transition-colors" @click="startStreaming">
          <h2 class="font-display font-bold text-lg text-slate-100 mb-1">I'm filming</h2>
          <p class="text-sm text-slate-400">Use this device's camera, keep a signed copy here, and hand the picture to the people next to you.</p>
        </button>
        <button class="card text-left hover:border-glow/50 transition-colors" @click="startWatching">
          <h2 class="font-display font-bold text-lg text-slate-100 mb-1">I'm receiving</h2>
          <p class="text-sm text-slate-400">Watch and keep a signed copy of what the other device is filming.</p>
        </button>
      </div>

      <!-- Errors -->
      <div v-if="uiError" class="card bg-ember/10 border-ember/40">
        <p class="text-sm text-ember">{{ uiError }}</p>
        <button class="mt-3 btn-secondary py-2 px-4 text-sm" @click="uiError = null">Dismiss</button>
      </div>

      <!-- ============ STREAMER ============ -->
      <template v-if="role === 'stream'">
        <div class="card">
          <div class="flex items-center gap-3 mb-3">
            <span class="w-2.5 h-2.5 rounded-full shrink-0" :class="recording.isRecording.value ? 'bg-ember animate-pulse' : 'bg-slate-500'" />
            <p class="text-sm font-medium text-slate-100 flex-1">
              {{ recording.isRecording.value ? 'Filming — a signed copy is kept on this device' : 'Camera starting…' }}
            </p>
            <span class="text-xs text-slate-400">{{ liveViewers }} watching</span>
          </div>
          <video ref="localVideo" autoplay playsinline muted class="w-full rounded-xl bg-black max-h-64 object-cover" />
        </div>

      </template>

      <!-- ============ WATCHER ============ -->
      <template v-if="role === 'watch'">
        <div v-if="watchStep === 'get-invite'" class="card space-y-3">
          <div class="flex items-center gap-2">
            <span class="font-mono text-[11px] text-slate-500">STEP 1 · READ THEIR CODE</span>
            <span class="h-px flex-1 bg-line" />
          </div>
          <div v-if="scanning" class="relative rounded-xl overflow-hidden bg-black aspect-video">
            <video ref="scanVideo" autoplay playsinline muted class="w-full h-full object-cover" />
            <canvas ref="scanCanvas" class="hidden" />
            <div class="absolute inset-0 grid place-items-center pointer-events-none">
              <div class="w-40 h-40 border-2 border-glow/80 rounded-lg" />
            </div>
          </div>
          <button v-else class="btn-primary w-full py-3" @click="scanInvite">Scan their code</button>
          <p class="text-sm text-slate-400 text-center">Point at the code on the filming device.</p>
          <CodeInput placeholder="…or paste the code they sent you" @submit="acceptInvite" />
        </div>

        <div v-else-if="watchStep === 'show-reply' && reply" class="card space-y-3">
          <div class="flex items-center gap-2">
            <span class="font-mono text-[11px] text-slate-500">STEP 2 · SHOW THEM THIS</span>
            <span class="h-px flex-1 bg-line" />
          </div>
          <PairCode :code="reply" share-title="Reply code" />
          <p class="text-sm text-slate-400 text-center">
            The filming device reads this to finish the link — scan, or send them the text.
          </p>
          <div class="flex items-center justify-center gap-2 text-xs text-slate-500">
            <span class="w-2 h-2 rounded-full bg-glow animate-pulse" /> Waiting for them…
          </div>
          <div v-if="replySlow" class="text-xs text-slate-400 border-t border-line pt-3">
            <p class="text-slate-300 mb-1">Taking long? If they already read it:</p>
            <ul class="list-disc list-inside space-y-1">
              <li v-for="tip in OFFLINE_CONNECT_TIPS" :key="tip">{{ tip }}</li>
            </ul>
          </div>
        </div>

        <div v-if="watchStep === 'live'" class="card">
          <div class="flex items-center gap-3 mb-3">
            <span class="w-2.5 h-2.5 rounded-full shrink-0" :class="PHASE[watchPhase].dot" />
            <div class="flex-1">
              <p class="text-sm font-medium text-slate-100">{{ watchTitle }}</p>
              <p class="text-xs text-slate-500">{{ recordingLabel }}</p>
            </div>
          </div>
          <video ref="remoteVideo" autoplay playsinline muted class="w-full rounded-xl bg-black max-h-72" />
          <div v-if="watchLink && (watchPhase === 'connected' || watchLink.transfer)" class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <button v-if="watchPhase === 'connected'" class="text-glow underline" data-testid="send-recordings" @click="handOver(watchLink.id)">
              Hand over my recordings
            </button>
            <span class="text-slate-400" data-testid="transfer-status">{{ transferText(watchLink.transfer) }}</span>
          </div>
          <ul v-if="watchPhase === 'timed-out'" class="mt-3 text-xs text-slate-400 list-disc list-inside space-y-1">
            <li v-for="tip in OFFLINE_CONNECT_TIPS" :key="tip">{{ tip }}</li>
          </ul>
          <div class="flex gap-2 mt-3">
            <button v-if="watchPhase === 'lost' || watchPhase === 'timed-out'" class="btn-primary flex-1 py-2.5 text-sm" @click="pairAgain">
              Pair again
            </button>
            <button
              v-else-if="!relaying && watchPhase === 'connected' && remoteStream"
              class="btn-primary flex-1 py-2.5 text-sm"
              data-testid="share-onward"
              @click="shareOnward"
            >
              Share onward
            </button>
            <button class="btn-secondary flex-1 py-2.5 text-sm" @click="restart">Stop</button>
          </div>
          <p v-if="!relaying && watchPhase === 'connected'" class="text-[11px] text-slate-500 mt-2 leading-relaxed">
            Too far from the person filming for others to join them? Share onward: people pair with you instead and
            you pass the picture on — a chain, no internet needed.
          </p>
        </div>
      </template>

      <!-- ============ INVITES: the camera, or a viewer passing the picture on ============ -->
      <template v-if="role === 'stream' || relaying">
        <div v-if="relaying && !viewerLinks.length && !invite" class="card text-sm text-slate-400">Preparing an invite…</div>
        <!-- The invite waiting for its viewer -->
        <div v-if="invite" class="card space-y-4">
          <div class="flex items-center gap-2">
            <span class="font-mono text-[11px] text-slate-500">{{ invite.label.toUpperCase() }} · STEP 1 · LET THEM READ THIS</span>
            <span class="h-px flex-1 bg-line" />
          </div>
          <PairCode :code="invite.code" share-title="Invite to watch" />
          <p class="text-sm text-slate-400">
            On their device: <em>Pair face to face</em> → <em>I'm receiving</em>, then scan this code or paste the text.
          </p>

          <div class="flex items-center gap-2 pt-1">
            <span class="font-mono text-[11px] text-slate-500">STEP 2 · READ THEIR REPLY</span>
            <span class="h-px flex-1 bg-line" />
          </div>
          <div v-if="scanning" class="relative rounded-xl overflow-hidden bg-black aspect-video">
            <video ref="scanVideo" autoplay playsinline muted class="w-full h-full object-cover" />
            <canvas ref="scanCanvas" class="hidden" />
            <div class="absolute inset-0 grid place-items-center pointer-events-none">
              <div class="w-40 h-40 border-2 border-glow/80 rounded-lg" />
            </div>
            <button class="absolute top-2 right-2 px-2 py-1 rounded bg-black/70 text-xs" @click="stopScan">Cancel</button>
          </div>
          <div v-else class="grid gap-2">
            <button class="btn-primary py-3" @click="scanReply">Scan their reply</button>
          </div>
          <CodeInput placeholder="…or paste their reply code" @submit="acceptReply" />
        </div>

        <!-- Everyone paired so far -->
        <div v-if="viewerLinks.length" class="card space-y-2">
          <h2 class="text-sm font-semibold text-slate-100">{{ role === 'stream' ? 'Viewers' : 'Watching through you' }}</h2>
          <div v-for="l in viewerLinks" :key="l.id" class="rounded-lg border border-line px-3 py-2">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full" :class="PHASE[l.phase].dot" />
              <span class="text-sm text-slate-200">{{ l.label }}</span>
              <span class="text-xs" :class="PHASE[l.phase].text">{{ PHASE[l.phase].label }}</span>
              <span v-if="l.phase === 'connected'" class="text-xs ml-auto" :class="l.peerRecording ? 'text-moss' : 'text-slate-500'">
                {{ l.peerRecording ? '● recording a copy' : 'not recording yet' }}
              </span>
              <button v-else-if="l.phase === 'timed-out' || l.phase === 'lost'" class="ml-auto text-xs text-slate-400 underline" @click="pair.closeLink(l.id)">remove</button>
            </div>
            <ul v-if="l.phase === 'timed-out'" class="mt-2 text-xs text-slate-400 list-disc list-inside space-y-1">
              <li v-for="tip in OFFLINE_CONNECT_TIPS" :key="tip">{{ tip }}</li>
            </ul>
            <div v-if="l.phase === 'connected' || l.transfer" class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <button v-if="l.phase === 'connected'" class="text-glow underline" data-testid="send-recordings" @click="handOver(l.id)">
                Hand over my recordings
              </button>
              <span class="text-slate-400" data-testid="transfer-status">{{ transferText(l.transfer) }}</span>
            </div>
          </div>
        </div>

        <div class="flex gap-2">
          <button v-if="!invite" class="btn-primary flex-1 py-3" :disabled="creatingInvite" data-testid="add-viewer" @click="newInvite">
            {{ viewerLinks.length ? 'Add another viewer' : 'Invite a viewer' }}
          </button>
          <button v-if="role === 'stream'" class="btn-secondary flex-1 py-3" @click="restart">Stop filming</button>
        </div>
      </template>

      <p v-if="role" class="text-xs text-slate-500 text-center px-6 leading-relaxed">
        Recordings made here are hashed and signed exactly like online ones — find them under Recordings.
        “Hand over” copies every signed recording on this device to the other one, checked second by second on
        arrival: a way to get footage to someone who is leaving, without any internet.
      </p>
      <div v-else class="text-center">
        <RouterLink to="/guide" class="text-xs text-glow hover:underline">How else can I use this? →</RouterLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted, computed, watch, defineComponent, h } from 'vue'
import { RouterLink } from 'vue-router'
import { useOfflinePair, type LinkTransfer } from '../composables/useOfflinePair'
import { useQRScanner } from '../composables/useQRScanner'
import { useRecording } from '../composables/useRecording'
import { useWakeLock } from '../composables/useWakeLock'
import { isOfflineSignal } from '../lib/net/offlinePair'
import { OFFLINE_CONNECT_TIPS, type LinkPhase } from '../lib/net/offlineLink'
import { createStallMonitor } from '../lib/net/streamHealth'
import PairCode from '../components/PairCode.vue'

// Paste box shared by both roles: accepts a pairing code as text.
const CodeInput = defineComponent({
  props: { placeholder: { type: String, default: '' } },
  emits: ['submit'],
  setup(props, { emit }) {
    const text = ref('')
    const valid = computed(() => isOfflineSignal(text.value))
    return () =>
      h('div', { class: 'flex gap-2' }, [
        h('textarea', {
          class: 'input text-xs font-mono flex-1 min-h-[2.5rem]',
          rows: 2,
          placeholder: props.placeholder,
          spellcheck: false,
          autocapitalize: 'off',
          value: text.value,
          'data-testid': 'pair-paste',
          onInput: (e: Event) => (text.value = (e.target as HTMLTextAreaElement).value),
        }),
        h(
          'button',
          {
            class: 'btn-secondary text-sm px-4',
            disabled: !valid.value,
            onClick: () => {
              emit('submit', text.value)
              text.value = ''
            },
          },
          'Use',
        ),
      ])
  },
})

const pair = useOfflinePair()
const scanner = useQRScanner()
const recording = useRecording()
const wakeLock = useWakeLock()

type Role = 'stream' | 'watch'
const role = ref<Role | null>(null)
const uiError = ref<string | null>(null)

const scanVideo = ref<HTMLVideoElement>()
const scanCanvas = ref<HTMLCanvasElement>()
const localVideo = ref<HTMLVideoElement>()
const remoteVideo = ref<HTMLVideoElement>()
const scanning = ref(false)

const PHASE: Record<LinkPhase, { label: string; dot: string; text: string }> = {
  'awaiting-reply': { label: 'waiting for their reply', dot: 'bg-slate-400', text: 'text-slate-400' },
  connecting: { label: 'connecting…', dot: 'bg-yellow-400 animate-pulse', text: 'text-yellow-300' },
  connected: { label: 'connected', dot: 'bg-moss', text: 'text-moss' },
  'timed-out': { label: "couldn't reach them", dot: 'bg-ember', text: 'text-ember' },
  lost: { label: 'disconnected', dot: 'bg-ember', text: 'text-ember' },
  closed: { label: 'closed', dot: 'bg-slate-600', text: 'text-slate-500' },
}

// Same constraints as the online streamer so behaviour matches.
const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
  audio: true,
}

function fail(err: unknown, fallback: string) {
  uiError.value = err instanceof Error ? err.message : fallback
}

// Recorder transitions come from independent events (stream arrival, stall,
// link loss); run them one at a time so stop/start never interleave.
let recOps: Promise<unknown> = Promise.resolve()
function queueRecording(fn: () => Promise<void>) {
  recOps = recOps.then(fn, fn)
  return recOps
}
async function startRecordingOf(stream: MediaStream) {
  if (recording.isRecording.value) return
  if (await recording.startRecording(stream, 'medium', 'offline-pair')) pair.setRecording(true)
}
async function stopRecordingNow() {
  if (!recording.isRecording.value) return
  await recording.stopRecording()
  pair.setRecording(false)
}

// --- scanning (QR) --------------------------------------------------------

async function scanFor(onCode: (text: string) => Promise<void>, fromStream?: MediaStream) {
  if (!scanner.isSecureContext() || !scanner.isCameraSupported()) {
    uiError.value = 'Camera scanning needs a secure context (https:// or the installed app). Paste the code instead.'
    return
  }
  scanning.value = true
  await nextTick()
  let handled = false // the detector fires on every frame until stopped
  const ok = await scanner.startScanning(
    scanVideo.value!,
    scanCanvas.value!,
    (data: string) => {
      if (handled || !isOfflineSignal(data)) return // not ours — keep looking
      handled = true
      // Keep the camera running until the code has been used: Safari only
      // reveals real local addresses (instead of mDNS names that a hotspot
      // may not resolve) while a capture is active.
      onCode(data)
        .catch((err) => fail(err, 'That code could not be used'))
        .finally(stopScan)
    },
    'environment',
    fromStream,
  )
  if (!ok) {
    scanning.value = false
    uiError.value = scanner.error.value || 'Could not start the camera — paste the code instead.'
  }
}

function stopScan() {
  scanner.stopScanning()
  scanning.value = false
}

// --- streamer ----------------------------------------------------------------

let localStream: MediaStream | null = null
const invite = ref<{ label: string; code: string } | null>(null)
const creatingInvite = ref(false)
// Links this device sends the picture on: the camera's viewers, or — for a
// viewer sharing onward — the devices watching through it.
const viewerLinks = computed(() => pair.links.value.filter((l) => l.role === 'stream' && l.phase !== 'awaiting-reply'))
const liveViewers = computed(() => viewerLinks.value.filter((l) => l.phase === 'connected').length)

async function startStreaming() {
  uiError.value = null
  if (!navigator.mediaDevices?.getUserMedia) {
    uiError.value = 'This page needs a secure context (https:// or the installed app) to use the camera.'
    return
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
    role.value = 'stream'
    watchCamera(localStream)
    await nextTick()
    if (localVideo.value) localVideo.value.srcObject = localStream
    // The person filming keeps a copy too — as online. If their phone is
    // taken, each viewer still has one; if the link fails, they still do.
    queueRecording(() => startRecordingOf(localStream!))
    await wakeLock.request()
    await newInvite()
  } catch (err) {
    fail(err, 'Could not start the camera')
  }
}

// What goes out on new links: the camera, or the picture we are relaying.
function outgoingStream(): MediaStream | null {
  return role.value === 'stream' ? localStream : remoteStream.value
}

async function newInvite() {
  const stream = outgoingStream()
  if (!stream) return
  creatingInvite.value = true
  try {
    const code = await pair.createInvite(stream)
    const pendingLink = pair.links.value.find((l) => l.phase === 'awaiting-reply')
    invite.value = { label: pendingLink?.label ?? 'Viewer', code }
  } catch (err) {
    fail(err, 'Could not create an invite')
  } finally {
    creatingInvite.value = false
  }
}

async function acceptReply(text: string) {
  try {
    await pair.acceptAnswer(text)
    invite.value = null
  } catch (err) {
    fail(err, 'That reply code could not be used')
  }
}

function scanReply() {
  // Scan with the camera that is already filming: phones often cannot open a
  // second one, and the scan must not interrupt the broadcast. (A relaying
  // viewer's outgoing picture is not a camera: it opens its own.)
  scanFor(acceptReply, role.value === 'stream' ? localStream ?? undefined : undefined)
}

// Mobile OSes end camera tracks on screen lock. Swap a fresh camera into every
// link without re-pairing, and roll the recording into a new segment.
function watchCamera(stream: MediaStream) {
  const track = stream.getVideoTracks()[0]
  if (track) track.onended = () => recoverCamera()
}
async function recoverCamera() {
  if (role.value !== 'stream') return
  try {
    const fresh = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
    localStream?.getTracks().forEach((t) => t.stop())
    localStream = fresh
    watchCamera(fresh)
    if (localVideo.value) localVideo.value.srcObject = fresh
    await pair.replaceLocalStream(fresh)
    queueRecording(async () => {
      await stopRecordingNow()
      await startRecordingOf(fresh)
    })
  } catch (err) {
    fail(err, 'Camera lost — tap Stop filming and start again')
  }
}
function onVisibility() {
  const track = localStream?.getVideoTracks()[0]
  if (document.visibilityState === 'visible' && track?.readyState === 'ended') recoverCamera()
}

// --- watcher ---------------------------------------------------------------

const watchStep = ref<'get-invite' | 'show-reply' | 'live'>('get-invite')
const reply = ref<string | null>(null)
const remoteStream = computed(() => pair.remoteStream.value)
const watchLink = computed(() => pair.links.value.find((l) => l.role === 'watch') ?? null)
const watchPhase = computed<LinkPhase>(() => watchLink.value?.phase ?? 'closed')
// A viewer passing the picture on to further devices (off-grid chain).
const relaying = ref(false)

async function shareOnward() {
  relaying.value = true
  await newInvite()
}
const interrupted = ref(false)
const watchTitle = computed(() => {
  if (watchPhase.value === 'connected') return interrupted.value ? 'Picture frozen — waiting for it to resume' : 'Connected — no internet involved'
  if (watchPhase.value === 'lost') return 'Connection lost'
  if (watchPhase.value === 'timed-out') return "Couldn't reach the filming device"
  return 'Linking…'
})
const recordingLabel = computed(() =>
  recording.isRecording.value ? 'Recording a signed copy on this device.' : 'Your copy so far is saved.',
)

function startWatching() {
  uiError.value = null
  role.value = 'watch'
  watchStep.value = 'get-invite'
}

// The viewer cannot tell "they haven't scanned yet" from "they did, and the
// network keeps us apart" — after a while, offer the same advice they see.
const replySlow = ref(false)
let replySlowTimer: number | null = null
watch(watchStep, (step) => {
  if (replySlowTimer) clearTimeout(replySlowTimer)
  replySlow.value = false
  if (step === 'show-reply') replySlowTimer = window.setTimeout(() => (replySlow.value = true), 30_000)
})

async function acceptInvite(text: string) {
  try {
    reply.value = await pair.acceptOffer(text)
    watchStep.value = 'show-reply'
    await wakeLock.request()
  } catch (err) {
    fail(err, 'That code could not be used')
  }
}

function scanInvite() {
  scanFor(acceptInvite)
}

async function pairAgain() {
  await queueRecording(stopRecordingNow)
  // Devices watching through us stay paired: they get the picture back as
  // soon as we have it again.
  if (relaying.value) {
    for (const l of pair.links.value) if (l.role === 'watch') pair.closeLink(l.id)
  } else {
    pair.reset()
  }
  reply.value = null
  interrupted.value = false
  watchStep.value = 'get-invite'
}

// Show and record the incoming picture as soon as it arrives.
watch(remoteStream, async (stream) => {
  if (!stream || role.value !== 'watch') return
  // Pass a new upstream picture straight on to everyone watching through us.
  if (relaying.value) await pair.replaceLocalStream(stream)
  watchStep.value = 'live'
  await nextTick()
  if (remoteVideo.value) remoteVideo.value.srcObject = stream
  queueRecording(() => startRecordingOf(stream))
})

// A dead link must not leave the recorder running on a stream that produces
// nothing: bank the segment so it is finalized and signed.
watch(watchPhase, (phase) => {
  if (role.value !== 'watch') return
  if (phase === 'lost' || phase === 'timed-out') {
    if (watchStep.value !== 'live') watchStep.value = 'live'
    queueRecording(stopRecordingNow)
  }
})

// Track events miss the common failure: a path that silently stops delivering.
const stall = createStallMonitor()
const stallTimer = window.setInterval(async () => {
  if (role.value !== 'watch' || !remoteStream.value) return
  const sample = await pair.sampleInboundVideo()
  if (!sample) return
  const health = stall.observe({ ...sample, at: Date.now() })
  if (health === 'stalled' && !interrupted.value) {
    interrupted.value = true
    queueRecording(stopRecordingNow)
  } else if (health === 'flowing' && interrupted.value) {
    interrupted.value = false
    const stream = remoteStream.value
    queueRecording(() => startRecordingOf(stream))
  }
}, 2000)

// --- both --------------------------------------------------------------------

// Hand every signed recording on this device to the other one. The segment
// being recorded right now is closed (and signed) first so it goes too;
// recording carries on in a new segment.
async function handOver(linkId: number) {
  const stream = role.value === 'stream' ? localStream : remoteStream.value
  if (recording.isRecording.value && stream) {
    await queueRecording(async () => {
      await stopRecordingNow()
      await startRecordingOf(stream)
    })
  }
  pair.sendRecordings(linkId)
}

function transferText(t: LinkTransfer | null): string {
  if (!t) return ''
  const parts: string[] = []
  if (t.outgoing) parts.push(`sending ${t.outgoing.done}/${t.outgoing.total} s`)
  if (t.sent) parts.push(`${t.sent} handed over ✓`)
  else if (t.sending && !t.outgoing) parts.push(t.offered === 0 ? 'nothing signed to hand over yet' : 'offering…')
  if (t.incoming) parts.push(`receiving ${t.incoming.done}/${t.incoming.total} s`)
  if (t.received) parts.push(`${t.received} received ✓ verified`)
  if (t.refused.length) parts.push(`refused: ${t.refused.join('; ')}`)
  return parts.join(' · ')
}

async function restart() {
  stopScan()
  await queueRecording(stopRecordingNow)
  pair.reset()
  localStream?.getTracks().forEach((t) => t.stop())
  localStream = null
  invite.value = null
  reply.value = null
  interrupted.value = false
  relaying.value = false
  wakeLock.release()
  role.value = null
  watchStep.value = 'get-invite'
  uiError.value = null
}

onMounted(() => document.addEventListener('visibilitychange', onVisibility))
onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibility)
  if (replySlowTimer) clearTimeout(replySlowTimer)
  clearInterval(stallTimer)
  scanner.stopScanning()
  if (recording.isRecording.value) recording.stopRecording()
  localStream?.getTracks().forEach((t) => t.stop())
  wakeLock.release()
})
</script>
