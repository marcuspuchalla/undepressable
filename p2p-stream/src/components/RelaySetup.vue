<template>
  <Teleport to="body" :disabled="inline">
    <div
      v-if="inline || open"
      :class="inline ? '' : 'fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 p-0 sm:p-4'"
      @click.self="close"
    >
      <div
        :class="inline ? 'space-y-4' : 'w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-night border border-line p-5 space-y-4'"
      >
        <div v-if="!inline" class="flex items-start justify-between gap-3">
          <div>
            <h2 class="font-display font-bold text-lg text-slate-100">Relay (TURN) server</h2>
            <p class="text-xs text-slate-400 mt-0.5">For networks that can't connect directly.</p>
          </div>
          <button class="p-1.5 rounded-lg hover:bg-haze text-slate-400" aria-label="Close" @click="close">✕</button>
        </div>

        <p class="text-sm text-slate-400 leading-relaxed">
          When both devices sit behind strict NAT — a VPN on one side and a mobile carrier on the other is the classic
          case — no direct path exists, whatever the app does. A relay forwards the (still end-to-end encrypted) video
          between them. <strong class="text-slate-200">Only one of the two devices needs it</strong>, and it travels
          inside your share link, so viewers need no setup.
        </p>

        <p v-if="setup.origin === 'link'" class="text-xs text-glow bg-glow/5 border border-glow/20 rounded-lg px-3 py-2">
          The relay below was set by a share link you opened. Remove it if you don't trust who sent the link.
        </p>
        <p v-else-if="setup.source === 'build'" class="text-xs text-slate-300 bg-white/5 border border-line rounded-lg px-3 py-2">
          This build ships a relay. Anything you enter here replaces it on this device.
        </p>

        <!-- mode -->
        <div class="inline-flex rounded-lg border border-line overflow-hidden text-xs">
          <button
            v-for="m in MODES"
            :key="m.id"
            class="px-3 py-1.5 font-medium transition-colors"
            :class="mode === m.id ? 'bg-glow/15 text-glow' : 'text-slate-400 hover:text-slate-200'"
            @click="mode = m.id"
          >{{ m.label }}</button>
        </div>

        <div v-if="mode === 'server'" class="space-y-2">
          <label class="block">
            <span class="text-xs text-slate-400">Server address(es)</span>
            <input
              v-model="urls"
              class="input mt-1 font-mono text-sm"
              placeholder="turns:relay.example.org:443"
              autocapitalize="off"
              autocomplete="off"
              spellcheck="false"
              @paste="onPasteSpec"
            />
          </label>
          <div class="grid grid-cols-2 gap-2">
            <label class="block">
              <span class="text-xs text-slate-400">Username</span>
              <input v-model="username" class="input mt-1 text-sm" autocapitalize="off" autocomplete="off" spellcheck="false" />
            </label>
            <label class="block">
              <span class="text-xs text-slate-400">Password</span>
              <input v-model="credential" type="password" class="input mt-1 text-sm" autocomplete="off" />
            </label>
          </div>
          <p class="text-[11px] text-slate-500 leading-relaxed">
            Several addresses: separate with commas. Prefer <code class="text-slate-300">turns:…:443</code> — it gets
            through networks that block everything but HTTPS. You can also paste a whole
            <code class="text-slate-300">address|username|password</code> line.
          </p>
        </div>

        <div v-else class="space-y-2">
          <label class="block">
            <span class="text-xs text-slate-400">Credentials link (HTTPS)</span>
            <input
              v-model="iceUrl"
              class="input mt-1 font-mono text-sm"
              placeholder="https://yourapp.metered.live/api/v1/turn/credentials?apiKey=…"
              autocapitalize="off"
              autocomplete="off"
              spellcheck="false"
            />
          </label>
          <p class="text-[11px] text-slate-500 leading-relaxed">
            Many relay providers hand out short-lived credentials from a link like this. The app fetches fresh ones
            each time it connects.
          </p>
        </div>

        <p v-if="formError" class="text-xs text-red-300">{{ formError }}</p>

        <div class="flex flex-wrap gap-2">
          <button class="btn-primary text-sm py-2" :disabled="testing" @click="test">
            {{ testing ? 'Testing…' : 'Test' }}
          </button>
          <button class="btn-secondary text-sm py-2" @click="save">Save</button>
          <button v-if="setup.source === 'runtime'" class="btn-secondary text-sm py-2" @click="remove">Remove</button>
        </div>

        <div
          v-if="result"
          class="text-sm rounded-lg px-3 py-2 border"
          :class="result.ok ? 'bg-moss/10 border-moss/30 text-moss' : 'bg-red-950/60 border-red-500/30 text-red-200'"
        >
          <template v-if="result.ok">
            Relay works over {{ result.protocols.map((p) => PROTO[p]).join(', ') }} ({{ (result.durationMs / 1000).toFixed(1) }} s).
            <span v-if="!result.protocols.includes('tls')" class="block text-xs text-slate-400 mt-1">
              Tip: add a <code>turns:</code> address on port 443 for networks that only allow HTTPS.
            </span>
          </template>
          <template v-else>
            <span v-if="result.errors.length === 0">No relay address came back — check the address, and that this network can reach it.</span>
            <span v-for="e in result.errors" :key="e.url + e.code" class="block">{{ e.url || 'relay' }}: {{ describeRelayError(e.code) }}.</span>
          </template>
        </div>
        <p v-if="savedNote" class="text-xs text-moss">{{ savedNote }}</p>

        <div class="space-y-2 pt-1 border-t border-line">
          <label class="flex items-start gap-2 text-sm text-slate-300 pt-3">
            <input v-model="share" type="checkbox" class="mt-1" @change="onShareToggle" />
            <span>Include the relay in my share links and QR codes <span class="block text-xs text-slate-500">So viewers connect without setting anything up.</span></span>
          </label>
          <label class="flex items-start gap-2 text-sm text-slate-300">
            <input v-model="forceRelay" type="checkbox" class="mt-1" @change="onForceToggle" />
            <span>Always connect through the relay <span class="block text-xs text-slate-500">Hides your IP address from the people you connect to. Slower, and uses the relay's bandwidth.</span></span>
          </label>
        </div>

        <details class="text-xs text-slate-400">
          <summary class="cursor-pointer text-slate-300">Where do I get a relay?</summary>
          <ul class="list-disc list-inside space-y-1 mt-2 leading-relaxed">
            <li>Run your own: <code>coturn</code> on any small server takes about ten minutes (docs/SELF_HOSTING.md).</li>
            <li>Or use a TURN provider with a free tier and paste its server details or credentials link here.</li>
            <li>A relay sees who connects to whom and how much, never the video itself — pick one you trust.</li>
          </ul>
        </details>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import {
  getRelaySetup,
  saveRelaySettings,
  parseTurnSpec,
  isValidIceUrl,
  isRelaySharingEnabled,
  setRelaySharingEnabled,
  isForceRelay,
  setForceRelay,
  fetchIceServers,
  relayServersOf,
  type TurnConfig,
  type RelaySetup,
} from '../lib/net/iceConfig'
import { testRelay, describeRelayError, type RelayTestResult, type RelayProtocol } from '../lib/net/natProbe'

