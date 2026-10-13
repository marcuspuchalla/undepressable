<template>
  <div class="space-y-3">
    <div class="bg-white p-3 rounded-xl w-fit mx-auto">
      <canvas ref="canvas" class="block" />
    </div>
    <div class="flex items-stretch gap-2">
      <code
        class="flex-1 min-w-0 px-3 py-2 rounded-lg bg-black/40 border border-line text-[11px] leading-snug font-mono text-slate-300 break-all select-all"
        data-testid="pair-code"
      >{{ code }}</code>
      <div class="flex flex-col gap-1.5">
        <button class="btn-secondary text-xs py-1.5 px-3" @click="copy">{{ copied ? 'Copied' : 'Copy' }}</button>
        <button v-if="canShare" class="btn-secondary text-xs py-1.5 px-3" @click="share">Send…</button>
      </div>
    </div>
    <p class="text-[11px] text-slate-500 leading-relaxed">
      No camera handy? Send this text instead — AirDrop, Nearby Share, Bluetooth or a messenger all work without
      internet between devices that are next to each other.
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from 'vue'
import QRCode from 'qrcode'

const props = defineProps<{ code: string; shareTitle?: string }>()
const canvas = ref<HTMLCanvasElement>()
const copied = ref(false)
const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

async function draw() {
  await nextTick()
  if (!canvas.value || !props.code) return
  // The compact codes are ~100 characters, which leaves room for medium error
  // correction: a glare spot or a cracked screen still scans.
  await QRCode.toCanvas(canvas.value, props.code, { width: 260, margin: 1, errorCorrectionLevel: 'M' }).catch(() => {})
}

async function copy() {
  try {
    await navigator.clipboard.writeText(props.code)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    /* clipboard blocked: the code text is selectable */
  }
}

async function share() {
  try {
    await navigator.share({ title: props.shareTitle ?? 'Pairing code', text: props.code })
  } catch {
    /* cancelled */
  }
}

watch(() => props.code, draw)
onMounted(draw)
</script>
