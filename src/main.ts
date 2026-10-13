import { createApp, watch } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import router from './router'
import App from './App.vue'
import { adoptRelayFromUrl } from './lib/net/iceConfig'
import { adoptDiscoveryFromUrl } from './lib/net/discoveryConfig'
import { startUpdates, updates } from './composables/useUpdates'
import { linkSearch } from './lib/appLocation'
import { capturePristineCopy, keepAppCopy } from './composables/useShareApp'
import { autoTimestamp, stampRecording } from './lib/timestamp/recordingStamp'
import { getRecording } from './lib/recordingDb'

import './assets/main.css'
import { installTestHooks } from './lib/testHooks'

// The portable single-file copy shares itself: keep its HTML as loaded,
// before the app renders into the page.
capturePristineCopy()

// window.__und: the app's modules for tests of a built copy (lib/testHooks.ts).
installTestHooks()

// A share link can carry a relay (?turn=urls|user|pass or ?ice=credentials-url)
// and custom discovery relays (?relays=wss://…), so an organizer can hand out
// working NAT traversal and a private meeting point along with the room code.
adoptRelayFromUrl(linkSearch())
adoptDiscoveryFromUrl(linkSearch())

// The dev build ships no service worker, but one registered by an earlier
// build keeps serving its precached copy forever — silently running stale code
// against a fresh dev server, which has repeatedly sent testing down blind
// alleys. Evict any survivor. Production registration is untouched.
if ((import.meta as any).env?.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(async (regs) => {
    if (regs.length === 0) return
    await Promise.all(regs.map((r) => r.unregister()))
    const names = await caches.keys()
    await Promise.all(names.map((n) => caches.delete(n)))
    console.warn('[dev] Removed a stale service worker and its caches — reloading')
    location.reload()
  })
}

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(PrimeVue, {
  theme: 'none',
  ripple: true
})

app.mount('#app')

// Production web builds: service worker for offline use, and updates only
// after this copy has checked who signed them.
startUpdates()
// Optional trusted timestamps for new and arriving recordings (off by
// default: it contacts public OpenTimestamps servers, with a fingerprint only).
window.addEventListener('undepressable:recording-saved', (e) => {
  if (!autoTimestamp() || !navigator.onLine) return
  void getRecording((e as CustomEvent<string>).detail)
    .then((rec) => (rec?.proof && !rec.timestamp ? stampRecording(rec) : null))
    .catch((err) => console.warn('[timestamp] not stamped now:', err?.message ?? err))
})

// A checked copy of the single-file app, so "Share this app" works offline —
// once this build's published release description is known.
watch(
  () => updates.current,
  (current) => current && void keepAppCopy().catch(() => {}),
  { immediate: true },
)
