<template>
  <div class="h-full overflow-y-auto">
    <section class="organic-veil px-5 pt-8 pb-4 text-center">
      <p class="text-xs uppercase tracking-[0.2em] text-glow/80 mb-3">Connection check</p>
      <h1 class="font-display font-black text-slate-50 text-3xl mb-3">Network &amp; relay</h1>
      <p class="text-slate-400 max-w-md mx-auto text-sm leading-relaxed">
        Why two devices can or can't reach each other, and what to do about it.
      </p>
    </section>

    <div class="px-4 pb-10 space-y-4 max-w-2xl mx-auto">
      <!-- This network -->
      <div class="card space-y-3">
        <div class="flex items-center justify-between gap-3">
          <h2 class="font-semibold text-slate-100">This device's network</h2>
          <button class="btn-primary text-sm py-1.5" :disabled="probing" @click="runProbe">
            {{ probing ? 'Checking…' : nat ? 'Check again' : 'Check' }}
          </button>
        </div>
        <p v-if="!nat && !probing" class="text-sm text-slate-400">
          Takes a few seconds.
          <template v-if="stunSource === 'relay'">Asks your relay how this network presents you to the internet — no public STUN server is contacted.</template>
          <template v-else>Asks public STUN servers how this network presents you to the internet — the same thing every connection does anyway.</template>
        </p>
        <div v-if="nat" class="rounded-lg border px-3 py-2" :class="NAT_TEXT[nat.kind].box">
          <p class="font-medium" :class="NAT_TEXT[nat.kind].tone">{{ NAT_TEXT[nat.kind].title }}</p>
          <p class="text-sm text-slate-300 mt-1 leading-relaxed">{{ NAT_TEXT[nat.kind].body }}</p>
          <p v-if="nat.ipv6" class="text-sm text-moss mt-1 leading-relaxed" data-testid="ipv6-verdict">
            ✓ Global IPv6: another device with IPv6 reaches this one directly — no STUN server and no relay in between.
          </p>
          <details class="mt-2 text-xs text-slate-400">
            <summary class="cursor-pointer">Details</summary>
            <p class="mt-1">{{ nat.evidence }}</p>
            <p>IPv6: {{ nat.ipv6 ? 'yes' : 'no' }} · checked in {{ (nat.durationMs / 1000).toFixed(1) }} s</p>
            <p v-if="nat.publicAddresses.length">Seen as: <span class="font-mono">{{ nat.publicAddresses.join(', ') }}</span></p>
          </details>
        </div>
        <div v-if="relayCheck" class="rounded-lg border px-3 py-2 text-sm" :class="relayCheck.ok ? 'border-moss/30 bg-moss/10 text-moss' : 'border-red-500/30 bg-red-950/50 text-red-200'">
          <template v-if="relayCheck.ok">Your relay answers ({{ relayCheck.protocols.join(', ').toUpperCase() }}). Strict-NAT connections are covered.</template>
          <template v-else>
            Your relay did not answer<span v-if="relayCheck.errors[0]">: {{ describeRelayError(relayCheck.errors[0].code) }}</span>.
          </template>
        </div>
        <p v-else-if="nat && !relayConfigured && (nat.kind === 'hard' || nat.kind === 'blocked')" class="text-sm text-yellow-200 bg-yellow-900/40 border border-yellow-500/30 rounded-lg px-3 py-2">
          No relay is configured. Set one up below so strict-NAT devices can reach you.
        </p>
      </div>

      <!-- Relay -->
      <div class="card space-y-3">
        <h2 class="font-semibold text-slate-100">Relay (TURN) server</h2>
        <p
          class="text-xs rounded-lg px-3 py-2 border leading-relaxed"
          :class="stunSource === 'relay' ? 'border-moss/30 bg-moss/10 text-moss' : 'border-line bg-white/5 text-slate-300'"
          data-testid="stun-source"
        >
          <template v-if="blendIn && stunSource === 'none'">Public address: not asked for at all — blend in sends everything through the TLS relay.</template>
          <template v-else-if="stunSource === 'relay'">Public address: learned from your relay. No public STUN server is contacted.</template>
          <template v-else-if="relayConfigured">
            Public address: from public STUN servers, because your relay has no <code>turn:</code> UDP address. Add one
            (for example <code>turn:host:3478</code>) next to <code>turns:…:443</code> and no public server is contacted.
          </template>
          <template v-else>
            Public address: from public STUN servers (Google, Cloudflare, Telnyx, Epygi — chosen for reach from censored
            networks). With a relay that speaks UDP, none of them is contacted.
          </template>
        </p>
        <label v-if="relayServesStunNow" class="flex items-start gap-2 text-sm text-slate-300">
          <input v-model="publicStunToo" type="checkbox" class="mt-1" data-testid="public-stun-too" @change="onPublicStunToggle" />
          <span>Also ask public STUN servers <span class="block text-xs text-slate-500">A fallback for when the relay is down. Off: only your relay learns this device's address.</span></span>
        </label>
        <RelaySetup inline :show-stun="nat?.kind === 'blocked'" :nat-kind="nat?.kind ?? null" @saved="onRelaySaved" />
      </div>

      <!-- What only a relay solves -->
      <div class="card space-y-2" data-testid="relay-only">
        <h2 class="font-semibold text-slate-100">What only a relay solves</h2>
        <p class="text-sm text-slate-400 leading-relaxed">
          No STUN server, port trick or browser feature connects these two devices — a relay does, and needs no STUN:
        </p>
        <ul class="text-sm text-slate-400 list-disc list-inside space-y-1 leading-relaxed">
          <li>two strict (symmetric) networks with no IPv6 between them — a VPN exit and a mobile carrier is the usual pair;</li>
          <li>a network that blocks outgoing UDP, on either side;</li>
          <li>a network that recognises STUN or WebRTC itself (<em>Blend in</em> below is relay-only by design).</li>
        </ul>
        <p class="text-xs text-slate-500 leading-relaxed">
          Two devices with global IPv6 connect directly with nothing in between; one strict side is fine when the other
          side is reachable. The evidence behind this: docs/STUN_RESEARCH.md in the repository.
        </p>
      </div>

      <!-- Blend in -->
      <div class="card space-y-3" data-testid="blend-in">
        <h2 class="font-semibold text-slate-100">Blend in with ordinary web traffic</h2>
        <p class="text-sm text-slate-400 leading-relaxed">
          Networks that look for WebRTC can see STUN requests, direct connections and relays in the clear. With this on,
          the app sends nothing but TLS to port 443: media only through a <code>turns:…:443</code> relay, discovery only
          through Nostr relays over WSS, no STUN and no direct connections at all.
        </p>
        <label class="flex items-start gap-2 text-sm text-slate-300">
          <input v-model="blendIn" type="checkbox" class="mt-1" data-testid="blend-in-toggle" @change="onBlendInToggle" />
          <span>Blend in <span class="block text-xs text-slate-500">Everything through the TLS relay. Slower, uses the relay's bandwidth, and only as hidden as docs/TRAFFIC.md says.</span></span>
        </label>
        <div class="rounded-lg border px-3 py-2 text-sm" :class="BLEND_TEXT[blendReady.level].box" data-testid="blend-in-status">
          <p :class="BLEND_TEXT[blendReady.level].tone">{{ BLEND_TEXT[blendReady.level].title }}</p>
          <p class="text-xs text-slate-400 mt-1">
            <template v-if="blendReady.tlsRelays.length">Relay: <span class="font-mono">{{ blendReady.tlsRelays.join(', ') }}</span>. </template>
            Discovery: {{ blendReady.ownDiscoveryOnly ? 'your own relays only' : 'public Nostr relays over WSS (add your own below to avoid well-known hostnames)' }}.
          </p>
        </div>
      </div>

      <!-- Share links -->
      <div class="card space-y-3">
        <h2 class="font-semibold text-slate-100">Share links &amp; QR codes</h2>
        <p class="text-sm text-slate-400 leading-relaxed">
          The address your share links point to. It must be one that <em>other</em> phones can open — this app running
          from <code class="text-slate-300">localhost</code>, a local network address or the desktop/mobile app shell
          is not reachable from a phone on mobile data.
        </p>
        <div class="rounded-lg border px-3 py-2 text-sm" :class="shareBase.reachability === 'public' ? 'border-moss/30 bg-moss/10' : 'border-yellow-500/30 bg-yellow-900/30'">
          <p class="font-mono text-xs break-all text-slate-200">{{ shareBase.base }}/collect/…</p>
          <p class="text-xs mt-1" :class="shareBase.reachability === 'public' ? 'text-moss' : 'text-yellow-200'">{{ REACH_TEXT[shareBase.reachability] }}</p>
        </div>
        <label class="block">
          <span class="text-xs text-slate-400">Public address of this app (optional)</span>
          <div class="flex gap-2 mt-1">
            <input v-model="publicUrl" class="input text-sm font-mono" placeholder="https://undepressable.example.org" autocapitalize="off" spellcheck="false" />
            <button class="btn-secondary text-sm" @click="savePublicUrl">Save</button>
          </div>
        </label>
        <p v-if="publicUrlNote" class="text-xs" :class="publicUrlOk ? 'text-moss' : 'text-red-300'">{{ publicUrlNote }}</p>
        <p class="text-[11px] text-slate-500">The in-app scanner (Collect → Scan) reads the room code from any of these links, so it works either way.</p>
      </div>

      <!-- Discovery relays -->
      <div class="card space-y-3">
        <h2 class="font-semibold text-slate-100">Discovery relays <span class="text-xs font-normal text-slate-500">advanced</span></h2>
        <p class="text-sm text-slate-400 leading-relaxed">
          Devices find each other through public Nostr relays and BitTorrent trackers. If a network blocks them, run
          your own Nostr relay on port 443 and add it here. It travels in your share links so viewers use it too.
        </p>
        <textarea v-model="customRelays" rows="2" class="input text-sm font-mono" placeholder="wss://relay.your-domain.org" spellcheck="false" autocapitalize="off" />
        <label class="flex items-start gap-2 text-sm text-slate-300">
          <input v-model="relaysOnly" type="checkbox" class="mt-1" />
          <span>Only use my relays <span class="block text-xs text-slate-500">No public discovery at all — less metadata leaves your group, but everyone must use the same relay.</span></span>
        </label>
        <div class="flex items-center gap-3">
          <button class="btn-secondary text-sm" @click="saveRelays">Save</button>
          <span v-if="relaysNote" class="text-xs text-moss">{{ relaysNote }}</span>
        </div>
        <details class="text-xs text-slate-500">
          <summary class="cursor-pointer text-slate-400">Built-in public relays</summary>
          <p class="font-mono mt-1 leading-relaxed">{{ NOSTR_RELAYS.join(' · ') }}</p>
          <p class="font-mono mt-1 leading-relaxed">{{ TORRENT_TRACKERS.join(' · ') }}</p>
        </details>
      </div>

      <!-- Which code is this? -->
      <div id="this-copy" class="card space-y-2" data-testid="this-copy">
        <h2 class="font-semibold text-slate-100">This copy of the app</h2>
        <dl class="text-sm grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
          <dt class="text-slate-500">Build</dt>
          <dd class="font-mono text-slate-300 break-all">{{ APP_BUILD }}</dd>
          <template v-if="updates.current?.manifest">
            <dt class="text-slate-500">Fingerprint</dt>
            <dd class="font-mono text-slate-300">{{ shortFingerprint(updates.current.manifest.fingerprint) }}</dd>
          </template>
          <dt class="text-slate-500">Signature</dt>
          <dd :class="updates.current?.status === 'signed' ? 'text-moss' : 'text-slate-400'">
            {{ CURRENT_TEXT[updates.current?.status ?? 'none'] }}
          </dd>
        </dl>
        <p class="text-xs text-slate-500 leading-relaxed">
          Updates are never installed silently: a new version is checked against the developers' release
          {{ updates.trustedKeys === 1 ? 'key' : 'keys' }} this copy carries ({{ updates.trustedKeys }}) and offered only if
          it is signed. An unsigned update is shown as a warning — the website may have been taken over. To compare
          this copy with a published release, read the fingerprint aloud to someone who has the release notes.
        </p>
        <button class="btn-secondary text-xs py-1.5" :disabled="checkingUpdate" @click="onCheckUpdate">
          {{ checkingUpdate ? 'Checking…' : updates.waiting ? 'An update is waiting (see the banner)' : 'Check for updates' }}
        </button>
      </div>

      <!-- What connects where -->
      <div class="card space-y-2">
        <h2 class="font-semibold text-slate-100">What connects where</h2>
        <ul class="text-sm text-slate-400 space-y-1.5 leading-relaxed">
          <li><span class="text-moss">✓</span> Same Wi-Fi or hotspot — direct, always.</li>
          <li><span class="text-moss">✓</span> Home/office network ↔ almost anything — direct, usually.</li>
          <li><span class="text-yellow-300">!</span> VPN ↔ mobile data, or mobile ↔ mobile on different carriers — often <strong class="text-slate-200">needs a relay</strong>.</li>
          <li><span class="text-yellow-300">!</span> Networks that block UDP (some corporate, hotel, censored) — needs a relay on <code>turns:…:443</code>.</li>
          <li><span class="text-glow">↔</span> No internet at all — use <RouterLink to="/offline" class="text-glow hover:underline">Pair face to face</RouterLink>.</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import RelaySetup from '../components/RelaySetup.vue'
