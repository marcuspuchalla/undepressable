import { describe, it, expect } from 'vitest'
import { buildProof, verifyProof } from './recordingProof'
import { generateIdentity } from './identity'
import { sha256, toHex } from './hashing'

const enc = new TextEncoder()

async function chunkHash(s: string): Promise<string> {
  return toHex(await sha256(enc.encode(s)))
}

describe('recordingProof', () => {
  it('builds a proof that verifies (happy path)', async () => {
    const id = generateIdentity()
    const hashes = [await chunkHash('chunk-0'), await chunkHash('chunk-1'), await chunkHash('chunk-2')]
    const proof = buildProof('rec-1', hashes, id)

    expect(proof.recordingId).toBe('rec-1')
    expect(proof.chunkCount).toBe(3)
    expect(proof.chunkHashes).toEqual(hashes)
    expect(proof.merkleRoot).toMatch(/^[0-9a-f]{64}$/)
    expect(proof.signature).toMatch(/^[0-9a-f]+$/)
    expect(proof.pubKey).toMatch(/^[0-9a-f]{64}$/)
    expect(typeof proof.createdAt).toBe('number')

    const res = verifyProof(proof)
    expect(res.valid).toBe(true)
    expect(res.reason).toBeUndefined()
  })

  it('detects a tampered chunk hash (root mismatch)', async () => {
    const id = generateIdentity()
    const hashes = [await chunkHash('a'), await chunkHash('b'), await chunkHash('c')]
    const proof = buildProof('rec-2', hashes, id)

    const tampered = { ...proof, chunkHashes: [...proof.chunkHashes] }
    tampered.chunkHashes[1] = await chunkHash('b-EVIL')

    const res = verifyProof(tampered)
    expect(res.valid).toBe(false)
    expect(res.reason).toMatch(/root/i)
  })

  it('detects a forged/mismatched signature', async () => {
    const id = generateIdentity()
    const other = generateIdentity()
    const hashes = [await chunkHash('x'), await chunkHash('y')]
    const proof = buildProof('rec-3', hashes, id)

    // Swap in a different pubkey -> signature no longer verifies
    const forged = { ...proof, pubKey: toHex(other.publicKey) }
    const res = verifyProof(forged)
    expect(res.valid).toBe(false)
    expect(res.reason).toMatch(/signature/i)
  })

  it('detects a chunkCount that disagrees with chunkHashes', async () => {
    const id = generateIdentity()
    const hashes = [await chunkHash('one'), await chunkHash('two')]
    const proof = buildProof('rec-4', hashes, id)
    const bad = { ...proof, chunkCount: 5 }
    const res = verifyProof(bad)
    expect(res.valid).toBe(false)
    expect(res.reason).toMatch(/count/i)
  })

  it('works for a single-chunk recording', async () => {
    const id = generateIdentity()
    const hashes = [await chunkHash('solo')]
    const proof = buildProof('rec-5', hashes, id)
    expect(proof.merkleRoot).toBe(hashes[0])
    expect(verifyProof(proof).valid).toBe(true)
  })

  it('rejects an empty recording at build time', () => {
    const id = generateIdentity()
    expect(() => buildProof('rec-empty', [], id)).toThrow()
  })
})
