<template>
  <div class="h-full overflow-y-auto p-4">
    <div class="flex items-center justify-between mb-4 gap-3">
      <h2 class="text-xl font-bold">Recordings</h2>
      <label class="btn-secondary text-sm py-1.5 cursor-pointer" data-testid="import-evidence">
        Import…
        <input
          type="file"
          multiple
          accept=".zip,.webm,.txt,.json,video/webm,application/zip,text/plain,application/json"
          class="hidden"
          data-testid="import-input"
          @change="onImport"
        />
      </label>
    </div>

    <!-- Import result -->
    <div v-if="importState" class="card mb-4 text-sm" role="status" data-testid="import-status">
      <p v-if="importState.busy" class="text-slate-300">
        Checking every second of the video against its signature… {{ importState.done }}/{{ importState.total || '?' }}
      </p>
      <template v-else>
        <p :class="importState.ok ? 'text-moss' : 'text-red-300'" class="font-medium">{{ importState.message }}</p>
        <p v-if="importState.detail" class="text-xs text-slate-400 mt-1">{{ importState.detail }}</p>
      </template>
    </div>

    <!-- Home archive: store and forward -->
    <div v-if="pairedHome" class="card mb-4 text-sm space-y-2" data-testid="home-sync">
      <div class="flex items-center gap-2">
        <svg class="w-4 h-4 text-moss shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
        <span class="text-slate-300">Home archive <span class="font-mono">{{ pairedHome }}</span></span>
      </div>
      <p class="text-slate-400" data-testid="home-sync-status">{{ syncText }}</p>
      <div v-if="syncSender?.progress.value" class="h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div class="h-full bg-moss transition-all" :style="{ width: (100 * syncSender.progress.value.done) / syncSender.progress.value.total + '%' }" />
      </div>
      <div class="flex gap-2">
        <button v-if="syncState === 'idle' && notHome > 0" class="btn-primary text-sm py-1.5" data-testid="send-home" @click="sendHome">
          Send {{ notHome }} to home now
        </button>
        <button v-if="syncState !== 'idle'" class="btn-secondary text-sm py-1.5" @click="stopSync">Stop</button>
      </div>
    </div>

    <!-- Sealing: recordings a seized phone cannot show -->
    <ProtectRecordings @changed="refreshRecordings" />

    <!-- Storage Info -->
    <div class="card mb-4">
      <div class="flex items-center justify-between mb-2">
        <span class="text-sm text-gray-400">Storage</span>
        <button class="text-xs text-primary-400 hover:text-primary-300" @click="refreshRecordings">Refresh</button>
      </div>
      <div class="h-2 bg-gray-700 rounded-full overflow-hidden">
        <div class="h-full bg-primary-500 transition-all" :style="{ width: storagePercent + '%' }" />
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
      <p class="text-gray-400 mb-4">Start collecting a stream to save recordings — or import one someone sent you.</p>
      <RouterLink to="/collect" class="btn-primary">Collect Stream</RouterLink>
    </div>

    <!-- Recordings List -->
    <div v-else class="space-y-3">
      <div v-for="recording in recordings" :key="recording.id" class="card" data-testid="recording">
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
            <div class="flex flex-wrap items-center gap-2 mb-1">
              <span class="px-2 py-0.5 rounded text-xs font-medium" :class="STATUS_CLASS[recording.status] ?? STATUS_CLASS.recording">
                {{ recording.status === 'receiving' ? 'arriving…' : recording.status }}
              </span>
              <span class="text-xs text-gray-500">{{ formatDate(recording.startedAt) }}</span>
              <span v-if="recording.origin?.kind === 'imported'" class="text-xs text-glow">imported · verified</span>
              <span v-else-if="recording.origin?.kind === 'synced'" class="text-xs text-glow">from a paired phone{{ recording.origin.verified ? ' · verified' : '' }}</span>
              <span v-if="atHome[recording.id]" class="text-xs text-moss" data-testid="at-home">✓ at home</span>
              <span v-if="recording.sealed" class="text-xs text-amber-300" data-testid="sealed-badge">🔒 sealed{{ SEAL_LABEL[sealAudience(recording.sealed.keys)] }}</span>
              <span v-if="recording.origin?.opened" class="text-xs text-glow">arrived sealed · opened here</span>
            </div>
            <p v-if="notice[recording.id]" class="text-xs text-amber-200 mb-1" data-testid="sealed-notice">{{ notice[recording.id] }}</p>

            <p class="text-sm text-gray-400 truncate">Campaign: {{ recording.campaignId.slice(0, 8) }}...</p>

            <div class="flex items-center gap-4 mt-2 text-xs text-gray-500">
              <span>{{ recording.chunks.length }} chunks</span>
              <span>{{ recording.metadata.resolution.width }}x{{ recording.metadata.resolution.height }}</span>
              <span v-if="recording.endedAt">{{ formatDuration(recording.endedAt.getTime() - recording.startedAt.getTime()) }}</span>
            </div>

            <!-- Tamper-evidence -->
            <div v-if="recording.proof" class="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <button
                class="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 flex items-center gap-1 transition-colors"
                data-testid="verify"
                :disabled="verifying[recording.id] !== undefined"
                @click="verify(recording)"
              >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                {{ verifying[recording.id] !== undefined ? `Checking… ${verifying[recording.id]}%` : 'Verify integrity' }}
              </button>
              <span
                v-if="verifyResults[recording.id]"
                :class="verifyResults[recording.id].valid ? 'text-green-400' : 'text-red-400'"
                class="font-medium"
                data-testid="verify-result"
              >
                {{ verifyResults[recording.id].valid ? (verifyResults[recording.id].sealed ? '✓ Intact (sealed — not opened)' : '✓ Unaltered') : '✗ ' + verifyResults[recording.id].reason }}
              </span>
              <span class="text-gray-600 font-mono" title="Anonymous signing key">signer {{ recording.proof.pubKey.slice(0, 8) }}…</span>
            </div>

            <!-- Trusted timestamp: proof it existed by a given time -->
            <div v-if="recording.proof && recording.status === 'completed'" class="mt-1.5 flex flex-wrap items-center gap-2 text-xs" data-testid="timestamp-row">
              <button
                v-if="!recording.timestamp"
                class="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 transition-colors"
                :disabled="!!stamping[recording.id]"
                title="Sends only a fingerprint of the proof to public OpenTimestamps servers"
                data-testid="timestamp"
                @click="timestampNow(recording)"
              >⏱ {{ stamping[recording.id] ? 'Requesting…' : 'Timestamp' }}</button>
              <template v-else>
                <span :class="recording.timestamp.bitcoin ? 'text-moss' : 'text-slate-400'" data-testid="timestamp-status">{{ stampText(recording) }}</span>
                <button
                  v-if="!recording.timestamp.bitcoin?.checkedAt"
                  class="text-slate-400 underline"
                  :disabled="!!stamping[recording.id]"
                  data-testid="timestamp-check"
                  @click="checkStamp(recording)"
                >{{ stamping[recording.id] ? 'Checking…' : 'Check now' }}</button>
              </template>
              <span v-if="stampError[recording.id]" class="text-red-300">{{ stampError[recording.id] }}</span>
            </div>

            <!-- Checked against what the filming phone signed while streaming -->
            <div v-if="hasAttestations(recording) && recording.status === 'completed'" class="mt-1.5 text-xs space-y-1" data-testid="corroborate-row">
              <div class="flex flex-wrap items-center gap-2">
                <button
                  class="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 transition-colors"
                  :disabled="corroborating[recording.id] !== undefined"
                  title="Plays this copy through and compares it with the fingerprints the filming phone signed live"
                  data-testid="corroborate"
                  @click="checkFilmer(recording)"
                >{{ corroborating[recording.id] !== undefined ? `Comparing… ${corroborating[recording.id]}%` : '🎥 Check against the filmer' }}</button>
                <span class="text-slate-500">{{ attestationCount(recording) }} s signed by the filming phone</span>
              </div>
              <template v-if="recording.corroboration && corroborating[recording.id] === undefined">
                <p
                  v-for="r in recording.corroboration.results"
                  :key="r.signer"
                  :class="CORR_CLASS[r.verdict]"
                  data-testid="corroborate-result"
                >{{ corroborationText(r) }}</p>
                <p v-if="!recording.corroboration.results.length" class="text-red-300" data-testid="corroborate-result">✗ None of the signatures check out.</p>
              </template>
              <p v-if="corrError[recording.id]" class="text-red-300">{{ corrError[recording.id] }}</p>
            </div>

          </div>

          <!-- Actions -->
          <div class="flex flex-col gap-2">
            <button class="p-2 hover:bg-gray-700 rounded-lg transition-colors" title="Play" @click="playRecording(recording)">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            <button
              v-if="recording.proof && recording.status === 'completed'"
              class="p-2 hover:bg-gray-700 rounded-lg transition-colors"
              title="Send or save with proof"
              data-testid="send-evidence"
              @click="openSend(recording)"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            </button>
            <button v-else class="p-2 hover:bg-gray-700 rounded-lg transition-colors" title="Download" @click="downloadRecording(recording)">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
            <button class="p-2 hover:bg-red-900/50 text-red-400 rounded-lg transition-colors" title="Delete" @click="deleteRecording(recording)">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
        <!-- Send / save as evidence -->
        <div v-if="sendPanel[recording.id]" class="mt-3 rounded-lg border border-line bg-white/5 p-3 text-xs space-y-2" data-testid="send-panel">
          <p v-if="sendPanel[recording.id].busy" class="text-slate-300">Preparing the video and its proof…</p>
          <p v-else-if="sendPanel[recording.id].error" class="text-red-300">{{ sendPanel[recording.id].error }}</p>
          <template v-else>
            <p class="text-slate-400 leading-relaxed">
              The video travels with its signed proof. Works without internet — AirDrop, Quick Share, Bluetooth, a
              USB stick. The receiving device checks every second of it under Recordings → Import.
            </p>
            <p v-if="recording.sealed" class="text-amber-200 leading-relaxed">
              🔒 It stays sealed: only whoever holds the key can open it. Anyone else who receives it can still check
              that it is intact and pass it on — for example to your home archive.
            </p>
            <div class="flex flex-wrap gap-2">
              <button v-if="sendPanel[recording.id].canShare" class="btn-primary text-xs py-1.5" @click="shareEvidence(recording)">
                Share…
              </button>
              <button class="btn-secondary text-xs py-1.5" data-testid="save-evidence" @click="saveEvidence(recording)">
                Save as file
              </button>
            </div>
          </template>
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
        <video ref="playerVideo" class="w-full rounded-lg" controls autoplay />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { RouterLink } from 'vue-router'
