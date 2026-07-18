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

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(PrimeVue, {
  theme: 'none',
  ripple: true
})

app.mount('#app')
