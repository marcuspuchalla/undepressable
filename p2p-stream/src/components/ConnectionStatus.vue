<template>
  <div class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-800 border border-gray-700">
    <div 
      class="w-2 h-2 rounded-full"
      :class="statusClass"
    />
    <span class="text-xs font-medium text-gray-300">{{ statusText }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTrystero } from '../composables/useTrystero'

const trystero = useTrystero()

const statusClass = computed(() => {
  if (trystero.isConnecting.value) {
    return 'bg-yellow-500 animate-pulse'
  }
  if (trystero.peerCount.value > 0) {
    return 'bg-green-500'
  }
  if (trystero.error.value) {
    return 'bg-red-500'
  }
  return 'bg-gray-500'
})

const statusText = computed(() => {
  if (trystero.isConnecting.value) {
    return 'Connecting...'
  }
  if (trystero.peerCount.value > 0) {
    return `${trystero.peerCount.value} Peer${trystero.peerCount.value !== 1 ? 's' : ''}`
  }
  if (trystero.error.value) {
    return 'Failed'
  }
  return 'Ready'
})
</script>
