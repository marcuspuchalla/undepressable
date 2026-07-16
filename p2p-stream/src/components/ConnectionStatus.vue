<template>
  <div class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-haze border border-line">
    <div class="w-2 h-2 rounded-full" :class="online ? 'bg-moss' : 'bg-slate-500'" />
    <span class="text-xs font-medium text-slate-300">{{ online ? 'Online' : 'Offline' }}</span>
  </div>
</template>

<script setup lang="ts">
// A lightweight network indicator for the header. Live peer/stream status is
// shown inside the Stream/Collect views (which own the P2P connection).
import { ref, onMounted, onUnmounted } from 'vue'

const online = ref(typeof navigator !== 'undefined' ? navigator.onLine : true)
function update() {
  online.value = navigator.onLine
}
onMounted(() => {
  window.addEventListener('online', update)
  window.addEventListener('offline', update)
})
onUnmounted(() => {
  window.removeEventListener('online', update)
  window.removeEventListener('offline', update)
})
</script>
