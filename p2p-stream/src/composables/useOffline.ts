import { ref, onMounted, onUnmounted } from 'vue'

export function useOffline() {
  const isOffline = ref(!navigator.onLine)
  const isPWAInstalled = ref(false)
  const canWorkOffline = ref(false)

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
    canWorkOffline
  }
}
