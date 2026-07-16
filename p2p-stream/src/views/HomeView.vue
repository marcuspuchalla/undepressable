<template>
  <div class="h-full overflow-y-auto p-4 space-y-4">
    <!-- Hero Section -->
    <div class="card text-center py-8">
      <div class="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-primary-500 to-primary-700 rounded-2xl flex items-center justify-center">
        <svg class="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      </div>
      <h2 class="text-2xl font-bold mb-2">P2P Emergency Stream</h2>
      <p class="text-gray-400 mb-6 max-w-sm mx-auto">
        Censorship-resistant live streaming. Your video is instantly recorded by multiple witnesses.
      </p>

      <!-- Offline Status -->
      <div v-if="offline.canWorkOffline.value" class="mb-4">
        <span v-if="offline.isOffline.value" class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs bg-green-900/50 text-green-400">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
          Running Offline - Ready
        </span>
        <span v-else class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs bg-blue-900/50 text-blue-400">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Online - Can Work Offline
        </span>
      </div>

      <div class="flex flex-col sm:flex-row gap-3 justify-center">
        <RouterLink to="/stream" class="btn-emergency text-lg py-3 px-6">
          <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Start Streaming
        </RouterLink>
        <RouterLink to="/collect" class="btn-primary text-lg py-3 px-6">
          <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4h2v-4zM6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Scan & Collect
        </RouterLink>
      </div>

      <!-- Share Button -->
      <button
        class="mt-4 mx-auto flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors"
        @click="shareModal?.open()"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
        </svg>
        Share App (QR Code)
      </button>
    </div>

    <!-- Offline-First Notice -->
    <div class="card bg-green-900/20 border-green-700/50">
      <h3 class="font-semibold mb-2 flex items-center gap-2 text-green-400">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
        ✅ Works 100% Offline
      </h3>
      <p class="text-sm text-gray-400">
        Once installed, this app works without any server. The PWA caches all code locally.
        Streaming uses direct P2P connections over WiFi - no internet required.
      </p>
    </div>

    <!-- Features -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div class="card">
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 bg-emergency-900/50 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg class="w-5 h-5 text-emergency-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div>
            <h3 class="font-semibold mb-1">Instant Protection</h3>
            <p class="text-sm text-gray-400">Video is saved on collectors' devices in real-time, even if your phone is taken.</p>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 bg-primary-900/50 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg class="w-5 h-5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
          </div>
          <div>
            <h3 class="font-semibold mb-1">Dual Network</h3>
            <p class="text-sm text-gray-400">Broadcasts to both BitTorrent DHT and Nostr relays simultaneously.</p>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 bg-green-900/50 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg class="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <h3 class="font-semibold mb-1">Private & Secure</h3>
            <p class="text-sm text-gray-400">End-to-end encrypted. No account needed. 6-digit codes for easy sharing.</p>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 bg-purple-900/50 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg class="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h3 class="font-semibold mb-1">Mobile First</h3>
            <p class="text-sm text-gray-400">Works in your browser. Scan QR codes. Choose cameras. Install as PWA.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- How It Works -->
    <div class="card">
      <h3 class="font-bold text-lg mb-4">How It Works</h3>
      <div class="space-y-4">
        <div class="flex items-start gap-4">
          <div class="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center flex-shrink-0 font-bold text-sm">
            1
          </div>
          <div>
            <h4 class="font-medium">Streamer starts broadcast</h4>
            <p class="text-sm text-gray-400">Get a 6-digit room code. Broadcast goes to both BitTorrent and Nostr.</p>
          </div>
        </div>

        <div class="flex items-start gap-4">
          <div class="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center flex-shrink-0 font-bold text-sm">
            2
          </div>
          <div>
            <h4 class="font-medium">Collectors join via code or QR</h4>
            <p class="text-sm text-gray-400">Enter the 6-digit code or scan the QR code with your camera.</p>
          </div>
        </div>

        <div class="flex items-start gap-4">
          <div class="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center flex-shrink-0 font-bold text-sm">
            3
          </div>
          <div>
            <h4 class="font-medium">Video is recorded on all devices</h4>
            <p class="text-sm text-gray-400">Each collector automatically records the stream locally in real-time.</p>
          </div>
        </div>

        <div class="flex items-start gap-4">
          <div class="w-8 h-8 rounded-full bg-emergency-600 flex items-center justify-center flex-shrink-0 font-bold text-sm">
            4
          </div>
          <div>
            <h4 class="font-medium text-emergency-400">Evidence is preserved</h4>
            <p class="text-sm text-gray-400">Even if the streamer's phone is confiscated, collectors already have the full recording.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Desktop App -->
    <div class="card bg-emergency-900/20 border-emergency-700/50">
      <h3 class="font-semibold mb-2 flex items-center gap-2 text-emergency-400">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        Desktop App (Recommended)
      </h3>
      <p class="text-sm text-gray-400 mb-2">
        Double-click to run. No browser restrictions. Works offline.
      </p>
      <div class="flex gap-2 text-sm">
        <span class="text-gray-500">Build with:</span>
        <code class="text-emergency-400">npm run tauri:build</code>
      </div>
    </div>

    <!-- Disclaimer -->
    <div class="text-xs text-gray-500 text-center px-4">
      This tool is for evidence preservation and citizen journalism.
      Always follow local laws and prioritize safety.
    </div>

    <!-- Share Modal -->
    <ShareModal ref="shareModal" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useOffline } from '../composables/useOffline'
import ShareModal from '../components/ShareModal.vue'

const offline = useOffline()
const shareModal = ref<InstanceType<typeof ShareModal>>()
</script>
