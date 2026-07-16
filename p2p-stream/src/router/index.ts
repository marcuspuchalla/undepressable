import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import StreamView from '../views/StreamView.vue'
import CollectView from '../views/CollectView.vue'
import RecordingsView from '../views/RecordingsView.vue'
import GuideView from '../views/GuideView.vue'

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
    }
  ]
})

export default router
