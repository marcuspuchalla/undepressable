import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import router from './router'
import App from './App.vue'
import { adoptRelayFromUrl } from './lib/net/iceConfig'
import { adoptDiscoveryFromUrl } from './lib/net/discoveryConfig'
import { startUpdates } from './composables/useUpdates'

import './assets/main.css'

// A share link can carry a relay (?turn=urls|user|pass or ?ice=credentials-url)
// and custom discovery relays (?relays=wss://…), so an organizer can hand out
// working NAT traversal and a private meeting point along with the room code.
adoptRelayFromUrl()
adoptDiscoveryFromUrl()

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
