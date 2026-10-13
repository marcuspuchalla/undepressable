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
      <div 
        v-if="isOpen" 
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" 
        @click.self="close"
      >
        <div class="w-full max-w-2xl max-h-[80vh] bg-gray-900 rounded-xl border border-gray-700 flex flex-col">
          <!-- Header -->
          <div class="flex items-center justify-between p-4 border-b border-gray-800">
            <div class="flex items-center gap-2">
              <svg class="w-5 h-5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h3 class="font-semibold">Debug Logs</h3>
            </div>
            <div class="flex items-center gap-2">
              <button
                class="p-2 text-gray-400 hover:text-white transition-colors"
                @click.prevent="copyLogs"
                title="Copy to clipboard"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
              <button
                class="p-2 text-gray-400 hover:text-white transition-colors"
                @click.prevent="clearLogs"
                title="Clear logs"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
              <button
                class="p-2 text-gray-400 hover:text-white transition-colors"
                @click.prevent="close"
              >
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <!-- Log count -->
          <div class="px-4 py-2 bg-gray-800/50 text-xs text-gray-500 border-b border-gray-800">
            {{ logger.logs.value.length }} entries
            <span v-if="!isCameraSupported" class="ml-2 text-red-400">⚠️ Camera not supported</span>
            <span v-else-if="!isSecureContext" class="ml-2 text-yellow-400">⚠️ HTTPS required for camera</span>
          </div>

          <!-- Discovery relays. These rot in weeks, and the symptom is always
               "peers can't find each other" — so make it checkable at a glance. -->
          <div v-if="relayHealth" class="px-4 py-2 border-b border-gray-800 text-xs">
            <div class="flex items-center gap-2 mb-1">
              <span :class="relayHealth.healthy ? 'text-green-400' : 'text-yellow-400'">
                {{ relaySummary }}
              </span>
            </div>
            <ul class="space-y-0.5 max-h-28 overflow-y-auto">
              <li v-for="r in relayHealth.relays" :key="r.transport + r.url" class="flex items-center gap-2">
                <span
                  class="w-1.5 h-1.5 rounded-full shrink-0"
                  :class="r.state === 'open' ? 'bg-green-400' : r.state === 'connecting' ? 'bg-yellow-400' : 'bg-red-500'"
                />
                <span class="text-gray-500 w-14 shrink-0">{{ r.transport }}</span>
                <span class="text-gray-400 truncate">{{ r.url }}</span>
              </li>
            </ul>
          </div>

          <!-- Connection attempts: separates "never found the peer" (discovery)
               from "found it but could not connect" (NAT / relay). -->
          <div v-if="connections" class="px-4 py-2 border-b border-gray-800 text-xs">
            <div class="text-gray-300 mb-1">
              Connections: {{ connections.attempts.length }} attempt{{ connections.attempts.length === 1 ? '' : 's' }} ·
              gathered {{ gatheredSummary }}
            </div>
            <ul class="space-y-0.5 max-h-28 overflow-y-auto font-mono">
              <li v-for="a in connections.attempts.slice(0, 12)" :key="a.id" class="flex items-center gap-2">
                <span
                  class="w-1.5 h-1.5 rounded-full shrink-0"
                  :class="a.outcome === 'connected' || a.outcome === 'closed' ? 'bg-green-400' : a.outcome === 'pending' ? 'bg-yellow-400' : 'bg-red-500'"
                />
                <span class="text-gray-400 w-16 shrink-0">{{ a.outcome }}</span>
                <span class="text-gray-500 truncate">
                  {{ a.localTypes.join('+') || '–' }} ⇄ {{ a.remoteTypes.join('+') || '–' }}{{ a.path ? ` · ${a.path.kind}` : '' }}{{ a.rescued ? ' · rescued' : '' }}
                </span>
              </li>
            </ul>
            <p v-for="e in connections.relayErrors" :key="e.url + e.code" class="text-yellow-400 mt-1">
              relay {{ e.url }} → {{ e.code }} {{ e.text }}
            </p>
          </div>

          <!-- Logs -->
          <div ref="logContainer" class="flex-1 overflow-y-auto p-4 space-y-1 font-mono text-sm">
            <div
              v-for="(log, index) in logger.logs.value"
              :key="index"
              class="break-words"
            >
              <span class="text-gray-500">{{ formatTime(log.timestamp) }}</span>
              <span :class="getLevelColor(log.level)"> [{{ log.level.toUpperCase() }}]</span>
              <span class="text-gray-300"> {{ log.message }}</span>
              <div v-if="log.details" class="mt-1 ml-16 text-xs text-gray-500 truncate">
                {{ log.details }}
              </div>
            </div>
            <div v-if="logger.logs.value.length === 0" class="text-gray-500 text-center py-8">
              No logs yet...
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useLogger, type LogLevel } from '../composables/useLogger'
import { useTrystero } from '../composables/useTrystero'
import { describeRelayHealth, type RelayHealth } from '../lib/net/relayHealth'
import { latestConnectionReport } from '../composables/useTrystero'

