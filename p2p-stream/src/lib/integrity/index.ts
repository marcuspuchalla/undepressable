/**
 * Tamper-evidence / integrity module.
 *
 * Framework-agnostic primitives for proving a locally-recorded video was not
 * altered: hash each chunk, build a Merkle tree over the chunk hashes, sign the
 * root with an anonymous Ed25519 identity, and verify later.
 */

export { sha256, hashBlob, toHex, fromHex } from './hashing'

export { IncrementalMerkleTree, verifyProof as verifyMerkleProof, computeRoot } from './merkle'
export type { MerkleProof } from './merkle'

export {
  generateIdentity,
  derivePublicKey,
  signRoot,
  verifyRootSignature,
  publicKeyToHex,
  serializeIdentity,
  deserializeIdentity,
} from './identity'
export type { Identity, SerializedIdentity } from './identity'

export { buildProof, verifyProof } from './recordingProof'
export type { RecordingProof, VerificationResult } from './recordingProof'
