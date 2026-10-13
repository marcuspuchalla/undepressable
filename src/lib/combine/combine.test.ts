import { describe, it, expect } from 'vitest'
import { buildTimeline, segmentAt, clock, weakest, type Copy } from './timeline'
import { groupCopies, place, signalsOffset, streamKeyOf, type CopyGroup } from './align'
import type { Recording } from '../../types'
import type { AttestationLog } from '../corroborate/log'

const copy = (id: string, startMs: number, durationMs: number, alignment: Copy['alignment'] = 'picture'): Copy => ({ id, startMs, durationMs, alignment })

describe('buildTimeline', () => {
  it('covers more than any single copy, switching where one ends', () => {
    // A: 0–12 s, B: 8–20 s, C: 25–30 s
    const t = buildTimeline([copy('B', 8000, 12000), copy('A', 0, 12000), copy('C', 25000, 5000)])!
    expect(t.segments).toEqual([
      { from: 0, to: 12000, copy: 'A', at: 0 },
      { from: 12000, to: 20000, copy: 'B', at: 4000 },
      { from: 20000, to: 25000, copy: null, at: 0 },
      { from: 25000, to: 30000, copy: 'C', at: 0 },
    ])
    expect(t.coveredMs).toBe(25000)
    expect(t.gapMs).toBe(5000)
    expect(t.startMs).toBe(0)
    expect(t.endMs).toBe(30000)
    expect(segmentAt(t, 15000)?.copy).toBe('B')
    expect(segmentAt(t, 22000)?.copy).toBeNull()
    expect(segmentAt(t, 30000)).toBeNull()
  })

  it('prefers a well-aligned copy over a longer one aligned by clock, and reports the weakest alignment used', () => {
    const t = buildTimeline([copy('fuzzy', 0, 30000, 'clock'), copy('exact', 0, 10000, 'picture')])!
    expect(t.segments.map((s) => s.copy)).toEqual(['exact', 'fuzzy'])
    expect(t.alignment).toBe('clock')
    expect(buildTimeline([copy('a', 0, 5000, 'picture'), copy('b', 5000, 5000, 'signals')])!.alignment).toBe('signals')
    expect(weakest('picture', 'signals')).toBe('signals')
  })

  it('a copy entirely inside another is never played', () => {
    const t = buildTimeline([copy('long', 0, 20000), copy('inner', 5000, 3000)])!
    expect(t.segments).toEqual([{ from: 0, to: 20000, copy: 'long', at: 0 }])
  })

  it('is null without footage, and ignores empty copies', () => {
    expect(buildTimeline([])).toBeNull()
    expect(buildTimeline([copy('x', 0, 0)])).toBeNull()
  })

  it('formats common time as a clock', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(65500)).toBe('1:05')
  })
})

// --- grouping and placing copies ---

const PK = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const SIG = 'c'.repeat(128)
const F = '0'.repeat(32)

function rec(id: string, opts: { startedAt: number; seconds: number; campaignId?: string; logs?: AttestationLog[]; corroboration?: Recording['corroboration']; status?: Recording['status'] }): Recording {
  return {
    id,
    campaignId: opts.campaignId ?? 'rec-1',
    recordedBy: 'x',
    startedAt: new Date(opts.startedAt),
    status: opts.status ?? 'completed',
    chunks: Array.from({ length: opts.seconds }, (_, i) => ({ index: i, timestamp: new Date(), duration: 1000, size: 1, opfsPath: '', checksum: '' })),
    metadata: { resolution: { width: 1, height: 1 }, bitrate: 1, codec: 'video/webm' },
    proof: { recordingId: id, chunkHashes: [], merkleRoot: 'd'.repeat(64), pubKey: 'e'.repeat(64), signature: 'f'.repeat(128), chunkCount: opts.seconds, version: 1 } as any,
    ...(opts.logs ? { attestations: opts.logs } : {}),
    ...(opts.corroboration ? { corroboration: opts.corroboration } : {}),
  }
}
/** A log of attestations t = 0, 1000, … received `delayMs` after the copy started recording at filmer time `offset`. */
function log(offset: number, n = 5, delayMs = 300, pk = PK, s = 'stream1'): AttestationLog {
  return { v: 1, pk, s, a: Array.from({ length: n }, (_, i) => [i, offset + i * 1000, F, SIG, i * 1000 + delayMs] as any) }
}
const checked = (offsetMs: number, verdict: 'corroborated' | 'not-corroborated' = 'corroborated', signer = PK): Recording['corroboration'] => ({
  checkedAt: '2026-10-08T10:00:00Z',
  frames: 10,
  invalid: 0,
  results: [{ signer, total: 10, matched: verdict === 'corroborated' ? 10 : 0, scenes: 5, offsetMs, unmatchedAt: [], verdict }],
})

