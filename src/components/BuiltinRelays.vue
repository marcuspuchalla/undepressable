<template>
  <section v-if="relays.length || canCheck" class="rounded-xl border border-line bg-ink/60 p-4 space-y-3" data-testid="builtin-relays">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h3 class="text-sm font-semibold text-print">Built-in relays</h3>
        <p class="text-xs text-slate-400 mt-0.5 leading-relaxed">
          Used automatically when a direct connection is impossible. Each has a free monthly allowance.
        </p>
      </div>
      <label class="flex items-center gap-2 text-xs text-slate-300 cursor-pointer shrink-0">
        <input type="checkbox" :checked="enabled" class="accent-[#4fe0d9]" data-testid="builtin-toggle" @change="toggle" />
        Use them
      </label>
    </div>

    <ul v-if="enabled" class="space-y-1.5 text-sm">
      <li v-for="r in rows" :key="r.id" class="flex items-baseline justify-between gap-3">
        <span class="text-slate-200">{{ r.label }}</span>
        <span class="text-xs text-right" :class="r.tone">{{ r.status }}</span>
      </li>
    </ul>

    <div v-if="enabled && canCheck" class="space-y-2">
      <button class="btn-secondary text-sm py-1.5" :disabled="checking" data-testid="builtin-check" @click="check">
        {{ checking ? 'Checking…' : 'Check which are available' }}
      </button>
      <p class="text-[11px] text-slate-500 leading-relaxed">
        Asks {{ host }} once which relays still have allowance this month, and brings fresh access to them. Nothing
        about you or your stream is sent, and the app never asks on its own.
      </p>
      <p v-if="note" class="text-xs" :class="noteOk ? 'text-moss' : 'text-yellow-200'">{{ note }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  compiledRelays,
  statusUrl,
  builtinRelaysEnabled,
  setBuiltinRelaysEnabled,
  checkBuiltinRelays,
  lastCheck,
  type RelayVerdict,
} from '../lib/net/builtinRelays'

const emit = defineEmits<{ (e: 'applied'): void }>()

const env = ((import.meta as any).env ?? {}) as Record<string, string | undefined>
const storage = (() => {
  try {
    return localStorage
  } catch {
    return null
  }
})()

const relays = compiledRelays(env)
const url = statusUrl(env)
const canCheck = !!url
const host = url ? new URL(url).host : ''

const enabled = ref(builtinRelaysEnabled(storage))
const checked = ref(lastCheck(storage))
const checking = ref(false)
const note = ref('')
const noteOk = ref(false)

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

const rows = computed(() => {
  const byId = new Map<string, RelayVerdict>((checked.value?.verdicts ?? []).map((v) => [v.id, v]))
  const ids = [...new Set([...relays.map((r) => r.id), ...byId.keys()])]
  return ids.map((id) => {
    const v = byId.get(id)
    const label = v?.label ?? relays.find((r) => r.id === id)?.label ?? id
    if (!v) return { id, label, status: relays.some((r) => r.id === id) ? 'On' : 'Only after a check', tone: 'text-slate-400' }
    if (v.active) return { id, label, status: `On · ${v.usedGB.toFixed(1)} of ${v.limitGB} GB this month`, tone: 'text-moss' }
    return { id, label, status: `Off until ${day(v.resetsAt)}${v.reason ? ` · ${v.reason}` : ''}`, tone: 'text-ember' }
  })
})

function toggle(e: Event) {
  enabled.value = (e.target as HTMLInputElement).checked
  setBuiltinRelaysEnabled(enabled.value, storage)
  emit('applied')
}

async function check() {
  checking.value = true
  note.value = ''
  const r = await checkBuiltinRelays(env, storage)
  checking.value = false
  if (r.ok) {
    checked.value = lastCheck(storage)
    const on = r.verdicts.filter((v) => v.active).length
    noteOk.value = on > 0
    note.value = on > 0 ? `${on} of ${r.verdicts.length} available — reconnecting with them.` : 'None has allowance left this month. Your own relay, below, still works.'
    emit('applied')
  } else {
    noteOk.value = false
    note.value = r.error
  }
}
</script>
