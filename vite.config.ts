import { isPatched } from './scripts/patch-deps.mjs'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { resolve } from 'path'
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'

// Compiled into the app and written into release.json (scripts/sign-release.mjs),
// so a copy can tell which published release it is.
function buildId(): string {
  if (process.env.VITE_BUILD_ID) return process.env.VITE_BUILD_ID
  const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'))
  try {
    return `${version}+${execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: __dirname, encoding: 'utf8' }).trim()}`
  } catch {
    return `${version}+local`
  }
}

// `vite build --mode extension` packages the app as a browser extension
// (scripts/build-extension.js): same code, no service worker — the installed
// extension is itself the offline copy — and its own output folder.
// `vite build --mode portable` makes the self-contained single-file app
// (scripts/build-portable.js): relative paths, hash routes, one inlined bundle,
// so it runs from a file or from any mirror under any path.
// `vite build --mode verify` builds the standalone evidence check (verify/):
// one small page from the same modules, inlined into dist-verify/verify.html
// and carried inside every evidence bundle (src/lib/transfer/verifier.ts).
const VERIFY_HTML = resolve(__dirname, 'dist-verify/verify.html')
function verifierPlugin() {
  const id = 'virtual:verify-html'
  return {
    name: 'undepressable-verifier',
    resolveId: (source: string) => (source === id ? '\0' + id : null),
    load(this: any, source: string) {
      if (source !== '\0' + id) return null
      this.addWatchFile?.(VERIFY_HTML)
      let html = ''
      try {
        html = readFileSync(VERIFY_HTML, 'utf8')
      } catch {
        /* not built yet (npm run build:verify): bundles then carry no checker */
      }
      return `export default ${JSON.stringify(html)}`
    },
  }
}

// The installed Trystero must carry the small offer pools (scripts/patch-deps.mjs):
// an unpatched copy would ship the connection burst the field report found.
if (!isPatched()) throw new Error('trystero is not patched — run `npm install` (scripts/patch-deps.mjs)')

export default defineConfig(({ mode }) => {
  const portable = mode === 'portable'
  const noServiceWorker = mode === 'extension' || portable
  if (mode === 'verify') {
    return {
      root: resolve(__dirname, 'verify'),
      publicDir: false,
      base: './',
      define: { __APP_BUILD__: JSON.stringify(buildId()), __HASH_ROUTES__: 'true', __PORTABLE__: 'true' },
      resolve: { alias: { '@': resolve(__dirname, 'src') } },
      build: {
        outDir: resolve(__dirname, 'dist-verify/app'),
        emptyOutDir: true,
        cssCodeSplit: false,
        assetsInlineLimit: 1024 * 1024,
        target: 'esnext',
        sourcemap: false,
        rollupOptions: { output: { inlineDynamicImports: true } },
      },
    }
  }
  return {
  plugins: [
    verifierPlugin(),
    nodePolyfills({
      include: ['process', 'util', 'buffer', 'stream'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
    vue(),
    !noServiceWorker && VitePWA({
      // Never swap the app's code silently: a waiting version is checked
      // against the release keys and offered (composables/useUpdates.ts).
      registerType: 'prompt',
      injectRegister: false,
      strategies: 'generateSW',
      workbox: {
        // Cache all assets aggressively for offline use
        globPatterns: [
          '**/*.{js,css,html,ico,png,svg,webm,json}'
        ],
        maximumFileSizeToCacheInBytes: 50 * 1024 * 1024, // 50MB for video chunks
        
        // Cache navigation requests (all routes)
        navigateFallback: '/index.html',
        // The single-file app sits next to the site (scripts/build-portable.js);
        // opening it directly must not be answered with index.html.
        navigateFallbackDenylist: [/^\/api/, /^\/__/, /^\/undepressable\.html$/, /^\/release\.(json|sig)$/],
        
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
        
        // A new version waits until someone accepts it (or every tab of the
        // app is closed — browsers allow no more control than that).
        skipWaiting: false,
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
            purpose: 'any'
          },
          {
            src: '/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            // Padded safe-zone version so Android doesn't crop the logo.
            src: '/icon-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      devOptions: {
        // Keep the service worker OFF in dev — a caching SW repeatedly served
        // stale code during on-device testing. Production builds still get the
        // full PWA/SW; this only affects `npm run dev`.
        enabled: false,
        type: 'module'
      }
    })
  ],
  base: portable ? './' : '/',
  define: {
    __APP_BUILD__: JSON.stringify(buildId()),
    __HASH_ROUTES__: JSON.stringify(portable),
    __PORTABLE__: JSON.stringify(portable),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // No service worker in the extension (it updates via its store or by hand).
      ...(noServiceWorker ? { 'virtual:pwa-register': resolve(__dirname, 'src/lib/update/pwaRegisterStub.ts') } : {}),
    }
  },
  server: {
    port: 4400,
    host: true,
    // Allow reaching the dev server through a tunnel host (e.g. *.trycloudflare.com)
    // for on-device testing over HTTPS. Dev-only; does not affect production builds.
    allowedHosts: true
  },
  build: {
    outDir: mode === 'extension' ? 'dist-extension/app' : portable ? 'dist-portable/app' : 'dist',
    // One file: no lazily loaded chunks a file:// page could not fetch.
    ...(portable ? { cssCodeSplit: false, assetsInlineLimit: 1024 * 1024 } : {}),
    target: 'esnext',
    sourcemap: true,
    // Ensure all assets are self-contained
    rollupOptions: {
      output: portable
        ? { inlineDynamicImports: true }
        : {
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
}
})
