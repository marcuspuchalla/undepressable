/**
 * Signed releases: can this copy of the app trust the update a website offers?
 *
 * Whoever controls the website controls what an installed web app becomes on
 * its next update — after a domain seizure or a hacked server, that is not us.
 * A browser gives a page no way to veto a new service worker, but the copy
 * that is running now can still check the update before offering it: every
 * release publishes `release.json` (each file's SHA-256 and a fingerprint over
 * all of them) and `release.sig`, an Ed25519 signature by a developer key that
 * the running copy already carries. An update that is unsigned, or signed by
 * any other key, is reported as a warning instead of offered.
 */

import { ed25519 } from '@noble/curves/ed25519'
import { sha256, toHex, fromHex } from '../integrity/hashing'

export const RELEASE_FORMAT = 'undepressable-release'

export interface ReleaseManifest {
  format: typeof RELEASE_FORMAT
  /** Build identifier (version + commit + time), also compiled into the app. */
  build: string
  builtAt: string
  /** Path (relative to the app root) → SHA-256 hex, for every file shipped. */
  files: Record<string, string>
  /** SHA-256 over the sorted "path hash" lines: one value to compare out of band. */
  fingerprint: string
}

export interface TrustedKey {
  /** Short label shown to people ("maintainer 2026"). */
  id: string
  /** Ed25519 public key, hex. */
  publicKey: string
}

export type ReleaseStatus =
  /** Signed by a key this copy trusts. */
  | 'signed'
  /** This copy carries no release keys (a self-built or development copy): nothing to check against. */
  | 'unverifiable'
  /** This copy expects signed releases; the update has no signature. */
  | 'unsigned'
  /** A signature is present but no trusted key made it, or the manifest was changed after signing. */
  | 'forged'
  /** No readable release manifest at all. */
  | 'missing'

export interface ReleaseCheck {
  status: ReleaseStatus
  manifest: ReleaseManifest | null
  keyId?: string
}

const HEX64 = /^[0-9a-f]{64}$/

export async function fingerprintOf(files: Record<string, string>): Promise<string> {
  const lines = Object.keys(files)
    .sort()
    .map((path) => `${path} ${files[path]}\n`)
    .join('')
  return toHex(await sha256(new TextEncoder().encode(lines)))
}

/** Parse and check a manifest's shape and that its fingerprint matches its file list. */
export async function parseRelease(text: string): Promise<ReleaseManifest | null> {
  let m: any
  try {
    m = JSON.parse(text)
  } catch {
    return null
  }
  if (!m || m.format !== RELEASE_FORMAT || typeof m.build !== 'string' || typeof m.builtAt !== 'string') return null
  if (!m.files || typeof m.files !== 'object') return null
  for (const [path, hash] of Object.entries(m.files)) {
    if (typeof path !== 'string' || typeof hash !== 'string' || !HEX64.test(hash)) return null
  }
  if (typeof m.fingerprint !== 'string' || m.fingerprint !== (await fingerprintOf(m.files))) return null
  return m as ReleaseManifest
}

/**
 * Check a release manifest (exact bytes as served) and its signature (hex, or
 * null when none was served) against the keys this copy trusts.
 */
export async function checkRelease(
  manifestText: string | null,
  signatureHex: string | null,
  trusted: TrustedKey[],
): Promise<ReleaseCheck> {
  const manifest = manifestText === null ? null : await parseRelease(manifestText)
  if (!manifest) return { status: 'missing', manifest: null }
  if (trusted.length === 0) return { status: 'unverifiable', manifest }
  const sig = signatureHex?.trim().toLowerCase() ?? ''
  if (!sig) return { status: 'unsigned', manifest }
  let sigBytes: Uint8Array
  try {
    sigBytes = fromHex(sig)
  } catch {
    return { status: 'forged', manifest }
  }
  const message = new TextEncoder().encode(manifestText!)
  for (const key of trusted) {
    try {
      if (ed25519.verify(sigBytes, message, fromHex(key.publicKey))) return { status: 'signed', manifest, keyId: key.id }
    } catch {
      /* malformed key or signature: try the next key */
    }
  }
  return { status: 'forged', manifest }
}

/** "a1b2 c3d4 e5f6 …" — the first 16 hex digits, for reading aloud or comparing. */
export function shortFingerprint(fp: string): string {
  return fp.slice(0, 16).replace(/(.{4})(?=.)/g, '$1 ')
}

/** Sign manifest text (used by the release script; exported for tests). */
export function signRelease(manifestText: string, privateKeyHex: string): string {
  return toHex(ed25519.sign(new TextEncoder().encode(manifestText), fromHex(privateKeyHex)))
}
