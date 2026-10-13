<template>
  <div v-if="updates.waiting && !updates.dismissed" class="flex-none px-4 py-3 border-b text-sm" :class="tone.box" role="alert" data-testid="update-banner">
    <p v-if="updates.checking || !updates.update" class="text-slate-300">A new version of the app is available — checking who made it…</p>

    <template v-else-if="verdict === 'signed'">
      <p class="text-moss font-medium">Update available — signed by the developers ({{ updates.update.keyId }}) ✓</p>
      <p class="text-xs text-slate-400 mt-0.5">
        Build {{ updates.update.manifest?.build }} · fingerprint <span class="font-mono">{{ fp }}</span>. Updating reloads the
        app — do it when you are not streaming.
      </p>
      <div class="flex gap-2 mt-2">
        <button class="btn-primary text-xs py-1.5" data-testid="apply-update" @click="applyUpdate">Update now</button>
        <button class="btn-secondary text-xs py-1.5" @click="updates.dismissed = true">Later</button>
      </div>
    </template>

    <template v-else-if="verdict === 'unverifiable'">
      <p class="text-slate-200 font-medium">Update available</p>
      <p class="text-xs text-slate-400 mt-0.5">
        Build {{ updates.update.manifest?.build ?? 'unknown' }}. This copy carries no release keys, so it cannot check who
        made the update. Updating reloads the app.
      </p>
      <div class="flex gap-2 mt-2">
        <button class="btn-primary text-xs py-1.5" data-testid="apply-update" @click="applyUpdate">Update now</button>
        <button class="btn-secondary text-xs py-1.5" @click="updates.dismissed = true">Later</button>
      </div>
    </template>

    <template v-else>
      <p class="text-red-200 font-semibold">⚠ This update is not signed by the Undepressable developers</p>
      <p class="text-xs text-red-100/90 mt-1 leading-relaxed">
        {{ REASON[verdict] }} The website may have been taken over — do not install it. Browsers apply a waiting update
        the next time every window of the app is closed, and no app can prevent that. Before you close this one:
      </p>
      <ul class="text-xs text-red-100/90 mt-1 list-disc list-inside space-y-0.5">
        <li>Save or send your recordings: Recordings → share icon, or “Send to home now”.</li>
        <li>Keep a copy of the app that the website cannot change: the browser extension, or a copy from someone you trust.</li>
        <li>After a restart, treat this app as untrusted until you have checked where it came from.</li>
      </ul>
      <div class="flex gap-2 mt-2">
        <RouterLink to="/recordings" class="btn-secondary text-xs py-1.5">Open Recordings</RouterLink>
        <button class="text-xs text-red-200 underline" @click="updates.dismissed = true">Dismiss</button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { updates, applyUpdate } from '../composables/useUpdates'
import { shortFingerprint, type ReleaseStatus } from '../lib/update/release'

const REASON: Partial<Record<ReleaseStatus, string>> = {
  unsigned: 'It carries no signature at all, although this copy expects one.',
  forged: 'Its signature was not made by any key this copy trusts, or its file list was changed after signing.',
  missing: 'The website no longer publishes a release description for it.',
}

// With no keys compiled in, a missing manifest is just an unverifiable update.
const verdict = computed<ReleaseStatus>(() => {
  const s = updates.update?.status ?? 'missing'
  return s === 'missing' && updates.trustedKeys === 0 ? 'unverifiable' : s
})
const fp = computed(() => shortFingerprint(updates.update?.manifest?.fingerprint ?? ''))
const tone = computed(() => {
  if (!updates.update || updates.checking) return { box: 'bg-night border-line' }
  if (verdict.value === 'signed') return { box: 'bg-moss/10 border-moss/30' }
  if (verdict.value === 'unverifiable') return { box: 'bg-night border-line' }
  return { box: 'bg-red-950/80 border-red-500/40' }
})
</script>