import { probeNat, testRelay, describeRelayError, type NatProbeResult, type NatKind, type RelayTestResult } from '../lib/net/natProbe'
import {
  hasRelay,
  resolveRtcConfig,
  getRtcConfig,
  relayServersOf,
  natProbeServers,
  relayServesStun,
  stunSourceOf,
  isPublicStunWithRelay,
  setPublicStunWithRelay,
} from '../lib/net/iceConfig'
import { getExtraStun } from '../lib/net/publicRelays'
import { resolveShareBase, getConfiguredPublicUrl, setConfiguredPublicUrl, type Reachability } from '../lib/net/shareLink'
import { appBase, usesHashRoutes } from '../lib/appLocation'
import { getCustomRelays, setCustomRelays, isCustomRelaysOnly, setCustomRelaysOnly, parseRelayList } from '../lib/net/discoveryConfig'
import { NOSTR_RELAYS, TORRENT_TRACKERS } from '../types'
import { isBlendIn, setBlendIn, blendInReadiness, type BlendInLevel } from '../lib/net/blendIn'
import { getRelaySetup } from '../lib/net/iceConfig'
import { updates, checkForUpdate, APP_BUILD } from '../composables/useUpdates'
import { shortFingerprint } from '../lib/update/release'

const CURRENT_TEXT: Record<string, string> = {
  signed: '✓ signed by the developers',
  unverifiable: 'not checked — this copy carries no release keys',
  unsigned: 'published without a signature',
  forged: '✗ the published signature does not match',
  missing: 'no published release description',
  none: 'unknown (offline, or not a published build)',
}
const checkingUpdate = ref(false)
async function onCheckUpdate() {
  checkingUpdate.value = true
  try {
    await checkForUpdate()
  } finally {
    setTimeout(() => (checkingUpdate.value = false), 1500)
  }
}

