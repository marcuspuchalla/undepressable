/**
 * The app's own modules, reachable as `window.__und` — from the browser
 * console and from end-to-end tests of a built copy (scripts/e2e, LIVE=1),
 * where the dev server's source modules cannot be imported. Nothing here is
 * secret: it is the page's own code, acting on the page's own storage.
 */

import { useRecording } from '../composables/useRecording'
import { useOPFS } from '../composables/useOPFS'
import { getAllRecordings, getRecording, putRecording } from './recordingDb'
import { manifestFor } from './transfer/evidence'

export function installTestHooks(): void {
  ;(window as any).__und = { useRecording, useOPFS, getAllRecordings, getRecording, putRecording, manifestFor }
}
