<template>
  <div class="h-full overflow-y-auto p-4 space-y-4">
    <div class="flex items-center justify-between gap-3">
      <h2 class="text-xl font-bold">Combine copies</h2>
      <RouterLink to="/recordings" class="btn-secondary text-sm py-1.5">Recordings</RouterLink>
    </div>
    <p class="text-sm text-slate-400">
      Every viewer records on its own, so their copies have gaps at different moments. Copies of one stream are laid on
      one clock here, so together they cover more than any single one — and can be rendered into one video.
    </p>

    <div v-if="!groups.length" class="card text-sm text-slate-400" data-testid="no-groups">
      No stream has more than one copy on this device yet. Copies arrive from viewers (home archive, hand-overs, evidence files).
    </div>

    <div v-for="g in groups" :key="groupKey(g.key)" class="card space-y-3" data-testid="group">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 class="font-semibold text-slate-100">
          <template v-if="g.key.kind === 'stream'">Stream signed by key <span class="font-mono">{{ g.key.pk!.slice(0, 8) }}…</span></template>
          <template v-else>Room {{ g.key.id.replace(/^room-/, '') }}</template>
        </h3>
        <span class="text-xs text-slate-500">{{ g.placements.length }} copies</span>
      </div>

      <!-- The copies -->
      <div class="space-y-1.5 text-xs">
        <div v-for="p in g.placements" :key="p.recording.id" class="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="copy">
          <span class="font-mono text-slate-300 w-20">{{ p.recording.id.slice(0, 8) }}</span>
          <span class="text-slate-400">{{ originOf(p.recording) }} · {{ clock(durationOf(p.recording)) }}</span>
          <span v-if="p.excluded === 'does-not-match'" class="text-red-300">✗ does not show this stream — left out</span>
          <span v-else-if="p.excluded === 'no-footage'" class="text-red-300">footage missing — left out</span>
          <span v-else-if="p.copy" :class="ALIGN_CLASS[p.copy.alignment]" data-testid="alignment">{{ ALIGN_LABEL[p.copy.alignment] }}</span>
          <button
            v-if="g.key.kind === 'stream' && !p.excluded && p.copy?.alignment !== 'picture' && hasAttestations(p.recording)"
            class="underline text-slate-300"
            :disabled="checking[p.recording.id] !== undefined"
            data-testid="check-copy"
            @click="checkOne(g, p)"
          >{{ checking[p.recording.id] !== undefined ? `checking… ${checking[p.recording.id]}%` : 'check against the filmer' }}</button>
        </div>
      </div>

      <!-- Coverage -->
      <div v-if="timelines[groupKey(g.key)]" class="space-y-1" data-testid="coverage">
        <div class="relative h-5 rounded bg-white/5 overflow-hidden">
          <div
            v-for="(s, i) in timelines[groupKey(g.key)]!.segments"
            :key="i"
            class="absolute top-0 h-full"
            :class="s.copy ? 'bg-moss/60' : 'bg-red-900/60'"
            :style="span(timelines[groupKey(g.key)]!, s.from, s.to)"
            :title="s.copy ? `${s.copy.slice(0, 8)} ${clock(s.from - timelines[groupKey(g.key)]!.startMs)}–${clock(s.to - timelines[groupKey(g.key)]!.startMs)}` : 'no copy'"
          />
          <div
            v-if="position[groupKey(g.key)] !== undefined"
            class="absolute top-0 h-full w-0.5 bg-white"
            :style="{ left: `${(100 * (position[groupKey(g.key)]! - timelines[groupKey(g.key)]!.startMs)) / (timelines[groupKey(g.key)]!.endMs - timelines[groupKey(g.key)]!.startMs)}%` }"
          />
        </div>
        <p class="text-xs text-slate-400" data-testid="coverage-text">
          Together: {{ clock(timelines[groupKey(g.key)]!.coveredMs) }} covered<template v-if="timelines[groupKey(g.key)]!.gapMs"
            >, {{ clock(timelines[groupKey(g.key)]!.gapMs) }} in gaps no copy covers</template
          >, {{ timelines[groupKey(g.key)]!.segments.filter((s) => s.copy).length }} stretches ·
          aligned by {{ ALIGN_LABEL[timelines[groupKey(g.key)]!.alignment].toLowerCase() }}
        </p>
      </div>

      <!-- Actions -->
      <div class="flex flex-wrap gap-2">
        <button
          v-if="g.key.kind === 'stream' && g.placements.some((p) => !p.excluded && p.copy?.alignment !== 'picture' && hasAttestations(p.recording))"
          class="btn-secondary text-sm py-1.5"
          :disabled="Object.keys(checking).length > 0"
          data-testid="check-all"
          @click="checkAll(g)"
        >Check every copy against the filmer</button>
        <button class="btn-secondary text-sm py-1.5" :disabled="!timelines[groupKey(g.key)] || !!rendering[groupKey(g.key)]" data-testid="play-through" @click="playThrough(g)">
          {{ playingGroup === groupKey(g.key) ? 'Stop' : '▶ Play through' }}
        </button>
        <button class="btn-primary text-sm py-1.5" :disabled="!timelines[groupKey(g.key)] || !!rendering[groupKey(g.key)] || playingGroup !== null" data-testid="render" @click="render(g)">
          {{ rendering[groupKey(g.key)] ? `Rendering… ${rendering[groupKey(g.key)]}%` : 'Render one video' }}
        </button>
      </div>
      <p v-if="errors[groupKey(g.key)]" class="text-xs text-red-300">{{ errors[groupKey(g.key)] }}</p>
      <p v-if="rendered[groupKey(g.key)]" class="text-xs text-moss" data-testid="rendered">
        ✓ Rendered: {{ rendered[groupKey(g.key)]!.slice(0, 8) }} — in <RouterLink to="/recordings" class="underline">Recordings</RouterLink>, signed, with the copies it was made from.
      </p>
      <p v-if="rendering[groupKey(g.key)]" class="text-xs text-slate-400">Rendering plays the record through in real time — keep this screen open.</p>

      <!-- Player -->
      <div v-if="playingGroup === groupKey(g.key)" class="relative rounded-lg overflow-hidden bg-black">
        <video ref="playerEl" playsinline class="w-full max-h-72" data-testid="combined-player" />
        <div v-if="gap" class="absolute inset-0 flex items-center justify-center bg-black/80 text-center text-sm text-slate-300" data-testid="gap-card">
          No copy covers {{ clock(gap.from - timelines[groupKey(g.key)]!.startMs) }}–{{ clock(gap.to - timelines[groupKey(g.key)]!.startMs) }}
        </div>
        <div class="absolute bottom-1 left-2 text-xs text-white/80 font-mono" data-testid="player-position">
          {{ clock((position[groupKey(g.key)] ?? timelines[groupKey(g.key)]!.startMs) - timelines[groupKey(g.key)]!.startMs) }} /
          {{ clock(timelines[groupKey(g.key)]!.endMs - timelines[groupKey(g.key)]!.startMs) }}
          <span v-if="playingCopy" class="ml-2 text-white/60">copy {{ playingCopy.slice(0, 8) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { RouterLink } from 'vue-router'
import type { Recording } from '../types'
import { getAllRecordings } from '../lib/recordingDb'
import { groupCopies, groupKey, place, durationOf, type CopyGroup, type Placement } from '../lib/combine/align'
import { buildTimeline, clock, type Timeline, type Segment, type Alignment } from '../lib/combine/timeline'
import { TimelinePlayer } from '../lib/combine/player'
import { loadSources, renderCombined } from '../lib/combine/record'
import { checkAgainstFilmer, hasAttestations } from '../lib/corroborate/check'
import { useRecording } from '../composables/useRecording'

const ALIGN_LABEL: Record<Alignment, string> = { picture: '✓ Matched against the filmer', signals: '~ by the filmer’s signals', clock: '≈ by device clocks' }
const ALIGN_CLASS: Record<Alignment, string> = { picture: 'text-moss', signals: 'text-glow', clock: 'text-yellow-300' }

const recording = useRecording()
const groups = ref<CopyGroup[]>([])
const timelines = ref<Record<string, Timeline | null>>({})
const checking = ref<Record<string, number>>({})
const rendering = ref<Record<string, number>>({})
const rendered = ref<Record<string, string>>({})
const errors = ref<Record<string, string>>({})
const position = ref<Record<string, number>>({})
const playingGroup = ref<string | null>(null)
const playingCopy = ref<string | null>(null)
const gap = ref<Segment | null>(null)
const playerEl = ref<HTMLVideoElement | HTMLVideoElement[]>()
let player: TimelinePlayer | null = null

function originOf(rec: Recording): string {
  if (rec.origin?.kind === 'imported') return 'imported'
  if (rec.origin?.kind === 'synced') return 'from a paired phone'
  return 'recorded here'
}

function rebuild(g: CopyGroup) {
  place(g)
  timelines.value = { ...timelines.value, [groupKey(g.key)]: buildTimeline(g.placements.map((p) => p.copy!).filter(Boolean)) }
}

async function load() {
  const all = await getAllRecordings()
  groups.value = groupCopies(all)
  for (const g of groups.value) rebuild(g)
}

const span = (t: Timeline, from: number, to: number) => {
  const total = t.endMs - t.startMs || 1
  return { left: `${(100 * (from - t.startMs)) / total}%`, width: `${(100 * (to - from)) / total}%` }
}

async function checkOne(g: CopyGroup, p: Placement) {
  checking.value = { ...checking.value, [p.recording.id]: 0 }
  try {
    const check = await checkAgainstFilmer(p.recording, {
      onProgress: (done, total) => (checking.value = { ...checking.value, [p.recording.id]: Math.min(99, Math.round((100 * done) / Math.max(1, total))) }),
    })
    p.recording = { ...p.recording, corroboration: check }
    rebuild(g)
  } catch (e: any) {
    errors.value = { ...errors.value, [groupKey(g.key)]: e?.message ?? String(e) }
  } finally {
    const { [p.recording.id]: _d, ...rest } = checking.value
    checking.value = rest
  }
}
async function checkAll(g: CopyGroup) {
  for (const p of g.placements) if (!p.excluded && p.copy?.alignment !== 'picture' && hasAttestations(p.recording)) await checkOne(g, p)
}

function stopPlaying() {
  player?.destroy()
  player = null
  playingGroup.value = null
  playingCopy.value = null
  gap.value = null
}

async function playThrough(g: CopyGroup) {
  const key = groupKey(g.key)
  if (playingGroup.value === key) return stopPlaying()
  stopPlaying()
  const timeline = timelines.value[key]
  if (!timeline) return
  const { sources, missing } = await loadSources(g)
  if (missing.length) {
    errors.value = { ...errors.value, [key]: 'Some copies cannot be played here (sealed, or footage missing).' }
    return
  }
  playingGroup.value = key
  await nextTick()
  const el = Array.isArray(playerEl.value) ? playerEl.value[0] : playerEl.value
  if (!el) return
  player = new TimelinePlayer(timeline, sources, el, {
    onPosition: (ms) => (position.value = { ...position.value, [key]: ms }),
    onSegment: (s) => {
      playingCopy.value = s.copy
      gap.value = s.copy ? null : s
    },
    onEnd: () => {
      playingCopy.value = null
      gap.value = null
    },
  })
  player.play(timeline.startMs)
}

async function render(g: CopyGroup) {
  const key = groupKey(g.key)
  const timeline = timelines.value[key]
  if (!timeline) return
  stopPlaying()
  const { sources, missing } = await loadSources(g)
  if (missing.length) {
    errors.value = { ...errors.value, [key]: 'Some copies cannot be rendered here (sealed, or footage missing).' }
    return
  }
  rendering.value = { ...rendering.value, [key]: 0 }
  const { [key]: _e, ...rest } = errors.value
  errors.value = rest
  try {
    const rec = await renderCombined(g, timeline, sources, recording, {
      onProgress: (done, total) => (rendering.value = { ...rendering.value, [key]: Math.min(99, Math.round((100 * done) / Math.max(1, total))) }),
    })
    rendered.value = { ...rendered.value, [key]: rec.id }
  } catch (e: any) {
    errors.value = { ...errors.value, [key]: e?.message ?? String(e) }
  } finally {
    const { [key]: _d, ...others } = rendering.value
    rendering.value = others
  }
}

watch(playingGroup, (v) => {
  if (!v) position.value = {}
})

onMounted(load)
onUnmounted(stopPlaying)
</script>
