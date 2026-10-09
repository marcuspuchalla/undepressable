import { describe, it, expect } from 'vitest'
import {
  generateSealKeyPair,
  newContentKey,
  sealContentKey,
  openContentKey,
  encryptChunk,
  decryptChunk,
  lockPrivateKey,
  unlockPrivateKey,
  CHUNK_OVERHEAD,
  sealJson,
  openJson,
} from './crypto'

const bytes = (s: string) => new TextEncoder().encode(s)

describe('sealed content keys', () => {
  it('each recipient opens the content key with its own private key, nobody else can', async () => {
    const home = generateSealKeyPair()
    const device = generateSealKeyPair()
    const stranger = generateSealKeyPair()
    const ck = newContentKey()
    const sealed = await sealContentKey(ck, [home.publicKey, device.publicKey])
    expect(sealed.length).toBe(2)
    expect(await openContentKey(sealed, home.privateKey)).toEqual(ck)
    expect(await openContentKey(sealed, device.privateKey)).toEqual(ck)
    expect(await openContentKey(sealed, stranger.privateKey)).toBeNull()
  })

  it('a tampered seal does not open', async () => {
    const home = generateSealKeyPair()
    const [s] = await sealContentKey(newContentKey(), [home.publicKey])
    const bad = { ...s, wrapped: (s.wrapped[0] === 'a' ? 'b' : 'a') + s.wrapped.slice(1) }
    expect(await openContentKey([bad], home.privateKey)).toBeNull()
    const otherEph = { ...s, eph: generateSealKeyPair().publicKey }
    expect(await openContentKey([otherEph], home.privateKey)).toBeNull()
  })

  it('the same recipient listed twice is sealed once', async () => {
    const home = generateSealKeyPair()
    expect((await sealContentKey(newContentKey(), [home.publicKey, home.publicKey.toUpperCase()])).length).toBe(1)
  })
})

describe('chunk encryption', () => {
  it('round-trips, adds a fixed overhead, and never repeats ciphertext for the same chunk', async () => {
    const ck = newContentKey()
    const plain = bytes('one second of video '.repeat(100))
    const a = await encryptChunk(ck, plain)
    const b = await encryptChunk(ck, plain)
    expect(a.length).toBe(plain.length + CHUNK_OVERHEAD)
    expect(a).not.toEqual(b) // fresh IV per chunk
    expect(await decryptChunk(ck, a)).toEqual(plain)
  })

  it('refuses a changed byte and a wrong key', async () => {
    const ck = newContentKey()
    const sealed = await encryptChunk(ck, bytes('evidence'))
    const changed = sealed.slice()
    changed[changed.length - 1] ^= 1
    await expect(decryptChunk(ck, changed)).rejects.toThrow()
    await expect(decryptChunk(newContentKey(), sealed)).rejects.toThrow()
  })
})

describe('sealed metadata', () => {
  it('round-trips JSON under the content key, and refuses another key', async () => {
    const ck = newContentKey()
    const value = { logs: [{ pk: 'ab'.repeat(32), a: [[1, 2, 'x', 'y']] }], note: 'Café ✓' }
    const sealed = await sealJson(ck, value)
    expect(sealed).not.toContain('ab'.repeat(8))
    expect(await openJson(ck, sealed)).toEqual(value)
    await expect(openJson(newContentKey(), sealed)).rejects.toThrow()
  })
})

describe('passphrase-locked device key', () => {
  it('opens with the right passphrase only', async () => {
    const pair = generateSealKeyPair()
    const locked = await lockPrivateKey(pair, 'correct horse battery staple', 1000)
    expect(locked.publicKey).toBe(pair.publicKey)
    expect(JSON.stringify(locked)).not.toContain(pair.privateKey)
    expect(await unlockPrivateKey(locked, 'correct horse battery staple')).toBe(pair.privateKey)
    expect(await unlockPrivateKey(locked, 'wrong')).toBeNull()
  })

  it('treats differently composed but equal Unicode passphrases alike', async () => {
    const pair = generateSealKeyPair()
    const locked = await lockPrivateKey(pair, 'Café', 1000)
    expect(await unlockPrivateKey(locked, 'Café')).toBe(pair.privateKey)
  })
})
