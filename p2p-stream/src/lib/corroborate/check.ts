/**
 * Check a stored recording against the attestations it carries, and keep the
 * result with it.
 */

import type { Recording, CorroborationCheck } from '../../types'
import { putRecording } from '../recordingDb'
import { footage } from '../transfer/library'
import { openWithAvailableKeys } from '../seal/keys'
import { openJson } from '../seal/crypto'
import { expandLogs, entryCount, isLogsShape, type AttestationLog } from './log'
import { corroborate } from './match'
import { sampleRecording } from './frames'

export function hasAttestations(rec: Recording): boolean {
  return (!!rec.attestations && entryCount(rec.attestations) > 0) || !!rec.sealed?.attestations
}

/** The attestations in the clear — opened with this device's key when they are sealed. */
async function attestationsOf(rec: Recording): Promise<AttestationLog[] | null> {
  if (rec.attestations?.length) return rec.attestations
  if (!rec.sealed?.attestations) return null
  const key = await openWithAvailableKeys(rec.sealed.keys)
  if (!key) return null
  const logs = await openJson(key, rec.sealed.attestations).catch(() => null)
  return isLogsShape(logs) ? logs : null
}

export async function checkAgainstFilmer(
  rec: Recording,
  opts: { onProgress?: (doneMs: number, totalMs: number) => void; signal?: AbortSignal } = {},
): Promise<CorroborationCheck> {
  if (!hasAttestations(rec)) throw new Error('This copy carries nothing from the filming device to check against.')
  const f = await footage(rec)
  if ('missing' in f) throw new Error('Some of the footage is missing from this device.')
  if ('sealedFor' in f) throw new Error('This recording is sealed: unlock it (or check it on the home archive) first.')
  const logs = await attestationsOf(rec)
  if (!logs) throw new Error('The signatures from the filming device could not be opened here.')
  const expectedMs = rec.chunks.length * 1000
  const sampled = await sampleRecording(f.video, {
    rate: expectedMs > 20 * 60_000 ? 16 : 8,
    onProgress: (ms) => opts.onProgress?.(ms, expectedMs),
    signal: opts.signal,
  })
  const report = corroborate(expandLogs(logs), sampled.frames, sampled.durationMs)
  const check: CorroborationCheck = { checkedAt: new Date().toISOString(), frames: sampled.frames.length, results: report.results, invalid: report.invalid }
  // Kept with the recording — except a sealed one's: the signer's key in the
  // clear would tie this device to the stream, which sealing is there to hide.
  if (!rec.sealed) await putRecording({ ...rec, corroboration: check })
  return check
}