const props = defineProps<{ open?: boolean; inline?: boolean; autoTest?: boolean }>()
// 'saved': ICE servers changed — connections must be re-made to use them.
// 'share-changed': only what goes into share links changed.
const emit = defineEmits<{ (e: 'update:open', v: boolean): void; (e: 'saved'): void; (e: 'share-changed'): void }>()

const MODES = [
  { id: 'server', label: 'Server address' },
  { id: 'link', label: 'Credentials link' },
] as const
const PROTO: Record<RelayProtocol, string> = { udp: 'UDP', tcp: 'TCP', tls: 'TLS (443-friendly)' }

const setup = ref<RelaySetup>(getRelaySetup())
const mode = ref<'server' | 'link'>('server')
const urls = ref('')
const username = ref('')
const credential = ref('')
const iceUrl = ref('')
const share = ref(isRelaySharingEnabled())
const forceRelay = ref(isForceRelay())
const testing = ref(false)
const result = ref<RelayTestResult | null>(null)
const formError = ref<string | null>(null)
const savedNote = ref<string | null>(null)

function load() {
  setup.value = getRelaySetup()
  const s = setup.value
  urls.value = s.turn?.urls.join(', ') ?? ''
  username.value = s.turn?.username ?? ''
  credential.value = s.turn?.credential ?? ''
  iceUrl.value = s.iceUrl ?? ''
  mode.value = s.iceUrl && !s.turn ? 'link' : 'server'
  share.value = isRelaySharingEnabled()
  forceRelay.value = isForceRelay()
  formError.value = null
  savedNote.value = null
}

