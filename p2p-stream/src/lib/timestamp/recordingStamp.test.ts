import { describe, it, expect } from 'vitest'
import { buildProof, generateIdentity, sha256, toHex } from '../integrity'
import { rootFileText, timestampFits } from './recordingStamp'
import { serializeDetached } from './ots'

async function proofOf(label: string) {
  return buildProof(label, [toHex(await sha256(new TextEncoder().encode(label)))], generateIdentity())
}

async function stampFor(proof: Awaited<ReturnType<typeof proofOf>>) {
  const digest = await sha256(new TextEncoder().encode(rootFileText(proof)))
  const ots = serializeDetached({ digest, timestamp: { msg: digest, attestations: [{ kind: 'pending', uri: 'https://cal.test' }], ops: [] } })
  let s = ''
  for (const b of ots) s += String.fromCharCode(b)
  return { ots: btoa(s), requestedAt: new Date().toISOString(), calendars: ['https://cal.test'] }
}

describe('recording timestamps', () => {
  it('stamps root.txt: the proof root and a newline', async () => {
    const p = await proofOf('a')
    expect(rootFileText(p)).toBe(`${p.merkleRoot}\n`)
  })

  it('a timestamp only counts for the proof it stamps', async () => {
    const a = await proofOf('a')
    const b = await proofOf('b')
    const t = await stampFor(a)
    expect(await timestampFits(a, t)).toBe(true)
    expect(await timestampFits(b, t)).toBe(false) // taken from another recording
    expect(await timestampFits(a, { ...t, ots: btoa('garbage') })).toBe(false)
    expect(await timestampFits(a, undefined)).toBe(false)
  })
})
