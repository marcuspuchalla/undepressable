/**
 * Sealed recordings: footage encrypted as it is recorded, so a phone that is
 * taken does not give its recordings away.
 *
 * Each recording gets a random 256-bit content key; every chunk is encrypted
 * with it (AES-256-GCM, fresh 96-bit IV per chunk, stored as iv || ciphertext).
 * The content key is then sealed to one or more X25519 public keys — the home
 * archive's, and/or this device's passphrase key — the way age/HPKE do it: an
 * ephemeral key pair, X25519, HKDF-SHA256, AES-GCM around the content key.
 *
 * Recording needs only public keys. Opening needs a private key: the home
 * archive's (it never leaves home), or this device's, which is itself kept
 * encrypted under a passphrase (PBKDF2-SHA256, 600 000 rounds).
 *
 * Primitives: @noble/curves (X25519), @noble/hashes (HKDF), WebCrypto
 * (AES-GCM, PBKDF2). Nothing hand-rolled.
 */

import { x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { toHex, fromHex } from '../integrity/hashing'

export const SEAL_VERSION = 1
const INFO = new TextEncoder().encode('undepressable-seal-v1')
const IV_BYTES = 12
const TAG_BYTES = 16
export const CHUNK_OVERHEAD = IV_BYTES + TAG_BYTES
export const PBKDF2_ROUNDS = 600_000

export interface SealKeyPair {
  publicKey: string // hex
  privateKey: string // hex
}

/** The content key, wrapped for one recipient. */
export interface SealedKey {
  /** Recipient's X25519 public key (hex): tells which private key opens it. */
  to: string
  /** Ephemeral X25519 public key (hex). */
  eph: string
  iv: string
  wrapped: string
}

/** A private key encrypted under a passphrase. */
export interface LockedKey {
  publicKey: string
  salt: string
  iv: string
  ciphertext: string
  rounds: number
}

const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n))
// Copy into a fresh ArrayBuffer: WebCrypto rejects views over shared/offset buffers in some engines.
const buf = (u: Uint8Array): ArrayBuffer => u.slice().buffer

async function aesKey(raw: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', buf(raw), { name: 'AES-GCM' }, false, usage)
}

export function generateSealKeyPair(): SealKeyPair {
  const priv = x25519.utils.randomPrivateKey()
  return { privateKey: toHex(priv), publicKey: toHex(x25519.getPublicKey(priv)) }
}

export function publicKeyOf(privateKeyHex: string): string {
  return toHex(x25519.getPublicKey(fromHex(privateKeyHex)))
}

export function newContentKey(): Uint8Array {
  return rand(32)
}

function kek(shared: Uint8Array, eph: Uint8Array, to: Uint8Array): Uint8Array {
  const salt = new Uint8Array(eph.length + to.length)
  salt.set(eph)
  salt.set(to, eph.length)
  return hkdf(sha256, shared, salt, INFO, 32)
}

/** Wrap the content key for each recipient public key. */
export async function sealContentKey(contentKey: Uint8Array, recipients: string[]): Promise<SealedKey[]> {
  const out: SealedKey[] = []
  for (const to of new Set(recipients.map((r) => r.toLowerCase()))) {
    const ephPriv = x25519.utils.randomPrivateKey()
    const eph = x25519.getPublicKey(ephPriv)
    const toBytes = fromHex(to)
    const key = await aesKey(kek(x25519.getSharedSecret(ephPriv, toBytes), eph, toBytes), ['encrypt'])
    const iv = rand(IV_BYTES)
    const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv) }, key, buf(contentKey)))
    out.push({ to, eph: toHex(eph), iv: toHex(iv), wrapped: toHex(wrapped) })
  }
  return out
}

/** Open the content key with a private key, if one of the seals is for it. */
export async function openContentKey(sealed: SealedKey[], privateKeyHex: string): Promise<Uint8Array | null> {
  const priv = fromHex(privateKeyHex)
  const pub = toHex(x25519.getPublicKey(priv))
  const mine = sealed.find((s) => s.to.toLowerCase() === pub)
  if (!mine) return null
  try {
    const eph = fromHex(mine.eph)
    const key = await aesKey(kek(x25519.getSharedSecret(priv, eph), eph, fromHex(pub)), ['decrypt'])
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(fromHex(mine.iv)) }, key, buf(fromHex(mine.wrapped))))
  } catch {
    return null
  }
}

export async function encryptChunk(contentKey: Uint8Array, plain: Uint8Array): Promise<Uint8Array> {
  const iv = rand(IV_BYTES)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv) }, await aesKey(contentKey, ['encrypt']), buf(plain)))
  const out = new Uint8Array(IV_BYTES + ct.length)
  out.set(iv)
  out.set(ct, IV_BYTES)
  return out
}

/** Decrypt one chunk; throws if the key is wrong or the bytes were changed. */
export async function decryptChunk(contentKey: Uint8Array, sealed: Uint8Array): Promise<Uint8Array> {
  if (sealed.length < CHUNK_OVERHEAD) throw new Error('sealed chunk too short')
  const iv = sealed.slice(0, IV_BYTES)
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(iv) }, await aesKey(contentKey, ['decrypt']), buf(sealed.slice(IV_BYTES))))
}

async function passphraseKey(passphrase: string, salt: Uint8Array, rounds: number, usage: KeyUsage[]): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', buf(new TextEncoder().encode(passphrase.normalize('NFC'))), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: buf(salt), iterations: rounds }, base, { name: 'AES-GCM', length: 256 }, false, usage)
}

/** Encrypt a private key under a passphrase. */
export async function lockPrivateKey(pair: SealKeyPair, passphrase: string, rounds = PBKDF2_ROUNDS): Promise<LockedKey> {
  const salt = rand(16)
  const iv = rand(IV_BYTES)
  const key = await passphraseKey(passphrase, salt, rounds, ['encrypt'])
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv) }, key, buf(fromHex(pair.privateKey))))
  return { publicKey: pair.publicKey, salt: toHex(salt), iv: toHex(iv), ciphertext: toHex(ct), rounds }
}

/** The private key, or null for a wrong passphrase. */
export async function unlockPrivateKey(locked: LockedKey, passphrase: string): Promise<string | null> {
  try {
    const key = await passphraseKey(passphrase, fromHex(locked.salt), locked.rounds, ['decrypt'])
    const priv = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(fromHex(locked.iv)) }, key, buf(fromHex(locked.ciphertext))))
    const hex = toHex(priv)
    return publicKeyOf(hex) === locked.publicKey ? hex : null
  } catch {
    return null
  }
}
