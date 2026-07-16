<template>
  <div class="h-full flex flex-col bg-ink">
    <!-- Header -->
    <header class="flex-none px-4 py-3 bg-night/80 backdrop-blur-md border-b border-line">
      <div class="flex items-center justify-between">
        <RouterLink to="/" class="flex items-center gap-3 group">
          <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-glow to-moss flex items-center justify-center shadow-halo">
            <span class="font-display font-bold text-ink text-lg leading-none">U</span>
          </div>
          <div>
            <h1 class="font-display font-bold text-lg text-slate-100 leading-tight">Undepressable</h1>
            <p class="text-[11px] text-slate-400 leading-tight">Live truth that can't be erased</p>
          </div>
        </RouterLink>

        <div class="flex items-center gap-2">
          <ConnectionStatus />
          <button
            class="p-2 rounded-lg hover:bg-haze transition-colors"
            @click="debugModal?.open()"
            title="Debug logs"
          >
            <svg class="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </button>
          <button class="p-2 rounded-lg hover:bg-haze transition-colors" @click="showHelp = true" title="How it works">
            <svg class="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <main class="flex-1 overflow-hidden">
      <RouterView />
    </main>

    <!-- Navigation -->
    <nav class="flex-none px-4 py-2 bg-night/80 backdrop-blur-md border-t border-line">
      <div class="flex justify-around">
        <RouterLink
          to="/"
          class="flex flex-col items-center gap-1 p-2 rounded-lg transition-colors"
          :class="[$route.path === '/' ? 'text-glow' : 'text-slate-500 hover:text-slate-300']"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          <span class="text-xs">Home</span>
        </RouterLink>

        <RouterLink
          to="/stream"
          class="flex flex-col items-center gap-1 p-2 rounded-lg transition-colors"
          :class="[$route.path === '/stream' ? 'text-ember' : 'text-slate-500 hover:text-slate-300']"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <span class="text-xs">Stream</span>
        </RouterLink>

        <RouterLink
          to="/collect"
          class="flex flex-col items-center gap-1 p-2 rounded-lg transition-colors"
          :class="[$route.path.startsWith('/collect') ? 'text-glow' : 'text-slate-500 hover:text-slate-300']"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <span class="text-xs">Collect</span>
        </RouterLink>

        <RouterLink
          to="/recordings"
          class="flex flex-col items-center gap-1 p-2 rounded-lg transition-colors"
          :class="[$route.path === '/recordings' ? 'text-moss' : 'text-slate-500 hover:text-slate-300']"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span class="text-xs">Recordings</span>
        </RouterLink>
      </div>
    </nav>

    <!-- Help Modal -->
    <div v-if="showHelp" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" @click.self="showHelp = false">
      <div class="card max-w-md w-full max-h-[80vh] overflow-y-auto">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-display font-bold text-slate-100">How it works</h2>
          <button @click="showHelp = false" class="p-1 hover:bg-haze rounded">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="space-y-4 text-sm text-slate-300">
          <div>
            <h3 class="font-semibold text-slate-100 mb-2">Go live from the field</h3>
            <ol class="list-decimal list-inside space-y-1 text-slate-400">
              <li>Open <span class="text-ember">Stream</span> and allow the camera.</li>
              <li>Share the room code or QR with trusted people.</li>
              <li>Your phone streams directly to them — no server in between.</li>
            </ol>
          </div>

          <div>
            <h3 class="font-semibold text-slate-100 mb-2">Watch &amp; keep a copy</h3>
            <ol class="list-decimal list-inside space-y-1 text-slate-400">
              <li>Open <span class="text-glow">Collect</span> and scan the QR or type the code.</li>
              <li>The stream plays and records to your device automatically.</li>
              <li>Every recording is signed so it can be proven unaltered.</li>
            </ol>
          </div>

          <div class="p-3 bg-moss/10 border border-moss/30 rounded-xl">
            <h3 class="font-semibold text-moss mb-1">Why it's resilient</h3>
            <p class="text-slate-300">
              Every watcher holds an independent copy. Even if the streamer's phone is taken, the footage already lives
              on other devices — nothing to delete in one place.
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Debug Modal (Global) -->
    <DebugModal ref="debugModal" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import ConnectionStatus from './components/ConnectionStatus.vue'
import DebugModal from './components/DebugModal.vue'

const showHelp = ref(false)
const debugModal = ref<InstanceType<typeof DebugModal>>()
const $route = useRoute()
</script>