const logger = useLogger()
const isOpen = ref(false)
const logContainer = ref<HTMLElement>()

// Check camera support for display
const isCameraSupported = ref(false)
const isSecureContext = ref(false)

// Relay liveness is read from the transports' existing sockets, so this is a
// snapshot of whatever discovery infrastructure the app is currently using.
const trystero = useTrystero()
const relayHealth = ref<RelayHealth | null>(null)
const relaySummary = computed(() => (relayHealth.value ? describeRelayHealth(relayHealth.value) : ''))
let relayTimer: number | null = null

const connections = computed(() => latestConnectionReport.value)
const gatheredSummary = computed(() => {
  const g = connections.value?.gathered
  if (!g) return ''
  return (['host', 'srflx', 'relay'] as const).map((t) => `${t} ${g[t]}`).join(', ')
})

function refreshRelayHealth() {
  const health = trystero.getRelayHealth()
  relayHealth.value = health.total > 0 ? health : null
}

function open() {
  isOpen.value = true
  checkCameraSupport()
  refreshRelayHealth()
  if (relayTimer) clearInterval(relayTimer)
  relayTimer = window.setInterval(refreshRelayHealth, 2000)
}

function close() {
  isOpen.value = false
  if (relayTimer) { clearInterval(relayTimer); relayTimer = null }
}

function checkCameraSupport() {
  isCameraSupported.value = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
  isSecureContext.value = window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost'
}

function clearLogs() {
  try {
    logger.clear()
  } catch (e) {
    console.error('Failed to clear logs:', e)
  }
}

function copyLogs() {
  try {
    const report = latestConnectionReport.value
    const text =
      logger.exportLogs() +
      (report
        ? `\n\n--- connections ---\n${JSON.stringify({ gathered: report.gathered, relayErrors: report.relayErrors, attempts: report.attempts }, null, 1)}`
        : '')
    navigator.clipboard.writeText(text).then(() => {
      console.log('Logs copied to clipboard')
    }).catch(err => {
      console.error('Failed to copy logs:', err)
    })
  } catch (e) {
    console.error('Failed to copy logs:', e)
  }
}

function formatTime(date: Date): string {
  try {
    return date.toISOString().split('T')[1].split('.')[0]
  } catch {
    return '--:--:--'
  }
}

function getLevelColor(level: LogLevel): string {
  switch (level) {
    case 'error': return 'text-red-400'
    case 'warn': return 'text-yellow-400'
    case 'debug': return 'text-gray-400'
    default: return 'text-blue-400'
  }
}

// Auto-scroll to top when new logs arrive
watch(() => logger.logs.value.length, () => {
  if (isOpen.value && logContainer.value) {
    nextTick(() => {
      if (logContainer.value) {
        logContainer.value.scrollTop = 0
      }
    })
  }
})

defineExpose({ open, close })
</script>
