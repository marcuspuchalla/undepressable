import { ref, onMounted, onUnmounted } from 'vue'
import { ensurePersistentStorage, persistenceState, type PersistenceState } from '../lib/persistence'

// Chrome/Edge/Android fire this once per page when the app is installable;
// keep it module-wide so any screen can offer the install button.
let deferredInstall: any = null
const canInstall = ref(false)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredInstall = e
    canInstall.value = true
  })
  window.addEventListener('appinstalled', () => {
    deferredInstall = null
    canInstall.value = false
    // An installed app is what browsers are most willing to keep.
    ensurePersistentStorage()
  })
}

export function useOffline() {
  const isOffline = ref(!navigator.onLine)
  const isPWAInstalled = ref(false)
  const canWorkOffline = ref(false)
  const persistence = ref<PersistenceState>('unsupported')

  async function install(): Promise<boolean> {
    if (!deferredInstall) return false
    deferredInstall.prompt()
    const { outcome } = await deferredInstall.userChoice.catch(() => ({ outcome: 'dismissed' }))
    deferredInstall = null
    canInstall.value = false
    if (outcome === 'accepted') persistence.value = await ensurePersistentStorage()
    return outcome === 'accepted'
  }

  function updateOnlineStatus() {
    isOffline.value = !navigator.onLine
    console.log(`[useOffline] Network status: ${navigator.onLine ? 'online' : 'offline'}`)
  }

  function checkPWAInstalled() {
    // Check if running as installed PWA
    if (window.matchMedia('(display-mode: standalone)').matches) {
      isPWAInstalled.value = true
    }
    // Check for iOS standalone
    if ((window.navigator as any).standalone === true) {
      isPWAInstalled.value = true
    }
  }

  function checkServiceWorker() {
    // Check if service worker is active (enables offline)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(() => {
        canWorkOffline.value = true
        console.log('[useOffline] Service Worker ready - can work offline')
      }).catch(() => {
        canWorkOffline.value = false
      })
    }
  }

  onMounted(() => {
    updateOnlineStatus()
    checkPWAInstalled()
    checkServiceWorker()
    persistenceState().then((p) => (persistence.value = p))

    window.addEventListener('online', updateOnlineStatus)
    window.addEventListener('offline', updateOnlineStatus)

    // Listen for display mode changes (PWA install)
    const mediaQuery = window.matchMedia('(display-mode: standalone)')
    mediaQuery.addEventListener('change', checkPWAInstalled)
  })

  onUnmounted(() => {
    window.removeEventListener('online', updateOnlineStatus)
    window.removeEventListener('offline', updateOnlineStatus)
  })

  return {
    isOffline,
    isPWAInstalled,
    canWorkOffline,
    canInstall,
    install,
    persistence
  }
}
