import type { CapacitorConfig } from '@capacitor/cli'

// Undepressable ships as a fully self-contained app: the web build is bundled
// into the APK and loaded from the WebView's local assets — there is no remote
// server or CDN. That keeps it offline-capable and F-Droid-friendly (no network
// dependency, no proprietary services).
const config: CapacitorConfig = {
  appId: 'app.undepressable',
  appName: 'Undepressable',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
}

export default config