function readForm(): { turn: TurnConfig | null; iceUrl: string | null } | null {
  formError.value = null
  if (mode.value === 'link') {
    const url = iceUrl.value.trim()
    if (!url) return { turn: null, iceUrl: null }
    if (!isValidIceUrl(url)) {
      formError.value = 'The credentials link must start with https://'
      return null
    }
    return { turn: null, iceUrl: url }
  }
  const list = urls.value.split(',').map((u) => u.trim()).filter(Boolean)
  if (list.length === 0) return { turn: null, iceUrl: null }
  const turn = parseTurnSpec(`${list.join(',')}|${username.value}|${credential.value}`)
  if (!turn) {
    formError.value = 'Addresses must start with turn: or turns: (for example turns:relay.example.org:443).'
    return null
  }
  return { turn, iceUrl: null }
}

function onPasteSpec(ev: ClipboardEvent) {
  const text = ev.clipboardData?.getData('text') ?? ''
  const spec = parseTurnSpec(text.trim())
  if (!spec) return
  ev.preventDefault()
  urls.value = spec.urls.join(', ')
  username.value = spec.username
  credential.value = spec.credential
}

async function test() {
  const form = readForm()
  if (!form) return
  if (!form.turn && !form.iceUrl) {
    formError.value = 'Enter a relay first.'
    return
  }
  testing.value = true
  result.value = null
  try {
    let servers: RTCIceServer[] = []
    if (form.turn) servers = [{ urls: form.turn.urls, username: form.turn.username, credential: form.turn.credential }]
    if (form.iceUrl) {
      const fetched = await fetchIceServers(form.iceUrl, { storage: null })
      if (!fetched) {
        result.value = { ok: false, protocols: [], errors: [{ url: form.iceUrl, code: 0, text: '' }], durationMs: 0 }
        formError.value = 'Could not fetch credentials from that link.'
        return
      }
      servers = relayServersOf(fetched)
    }
    result.value = await testRelay(servers)
  } catch (err) {
    formError.value = (err as Error)?.message ?? 'Test failed'
  } finally {
    testing.value = false
  }
}

function save() {
  const form = readForm()
  if (!form) return
  if (!saveRelaySettings(form, 'settings')) {
    formError.value = 'Could not save on this device (storage blocked?).'
    return
  }
  load()
  savedNote.value = form.turn || form.iceUrl ? 'Saved. Reconnecting with the relay…' : 'Relay removed.'
  emit('saved')
}

function remove() {
  saveRelaySettings({ turn: null, iceUrl: null }, 'settings')
  load()
  result.value = null
  savedNote.value = 'Relay removed.'
  emit('saved')
}

function onShareToggle() {
  setRelaySharingEnabled(share.value)
  emit('share-changed')
}

function onForceToggle() {
  setForceRelay(forceRelay.value)
  emit('saved')
}

function close() {
  if (!props.inline) emit('update:open', false)
}

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    load()
    result.value = null
    if (props.autoTest && setup.value.source !== 'none') test()
  },
)
onMounted(load)
</script>
