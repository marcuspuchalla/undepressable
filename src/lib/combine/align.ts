/**
 * Which copies show the same stream, and where each one sits on a common clock.
 *
 * Copies that carry the filmer's attestations (lib/corroborate) belong to that
 * stream, and the filmer's clock is the common one: a copy checked against
 * the attestations knows its offset exactly ("picture"); one not checked yet
 * is placed by when the attestations arrived while it recorded ("signals").
 * Copies without attestations are grouped by room and placed by their
 * devices' clocks ("clock") — next to attested copies when the group has any,
 * since those tie the filmer's clock to wall-clock time.
 */

import type { Recording } from '../../types'
import type { AttestationLog } from '../corroborate/log'
import type { Alignment, Copy } from './timeline'

export interface StreamKey {
  /** The filmer's key and stream id — or, without attestations, the room. */
  kind: 'stream' | 'room'
  id: string
  pk?: string
  s?: string
}

export interface Placement {
  recording: Recording
  copy: Copy | null
  /** Why the copy is left out, when it is. */
  excluded?: 'does-not-match' | 'no-footage'
}

export interface CopyGroup {
  key: StreamKey
  placements: Placement[]
}

export const groupKey = (k: StreamKey) => (k.kind === 'stream' ? `stream:${k.pk}:${k.s}` : `room:${k.id}`)

/** The attestation log with the most entries: the stream this copy watched. */
export function mainLog(rec: Recording): AttestationLog | null {
  const logs = rec.attestations ?? []
  return logs.length ? [...logs].sort((a, b) => b.a.length - a.a.length)[0] : null
}

export function streamKeyOf(rec: Recording): StreamKey | null {
  const log = mainLog(rec)
  if (log) return { kind: 'stream', id: `${log.pk}:${log.s}`, pk: log.pk, s: log.s }
  if (/^room-/.test(rec.campaignId)) return { kind: 'room', id: rec.campaignId }
  return null
}

export const durationOf = (rec: Recording) => rec.chunks.reduce((n, c) => n + (c.duration || 1000), 0)

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : null
}

/** filmer time − media time, from when the attestations arrived (null without receipt times). */
export function signalsOffset(log: AttestationLog): number | null {
  const diffs = log.a.filter((e) => typeof e[4] === 'number').map((e) => e[1] - (e[4] as number))
  return median(diffs)
}

/** filmer time − media time, from the last picture check against this signer. */
export function pictureOffset(rec: Recording, pk: string): { offsetMs: number | null; matches: boolean } | null {
  const r = rec.corroboration?.results.find((x) => x.signer === pk)
  if (!r) return null
  return { offsetMs: r.offsetMs, matches: r.verdict !== 'not-corroborated' }
}

/** Group every signed, complete recording by the stream it shows. */
export function groupCopies(recordings: Recording[]): CopyGroup[] {
  const groups = new Map<string, CopyGroup>()
  for (const rec of recordings) {
    if (rec.status !== 'completed' || !rec.proof || rec.combined) continue
    const key = streamKeyOf(rec)
    if (!key) continue
    const k = groupKey(key)
    const g = groups.get(k) ?? { key, placements: [] }
    g.placements.push({ recording: rec, copy: null })
    groups.set(k, g)
  }
  for (const g of groups.values()) place(g)
  return [...groups.values()].filter((g) => g.placements.length >= 2)
}

/** Put every copy of a group on the common clock (mutates the placements). */
export function place(group: CopyGroup): void {
  const pk = group.key.pk
  type Known = { p: Placement; startMs: number; alignment: Alignment }
  const known: Known[] = []
  const unknown: Placement[] = []
  for (const p of group.placements) {
    const rec = p.recording
    p.copy = null
    p.excluded = undefined
    if (!rec.chunks.length) {
      p.excluded = 'no-footage'
      continue
    }
    const log = pk ? mainLog(rec) : null
    const pic = pk ? pictureOffset(rec, pk) : null
    if (pic && !pic.matches) {
      p.excluded = 'does-not-match'
      continue
    }
    if (pic?.offsetMs != null) known.push({ p, startMs: pic.offsetMs, alignment: 'picture' })
    else if (log && signalsOffset(log) != null) known.push({ p, startMs: signalsOffset(log)!, alignment: 'signals' })
    else unknown.push(p)
  }
  // Wall-clock time of the common clock's zero: from the placed copies, or
  // the earliest start when nothing is placed.
  const all = group.placements.filter((p) => !p.excluded).map((p) => p.recording.startedAt.getTime())
  const epoch0 = median(known.map((k) => k.p.recording.startedAt.getTime() - k.startMs)) ?? Math.min(...all)
  for (const k of known) k.p.copy = { id: k.p.recording.id, durationMs: durationOf(k.p.recording), startMs: k.startMs, alignment: k.alignment }
  for (const p of unknown) p.copy = { id: p.recording.id, durationMs: durationOf(p.recording), startMs: p.recording.startedAt.getTime() - epoch0, alignment: 'clock' }
}
