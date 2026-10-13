import { describe, it, expect } from 'vitest'
import { IncrementalMerkleTree, verifyProof } from './merkle'
import { toHex } from './hashing'

// Deterministic fake 32-byte leaf hashes (content does not need to be real SHA-256
// output for the tree logic — the tree combines pre-computed leaf hashes).
function leaf(n: number): Uint8Array {
  const b = new Uint8Array(32)
  b.fill(n & 0xff)
  return b
}

describe('IncrementalMerkleTree', () => {
  it('reports null root and zero leaves when empty', () => {
    const t = new IncrementalMerkleTree()
    expect(t.root).toBeNull()
    expect(t.leafCount).toBe(0)
  })

  it('uses the single leaf as the root for a 1-leaf tree', () => {
    const t = new IncrementalMerkleTree()
    t.addLeaf(leaf(1))
    expect(t.leafCount).toBe(1)
    expect(t.root).not.toBeNull()
    expect(toHex(t.root!)).toBe(toHex(leaf(1)))
  })

  it('is deterministic: same leaves -> same root', () => {
    const a = new IncrementalMerkleTree()
    const b = new IncrementalMerkleTree()
    for (let i = 0; i < 5; i++) {
      a.addLeaf(leaf(i))
      b.addLeaf(leaf(i))
    }
    expect(toHex(a.root!)).toBe(toHex(b.root!))
  })

  it('produces a 2-leaf root that differs from either leaf', () => {
    const t = new IncrementalMerkleTree()
    t.addLeaf(leaf(1))
    t.addLeaf(leaf(2))
    const root = toHex(t.root!)
    expect(root).not.toBe(toHex(leaf(1)))
    expect(root).not.toBe(toHex(leaf(2)))
    expect(t.root!.length).toBe(32)
  })

  it('handles an odd (3-leaf) tree via duplicate-last', () => {
    const t = new IncrementalMerkleTree()
    t.addLeaf(leaf(1))
    t.addLeaf(leaf(2))
    t.addLeaf(leaf(3))
    expect(t.leafCount).toBe(3)
    expect(t.root).not.toBeNull()
    expect(t.root!.length).toBe(32)
  })

  it('root changes when any leaf order changes', () => {
    const a = new IncrementalMerkleTree()
    a.addLeaf(leaf(1))
    a.addLeaf(leaf(2))
    const b = new IncrementalMerkleTree()
    b.addLeaf(leaf(2))
    b.addLeaf(leaf(1))
    expect(toHex(a.root!)).not.toBe(toHex(b.root!))
  })
})

describe('getProof / verifyProof', () => {
  it('verifies proofs for every leaf across various sizes', () => {
    for (const size of [1, 2, 3, 4, 5, 8, 9]) {
      const t = new IncrementalMerkleTree()
      for (let i = 0; i < size; i++) t.addLeaf(leaf(i))
      const root = t.root!
      for (let i = 0; i < size; i++) {
        const proof = t.getProof(i)
        expect(verifyProof(leaf(i), proof, root)).toBe(true)
      }
    }
  })

  it('rejects a proof against a tampered root', () => {
    const t = new IncrementalMerkleTree()
    for (let i = 0; i < 4; i++) t.addLeaf(leaf(i))
    const proof = t.getProof(2)
    const badRoot = t.root!.slice()
    badRoot[0] ^= 0xff
    expect(verifyProof(leaf(2), proof, badRoot)).toBe(false)
  })

  it('rejects a proof for the wrong leaf value (tamper detection)', () => {
    const t = new IncrementalMerkleTree()
    for (let i = 0; i < 4; i++) t.addLeaf(leaf(i))
    const proof = t.getProof(2)
    // flip the leaf we claim
    const tampered = leaf(2).slice()
    tampered[5] ^= 0x01
    expect(verifyProof(tampered, proof, t.root!)).toBe(false)
  })

  it('flipping a leaf changes the root', () => {
    const a = new IncrementalMerkleTree()
    for (let i = 0; i < 4; i++) a.addLeaf(leaf(i))
    const b = new IncrementalMerkleTree()
    for (let i = 0; i < 4; i++) {
      if (i === 2) {
        const tampered = leaf(2).slice()
        tampered[0] ^= 0x01
        b.addLeaf(tampered)
      } else {
        b.addLeaf(leaf(i))
      }
    }
    expect(toHex(a.root!)).not.toBe(toHex(b.root!))
  })

  it('throws on out-of-range proof index', () => {
    const t = new IncrementalMerkleTree()
    t.addLeaf(leaf(1))
    expect(() => t.getProof(1)).toThrow()
    expect(() => t.getProof(-1)).toThrow()
  })
})
