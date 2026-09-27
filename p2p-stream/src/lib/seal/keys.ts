/**
 * Who can open this device's sealed recordings, and which keys it holds.
 *
 *   policy                 what new recordings are sealed to (off by default)
 *   paired home seal key   the home archive's public key, learned from its
 *                          pairing link — "seal to home": only home can open
 *   device key             this device's own key pair, the private half kept
 *                          encrypted under a passphrase and unlocked for the
 *                          session only
 *   archive key            on a home archive: its key pair (it is the safe place)
 */

import {
  generateSealKeyPair,
  lockPrivateKey,
  unlockPrivateKey,
  openContentKey,
  type LockedKey,
  type SealKeyPair,
  type SealedKey,
} from './crypto'

const POLICY_KEY = 'undepressable_seal_policy'
const DEVICE_KEY = 'undepressable_device_seal'
const ARCHIVE_KEY = 'undepressable_archive_seal'
const PAIRED_HOME_SEAL = 'undepressable_paired_home_seal'

export interface SealPolicy {
  /** Seal new recordings to the paired home archive (this device then cannot open them). */
  toHome: boolean
  /** Seal new recordings to this device's passphrase key (open after unlocking). */
  passphrase: boolean
}

const HEX64 = /^[0-9a-f]{64}$/

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}
function read<T>(key: string): T | null {
  try {
    return JSON.parse(storage()?.getItem(key) ?? 'null') as T | null
  } catch {
    return null
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === null) storage()?.removeItem(key)
    else storage()?.setItem(key, JSON.stringify(value))
  } catch {
    /* storage blocked */
  }
}

export function getSealPolicy(): SealPolicy {
  const p = read<Partial<SealPolicy>>(POLICY_KEY)
  return { toHome: !!p?.toHome, passphrase: !!p?.passphrase }
}
export function setSealPolicy(policy: SealPolicy) {
  write(POLICY_KEY, policy)
}

// --- home archive side ---

/** This device's key as a home archive (created on first use). */
export function archiveKeyPair(): SealKeyPair {
  const existing = read<SealKeyPair>(ARCHIVE_KEY)
  if (existing && HEX64.test(existing.publicKey) && HEX64.test(existing.privateKey)) return existing
  const pair = generateSealKeyPair()
  write(ARCHIVE_KEY, pair)
  return pair
}
function archivePrivateKey(): string | null {
  const existing = read<SealKeyPair>(ARCHIVE_KEY)
  return existing && HEX64.test(existing.privateKey) ? existing.privateKey : null
}

// --- phone side: the paired home's public key ---

export function getPairedHomeSealKey(): string | null {
  const k = read<string>(PAIRED_HOME_SEAL)
  return typeof k === 'string' && HEX64.test(k) ? k : null
}
export function setPairedHomeSealKey(publicKey: string | null): boolean {
  if (publicKey === null) {
    write(PAIRED_HOME_SEAL, null)
    return true
  }
  const k = publicKey.trim().toLowerCase()
  if (!HEX64.test(k)) return false
  write(PAIRED_HOME_SEAL, k)
  return true
}

// --- device passphrase key ---

let unlocked: string | null = null

export function deviceKey(): LockedKey | null {
  const k = read<LockedKey>(DEVICE_KEY)
  return k && HEX64.test(k.publicKey) ? k : null
}
export function isDeviceUnlocked(): boolean {
  return unlocked !== null
}

/** Create this device's passphrase key (replaces none: call once). */
export async function setUpPassphrase(passphrase: string): Promise<void> {
  if (passphrase.length < 8) throw new Error('Use at least 8 characters.')
  const pair = generateSealKeyPair()
  write(DEVICE_KEY, await lockPrivateKey(pair, passphrase))
  unlocked = pair.privateKey
}

export async function unlockDevice(passphrase: string): Promise<boolean> {
  const k = deviceKey()
  if (!k) return false
  const priv = await unlockPrivateKey(k, passphrase)
  if (priv) unlocked = priv
  return priv !== null
}

export function lockDevice() {
  unlocked = null
}

/** Public keys new recordings are sealed to under the current policy (empty: not sealed). */
export function sealRecipients(policy: SealPolicy = getSealPolicy()): string[] {
  const out: string[] = []
  const home = getPairedHomeSealKey()
  if (policy.toHome && home) out.push(home)
  const dev = deviceKey()
  if (policy.passphrase && dev) out.push(dev.publicKey)
  return out
}

/** Open a recording's content key with any private key this device holds right now. */
export async function openWithAvailableKeys(sealed: SealedKey[]): Promise<Uint8Array | null> {
  for (const priv of [archivePrivateKey(), unlocked]) {
    if (!priv) continue
    const key = await openContentKey(sealed, priv)
    if (key) return key
  }
  return null
}

export type SealAudience = 'home' | 'passphrase' | 'both' | 'other'

/** Who a recording is sealed for, from this device's point of view. */
export function sealAudience(sealed: SealedKey[]): SealAudience {
  const to = new Set(sealed.map((s) => s.to))
  const home = getPairedHomeSealKey()
  const dev = deviceKey()?.publicKey
  const archive = read<SealKeyPair>(ARCHIVE_KEY)?.publicKey
  const forHome = (home && to.has(home)) || (archive && to.has(archive))
  const forDevice = dev && to.has(dev)
  return forHome && forDevice ? 'both' : forHome ? 'home' : forDevice ? 'passphrase' : 'other'
}
