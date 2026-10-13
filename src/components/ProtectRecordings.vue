<template>
  <div class="card mb-4 text-sm" data-testid="protect">
    <button class="w-full flex items-center gap-2 text-left" @click="open = !open">
      <svg class="w-4 h-4 shrink-0" :class="active ? 'text-moss' : 'text-slate-500'" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
      <span class="font-medium text-slate-200">Protect recordings on this device</span>
      <span class="ml-auto text-xs" :class="active ? 'text-moss' : 'text-slate-500'" data-testid="protect-status">{{ summary }}</span>
    </button>

    <div v-if="open" class="mt-3 space-y-3">
      <p class="text-xs text-slate-400 leading-relaxed">
        Sealed recordings are encrypted while they are recorded, so whoever takes this phone cannot watch them — and
        cannot tell who is in them. Checking that a sealed recording is intact, and sending it on, still works without
        opening it. (Only fingerprints of the footage stay readable; they reveal nothing about what was filmed.)
      </p>

      <label class="flex items-start gap-2" :class="homeKey ? '' : 'opacity-60'">
        <input type="checkbox" class="mt-0.5" :checked="policy.toHome" :disabled="!homeKey" data-testid="seal-home" @change="toggle('toHome', ($event.target as HTMLInputElement).checked)" />
        <span>
          <span class="text-slate-200">Seal to my home archive</span>
          <span class="block text-xs text-slate-500">
            <template v-if="homeKey">Only the home archive can open them — not even this phone. Send them home (above) to watch them.</template>
            <template v-else>Pair with a home archive by scanning its QR or link (a typed code carries no key).</template>
          </span>
        </span>
      </label>

      <label class="flex items-start gap-2">
        <input type="checkbox" class="mt-0.5" :checked="policy.passphrase" data-testid="seal-passphrase" @change="toggle('passphrase', ($event.target as HTMLInputElement).checked)" />
        <span>
          <span class="text-slate-200">Lock with a passphrase</span>
          <span class="block text-xs text-slate-500">This phone can open them after you enter it. There is no way to recover a forgotten passphrase.</span>
        </span>
      </label>

      <!-- Passphrase setup -->
      <div v-if="needsSetup" class="rounded-lg border border-line p-3 space-y-2">
        <p class="text-xs text-slate-300">Choose a passphrase (at least 8 characters). It never leaves this device.</p>
        <input v-model="pass1" type="password" class="input text-sm" placeholder="Passphrase" autocomplete="new-password" data-testid="pass-new" />
        <input v-model="pass2" type="password" class="input text-sm" placeholder="Again" autocomplete="new-password" data-testid="pass-again" />
        <button class="btn-primary text-xs py-1.5" :disabled="busy" data-testid="pass-save" @click="setUp">{{ busy ? 'Setting up…' : 'Set passphrase' }}</button>
      </div>

      <!-- Unlock / lock for this session -->
      <div v-else-if="hasDeviceKey" class="flex flex-wrap items-center gap-2">
        <template v-if="!unlocked">
          <input v-model="pass1" type="password" class="input text-sm flex-1 min-w-[10rem]" placeholder="Passphrase to open recordings" autocomplete="current-password" data-testid="pass-unlock" @keyup.enter="unlock" />
          <button class="btn-secondary text-xs py-1.5" :disabled="busy" data-testid="unlock" @click="unlock">{{ busy ? 'Checking…' : 'Unlock' }}</button>
        </template>
        <template v-else>
          <span class="text-xs text-moss">Unlocked for this session.</span>
          <button class="btn-secondary text-xs py-1.5" data-testid="lock" @click="lock">Lock now</button>
        </template>
      </div>

      <p v-if="note" class="text-xs" :class="noteOk ? 'text-moss' : 'text-red-300'">{{ note }}</p>
      <p class="text-[11px] text-slate-500">Applies to recordings started from now on. Earlier ones stay as they are.</p>

      <div class="border-t border-line pt-3">
        <label class="flex items-start gap-2">
          <input type="checkbox" class="mt-0.5" :checked="autoStamp" data-testid="auto-timestamp" @change="setAuto(($event.target as HTMLInputElement).checked)" />
          <span>
            <span class="text-slate-200">Timestamp recordings automatically</span>
            <span class="block text-xs text-slate-500">
              Proves each recording existed by a given time: a fingerprint of its proof (never the footage) goes to
              public OpenTimestamps servers, which anchor it in Bitcoin within hours. It is a request to those servers
              from this device — leave it off where that could draw attention, and timestamp later, or from home.
            </span>
          </span>
        </label>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  getSealPolicy,
  setSealPolicy,
  getPairedHomeSealKey,
  deviceKey,
  isDeviceUnlocked,
  setUpPassphrase,
  unlockDevice,
  lockDevice,
  type SealPolicy,
} from '../lib/seal/keys'
import { autoTimestamp, setAutoTimestamp } from '../lib/timestamp/recordingStamp'

const emit = defineEmits<{ (e: 'changed'): void }>()

const autoStamp = ref(autoTimestamp())
function setAuto(on: boolean) {
  setAutoTimestamp(on)
  autoStamp.value = on
}

const policy = ref<SealPolicy>(getSealPolicy())
const homeKey = ref(getPairedHomeSealKey())
const hasDeviceKey = ref(!!deviceKey())
const unlocked = ref(isDeviceUnlocked())
const open = ref(false)
const pass1 = ref('')
const pass2 = ref('')
const busy = ref(false)
const note = ref<string | null>(null)
const noteOk = ref(true)

const needsSetup = computed(() => policy.value.passphrase && !hasDeviceKey.value)
const active = computed(() => (policy.value.toHome && !!homeKey.value) || (policy.value.passphrase && hasDeviceKey.value))
const summary = computed(() => {
  const parts: string[] = []
  if (policy.value.toHome && homeKey.value) parts.push('sealed to home')
  if (policy.value.passphrase && hasDeviceKey.value) parts.push(unlocked.value ? 'passphrase · unlocked' : 'passphrase')
  return parts.length ? parts.join(' + ') : 'off'
})

function toggle(which: keyof SealPolicy, value: boolean) {
  policy.value = { ...policy.value, [which]: value }
  setSealPolicy(policy.value)
  note.value = null
  emit('changed')
}

async function setUp() {
  note.value = null
  if (pass1.value !== pass2.value) {
    noteOk.value = false
    note.value = 'The two passphrases differ.'
    return
  }
  busy.value = true
  try {
    await setUpPassphrase(pass1.value)
    hasDeviceKey.value = true
    unlocked.value = true
    pass1.value = pass2.value = ''
    noteOk.value = true
    note.value = 'Passphrase set. New recordings are locked with it.'
    emit('changed')
  } catch (e: any) {
    noteOk.value = false
    note.value = e?.message ?? String(e)
  } finally {
    busy.value = false
  }
}

async function unlock() {
  busy.value = true
  note.value = null
  try {
    const ok = await unlockDevice(pass1.value)
    unlocked.value = ok
    noteOk.value = ok
    note.value = ok ? null : 'Wrong passphrase.'
    if (ok) {
      pass1.value = ''
      emit('changed')
    }
  } finally {
    busy.value = false
  }
}

function lock() {
  lockDevice()
  unlocked.value = false
  emit('changed')
}
</script>
