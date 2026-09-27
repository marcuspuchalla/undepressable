import { ref } from 'vue'
import { APP_BUILD, updates } from './useUpdates'
import { usesHashRoutes } from '../lib/appLocation'
import { sha256, toHex } from '../lib/integrity/hashing'

/**
 * Hand the whole app on as one file (scripts/build-portable.js), so it spreads
 * by AirDrop, Bluetooth, messenger or USB stick with no website involved.
 *
 * Where the file comes from:
 *   - the portable copy shares itself, exactly as it was loaded;
 *   - the web app and the extension carry `undepressable.html` next to
 *     themselves. The web app keeps it for offline use only after checking
 *     it against this build's published release (a newer copy from a website
 *     that changed hands must not slip in).
 */

const FILE = 'undepressable.html'
const CACHE = 'undepressable-app-copy'

let pristine: string | null = null

/** Call first thing at startup: the portable copy's own HTML, before the app renders into it. */
export function capturePristineCopy() {
  if (typeof __PORTABLE__ !== 'undefined' && __PORTABLE__) pristine = '<!DOCTYPE html>\n' + document.documentElement.outerHTML
}

function fileUrl(): string {
  return new URL(FILE, location.href.split('#')[0]).href
}

export type CopyCheck = 'this-copy' | 'matches-release' | 'unchecked'

async function expectedHash(): Promise<string | null> {
  return updates.current?.manifest?.files?.[FILE] ?? null
}

/** Keep a verified copy of the single-file app for sharing while offline (web builds). */
export async function keepAppCopy(): Promise<void> {
  if (pristine || usesHashRoutes() || (import.meta as any).env?.DEV || typeof caches === 'undefined') return
  const want = await expectedHash()
  if (!want) return // no release description for this very build: nothing to check against
  const cache = await caches.open(CACHE)
  const key = `${fileUrl()}?build=${encodeURIComponent(APP_BUILD)}`
  if (await cache.match(key)) return
  const res = await fetch(fileUrl(), { cache: 'no-store' }).catch(() => null)
  if (!res?.ok) return
  const bytes = new Uint8Array(await res.clone().arrayBuffer())
  if (toHex(await sha256(bytes)) !== want) return
  for (const old of await cache.keys()) await cache.delete(old)
  await cache.put(key, new Response(bytes, { headers: { 'content-type': 'text/html' } }))
}

export function useShareApp() {
  const busy = ref(false)
  const note = ref<string | null>(null)

  async function appFile(): Promise<{ file: File; check: CopyCheck } | null> {
    const name = `undepressable-${APP_BUILD.replace(/[^\w.+-]/g, '_')}.html`
    if (pristine) return { file: new File([pristine], name, { type: 'text/html' }), check: 'this-copy' }
    let blob: Blob | null = null
    let check: CopyCheck = 'unchecked'
    if (typeof caches !== 'undefined') {
      const hit = await caches.match(`${fileUrl()}?build=${encodeURIComponent(APP_BUILD)}`, { cacheName: CACHE }).catch(() => undefined)
      if (hit) {
        blob = await hit.blob()
        check = 'matches-release'
      }
    }
    if (!blob) {
      // The extension carries the file in its package; a web copy fetches it.
      const res = await fetch(fileUrl(), { cache: 'no-store' }).catch(() => null)
      if (res?.ok) {
        blob = await res.blob()
        const want = await expectedHash()
        if (usesHashRoutes()) check = 'this-copy'
        else if (want && toHex(await sha256(new Uint8Array(await blob.arrayBuffer()))) === want) check = 'matches-release'
      }
    }
    return blob ? { file: new File([blob], name, { type: 'text/html' }), check } : null
  }

  async function share(): Promise<void> {
    busy.value = true
    note.value = null
    try {
      const got = await appFile()
      if (!got) {
        note.value = 'The app file is not available on this device right now (open the app online once).'
        return
      }
      const files = [got.file]
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files })) {
        try {
          await navigator.share({ files, title: 'Undepressable', text: 'Open this file in Chrome, Edge or Firefox on a computer — or put it on any website as index.html.' })
          return
        } catch (e: any) {
          if (e?.name === 'AbortError') return
        }
      }
      save(got.file)
    } finally {
      busy.value = false
    }
  }

  async function download(): Promise<void> {
    busy.value = true
    try {
      const got = await appFile()
      if (got) save(got.file)
      else note.value = 'The app file is not available on this device right now (open the app online once).'
    } finally {
      busy.value = false
    }
  }

  function save(file: File) {
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  return { busy, note, share, download, appFile }
}