import { useRecordingStore } from '../stores/recording'
import { useOPFS } from '../composables/useOPFS'
import { useTrystero } from '../composables/useTrystero'
import { useSyncSender } from '../composables/useRecordingSync'
import type { Recording } from '../types'
import { getPairedHome, archiveRoomId } from '../lib/archive'
import {
  manifestFor,
  buildBundle,
  bundleName,
  videoName,
  evidenceTxtName,
  readEvidenceInput,
  verifyEvidence,
} from '../lib/transfer/evidence'
import { chunkBlobs, verifyStored, importEvidence, deliveredTo, makeOutbox, footage } from '../lib/transfer/library'
import { sealAudience, type SealAudience } from '../lib/seal/keys'
import { stampRecording, refreshTimestamp, autoTimestamp } from '../lib/timestamp/recordingStamp'
import ProtectRecordings from '../components/ProtectRecordings.vue'
import { hasAttestations, checkAgainstFilmer } from '../lib/corroborate/check'
import { entryCount } from '../lib/corroborate/log'
import type { Corroboration } from '../lib/corroborate/match'

const recordingStore = useRecordingStore()
const opfs = useOPFS()

const STATUS_CLASS: Record<string, string> = {
  completed: 'bg-green-900/50 text-green-400',
  recording: 'bg-yellow-900/50 text-yellow-400',
  receiving: 'bg-sky-900/50 text-sky-300',
  failed: 'bg-red-900/50 text-red-300',
  cancelled: 'bg-gray-800 text-gray-400',
}

