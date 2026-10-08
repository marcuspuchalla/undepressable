import { describe, it, expect } from 'vitest'
import { serializeRecording, deserializeRecording } from './recordingDb'
import type { Recording } from '../types'

describe('stored recording shape', () => {
  it('keeps every optional part — a field left out here is silently lost on save', () => {
    const rec: Recording = {
      id: 'r1',
      campaignId: 'c1',
      recordedBy: 'local-x',
      startedAt: new Date('2026-10-01T10:00:00Z'),
      endedAt: new Date('2026-10-01T10:00:05Z'),
      status: 'completed',
      chunks: [{ index: 0, timestamp: new Date('2026-10-01T10:00:01Z'), duration: 1000, size: 10, opfsPath: 'p', checksum: 'abc' }],
      metadata: { resolution: { width: 1, height: 1 }, bitrate: 1, codec: 'video/webm' },
      proof: { recordingId: 'r1' } as any,
      origin: { kind: 'synced', at: '2026-10-01T11:00:00Z', verified: true },
      sealed: { v: 1, keys: [] },
      timestamp: { ots: 'AA==', requestedAt: '2026-10-01T10:00:06Z', calendars: [] },
      attestations: [{ v: 1, pk: 'a'.repeat(64), s: 'b'.repeat(16), a: [[0, 0, 'c'.repeat(32), 'd'.repeat(128)]] }],
      corroboration: { checkedAt: '2026-10-01T12:00:00Z', frames: 20, results: [], invalid: 0 },
      combined: { v: 1, sources: [], segments: [], alignment: 'picture' },
    }
    const back = deserializeRecording(JSON.parse(JSON.stringify(serializeRecording(rec))))
    expect(back).toEqual(rec)
    // Every top-level field is covered by this test.
    expect(Object.keys(back).sort()).toEqual(Object.keys(rec).sort())
  })
})
