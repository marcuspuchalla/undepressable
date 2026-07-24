import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import router from './router'
import App from './App.vue'
import { adoptTurnFromUrl } from './lib/net/iceConfig'

import './assets/main.css'

// A share link can carry a TURN relay (?turn=urls|user|pass) so an organizer
// can hand out working NAT traversal along with the room code.
adoptTurnFromUrl()

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