// State
const recordings = computed(() => recordingStore.recordings)
const storageUsed = ref(0)
const storageQuota = ref(0)
const playingRecording = ref<Recording | null>(null)
const playerVideo = ref<HTMLVideoElement>()
const verifyResults = ref<Record<string, { valid: boolean; reason?: string; sealed?: boolean }>>({})
const notice = ref<Record<string, string>>({})

// --- trusted timestamps ---
const stamping = ref<Record<string, boolean>>({})
const stampError = ref<Record<string, string>>({})
function stampText(rec: Recording): string {
  const t = rec.timestamp!
  if (!t.bitcoin) return '⏱ Timestamp requested — anchoring it in Bitcoin takes a few hours'
  const when = t.bitcoin.blockTime ? ` (${formatDate(new Date(t.bitcoin.blockTime * 1000))})` : ''
  return `⏱ Existed by Bitcoin block #${t.bitcoin.height}${when}${t.bitcoin.checkedAt ? ' ✓ checked' : ''}`
}
async function withStamp(rec: Recording, fn: (r: Recording) => Promise<Recording>) {
  stamping.value = { ...stamping.value, [rec.id]: true }
  const { [rec.id]: _e, ...rest } = stampError.value
  stampError.value = rest
  try {
    await fn(rec)
    await recordingStore.loadRecordings()
  } catch (e: any) {
    stampError.value = { ...stampError.value, [rec.id]: e?.message ?? String(e) }
  } finally {
    stamping.value = { ...stamping.value, [rec.id]: false }
  }
}
const timestampNow = (rec: Recording) => withStamp(rec, stampRecording)
const checkStamp = (rec: Recording) => withStamp(rec, refreshTimestamp)
// --- checked against the filmer's live attestations ---
const corroborating = ref<Record<string, number>>({})
const corrError = ref<Record<string, string>>({})
const CORR_CLASS: Record<Corroboration['verdict'], string> = {
  corroborated: 'text-moss',
  'not-corroborated': 'text-red-300',
  'too-short': 'text-slate-400',
}
const attestationCount = (rec: Recording) => entryCount(rec.attestations ?? [])
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`
/** "0:04–0:08, 0:15": unmatched moments, consecutive seconds joined. */
function stretches(ms: number[]): string {
  const out: string[] = []
  let from = -1
  let to = -1
  for (const m of [...ms].sort((a, b) => a - b)) {
    if (from >= 0 && m - to <= 1500) to = m
    else {
      if (from >= 0) out.push(from === to ? clock(from) : `${clock(from)}–${clock(to)}`)
      from = to = m
    }
  }
  if (from >= 0) out.push(from === to ? clock(from) : `${clock(from)}–${clock(to)}`)
  return out.slice(0, 6).join(', ') + (out.length > 6 ? ', …' : '')
}
function corroborationText(r: Corroboration): string {
  const key = `key ${r.signer.slice(0, 8)}…`
  const gaps = r.unmatchedAt.length ? ` No match at ${stretches(r.unmatchedAt)}.` : ''
  if (r.verdict === 'too-short') return `Too few signed moments to tell (${r.total}) — ${key}`
  if (r.verdict === 'not-corroborated') return `✗ Does not show what the filming phone signed: ${r.matched} of ${r.total} moments match (${key}).${gaps}`
  const still = r.scenes <= 1 ? ' The picture hardly changed, so this says little.' : ''
  return `✓ Shows what the filming phone's camera showed: ${r.matched} of ${r.total} signed moments match (${key}).${gaps}${still}`
}
async function checkFilmer(rec: Recording) {
  corroborating.value = { ...corroborating.value, [rec.id]: 0 }
  const { [rec.id]: _e, ...rest } = corrError.value
  corrError.value = rest
  try {
    await checkAgainstFilmer(rec, {
      onProgress: (done, total) => {
        corroborating.value = { ...corroborating.value, [rec.id]: Math.min(99, Math.round((100 * done) / Math.max(total, 1))) }
      },
    })
    await recordingStore.loadRecordings()
  } catch (e: any) {
    corrError.value = { ...corrError.value, [rec.id]: e?.message ?? String(e) }
  } finally {
    const { [rec.id]: _d, ...others } = corroborating.value
    corroborating.value = others
  }
}

