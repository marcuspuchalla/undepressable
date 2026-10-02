/**
 * Check a stored recording against the attestations it carries, and keep the
 * result with it.
 */

import type { Recording } from '../../types'
import { putRecording } from '../recordingDb'
import { footage } from '../transfer/library'
import { expandLogs, entryCount } from './log'
import { corroborate } from './match'
import { sampleRecording } from './frames'

export function hasAttestations(rec: Recording): boolean {
  return !!rec.attestations && entryCount(rec.attestations) > 0
}

export async function checkAgainstFilmer(
  rec: Recording,
  opts: { onProgress?: (doneMs: number, totalMs: number) => void; signal?: AbortSignal } = {},
): Promise<Recording> {
  if (!rec.attestations || !hasAttestations(rec)) throw new Error('This copy carries nothing from the filming device to check against.')
  const f = await footage(rec)
  if ('missing' in f) throw new Error('Some of the footage is missing from this device.')
  if ('sealedFor' in f) throw new Error('This recording is sealed: unlock it (or check it on the home archive) first.')
  const expectedMs = rec.chunks.length * 1000
  const sampled = await sampleRecording(f.video, {
    rate: expectedMs > 20 * 60_000 ? 16 : 8,
    onProgress: (ms) => opts.onProgress?.(ms, expectedMs),
    signal: opts.signal,
  })
  const report = corroborate(expandLogs(rec.attestations), sampled.frames, sampled.durationMs)
  const updated: Recording = {
    ...rec,
    corroboration: { checkedAt: new Date().toISOString(), frames: sampled.frames.length, results: report.results, invalid: report.invalid },
  }
  await putRecording(updated)
  return updated
}