const NAT_TEXT: Record<NatKind, { title: string; body: string; tone: string; box: string }> = {
  open: {
    title: 'Open — no NAT',
    body: 'Other devices can reach this one directly. Connections should just work.',
    tone: 'text-moss',
    box: 'border-moss/30 bg-moss/10',
  },
  easy: {
    title: 'Standard NAT',
    body: 'Direct connections work with most networks. Only the very strictest ones on the other side need a relay.',
    tone: 'text-moss',
    box: 'border-moss/30 bg-moss/10',
  },
  hard: {
    title: 'Strict NAT (symmetric)',
    body: 'Typical of VPNs and mobile carriers. Direct connections work with ordinary home or office networks, but not with another strict network — a phone on mobile data, for example. Those need a relay.',
    tone: 'text-yellow-200',
    box: 'border-yellow-500/30 bg-yellow-900/30',
  },
  blocked: {
    title: 'UDP blocked',
    body: 'No STUN server answered. Either the network blocks UDP, or a VPN / browser setting restricts WebRTC. Direct connections are impossible here; only a relay reachable over TCP/TLS (turns:…:443) will work.',
    tone: 'text-red-200',
    box: 'border-red-500/30 bg-red-950/50',
  },
  unknown: {
    title: 'Could not tell',
    body: 'No candidates were gathered at all — WebRTC may be disabled in this browser.',
    tone: 'text-slate-200',
    box: 'border-line bg-white/5',
  },
}

