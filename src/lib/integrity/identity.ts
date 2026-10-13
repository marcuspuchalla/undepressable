/**
 * Anonymous Ed25519 signing identity for recordings.
 *
 * Ed25519 is a standard, compact (32-byte keys, 64-byte signatures) signature
 * scheme. Keys carry no PII — they are random and anonymous. Used to sign a
 * recording's Merkle root so a recording's authenticity can be checked later.
 */

import { ed25519 } from '@noble/curves/ed25519'
import { toHex, fromHex } from './hashing'

/** A raw Ed25519 keypair. */
export interface Identity {
  privateKey: Uint8Array // 32 bytes
  publicKey: Uint8Array // 32 bytes
}

/** Hex-encoded form of an {@link Identity}, safe to persist as JSON. */
export interface SerializedIdentity {
  privateKey: string
  publicKey: string
}

/** Generate a fresh random Ed25519 identity. */
export function generateIdentity(): Identity {
  const privateKey = ed25519.utils.randomPrivateKey()
  const publicKey = ed25519.getPublicKey(privateKey)
  return { privateKey, publicKey }
}

/** Derive the public key for a given private key. */
export function derivePublicKey(privateKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(privateKey)
}

/** Sign a Merkle root (or any 32-byte digest) with the private key. */
export function signRoot(privateKey: Uint8Array, root: Uint8Array): Uint8Array {
  return ed25519.sign(root, privateKey)
}

/** Verify an Ed25519 signature over a root. Returns false on any malformed input. */
export function verifyRootSignature(
  publicKey: Uint8Array,
  root: Uint8Array,
  signature: Uint8Array,
): boolean {
  try {
    return ed25519.verify(signature, root, publicKey)
  } catch {
    return false
  }
}

/** Hex-encode a public key. */
export function publicKeyToHex(publicKey: Uint8Array): string {
  return toHex(publicKey)
}

/** Serialize an identity to hex strings. */
export function serializeIdentity(identity: Identity): SerializedIdentity {
  return {
    privateKey: toHex(identity.privateKey),
    publicKey: toHex(identity.publicKey),
  }
}

/** Restore an identity from its hex serialization. */
export function deserializeIdentity(serialized: SerializedIdentity): Identity {
  return {
    privateKey: fromHex(serialized.privateKey),
    publicKey: fromHex(serialized.publicKey),
  }
}