describe('grouping copies', () => {
  it('groups by the stream the attestations name, else by room; singles and unsigned copies are left out', () => {
    const groups = groupCopies([
      rec('a', { startedAt: 1000, seconds: 10, logs: [log(0)] }),
      rec('b', { startedAt: 6000, seconds: 10, logs: [log(5000)] }),
      rec('c', { startedAt: 1000, seconds: 10, campaignId: 'room-ABC123' }),
      rec('d', { startedAt: 4000, seconds: 10, campaignId: 'room-ABC123' }),
      rec('alone', { startedAt: 1000, seconds: 10, campaignId: 'room-ZZZZZZ' }),
      rec('other-stream', { startedAt: 1000, seconds: 10, logs: [log(0, 5, 300, OTHER)] }),
      { ...rec('unsigned', { startedAt: 1000, seconds: 10, campaignId: 'room-ABC123' }), proof: undefined },
      rec('unfinished', { startedAt: 1000, seconds: 10, campaignId: 'room-ABC123', status: 'recording' }),
    ])
    expect(groups.map((g) => [g.key.kind, g.placements.map((p) => p.recording.id)])).toEqual([
      ['stream', ['a', 'b']],
      ['room', ['c', 'd']],
    ])
    expect(streamKeyOf(rec('x', { startedAt: 0, seconds: 1 }))).toBeNull()
  })

  it('places checked copies by their picture offset, unchecked ones by when the signals arrived', () => {
    const [g] = groupCopies([
      rec('a', { startedAt: 1000, seconds: 10, logs: [log(0)], corroboration: checked(150) }),
      rec('b', { startedAt: 6000, seconds: 10, logs: [log(5000)] }),
    ])
    const [a, b] = g.placements
    expect(a.copy).toMatchObject({ startMs: 150, alignment: 'picture', durationMs: 10000 })
    expect(b.copy).toMatchObject({ startMs: 5000 - 300, alignment: 'signals' })
    expect(signalsOffset(log(5000))).toBe(4700)
  })

  it('leaves out a copy that was checked and does not show this stream', () => {
    const [g] = groupCopies([
      rec('a', { startedAt: 1000, seconds: 10, logs: [log(0)], corroboration: checked(0) }),
      rec('b', { startedAt: 6000, seconds: 10, logs: [log(5000)], corroboration: checked(null as any, 'not-corroborated') }),
    ])
    expect(g.placements[1].excluded).toBe('does-not-match')
    expect(g.placements[1].copy).toBeNull()
  })

  it('places copies without attestations by their device clocks, next to the placed ones', () => {
    // Copies a (picture: filmer 2000 ms at its start) and b (no attestations); b started 4 s after a by their clocks.
    const group: CopyGroup = {
      key: { kind: 'stream', id: 'x', pk: PK, s: 'stream1' },
      placements: [
        { recording: rec('a', { startedAt: 10_000, seconds: 10, logs: [log(2000)], corroboration: checked(2000) }), copy: null },
        { recording: rec('b', { startedAt: 14_000, seconds: 10 }), copy: null },
      ],
    }
    place(group)
    expect(group.placements[0].copy?.startMs).toBe(2000)
    expect(group.placements[1].copy).toMatchObject({ startMs: 6000, alignment: 'clock' })
    // A room group with no attestations at all starts its clock at the earliest copy.
    const [room] = groupCopies([rec('c', { startedAt: 50_000, seconds: 5, campaignId: 'room-R' }), rec('d', { startedAt: 53_000, seconds: 5, campaignId: 'room-R' })])
    expect(room.placements.map((p) => p.copy?.startMs)).toEqual([0, 3000])
    expect(buildTimeline(room.placements.map((p) => p.copy!))!.coveredMs).toBe(8000)
  })
})
