<template>
  <div
    class="rounded-xl border backdrop-blur-sm text-left"
    :class="[tone.box, compact ? 'px-3 py-1.5' : 'p-3']"
    role="status"
    aria-live="polite"
  >
    <div class="flex items-center gap-2">
      <span class="w-2 h-2 rounded-full flex-none" :class="[tone.dot, busy ? 'animate-pulse' : '']" />
      <span class="text-sm font-medium" :class="tone.title">{{ diagnosis.title }}</span>
      <span
        v-if="diagnosis.path && diagnosis.code === 'connected'"
        class="ml-auto text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded bg-white/10 text-slate-300"
      >{{ PATH_LABEL[diagnosis.path] }}</span>
    </div>
    <p v-if="!compact || diagnosis.level === 'error' || diagnosis.level === 'warn'" class="text-xs text-slate-300/90 mt-1 leading-relaxed">
      {{ diagnosis.detail }}
    </p>
    <div v-if="diagnosis.action && (diagnosis.level === 'error' || diagnosis.level === 'warn')" class="mt-2 flex flex-wrap gap-2">
      <button
        class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-glow text-ink hover:bg-primary-200 transition-colors"
        @click="$emit('action', diagnosis.action!)"
      >
        {{ ACTION_LABEL[diagnosis.action] }}
      </button>
      <RouterLink
        v-if="diagnosis.action === 'setup-relay' || diagnosis.action === 'test-relay'"
        to="/network"
        class="px-3 py-1.5 rounded-lg text-xs text-slate-300 border border-white/15 hover:border-glow/50 transition-colors"
      >Check my network</RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { Diagnosis, DiagnosisAction } from '../lib/net/diagnosis'
import type { PathKind } from '../lib/net/connectionMonitor'

const props = defineProps<{ diagnosis: Diagnosis; compact?: boolean }>()
defineEmits<{ (e: 'action', action: DiagnosisAction): void }>()

const PATH_LABEL: Record<PathKind, string> = { lan: 'local', direct: 'direct', relay: 'relay' }
const ACTION_LABEL: Record<DiagnosisAction, string> = {
  'setup-relay': 'Set up a relay',
  'test-relay': 'Test the relay',
  'check-code': 'Re-enter the code',
  retry: 'Try again',
  'pair-offline': 'Pair face to face',
}

const busy = computed(() => ['searching', 'negotiating', 'waiting-for-video'].includes(props.diagnosis.code))

const tone = computed(() => {
  switch (props.diagnosis.level) {
    case 'ok':
      return { box: 'bg-moss/10 border-moss/30', dot: 'bg-moss', title: 'text-moss' }
    case 'warn':
      return { box: 'bg-yellow-900/70 border-yellow-500/30', dot: 'bg-yellow-400', title: 'text-yellow-200' }
    case 'error':
      return { box: 'bg-red-950/80 border-red-500/40', dot: 'bg-red-400', title: 'text-red-200' }
    default:
      return { box: 'bg-black/60 border-white/10', dot: 'bg-glow', title: 'text-slate-200' }
  }
})
</script>
