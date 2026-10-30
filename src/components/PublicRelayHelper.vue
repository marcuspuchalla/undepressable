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
      {{ testingRelays ? 'Testing public relays…' : relayResults.length ? 'Test again' : 'Test public relays' }}
    </button>

    <ul v-if="relayResults.length" class="space-y-1 text-xs" data-testid="public-relay-results">
      <li v-for="r in relayResults" :key="r.candidate.id" class="flex items-center gap-2">
        <span :class="r.ok ? 'text-moss' : 'text-slate-500'">{{ r.ok ? '✓' : '✗' }}</span>
        <span class="text-slate-300">{{ r.candidate.label }}</span>
        <span class="text-slate-500 ml-auto">{{ r.detail }}</span>
      </li>
      <li v-if="relayTestedAt && !testingRelays" class="text-[11px] text-slate-500" data-testid="public-relay-tested">
        Tested {{ agoText(relayTestedAt, now) }}.
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
    <div v-else-if="relayResults.length && !workingRelays.length" class="text-xs leading-relaxed space-y-2" data-testid="no-public-relay">
      <p class="text-yellow-200">
        None answered from this network. Public relays come and go; a free account at a relay provider is the
        reliable fix and takes about five minutes. <strong>Only one side needs it</strong> — whoever shares the
        link can set it up for everyone, because it travels inside the link.
      </p>
      <ul class="list-disc list-inside text-slate-300 space-y-1">
        <li><strong>ExpressTURN</strong> (free plan; a fixed username and password): paste its <code>turn:</code> address, username and password below.</li>
        <li><strong>Metered</strong> (free plan; a credentials link): paste the link under <em>Credentials link</em>.</li>
        <li>Your own <code>coturn</code> in about ten minutes: docs/SELF_HOSTING.md. The site's publisher can also build one in for everybody.</li>
      </ul>
    </div>

    <!-- Extra STUN -->
    <details class="text-xs" :open="showStun" data-testid="stun-section">
      <summary class="cursor-pointer text-slate-300">
        More STUN servers{{ activeStun.length ? ` (${activeStun.length} in use)` : '' }}{{ natKind === 'hard' ? ' — will not help here' : '' }}
      </summary>
      <p class="text-slate-400 mt-2 leading-relaxed" data-testid="stun-explainer">
        <template v-if="natKind === 'hard'">
          The usual STUN servers answer from this network. What blocks you is strict NAT on both sides, and no number
          of STUN servers changes that: only a relay connects two strict networks.
        </template>
        <template v-else>
          Only helps when this network blocks the usual ones (“UDP blocked” in the check). STUN cannot connect two
          strict networks — that needs a relay.
        </template>
      </p>
      <div class="flex flex-wrap gap-2 mt-2">
        <button class="btn-secondary text-xs py-1.5" :disabled="testingStun" data-testid="test-stun" @click="testStun(EXTRA_STUN_CANDIDATES)">
          {{ testingStun ? 'Testing…' : 'Test more STUN servers' }}
        </button>
        <button class="btn-secondary text-xs py-1.5" :disabled="testingStun" @click="testFreshStun">Get a fresh list</button>
        <button v-if="activeStun.length" class="text-slate-400 underline" @click="removeStun">Stop using</button>
      </div>
      <p v-if="stunNote" class="mt-2" :class="TONE[stunNote.tone]" data-testid="stun-note">
        {{ stunNote.text }}<span v-if="stunTestedAt" class="text-slate-500"> (tested {{ agoText(stunTestedAt, now) }})</span>
      </p>
      <p class="text-[11px] text-slate-500 mt-1">The fresh list comes from github.com/pradt2/always-online-stun (re-tested hourly).</p>
    </details>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
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
  credentialsFor,
  rememberRelayTest,
  recallRelayTest,
  rememberStunTest,
  recallStunTest,
  stunVerdict,
  agoText,
  type CandidateResult,
  type PublicRelayCandidate,
  type StoredPublicRelay,
  type StunVerdict,
  type TestMemory,
} from '../lib/net/publicRelays'
import { relayServersOf } from '../lib/net/iceConfig'
import { testRelay, testStunServer, describeRelayError, type NatKind } from '../lib/net/natProbe'

