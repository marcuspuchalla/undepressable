import { reactive } from 'vue'
import { registerSW } from 'virtual:pwa-register'
import { checkRelease, type ReleaseCheck } from '../lib/update/release'
import { TRUSTED_RELEASE_KEYS } from '../lib/update/trustedKeys'

/**
 * Updates happen only when someone decides to — never silently.
 *
 * A new version downloaded by the service worker waits. Before offering it,
 * this (already installed, trusted) copy checks the new release's signature
 * against the keys compiled into it (lib/update/release.ts). A signed update
 * is offered; anything else — the likely sign of a seized or hacked website —
 * is reported as a warning, with what to do before the app is next closed
 * (a browser applies a waiting version then, and no page can prevent that).
 */

export const APP_BUILD: string = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev'

const CURRENT_KEY = 'undepressable_release_current'

export const updates = reactive({
  /** A new version is downloaded and waiting. */
  waiting: false,
  checking: false,
  /** Verdict on the waiting version. */
  update: null as ReleaseCheck | null,
  /** This running copy's own release, as published when it was current. */
  current: null as ReleaseCheck | null,
  dismissed: false,
  trustedKeys: TRUSTED_RELEASE_KEYS.length,
})

let applyWaiting: ((reload?: boolean) => Promise<void>) | null = null
let started = false

function base(): string {
  return new URL('./', location.href.split('#')[0]).href.replace(/[^/]*$/, '')
}

async function fetchRelease(): Promise<{ text: string | null; sig: string | null }> {
  const get = async (name: string) => {
    try {
      const res = await fetch(new URL(name, base()).href, { cache: 'no-store', credentials: 'omit' })
      return res.ok ? await res.text() : null
    } catch {
      return null
    }
  }
  const [text, sig] = await Promise.all([get('release.json'), get('release.sig')])
  return { text, sig }
}

async function inspectUpdate() {
  updates.checking = true
  try {
    const { text, sig } = await fetchRelease()
    updates.update = await checkRelease(text, sig, TRUSTED_RELEASE_KEYS)
  } finally {
    updates.checking = false
  }
}

async function inspectCurrent() {
  try {
    const saved = JSON.parse(localStorage.getItem(CURRENT_KEY) ?? 'null')
    if (saved?.manifest?.build === APP_BUILD) updates.current = saved
  } catch {
    /* nothing saved */
  }
  if (updates.current || updates.waiting) return
  const { text, sig } = await fetchRelease()
  const check = await checkRelease(text, sig, TRUSTED_RELEASE_KEYS)
  // Only describe ourselves with a manifest for this very build.
  if (check.manifest?.build !== APP_BUILD) return
  updates.current = check
  try {
    localStorage.setItem(CURRENT_KEY, JSON.stringify(check))
  } catch {
    /* storage blocked */
  }
}

/** Register the service worker (production web builds only). */
export function startUpdates() {
  if (started || (import.meta as any).env?.DEV || !('serviceWorker' in navigator)) return
  started = true
  applyWaiting = registerSW({
    immediate: true,
    onNeedRefresh() {
      updates.waiting = true
      updates.dismissed = false
      void inspectUpdate()
    },
    onRegisteredSW(_url: string, registration: ServiceWorkerRegistration | undefined) {
      void inspectCurrent()
      // Look for updates while the app stays open (a home archive may run for days).
      if (registration) setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000)
    },
  })
}

/** Install the waiting version now (reloads the app). */
export async function applyUpdate() {
  await applyWaiting?.(true)
}

/** Ask the website for a newer version right away. */
export async function checkForUpdate(): Promise<void> {
  const reg = await navigator.serviceWorker?.getRegistration()
  await reg?.update().catch(() => {})
}
