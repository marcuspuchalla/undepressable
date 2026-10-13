<template>
  <div class="rounded-xl border border-glow/25 bg-glow/5 p-3 space-y-3">
    <!-- Public relays (TURN) -->
    <div>
      <p class="text-sm font-medium text-slate-100">No relay of your own? Try free public ones.</p>
      <p class="text-xs text-slate-400 mt-1 leading-relaxed">
        Run by volunteers, not by this project. They can be slow, full or gone without notice, and they see which
        addresses connect to each other — never the video, which stays end-to-end encrypted. Each one is tested on
        your network first; only those that answer are used.
      </p>
    </div>

    <div v-if="activePublic.length" class="flex items-center gap-2 text-xs text-moss">
      <span>✓ Using {{ activePublic.length }} public relay{{ activePublic.length === 1 ? '' : 's' }}.</span>
      <button class="text-slate-400 underline" @click="removePublic">Stop using</button>
    </div>

    <button class="btn-primary text-sm py-2 w-full" :disabled="testingRelays" @click="testRelays" data-testid="test-public-relays">
      {{ testingRelays ? 'Testing public relays…' : activePublic.length ? 'Test again' : 'Test public relays' }}
    </button>

    <ul v-if="relayResults.length" class="space-y-1 text-xs">
      <li v-for="r in relayResults" :key="r.candidate.id" class="flex items-center gap-2">
        <span :class="r.ok ? 'text-moss' : 'text-slate-500'">{{ r.ok ? '✓' : '✗' }}</span>
        <span class="text-slate-300">{{ r.candidate.label }}</span>
        <span class="text-slate-500 ml-auto">{{ r.detail }}</span>
      </li>
    </ul>
    <button
      v-if="workingRelays.length && !appliedRelays"
      class="btn-secondary text-sm py-2 w-full"
      data-testid="use-public-relays"
      @click="applyRelays"
    >
      Use the {{ workingRelays.length }} that answered
    </button>
    <p v-else-if="relayResults.length && !workingRelays.length" class="text-xs text-yellow-200 leading-relaxed">
      None answered from this network. Free accounts at TURN providers (for example ExpressTURN, Metered, or
      Cloudflare) work well — paste their details below — or run your own (docs/SELF_HOSTING.md).
    </p>

    <!-- Extra STUN -->
    <details class="text-xs" :open="showStun">
      <summary class="cursor-pointer text-slate-300">More STUN servers {{ activeStun.length ? `(${activeStun.length} in use)` : '' }}</summary>
      <p class="text-slate-400 mt-2 leading-relaxed">
        Only helps when this network blocks the usual ones (“UDP blocked” in the check). STUN cannot connect two strict
        networks — that needs a relay.
      </p>
      <div class="flex flex-wrap gap-2 mt-2">
        <button class="btn-secondary text-xs py-1.5" :disabled="testingStun" @click="testStun(EXTRA_STUN_CANDIDATES)">
          {{ testingStun ? 'Testing…' : 'Test more STUN servers' }}
        </button>
        <button class="btn-secondary text-xs py-1.5" :disabled="testingStun" @click="testFreshStun">Get a fresh list</button>
        <button v-if="activeStun.length" class="text-slate-400 underline" @click="removeStun">Stop using</button>
      </div>
      <p v-if="stunNote" class="mt-2" :class="stunOk ? 'text-moss' : 'text-yellow-200'">{{ stunNote }}</p>
      <p class="text-[11px] text-slate-500 mt-1">The fresh list comes from github.com/pradt2/always-online-stun (re-tested hourly).</p>
    </details>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  EXTRA_STUN_CANDIDATES,
  FRESH_STUN_LIST_URL,
  getPublicRelays,
  setPublicRelays,
  getExtraStun,
  setExtraStun,
  parseStunList,
  spreadPick,
  testAll,
  relayCandidates,
  type CandidateResult,
  type PublicRelayCandidate,
} from '../lib/net/publicRelays'
import { relayServersOf } from '../lib/net/iceConfig'
import { testRelay, testStunServer, describeRelayError } from '../lib/net/natProbe'

defineProps<{ showStun?: boolean }>()
const emit = defineEmits<{ (e: 'applied'): void }>()

const activePublic = ref<RTCIceServer[]>(getPublicRelays())
const activeStun = ref<string[]>(getExtraStun())

// --- public relays ---
const testingRelays = ref(false)
const relayResults = ref<CandidateResult<PublicRelayCandidate>[]>([])
const appliedRelays = ref(false)
const workingRelays = computed(() => relayResults.value.filter((r) => r.ok))

async function testRelays() {
  testingRelays.value = true
  appliedRelays.value = false
  relayResults.value = []
  try {
    relayResults.value = await testAll(relayCandidates(), async (c) => {
      const r = await testRelay(relayServersOf([c.server]), 8000)
      if (r.ok) return { ok: true, detail: `${r.protocols.join('/').toUpperCase()} · ${(r.durationMs / 1000).toFixed(1)} s` }
      return { ok: false, detail: r.errors[0] ? describeRelayError(r.errors[0].code) : 'no answer' }
    })
  } finally {
    testingRelays.value = false
  }
}

function applyRelays() {
  setPublicRelays(workingRelays.value.map((r) => r.candidate.server))
  activePublic.value = getPublicRelays()
  appliedRelays.value = true
  emit('applied')
}

function removePublic() {
  setPublicRelays([])
  activePublic.value = []
  relayResults.value = []
  emit('applied')
}

// --- extra STUN ---
const testingStun = ref(false)
const stunNote = ref<string | null>(null)
const stunOk = ref(false)

async function testStun(urls: string[]) {
  testingStun.value = true
  stunNote.value = null
  try {
    const results = await testAll(urls, (u) => testStunServer(u))
    const working = results.filter((r) => r.ok).map((r) => r.candidate)
    stunOk.value = working.length > 0
    if (working.length) {
      setExtraStun(working)
      activeStun.value = getExtraStun()
      stunNote.value = `${working.length} of ${urls.length} answered — using ${activeStun.value.length}.`
      emit('applied')
    } else {
      stunNote.value = `None of ${urls.length} answered: this network seems to block UDP entirely. Only a relay reachable over TCP/TLS can connect you.`
    }
  } finally {
    testingStun.value = false
  }
}

async function testFreshStun() {
  testingStun.value = true
  stunNote.value = null
  let list: string[] = []
  try {
    const res = await fetch(FRESH_STUN_LIST_URL, { cache: 'no-store', credentials: 'omit' })
    list = parseStunList(await res.text())
  } catch {
    /* offline or blocked */
  }
  testingStun.value = false
  if (list.length === 0) {
    stunOk.value = false
    stunNote.value = 'Could not fetch the fresh list from this network.'
    return
  }
  await testStun(spreadPick(list, 10))
}

function removeStun() {
  setExtraStun([])
  activeStun.value = []
  stunNote.value = null
  emit('applied')
}
</script>
