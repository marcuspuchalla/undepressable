import { ref } from 'vue'

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export interface LogEntry {
  timestamp: Date
  level: LogLevel
  message: string
  details?: any
}

// Global log store (shared across components)
const globalLogs = ref<LogEntry[]>([])
const MAX_LOGS = 500

// Override console methods to capture logs
let isInitialized = false

function initializeConsoleCapture() {
  if (isInitialized || typeof window === 'undefined') return
  
  const originalLog = console.log
  const originalWarn = console.warn
  const originalError = console.error
  const originalDebug = console.debug

  console.log = (...args: any[]) => {
    addLog('info', args.join(' '), args)
    originalLog.apply(console, args)
  }

  console.warn = (...args: any[]) => {
    addLog('warn', args.join(' '), args)
    originalWarn.apply(console, args)
  }

  console.error = (...args: any[]) => {
    addLog('error', args.join(' '), args)
    originalError.apply(console, args)
  }

  console.debug = (...args: any[]) => {
    addLog('debug', args.join(' '), args)
    originalDebug.apply(console, args)
  }

  isInitialized = true
}

function addLog(level: LogLevel, message: string, details?: any) {
  const entry: LogEntry = {
    timestamp: new Date(),
    level,
    message: message.substring(0, 500), // Limit message length
    details: details ? JSON.stringify(details).substring(0, 1000) : undefined
  }

  globalLogs.value.unshift(entry)
  
  // Keep only recent logs
  if (globalLogs.value.length > MAX_LOGS) {
    globalLogs.value = globalLogs.value.slice(0, MAX_LOGS)
  }
}

export function useLogger() {
  // Initialize on first use
  initializeConsoleCapture()

  const logs = globalLogs

  function clear() {
    globalLogs.value = []
  }

  function exportLogs(): string {
    return globalLogs.value
      .slice()
      .reverse()
      .map(log => {
        const time = log.timestamp.toISOString().split('T')[1].split('.')[0]
        const details = log.details ? ` | ${log.details}` : ''
        return `[${time}] [${log.level.toUpperCase()}] ${log.message}${details}`
      })
      .join('\n')
  }

  function copyToClipboard() {
    const text = exportLogs()
    navigator.clipboard.writeText(text).then(() => {
      addLog('info', 'Logs copied to clipboard')
    })
  }

  function getLevelColor(level: LogLevel): string {
    switch (level) {
      case 'error': return 'text-red-400'
      case 'warn': return 'text-yellow-400'
      case 'debug': return 'text-gray-400'
      default: return 'text-blue-400'
    }
  }

  return {
    logs,
    clear,
    exportLogs,
    copyToClipboard,
    getLevelColor,
    addLog: (level: LogLevel, message: string) => addLog(level, message)
  }
}