const SEAL_LABEL: Record<SealAudience, string> = { home: ' for home', passphrase: ' · passphrase', both: ' · home + passphrase', other: '' }
const verifying = ref<Record<string, number>>({})

async function verify(recording: Recording) {
  // Never show the previous verdict while checking again (it may be about to change: e.g. after unlocking).
  const { [recording.id]: _old, ...others } = verifyResults.value
  verifyResults.value = others
  verifying.value = { ...verifying.value, [recording.id]: 0 }
  try {
    const r = await verifyStored(recording, (done, total) => {
      verifying.value = { ...verifying.value, [recording.id]: Math.round((100 * done) / total) }
    })
    verifyResults.value = { ...verifyResults.value, [recording.id]: r }
  } finally {
    const { [recording.id]: _done, ...rest } = verifying.value
    verifying.value = rest
  }
}

const storagePercent = computed(() => {
  if (!storageQuota.value) return 0
  return (storageUsed.value / storageQuota.value) * 100
})

async function refreshRecordings() {
  await recordingStore.loadRecordings()
  const usage = await opfs.getStorageUsage()
  if (usage) {
    storageUsed.value = usage.used
    storageQuota.value = usage.remaining + usage.used
  }
  await refreshHome()
}

// The footage in recording order, opened if sealed and a key is at hand
// (chunk metadata first; raw files as a fallback for unsigned recordings).
async function videoBlob(recording: Recording): Promise<Blob | null> {
  const f = await footage(recording)
  if ('video' in f) return f.video
  if ('sealedFor' in f) {
    const who = sealAudience(recording.sealed?.keys ?? [])
    notice.value = {
      ...notice.value,
      [recording.id]:
        who === 'home'
          ? 'Sealed for your home archive — this phone cannot open it. Send it home to watch it there.'
          : who === 'other'
            ? 'Sealed for someone else — this device cannot open it. You can check it is intact and pass it on.'
            : 'Sealed — unlock with your passphrase under “Protect recordings” to open it.',
    }
    return null
  }
  const raw = await opfs.readAllChunks(recording.campaignId, recording.id)
  return raw.length ? new Blob(raw, { type: recording.metadata.codec }) : null
}