const REACH_TEXT: Record<Reachability, string> = {
  public: 'Anyone can open this link.',
  lan: 'Only devices on the same local network can open this link.',
  device: 'Only this device can open this link — scan it with the app, or set the public address below.',
}

// --- blend in ---
const blendIn = ref(isBlendIn())
const blendTick = ref(0)
const blendReady = computed(() => {
  void blendTick.value
  return blendInReadiness(getRelaySetup(), [], isCustomRelaysOnly())
})
const BLEND_TEXT: Record<BlendInLevel, { title: string; tone: string; box: string }> = {
  ready: { title: '✓ A TLS relay on port 443 is set up — traffic passes as HTTPS.', tone: 'text-moss', box: 'border-moss/30 bg-moss/10' },
  'tls-other-port': { title: 'A TLS relay is set up, but not on port 443: encrypted, on a port HTTPS does not use.', tone: 'text-yellow-200', box: 'border-yellow-500/30 bg-yellow-900/30' },
  none: { title: 'Needs a turns: relay on port 443 — set one up above. Until then this setting does not apply.', tone: 'text-yellow-200', box: 'border-yellow-500/30 bg-yellow-900/30' },
}
function onBlendInToggle() {
  setBlendIn(blendIn.value)
}

const probing = ref(false)
const nat = ref<NatProbeResult | null>(null)
const relayCheck = ref<RelayTestResult | null>(null)
const relayConfigured = ref(hasRelay())

