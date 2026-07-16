import { describe, it, expect } from 'vitest'
import { sha256, hashBlob, toHex, fromHex } from './hashing'

// Known SHA-256 vectors (NIST / RFC 6234)
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

const enc = new TextEncoder()

describe('toHex / fromHex', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 127, 128, 255])
    expect(toHex(bytes)).toBe('00010f107f80ff')
    expect(fromHex(toHex(bytes))).toEqual(bytes)
  })

  it('produces lowercase, zero-padded hex', () => {
    expect(toHex(new Uint8Array([0, 10, 255]))).toBe('000aff')
  })

  it('accepts 0x-prefixed and mixed-case input', () => {
    expect(fromHex('0xAB')).toEqual(new Uint8Array([0xab]))
    expect(fromHex('Ab')).toEqual(new Uint8Array([0xab]))
  })

  it('throws on odd-length hex', () => {
    expect(() => fromHex('abc')).toThrow()
  })
})

describe('sha256', () => {
  it('hashes the empty input to the known vector', async () => {
    const out = await sha256(new Uint8Array(0))
    expect(toHex(out)).toBe(EMPTY_SHA256)
    expect(out).toBeInstanceOf(Uint8Array)
    expect(out.length).toBe(32)
  })

  it('hashes "abc" to the known vector', async () => {
    const out = await sha256(enc.encode('abc'))
    expect(toHex(out)).toBe(ABC_SHA256)
  })

  it('accepts an ArrayBuffer as well as a Uint8Array', async () => {
    const u8 = enc.encode('abc')
    const fromView = await sha256(u8)
    const fromBuffer = await sha256(u8.buffer)
    expect(toHex(fromView)).toBe(toHex(fromBuffer))
  })

  it('is deterministic', async () => {
    const a = await sha256(enc.encode('determinism'))
    const b = await sha256(enc.encode('determinism'))
    expect(toHex(a)).toBe(toHex(b))
  })
})

describe('hashBlob', () => {
  it('hashes blob contents to the same value as sha256 of the bytes', async () => {
    const blob = new Blob([enc.encode('abc')])
    const out = await hashBlob(blob)
    expect(toHex(out)).toBe(ABC_SHA256)
  })
})
