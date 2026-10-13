import { describe, it, expect } from 'vitest'
import {
  generateIdentity,
  signRoot,
  verifyRootSignature,
  serializeIdentity,
  deserializeIdentity,
  publicKeyToHex,
} from './identity'

const root = () => {
  const r = new Uint8Array(32)
  r.fill(0xa5)
  return r
}

describe('identity', () => {
  it('generates a 32-byte private key and 32-byte public key', () => {
    const id = generateIdentity()
    expect(id.privateKey).toBeInstanceOf(Uint8Array)
    expect(id.publicKey).toBeInstanceOf(Uint8Array)
    expect(id.privateKey.length).toBe(32)
    expect(id.publicKey.length).toBe(32)
  })

  it('generates distinct keys each call', () => {
    const a = generateIdentity()
    const b = generateIdentity()
    expect(publicKeyToHex(a.publicKey)).not.toBe(publicKeyToHex(b.publicKey))
  })

  it('signs a root and verifies with the matching public key', () => {
    const id = generateIdentity()
    const sig = signRoot(id.privateKey, root())
    expect(sig).toBeInstanceOf(Uint8Array)
    expect(sig.length).toBe(64)
    expect(verifyRootSignature(id.publicKey, root(), sig)).toBe(true)
  })

  it('rejects a signature verified with the wrong public key', () => {
    const signer = generateIdentity()
    const other = generateIdentity()
    const sig = signRoot(signer.privateKey, root())
    expect(verifyRootSignature(other.publicKey, root(), sig)).toBe(false)
  })

  it('rejects a signature over a tampered root', () => {
    const id = generateIdentity()
    const sig = signRoot(id.privateKey, root())
    const tampered = root()
    tampered[0] ^= 0x01
    expect(verifyRootSignature(id.publicKey, tampered, sig)).toBe(false)
  })

  it('rejects a malformed signature without throwing', () => {
    const id = generateIdentity()
    expect(verifyRootSignature(id.publicKey, root(), new Uint8Array([1, 2, 3]))).toBe(false)
  })

  it('serializes and deserializes an identity via hex, preserving signing ability', () => {
    const id = generateIdentity()
    const hex = serializeIdentity(id)
    expect(typeof hex.privateKey).toBe('string')
    expect(typeof hex.publicKey).toBe('string')

    const restored = deserializeIdentity(hex)
    expect(restored.privateKey).toEqual(id.privateKey)
    expect(restored.publicKey).toEqual(id.publicKey)

    const sig = signRoot(restored.privateKey, root())
    expect(verifyRootSignature(id.publicKey, root(), sig)).toBe(true)
  })
})