// Where this device's public address comes from: the relay, when one speaks UDP.
const stunTick = ref(0)
const stunSource = computed(() => {
  void stunTick.value
  void blendTick.value
  return stunSourceOf(getRtcConfig().iceServers ?? [], isPublicStunWithRelay())
})
const relayServesStunNow = computed(() => {
  void stunTick.value
  return relayServesStun(getRtcConfig().iceServers ?? [])
})
const publicStunToo = ref(isPublicStunWithRelay())
function onPublicStunToggle() {
  setPublicStunWithRelay(publicStunToo.value)
  stunTick.value++
}

async function runProbe() {
  probing.value = true
  relayCheck.value = null
  try {
    const config = await resolveRtcConfig()
    const [n] = await Promise.all([
      probeNat(natProbeServers(config.iceServers ?? [], isPublicStunWithRelay(), getExtraStun())),
      (async () => {
        if (!hasRelay()) return
        relayCheck.value = await testRelay(relayServersOf(config.iceServers ?? []))
      })(),
    ])
    nat.value = n
  } finally {
    probing.value = false
  }
}

function onRelaySaved() {
  relayConfigured.value = hasRelay()
  relayCheck.value = null
  blendTick.value++
  stunTick.value++
}

// --- share links ---
const publicUrl = ref(getConfiguredPublicUrl() ?? '')
const publicUrlNote = ref<string | null>(null)
const publicUrlOk = ref(true)
const configuredTick = ref(0)
const shareBase = computed(() => {
  void configuredTick.value
  return resolveShareBase({
    origin: appBase(),
    hashRoutes: usesHashRoutes(),
    configured: getConfiguredPublicUrl(),
    envPublicUrl: (import.meta as any).env?.VITE_PUBLIC_URL ?? null,
  })
})
function savePublicUrl() {
  publicUrlOk.value = setConfiguredPublicUrl(publicUrl.value)
  publicUrlNote.value = publicUrlOk.value ? 'Saved.' : 'That does not look like a web address.'
  publicUrl.value = getConfiguredPublicUrl() ?? publicUrl.value
  configuredTick.value++
}

// --- discovery relays ---
const customRelays = ref(getCustomRelays().join('\n'))
const relaysOnly = ref(isCustomRelaysOnly())
const relaysNote = ref<string | null>(null)
function saveRelays() {
  const list = parseRelayList(customRelays.value)
  setCustomRelays(list)
  setCustomRelaysOnly(relaysOnly.value && list.length > 0)
  customRelays.value = list.join('\n')
  relaysOnly.value = isCustomRelaysOnly()
  blendTick.value++
  relaysNote.value = list.length ? `Saved ${list.length} relay${list.length === 1 ? '' : 's'}. Applies to the next connection.` : 'Cleared.'
}
</script>
