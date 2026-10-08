/// <reference types="vite-plugin-pwa/client" />

/** Build identifier compiled in by vite.config.ts (also in release.json). */
declare const __APP_BUILD__: string

/** True in the portable single-file build (vite.config.ts). */
declare const __PORTABLE__: boolean

declare module 'virtual:verify-html' {
  const html: string
  export default html
}
