<template>
  <div class="rounded-xl border border-line bg-white/5 text-left" data-testid="amplify">
    <button class="w-full flex items-center gap-2 px-3 py-2.5 text-sm" @click="open = !open">
      <span class="w-2 h-2 rounded-full shrink-0" :class="DOT[amp.state.value]" />
      <span class="text-slate-200 font-medium">Amplify — broadcast to a server</span>
      <span class="ml-auto text-xs" :class="amp.state.value === 'live' ? 'text-moss' : 'text-slate-500'" data-testid="amplify-status">{{ statusText }}</span>
    </button>
    <div v-if="open" class="px-3 pb-3 space-y-2">
      <p class="text-xs text-slate-400 leading-relaxed">
        Sends {{ role === 'streamer' ? 'your stream' : 'the stream you are watching' }} to a broadcast server over
        WHIP — your own MediaMTX, Owncast, Cloudflare Stream or any other — which can show it to anyone on the web, no
        app needed.
        <template v-if="role === 'viewer'">Somewhere the server is reachable, you can do this for someone whose own network is blocked.</template>
        The server sees the video: use one you trust.
      </p>
      <input v-model="amp.url.value" class="input text-sm font-mono" placeholder="https://live.example.org/stream/whip" autocapitalize="off" spellcheck="false" :disabled="busy" data-testid="amplify-url" />
      <input v-model="amp.token.value" class="input text-sm font-mono" type="password" placeholder="Token (if the server needs one)" autocomplete="off" :disabled="busy" data-testid="amplify-token" />
      <div class="flex gap-2">
        <button v-if="!busy" class="btn-primary text-sm py-1.5" :disabled="!stream" data-testid="amplify-start" @click="amp.start()">Start broadcasting</button>
        <button v-else class="btn-secondary text-sm py-1.5" data-testid="amplify-stop" @click="amp.stop()">Stop</button>
      </div>
      <p v-if="amp.error.value" class="text-xs" :class="amp.state.value === 'failed' ? 'text-red-300' : 'text-yellow-200'">{{ amp.error.value }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import type { Amplify } from '../composables/useAmplify'
import type { WhipState } from '../lib/net/whip'

const props = defineProps<{ amp: Amplify; stream: MediaStream | null; role: 'streamer' | 'viewer' }>()

const open = ref(props.amp.state.value !== 'stopped')
const busy = computed(() => ['connecting', 'live', 'reconnecting'].includes(props.amp.state.value))
const DOT: Record<WhipState, string> = {
  stopped: 'bg-slate-600',
  connecting: 'bg-yellow-400 animate-pulse',
  reconnecting: 'bg-yellow-400 animate-pulse',
  live: 'bg-moss',
  failed: 'bg-ember',
}
const now = ref(Date.now())
const timer = setInterval(() => (now.value = Date.now()), 1000)
onUnmounted(() => clearInterval(timer))
const statusText = computed(() => {
  const s = props.amp.state.value
  if (s === 'live') {
    const secs = Math.max(0, Math.floor((now.value - (props.amp.liveSince.value ?? now.value)) / 1000))
    return `live · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
  }
  return { stopped: 'off', connecting: 'connecting…', reconnecting: 'reconnecting…', failed: 'failed' }[s]
})
</script>