async function playRecording(recording: Recording) {
  const blob = await videoBlob(recording)
  if (!blob) return
  playingRecording.value = recording
  await nextTick()
  if (playerVideo.value) playerVideo.value.src = URL.createObjectURL(blob)
}

function closePlayer() {
  if (playerVideo.value) {
    playerVideo.value.pause()
    playerVideo.value.src = ''
  }
  playingRecording.value = null
}

function saveFile(file: Blob, name: string) {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

async function downloadRecording(recording: Recording) {
  const blob = await videoBlob(recording)
  if (blob) saveFile(blob, `recording-${recording.id.slice(0, 8)}-${formatDateForFilename(recording.startedAt)}.webm`)
}

// --- send / save with proof ---
// Two steps on purpose: building the files can take longer than a browser
// lets a tap count as permission to open the share sheet.
interface SendPrep {
  busy: boolean
  error?: string
  zip?: File
  pair?: File[]
  canShare?: boolean
}
const sendPanel = ref<Record<string, SendPrep>>({})

function shareable(p: SendPrep): File[] | null {
  if (typeof navigator.canShare !== 'function') return null
  try {
    if (p.zip && navigator.canShare({ files: [p.zip] })) return [p.zip]
    if (p.pair && navigator.canShare({ files: p.pair })) return p.pair
  } catch {
    /* canShare throws on some platforms for unsupported types */
  }
  return null
}

async function openSend(recording: Recording) {
  if (sendPanel.value[recording.id]) {
    const { [recording.id]: _closed, ...rest } = sendPanel.value
    sendPanel.value = rest
    return
  }
  sendPanel.value = { ...sendPanel.value, [recording.id]: { busy: true } }
  const set = (p: SendPrep) => (sendPanel.value = { ...sendPanel.value, [recording.id]: p })
  const manifest = manifestFor(recording)
  const blobs = manifest ? await chunkBlobs(recording) : null
  if (!manifest || !blobs) {
    set({ busy: false, error: 'Some of this recording is missing from the device, so it cannot be sent with its proof.' })
    return
  }
  const pair = [
    new File(blobs, videoName(manifest), { type: manifest.sealed ? 'application/octet-stream' : 'video/webm' }),
    new File([JSON.stringify(manifest, null, 2)], evidenceTxtName(manifest), { type: 'text/plain' }),
  ]
  let zip: File | undefined
  try {
    zip = new File([await buildBundle(manifest, blobs)], bundleName(manifest), { type: 'application/zip' })
  } catch {
    /* over ~4 GB: send the two files instead */
  }
  const prep: SendPrep = { busy: false, zip, pair }
  prep.canShare = shareable(prep) !== null
  set(prep)
}

async function shareEvidence(recording: Recording) {
  const p = sendPanel.value[recording.id]
  const files = p && shareable(p)
  if (!files) return saveEvidence(recording)
  try {
    await navigator.share({ files, title: 'Undepressable recording' })
  } catch (e: any) {
    if (e?.name !== 'AbortError') saveEvidence(recording)
  }
}

function saveEvidence(recording: Recording) {
  const p = sendPanel.value[recording.id]
  if (!p) return
  if (p.zip) saveFile(p.zip, p.zip.name)
  else for (const f of p.pair ?? []) saveFile(f, f.name)
}

// --- import ---
const importState = ref<{ busy: boolean; ok?: boolean; message?: string; detail?: string; done?: number; total?: number } | null>(null)

async function onImport(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (!files.length) return
  importState.value = { busy: true, done: 0, total: 0 }
  try {
    const picked = await readEvidenceInput(files)
    if (!picked.ok) {
      importState.value = { busy: false, ok: false, message: 'Not imported', detail: picked.reason }
      return
    }
    const check = await verifyEvidence(picked.manifest, picked.video, (done, total) => {
      importState.value = { busy: true, done, total }
    })
    if (!check.valid) {
      importState.value = { busy: false, ok: false, message: '✗ Not imported — this is not the recording that was signed', detail: check.reason }
      return
    }
    const result = await importEvidence(picked.manifest, picked.video)
    const seconds = picked.manifest.chunkSizes.length
    importState.value = {
      busy: false,
      ok: true,
      message: result === 'exists' ? '✓ Verified — this device already has this recording' : `✓ Verified and imported (${seconds} s)`,
      detail: `Every second matches the signature of key ${picked.manifest.proof.pubKey.slice(0, 8)}…`,
    }
    await refreshRecordings()
  } catch (e: any) {
    importState.value = { busy: false, ok: false, message: 'Import failed', detail: e?.message ?? String(e) }
  }
}

// --- store and forward to the paired home archive ---
const pairedHome = getPairedHome()
const atHome = ref<Record<string, string>>({})
const notHome = ref(0)
const syncState = ref<'idle' | 'connecting' | 'sending' | 'done'>('idle')
const syncTrystero = useTrystero()
const syncSender = shallowRef<ReturnType<typeof useSyncSender> | null>(null)
let syncWatchers: (() => void)[] = []
let connectingSince = 0
const tick = ref(0)
let tickTimer: number | null = null

async function refreshHome() {
  if (!pairedHome) return
  atHome.value = deliveredTo(pairedHome)
  notHome.value = (await makeOutbox(pairedHome).pending()).length
  if (syncState.value !== 'idle' && notHome.value === 0) syncState.value = 'done'
}

async function sendHome() {
  if (!pairedHome) return
  syncState.value = 'connecting'
  connectingSince = Date.now()
  tickTimer ??= window.setInterval(() => tick.value++, 1000)
  await syncTrystero.init(['both'])
  const sender = useSyncSender(syncTrystero, pairedHome)
  syncSender.value = sender
  syncWatchers = [
    watch(sender.progress, (p) => {
      if (p && syncState.value !== 'done') syncState.value = 'sending'
    }),
    watch(sender.delivered, () => refreshRecordings()),
  ]
  await syncTrystero.joinRoom(archiveRoomId(pairedHome), ['both'])
}

function stopSync() {
  syncSender.value?.stop()
  syncSender.value = null
  for (const stop of syncWatchers.splice(0)) stop()
  syncTrystero.leaveRoom()
  syncState.value = 'idle'
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = null
  }
}

