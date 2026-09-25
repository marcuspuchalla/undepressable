<template>
  <div class="h-full overflow-y-auto">
    <!-- Hero -->
    <section class="organic-veil px-5 pt-10 pb-8 text-center">
      <p class="text-xs uppercase tracking-[0.2em] text-glow/80 mb-4">Censorship-resistant streaming</p>
      <h1 class="font-display font-black text-slate-50 leading-[1.05] text-[2.5rem] sm:text-5xl mb-4 max-w-lg mx-auto">
        Live truth that<br />can't be erased<a
          href="#erasable-footnote"
          class="text-glow font-body font-normal text-[0.35em] align-super ml-0.5 no-underline hover:underline"
          aria-label="footnote"
        >✳</a>
      </h1>
      <p class="text-slate-400 max-w-md mx-auto mb-6 leading-relaxed">
        Stream live from your phone to trusted people with no central server. They watch and keep their own signed
        copy — so no single takedown can erase what happened.
      </p>

      <div class="flex flex-wrap justify-center gap-2 mb-7 text-xs">
        <span class="px-3 py-1 rounded-full border border-line bg-night/60 text-slate-300">No central server</span>
        <span class="px-3 py-1 rounded-full border border-line bg-night/60 text-slate-300">Privacy by design</span>
        <span class="px-3 py-1 rounded-full border border-line bg-night/60 text-slate-300">Peer recording</span>
      </div>

      <div class="flex flex-col sm:flex-row gap-3 justify-center max-w-md mx-auto">
        <RouterLink to="/stream" class="btn-emergency text-base py-3 px-6 flex-1">
          <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Go live
        </RouterLink>
        <RouterLink to="/collect" class="btn-primary text-base py-3 px-6 flex-1">
          <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4h2v-4zM6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Scan &amp; collect
        </RouterLink>
      </div>

      <div class="mt-3 flex flex-col sm:flex-row items-center justify-center gap-x-5 gap-y-2">
        <RouterLink to="/archive" class="inline-flex items-center gap-1.5 text-xs text-moss hover:underline">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
          Set up a home archive on a safe device →
        </RouterLink>
        <RouterLink to="/offline" class="inline-flex items-center gap-1.5 text-xs text-glow hover:underline">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636a9 9 0 010 12.728M5.636 18.364a9 9 0 010-12.728M12 12h.01M3 3l18 18" /></svg>
          No internet? Pair face to face →
        </RouterLink>
        <RouterLink to="/network" class="inline-flex items-center gap-1.5 text-xs text-slate-300 hover:underline">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" /></svg>
          Can't connect? Check your network →
        </RouterLink>
      </div>

      <div class="mt-5 flex items-center justify-center gap-3">
        <span
          v-if="offline.canWorkOffline.value"
          class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs"
          :class="offline.isOffline.value ? 'bg-moss/10 text-moss' : 'bg-glow/10 text-glow'"
        >
          <span class="w-1.5 h-1.5 rounded-full bg-current" />
          {{ offline.isOffline.value ? 'Offline — ready' : 'Online — works offline too' }}
        </span>
        <button
          class="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
          @click="shareModal?.open()"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          Share this app
        </button>
      </div>

      <!-- Self-undercutting footnote — the irony the whole project lives with. -->
      <p id="erasable-footnote" class="mt-8 pt-4 border-t border-line/60 text-[11px] leading-relaxed text-slate-500 italic max-w-sm mx-auto text-left">
        <span class="text-glow not-italic mr-0.5">✳</span> Assuming anyone still trusts their own eyes. In
        <span class="not-italic">1984</span>, rejecting “the evidence of your eyes and ears” was the Party's final,
        most essential command.
      </p>
    </section>

    <div class="px-4 pb-6 space-y-4">
      <!-- Resilience thesis -->
      <div class="glass-panel border-glow/20">
        <p class="font-display text-lg text-slate-100 leading-snug">
          Every recorder is a backup.<br />
          <span class="text-glow">Every backup is a new path to the truth.</span>
        </p>
      </div>

      <!-- Features -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="card">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 bg-ember/10 rounded-xl flex items-center justify-center flex-shrink-0">
              <svg class="w-5 h-5 text-ember" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
            </div>
            <div>
              <h3 class="font-semibold text-slate-100 mb-1">Stream from any phone</h3>
              <p class="text-sm text-slate-400">Share a room code ahead of time; go live with no infrastructure.</p>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 bg-glow/10 rounded-xl flex items-center justify-center flex-shrink-0">
              <svg class="w-5 h-5 text-glow" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4z" /></svg>
            </div>
            <div>
              <h3 class="font-semibold text-slate-100 mb-1">Community redundancy</h3>
              <p class="text-sm text-slate-400">Multiple remote recorders keep copies alive when the streamer is stopped.</p>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 bg-moss/10 rounded-xl flex items-center justify-center flex-shrink-0">
              <svg class="w-5 h-5 text-moss" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
            </div>
            <div>
              <h3 class="font-semibold text-slate-100 mb-1">Tamper-evident proofs</h3>
              <p class="text-sm text-slate-400">Each recording is hashed and signed, so footage can be verified unaltered.</p>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 bg-glow/10 rounded-xl flex items-center justify-center flex-shrink-0">
              <svg class="w-5 h-5 text-glow" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <div>
              <h3 class="font-semibold text-slate-100 mb-1">Works offline</h3>
              <p class="text-sm text-slate-400">Install as an app; connect two phones over one hotspot with no internet.</p>
            </div>
          </div>
        </div>
      </div>

      <!-- How it works -->
      <div class="card">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-display font-bold text-lg text-slate-100">A workflow built for real life</h3>
          <RouterLink to="/guide" class="text-xs text-glow hover:underline whitespace-nowrap">Ways to use it →</RouterLink>
        </div>
        <div class="space-y-4">
          <div class="flex items-start gap-4">
            <div class="w-8 h-8 rounded-full bg-glow/15 text-glow flex items-center justify-center flex-shrink-0 font-semibold text-sm">1</div>
            <div>
              <h4 class="font-medium text-slate-100">Create a room</h4>
              <p class="text-sm text-slate-400">Get a short code and QR. Signaling rides BitTorrent DHT and Nostr — no server to block.</p>
            </div>
          </div>
          <div class="flex items-start gap-4">
            <div class="w-8 h-8 rounded-full bg-glow/15 text-glow flex items-center justify-center flex-shrink-0 font-semibold text-sm">2</div>
            <div>
              <h4 class="font-medium text-slate-100">Trusted people join</h4>
              <p class="text-sm text-slate-400">They scan the QR or type the code — even ones who arrive late get the live stream.</p>
            </div>
          </div>
          <div class="flex items-start gap-4">
            <div class="w-8 h-8 rounded-full bg-glow/15 text-glow flex items-center justify-center flex-shrink-0 font-semibold text-sm">3</div>
            <div>
              <h4 class="font-medium text-slate-100">Everyone keeps a copy</h4>
              <p class="text-sm text-slate-400">Each device records locally and signs it. You see how many are watching and recording.</p>
            </div>
          </div>
          <div class="flex items-start gap-4">
            <div class="w-8 h-8 rounded-full bg-moss/15 text-moss flex items-center justify-center flex-shrink-0 font-semibold text-sm">4</div>
            <div>
              <h4 class="font-medium text-moss">The record outlives the moment</h4>
              <p class="text-sm text-slate-400">If the streamer's phone is taken, the footage already lives on other devices.</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Desktop app (optional) -->
      <div class="card">
        <h3 class="font-semibold mb-2 flex items-center gap-2 text-slate-100">
          <svg class="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
          Desktop app (optional)
        </h3>
        <p class="text-sm text-slate-400">
          A native build (no browser restrictions, fully offline) is available via
          <code class="text-glow">npm run tauri:build</code>. The web app works everywhere without it.
        </p>
      </div>

      <!-- Ethical use -->
      <p class="text-xs text-slate-500 text-center px-4 leading-relaxed">
        Built for human-rights documentation, community accountability, and public-interest reporting. Designed to
        reduce censorship and data loss — not to incite harm. Know your local laws and prioritise safety.
      </p>

      <ShareModal ref="shareModal" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useOffline } from '../composables/useOffline'
import ShareModal from '../components/ShareModal.vue'

const offline = useOffline()
const shareModal = ref<InstanceType<typeof ShareModal>>()
</script>
