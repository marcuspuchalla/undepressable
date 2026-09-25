<template>
  <div class="h-full overflow-y-auto">
    <section class="organic-veil px-5 pt-8 pb-4 text-center">
      <p class="text-xs uppercase tracking-[0.2em] text-moss/80 mb-3">Home archive</p>
      <h1 class="font-display font-black text-slate-50 text-3xl mb-3">A safe place to keep the footage</h1>
      <p class="text-slate-400 max-w-md mx-auto text-sm leading-relaxed">
        Leave this running on a device that stays safe — a home computer. Pair a phone once, and whatever that phone
        watches at the scene is forwarded here and recorded, even if the phone is later taken.
      </p>
    </section>

    <div class="px-4 pb-8 space-y-4">
      <!-- Pairing -->
      <div class="card">
        <div class="flex items-center gap-2 mb-3">
          <span class="font-mono text-[11px] text-slate-500">STEP 1 · PAIR A PHONE</span>
          <span class="h-px flex-1 bg-line" />
        </div>
        <div class="flex flex-col sm:flex-row items-center gap-5">
          <div class="bg-white p-3 rounded-xl shrink-0">
            <canvas ref="qrCanvas" class="w-40 h-40 block" />
          </div>
          <div class="text-center sm:text-left">
            <p class="text-sm text-slate-300 mb-2">
              On the phone that will go to the scene, scan this code (or open the link) to pair it with this archive.
            </p>
            <p class="text-xs text-slate-500 mb-1">Pairing code</p>
            <div
              class="font-mono text-2xl font-bold tracking-widest text-moss cursor-pointer hover:opacity-80"
              @click="copy(homeKey)"
            >
              {{ homeKey }}
            </div>
            <p v-if="copied" class="text-xs text-moss mt-1">Copied</p>
            <p class="text-[11px] text-slate-500 mt-2 break-all">{{ pairUrl }}</p>
          </div>
        </div>
        <p v-if="pairBase.reachability !== 'public'" class="mt-3 text-xs text-yellow-200 bg-yellow-900/40 border border-yellow-500/30 rounded-lg px-3 py-2 leading-relaxed">
          This link only opens on {{ pairBase.reachability === 'lan' ? 'your local network' : 'this device' }}. Scan it
          from inside the app on the phone (Collect → Scan) — or
          <RouterLink to="/network" class="underline">set the app's public address</RouterLink> so its camera can open it.
        </p>
        <p v-if="relayInLink" class="mt-2 text-xs text-moss">✓ This archive's relay is included, so the phone can reach it from strict networks.</p>
      </div>

      <!-- Status -->
      <div class="card">
        <div class="flex items-center gap-2 mb-3">
          <span class="font-mono text-[11px] text-slate-500">STEP 2 · KEEP THIS OPEN</span>
          <span class="h-px flex-1 bg-line" />
        </div>

        <div class="flex items-center gap-3">
          <span
            class="w-2.5 h-2.5 rounded-full shrink-0"
            :class="isRecording ? 'bg-ember animate-pulse' : peerCount > 0 ? 'bg-moss' : 'bg-slate-500'"
          />
          <div class="flex-1">
            <p class="text-sm font-medium text-slate-100">
              {{ isRecording ? 'Recording a forwarded stream' : peerCount > 0 ? 'Paired phone connected' : 'Waiting for a paired phone' }}
            </p>
            <p class="text-xs text-slate-500">
              {{ isRecording ? formatDuration(recordingDuration) + ' · saving locally' : 'This device will start recording automatically when a stream arrives.' }}
            </p>
          </div>
        </div>

        <!-- Why the paired phone can or cannot reach this archive -->
        <ConnectionDoctor
          v-if="diagnosis.level !== 'info' || peerCount > 0"
          :diagnosis="diagnosis"
          class="mt-3"
          @action="onDoctorAction"
        />

        <video v-show="remoteStream" ref="videoEl" autoplay playsinline muted class="w-full rounded-xl bg-black mt-3 max-h-64" />
      </div>

      <!-- Archived this session -->
      <div v-if="archived.length" class="card">
        <div class="flex items-center gap-2 mb-3">
          <span class="font-mono text-[11px] text-slate-500">ARCHIVED THIS SESSION</span>
          <span class="h-px flex-1 bg-line" />
        </div>
        <ul class="space-y-1.5">
          <li v-for="r in archived" :key="r.id" class="flex items-center justify-between text-sm">
            <span class="flex items-center gap-2 text-slate-300">
              <svg class="w-4 h-4 text-moss" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              {{ r.chunks }} chunks · {{ formatDuration(r.ms) }}
            </span>
            <span class="font-mono text-xs text-slate-500">{{ r.id.slice(0, 8) }}…</span>
          </li>
        </ul>
        <RouterLink to="/recordings" class="inline-block mt-3 text-xs text-glow hover:underline">Open Recordings →</RouterLink>
      </div>

      <p class="text-xs text-slate-500 text-center px-6 leading-relaxed">
        Tip: this is just the app in a browser tab. Keep the tab open and the device online. Everything is stored
        locally and signed — nothing passes through a server.
      </p>
    </div>
    <RelaySetup v-model:open="showRelay" :auto-test="relayAutoTest" :show-stun="diag.natKind.value === 'blocked'" @saved="onRelaySaved" @share-changed="linkTick++" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import QRCode from 'qrcode'