const syncText = computed(() => {
  void tick.value
  switch (syncState.value) {
    case 'idle':
      return notHome.value === 0
        ? 'Everything signed on this device is already at home.'
        : `${notHome.value} recording${notHome.value === 1 ? ' is' : 's are'} not at home yet. They are sent when both devices are online — the home device must have the Home archive screen open.`
    case 'connecting': {
      const s = Math.round((Date.now() - connectingSince) / 1000)
      return s < 20
        ? 'Looking for your home archive…'
        : `Still looking (${s} s). Is the Home archive screen open at home and online? Strict networks may need a relay (Network).`
    }
    case 'sending': {
      const p = syncSender.value?.progress.value
      return p ? `Sending — ${p.done} of ${p.total} s of the current recording (${notHome.value} left). Each second is checked at home.` : 'Sending…'
    }
    case 'done':
      return '✓ Everything is at home, checked against its signature. Keep this device\'s copy or delete it — that is up to you.'
  }
  return ''
})

async function deleteRecording(recording: Recording) {
  if (!confirm('Are you sure you want to delete this recording?')) return
  await opfs.deleteRecording(recording.campaignId, recording.id)
  await recordingStore.deleteRecording(recording.id)
  await refreshRecordings()
}

// Utilities
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(date))
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

const onRecordingSaved = () => void refreshRecordings()

// With automatic timestamps on: stamp what has none yet, and look in on
// pending ones (each at most once per visit).
async function catchUpTimestamps() {
  if (!autoTimestamp() || !navigator.onLine) return
  for (const rec of recordingStore.recordings) {
    if (!rec.proof || rec.status !== 'completed') continue
    try {
      if (!rec.timestamp) await stampRecording(rec)
      else if (!rec.timestamp.bitcoin?.checkedAt) await refreshTimestamp(rec)
    } catch {
      /* offline or servers unreachable: next visit */
    }
  }
  await recordingStore.loadRecordings()
}

onMounted(async () => {
  await refreshRecordings()
  void catchUpTimestamps()
  window.addEventListener('undepressable:recording-saved', onRecordingSaved)
})
onUnmounted(() => {
  window.removeEventListener('undepressable:recording-saved', onRecordingSaved)
  if (syncState.value !== 'idle') stopSync()
})
</script>
