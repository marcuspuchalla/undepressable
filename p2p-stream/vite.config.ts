import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    nodePolyfills({
      include: ['process', 'util', 'buffer', 'stream'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      strategies: 'generateSW',
      workbox: {
        // Cache all assets aggressively for offline use
        globPatterns: [
          '**/*.{js,css,html,ico,png,svg,webm,json}'
        ],
        maximumFileSizeToCacheInBytes: 50 * 1024 * 1024, // 50MB for video chunks
        
        // Cache navigation requests (all routes)
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/__/],
        
        // Clean up old caches
        cleanupOutdatedCaches: true,
        
        // Cache runtime assets with aggressive caching
        runtimeCaching: [
          {
            // Cache all assets - js, css, etc
            urlPattern: ({ request }) => 
              request.destination === 'script' ||
              request.destination === 'style' ||
              request.destination === 'document' ||
              request.destination === 'image' ||
              request.destination === 'font',
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-assets',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 365 * 24 * 60 * 60 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            // Cache navigation requests (HTML pages)
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'CacheFirst',
            options: {
              cacheName: 'pages',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 365 * 24 * 60 * 60 // 1 year
              }
            }
          },
          {
            // Trystero chunks and other dynamic imports
            urlPattern: /\.js$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'dynamic-js',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 365 * 24 * 60 * 60
              }
            }
          }
        ],
        
        // Skip waiting so new service worker activates immediately
        skipWaiting: true,
        clientsClaim: true
      },
      manifest: {
        name: 'Undepressable',
        short_name: 'Undepressable',
        description: 'Censorship-resistant, peer-to-peer live streaming that keeps documentation online even when devices are seized or networks are blocked.',
        theme_color: '#0b0d10',
        background_color: '#0b0d10',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        // Ensure app works offline immediately
        display_override: ['standalone', 'minimal-ui'],
        categories: ['social', 'utilities'],
        icons: [
          {
            src: '/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: '/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      devOptions: {
        enabled: true,
        type: 'module'
      }
    })
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  server: {
    port: 4400,
    host: true
  },
  build: {
    target: 'esnext',
    sourcemap: true,
    // Ensure all assets are self-contained
    rollupOptions: {
      output: {
        manualChunks: {
          'trystero-torrent': ['trystero/torrent'],
          'trystero-nostr': ['trystero/nostr']
        }
      }
    }
  },
  optimizeDeps: {
    include: ['simple-peer', 'qrcode', 'jsqr', 'trystero/torrent', 'trystero/nostr']
  }
})
