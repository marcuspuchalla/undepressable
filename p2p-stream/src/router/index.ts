import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import StreamView from '../views/StreamView.vue'
import CollectView from '../views/CollectView.vue'
import RecordingsView from '../views/RecordingsView.vue'
import GuideView from '../views/GuideView.vue'
import ArchiveView from '../views/ArchiveView.vue'
import OfflineView from '../views/OfflineView.vue'
import PairHomeView from '../views/PairHomeView.vue'
import NetworkView from '../views/NetworkView.vue'
import { usesHashRoutes } from '../lib/appLocation'

// Copies that don't live at the root of their own website (the extension, the
// portable single file, mirrors under any path) keep routes in the hash:
// no server answers /collect/CODE for them. See lib/appLocation.ts.
const hashRoutes = usesHashRoutes()

const router = createRouter({
  history: hashRoutes ? createWebHashHistory() : createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView
    },
    {
      path: '/stream',
      name: 'stream',
      component: StreamView
    },
    {
      path: '/collect',
      name: 'collect',
      component: CollectView
    },
    {
      path: '/collect/:roomCode',
      name: 'collect-with-code',
      component: CollectView,
      props: true
    },
    {
      path: '/recordings',
      name: 'recordings',
      component: RecordingsView
    },
    {
      path: '/combine',
      name: 'combine',
      component: () => import('../views/CombineView.vue')
    },
    {
      path: '/guide',
      name: 'guide',
      component: GuideView
    },
    {
      path: '/archive',
      name: 'archive',
      component: ArchiveView
    },
    {
      path: '/offline',
      name: 'offline',
      component: OfflineView
    },
    {
      path: '/network',
      name: 'network',
      component: NetworkView
    },
    {
      path: '/pair-home/:code',
      name: 'pair-home',
      component: PairHomeView,
      props: true
    }
  ]
})

export default router