import { useTrystero } from '../composables/useTrystero'
import { useRecording } from '../composables/useRecording'
import { getHomeKey, archiveRoomId } from '../lib/archive'
import type { Recording } from '../types'
import { useConnectionDiagnosis } from '../composables/useConnectionDiagnosis'
import { resolveShareBase, buildPairHomeUrl, getConfiguredPublicUrl } from '../lib/net/shareLink'
import { relayShareParams } from '../lib/net/iceConfig'
import { discoveryShareParams } from '../lib/net/discoveryConfig'
import type { DiagnosisAction } from '../lib/net/diagnosis'
import ConnectionDoctor from '../components/ConnectionDoctor.vue'
import RelaySetup from '../components/RelaySetup.vue'
import { RouterLink } from 'vue-router'

const trystero = useTrystero()
const recording = useRecording()

const homeKey = ref('')

// The pairing link must open on the phone — this archive is often the desktop
// app (tauri://localhost) — and carries this device's relay, since a home
// router and a phone on mobile data are frequently a strict-NAT pair too.
const linkTick = ref(0)
const pairBase = computed(() => {
  void linkTick.value
  return resolveShareBase({
    origin: location.origin,
    configured: getConfiguredPublicUrl(),
    envPublicUrl: (import.meta as any).env?.VITE_PUBLIC_URL ?? null,
  })
})
const linkParams = computed(() => {
  void linkTick.value
  return { ...relayShareParams(), ...discoveryShareParams() }
})
const relayInLink = computed(() => 'turn' in linkParams.value || 'ice' in linkParams.value)
const pairUrl = computed(() => (homeKey.value ? buildPairHomeUrl(pairBase.value.base, homeKey.value, linkParams.value) : ''))
const qrCanvas = ref<HTMLCanvasElement>()
const videoEl = ref<HTMLVideoElement>()
const remoteStream = ref<MediaStream | null>(null)
const isRecording = ref(false)
const recordingDuration = ref(0)
const copied = ref(false)
const archived = ref<{ id: string; chunks: number; ms: number }[]>([])
let durationInterval: number | null = null

const peerCount = ref(0)
watch(() => trystero.peerCount.value, (n) => (peerCount.value = n))

const diag = useConnectionDiagnosis(trystero, { role: 'archive', hasStream: () => !!remoteStream.value })
const diagnosis = diag.diagnosis
const showRelay = ref(false)
const relayAutoTest = ref(false)

function onDoctorAction(action: DiagnosisAction) {
  if (action === 'setup-relay' || action === 'test-relay') {
    relayAutoTest.value = action === 'test-relay'
    showRelay.value = true
  }
}

// New relay settings apply to new connections only: re-open the archive room.
async function onRelaySaved() {
  diag.refreshRelay()
  linkTick.value++
  await trystero.joinRoom(archiveRoomId(homeKey.value), ['both'])
}

async function drawPairQr() {
  await nextTick()
  if (qrCanvas.value && pairUrl.value) {
    QRCode.toCanvas(qrCanvas.value, pairUrl.value, { width: 160, margin: 1 }).catch(() => {})
  }
}
watch(pairUrl, drawPairQr)

onMounted(async () => {
  homeKey.value = getHomeKey()
  await drawPairQr()

  await trystero.init(['both'])
  await trystero.joinRoom(archiveRoomId(homeKey.value), ['both'])

  trystero.setOnStreamReceived(async (stream) => {
    // Reported once per track (audio, then video). Acting on both started two
    // recorders at once, and one of them was never finalized or signed.
    if (remoteStream.value === stream) return
    const replacing = remoteStream.value !== null
    remoteStream.value = stream
    // Finalize the recording if the forwarding phone's track ends.
    stream.getVideoTracks()[0]?.addEventListener('ended', () => queueRecording(stop))
    // A phone that reconnected brings a new stream: bank the old segment
    // (still verifiable) and record the new one.
    queueRecording(async () => {
      if (replacing) await stop()
      await start(stream)
    })
    await nextTick()
    const v = videoEl.value
    if (v) {
      v.srcObject = stream
      // Set while the element was still hidden, autoplay never kicks in.
      v.play().catch(() => {})
    }
  })
})

// Start/stop come from independent events (stream arrival, track end, peer
// leaving); run them one at a time so recorders never overlap.
let recOps: Promise<unknown> = Promise.resolve()
function queueRecording(fn: () => Promise<void>) {
  recOps = recOps.then(fn, fn)
  return recOps
}

// Stop and save when the paired phone disconnects.
watch(peerCount, (n) => {
  if (n > 0) return
  queueRecording(stop)
  remoteStream.value = null
})

async function start(stream: MediaStream) {
  if (isRecording.value) return
  const ok = await recording.startRecording(stream, 'medium', `archive-${homeKey.value}`)
  if (!ok) return
  isRecording.value = true
  recordingDuration.value = 0
  durationInterval = window.setInterval(() => (recordingDuration.value += 1000), 1000)
}

async function stop() {
  if (!isRecording.value) return
  if (durationInterval) {
    clearInterval(durationInterval)
    durationInterval = null
  }
  const saved: Recording | null = await recording.stopRecording()
  isRecording.value = false
  if (saved) {
    archived.value.unshift({
      id: saved.id,
      chunks: saved.chunks.length,
      ms: (saved.endedAt?.getTime() ?? Date.now()) - saved.startedAt.getTime(),
    })
  }
}

function copy(text: string) {
  navigator.clipboard?.writeText(text)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toString().padStart(2, '0')}`
}

onUnmounted(() => {
  if (durationInterval) clearInterval(durationInterval)
  if (isRecording.value) recording.stopRecording()
  trystero.leaveRoom()
})
</script>
