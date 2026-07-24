import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import StreamView from '../views/StreamView.vue'
import CollectView from '../views/CollectView.vue'
import RecordingsView from '../views/RecordingsView.vue'
import GuideView from '../views/GuideView.vue'
import ArchiveView from '../views/ArchiveView.vue'
import OfflineView from '../views/OfflineView.vue'
import PairHomeView from '../views/PairHomeView.vue'

const router = createRouter({
  history: createWebHistory(),
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
      path: '/pair-home/:code',
      name: 'pair-home',
      component: PairHomeView,
      props: true
    }
  ]
})

export default router
