<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="isOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90" @click.self="close">
        <div class="w-full max-w-sm bg-gray-900 rounded-xl border border-gray-700 p-6">
          <!-- Header -->
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-semibold text-lg">Share P2P Stream</h3>
            <button class="p-2 text-gray-400 hover:text-white" @click="close">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Localhost Warning -->
          <div v-if="localIP.isLocalhost.value" class="mb-4 p-3 bg-yellow-900/30 border border-yellow-700 rounded-lg">
            <p class="text-sm text-yellow-200">
              <strong>⚠️ Development Mode</strong><br>
              Using local IP address for sharing on your network.
            </p>
          </div>

          <!-- Instructions -->
          <p class="text-sm text-gray-400 mb-4 text-center">
            Scan this QR code to install the app
          </p>

          <!-- QR Code -->
          <div class="flex justify-center mb-4">
            <canvas ref="qrCanvas" class="rounded-lg bg-white p-2" />
          </div>

          <!-- URL Display -->
          <div class="bg-gray-800 rounded-lg p-3 mb-4">
            <code class="text-xs text-gray-300 break-all block text-center">
              {{ shareUrl }}
            </code>
          </div>

          <!-- Copy Button -->
          <button
            class="w-full py-3 bg-primary-600 hover:bg-primary-700 rounded-lg font-medium transition-colors mb-4"
            @click="copyUrl"
          >
            <span v-if="copied">✓ Copied!</span>
            <span v-else>Copy Link</span>
          </button>

          <!-- Instructions for receiver -->
          <div class="border-t border-gray-700 pt-4">
            <h4 class="font-medium text-sm mb-2 text-gray-300">For the person scanning:</h4>
            <ol class="text-xs text-gray-400 space-y-1 list-decimal list-inside">
              <li>Open camera app</li>
              <li>Scan the QR code above</li>
              <li>Tap the notification to open</li>
              <li>Tap "Share" → "Add to Home Screen"</li>
              <li>Open the app from home screen</li>
            </ol>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import QRCode from 'qrcode'
import { useLocalIP } from '../composables/useLocalIP'

const isOpen = ref(false)
const qrCanvas = ref<HTMLCanvasElement>()
const copied = ref(false)

const localIP = useLocalIP()

// Computed share URL that uses IP instead of localhost
const shareUrl = computed(() => {
  return localIP.getShareUrl()
})

function open() {
  isOpen.value = true
  
  // Regenerate QR when opening
  nextTick(() => {
    generateQR()
  })
}

function close() {
  isOpen.value = false
  copied.value = false
}

async function generateQR() {
  if (!qrCanvas.value || !shareUrl.value) return
  
  try {
    await QRCode.toCanvas(qrCanvas.value, shareUrl.value, {
      width: 250,
      margin: 2,
      color: { 
        dark: '#000000', 
        light: '#ffffff' 
      }
    })
  } catch (err) {
    console.error('Failed to generate QR:', err)
  }
}

async function copyUrl() {
  try {
    await navigator.clipboard.writeText(shareUrl.value)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch (err) {
    console.error('Failed to copy:', err)
  }
}

// Regenerate QR when modal opens or IP changes
watch(isOpen, (newVal) => {
  if (newVal) {
    nextTick(() => generateQR())
  }
})

watch(() => localIP.localIP.value, () => {
  if (isOpen.value) {
    nextTick(() => generateQR())
  }
})

defineExpose({ open, close })
</script>
