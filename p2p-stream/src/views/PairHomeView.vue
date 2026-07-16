<template>
  <div class="h-full overflow-y-auto grid place-items-center px-5">
    <div class="max-w-sm w-full text-center">
      <template v-if="ok">
        <div class="w-16 h-16 mx-auto mb-4 rounded-2xl bg-moss/15 grid place-items-center">
          <svg class="w-8 h-8 text-moss" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </div>
        <h1 class="font-display font-bold text-2xl text-slate-50 mb-2">Home archive paired</h1>
        <p class="text-slate-400 text-sm leading-relaxed mb-2">
          This phone will now quietly forward whatever you watch to your home archive
          (<span class="font-mono text-moss">{{ code }}</span>) and it will be recorded there too.
        </p>
        <p class="text-slate-500 text-xs mb-6">
          At the demo, just scan the streamer's code as usual — forwarding happens automatically.
        </p>
        <RouterLink to="/collect" class="btn-primary py-3 px-6">Go to Collect</RouterLink>
      </template>

      <template v-else>
        <div class="w-16 h-16 mx-auto mb-4 rounded-2xl bg-ember/15 grid place-items-center">
          <svg class="w-8 h-8 text-ember" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0L3.16 16.25A2 2 0 005 19z" /></svg>
        </div>
        <h1 class="font-display font-bold text-2xl text-slate-50 mb-2">That pairing code looks wrong</h1>
        <p class="text-slate-400 text-sm mb-6">Open your home archive again and scan the fresh code it shows.</p>
        <RouterLink to="/collect" class="btn-secondary py-3 px-6">Back to Collect</RouterLink>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { setPairedHome } from '../lib/archive'

const props = defineProps<{ code: string }>()
const ok = ref(false)

onMounted(() => {
  ok.value = setPairedHome(props.code)
})
</script>