const props = defineProps<{ showStun?: boolean; natKind?: NatKind | null }>()
const emit = defineEmits<{ (e: 'applied'): void }>()

const TONE: Record<StunVerdict['tone'], string> = { good: 'text-moss', warn: 'text-yellow-200', none: 'text-yellow-200' }

const activePublic = ref<RTCIceServer[]>(getPublicRelays())
const activeStun = ref<string[]>(getExtraStun())

// "Tested 3 min ago" keeps counting while the panel is open.
const now = ref(Date.now())
let clock: number | undefined
onMounted(() => {
  clock = window.setInterval(() => (now.value = Date.now()), 20_000)
})
onUnmounted(() => clearInterval(clock))

// --- public relays ---
// The last test is shown again when the panel comes back (it is kept for the
// page's life): closing the panel, a reconnect or another view does not mean
// the test has to be done again.
const minted = new Map<string, StoredPublicRelay>()
const rememberedRelays = recallRelayTest()
const testingRelays = ref(false)
const relayResults = ref<CandidateResult<PublicRelayCandidate>[]>(rememberedRelays?.results ?? [])
const relayTestedAt = ref<number | null>(rememberedRelays?.at ?? null)
const appliedRelays = ref(activePublic.value.length > 0)
const workingRelays = computed(() => relayResults.value.filter((r) => r.ok))

async function testRelays() {
  testingRelays.value = true
  appliedRelays.value = false
  relayResults.value = []
  try {
    relayResults.value = await testAll(relayCandidates(), async (c) => {
      // A relay that publishes a shared secret gets credentials minted here.
      const server = await credentialsFor(c)
      minted.set(c.id, server)
      const r = await testRelay(relayServersOf([server]), 8000)
      if (r.ok) return { ok: true, detail: `${r.protocols.join('/').toUpperCase()} · ${(r.durationMs / 1000).toFixed(1)} s` }
      return { ok: false, detail: r.errors[0] ? describeRelayError(r.errors[0].code) : 'no answer in 8 s' }
    })
    rememberRelayTest(relayResults.value)
    relayTestedAt.value = Date.now()
    now.value = relayTestedAt.value
  } finally {
    testingRelays.value = false
  }
}

function applyRelays() {
  setPublicRelays(workingRelays.value.map((r) => minted.get(r.candidate.id) ?? r.candidate.server))
  activePublic.value = getPublicRelays()
  appliedRelays.value = true
  emit('applied')
}

function removePublic() {
  setPublicRelays([])
  activePublic.value = []
  appliedRelays.value = false
  emit('applied')
}

// --- extra STUN ---
const testingStun = ref(false)
const stunNote = ref<StunVerdict | null>(null)
const stunTestedAt = ref<number | null>(null)

function verdictOf(mem: TestMemory<string>, previous: TestMemory<string> | null): StunVerdict {
  return stunVerdict({
    answered: mem.results.filter((r) => r.ok).length,
    tested: mem.results.length,
    using: activeStun.value.length,
    natKind: props.natKind ?? null,
    previous,
    now: Date.now(),
  })
}
const rememberedStun = recallStunTest()
if (rememberedStun) {
  stunNote.value = verdictOf(rememberedStun, null)
  stunTestedAt.value = rememberedStun.at
}

async function testStun(urls: string[]) {
  testingStun.value = true
  stunNote.value = null
  try {
    const previous = recallStunTest()
    const results = await testAll(urls, (u) => testStunServer(u, 5000))
    const working = results.filter((r) => r.ok).map((r) => r.candidate)
    if (working.length) {
      setExtraStun(working)
      activeStun.value = getExtraStun()
    }
    rememberStunTest(results)
    const mem = recallStunTest()!
    stunNote.value = verdictOf(mem, previous)
    stunTestedAt.value = mem.at
    now.value = mem.at
    // Reconnecting with more STUN servers only makes sense where they can change the outcome.
    if (stunNote.value.useful) emit('applied')
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
    stunNote.value = { tone: 'none', useful: false, text: 'Could not fetch the fresh list from this network.' }
    stunTestedAt.value = null
    return
  }
  await testStun(spreadPick(list, 10))
}

function removeStun() {
  setExtraStun([])
  activeStun.value = []
  stunNote.value = null
  stunTestedAt.value = null
  emit('applied')
}
</script>
