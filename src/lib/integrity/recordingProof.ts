/**
 * High-level tamper-evidence glue.
 *
 * A {@link RecordingProof} captures everything needed to later prove a recording
 * was not altered: the ordered per-chunk hashes, the Merkle root over them, and
 * an Ed25519 signature of that root by an anonymous identity.
 *
 * Verification recomputes the Merkle root from the stored chunk hashes, checks
 * it matches the recorded root, and verifies the signature over that root.
 */

import { fromHex, toHex } from './hashing'
import { computeRoot } from './merkle'
import { verifyRootSignature, signRoot, publicKeyToHex, type Identity } from './identity'

/** A portable, JSON-serializable integrity proof for one recording. */
export interface RecordingProof {
  recordingId: string
  /** Ordered hex SHA-256 hashes, one per recorded chunk. */
  chunkHashes: string[]
  /** Hex Merkle root over `chunkHashes`. */
  merkleRoot: string
  /** Hex Ed25519 public key of the signer. */
  pubKey: string
  /** Hex Ed25519 signature over the Merkle root bytes. */
  signature: string
  /** Unix epoch milliseconds when the proof was built. */
  createdAt: number
  /** Number of chunks (must equal `chunkHashes.length`). */
  chunkCount: number
}

/** Result of verifying a {@link RecordingProof}. */
export interface VerificationResult {
  valid: boolean
  reason?: string
}

/**
 * Build a signed integrity proof from a recording's ordered chunk hashes.
 *
 * @param recordingId Stable id of the recording.
 * @param chunkHashes Ordered hex SHA-256 hashes, one per chunk (non-empty).
 * @param identity    Ed25519 identity used to sign the Merkle root.
 */
export function buildProof(
  recordingId: string,
  chunkHashes: string[],
  identity: Identity,
): RecordingProof {
  if (chunkHashes.length === 0) {
    throw new Error('Cannot build a proof for an empty recording (no chunk hashes)')
  }

  const root = computeRoot(chunkHashes.map((h) => fromHex(h)))
  if (root === null) {
    throw new Error('Failed to compute Merkle root')
  }

  const signature = signRoot(identity.privateKey, root)

  return {
    recordingId,
    chunkHashes: [...chunkHashes],
    merkleRoot: toHex(root),
    pubKey: publicKeyToHex(identity.publicKey),
    signature: toHex(signature),
    createdAt: Date.now(),
    chunkCount: chunkHashes.length,
  }
}

/**
 * Verify a {@link RecordingProof}: chunk-count consistency, Merkle-root match
 * (recomputed from `chunkHashes`), and signature validity over the root.
 */
export function verifyProof(proof: RecordingProof): VerificationResult {
  if (proof.chunkCount !== proof.chunkHashes.length) {
    return {
      valid: false,
      reason: `Chunk count mismatch: chunkCount=${proof.chunkCount}, chunkHashes.length=${proof.chunkHashes.length}`,
    }
  }

  if (proof.chunkHashes.length === 0) {
    return { valid: false, reason: 'No chunk hashes to verify' }
  }

  let recomputedRoot: Uint8Array | null
  try {
    recomputedRoot = computeRoot(proof.chunkHashes.map((h) => fromHex(h)))
  } catch {
    return { valid: false, reason: 'Malformed chunk hash (not valid hex)' }
  }
  if (recomputedRoot === null) {
    return { valid: false, reason: 'Failed to recompute Merkle root' }
  }

  if (toHex(recomputedRoot) !== proof.merkleRoot) {
    return {
      valid: false,
      reason: 'Merkle root mismatch: chunk hashes do not reproduce the recorded root',
    }
  }

  let pubKey: Uint8Array
  let signature: Uint8Array
  try {
    pubKey = fromHex(proof.pubKey)
    signature = fromHex(proof.signature)
  } catch {
    return { valid: false, reason: 'Malformed public key or signature hex' }
  }

  if (!verifyRootSignature(pubKey, recomputedRoot, signature)) {
    return { valid: false, reason: 'Invalid signature over Merkle root' }
  }

  return { valid: true }
}
