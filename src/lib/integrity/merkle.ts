/**
 * Incremental Merkle tree over pre-computed leaf hashes.
 *
 * Design notes
 * ------------
 * - Leaves are the already-computed chunk hashes (SHA-256 of each recording
 *   chunk). The tree stores them as-is and only hashes when combining pairs.
 * - Internal nodes use domain separation: `SHA-256(0x01 || left || right)`.
 *   The 0x01 prefix distinguishes internal nodes from raw leaf material.
 * - Odd levels are handled with the standard **duplicate-last** rule: when a
 *   level has an odd number of nodes, the final node is paired with itself.
 * - Hashing here is synchronous (via `@noble/hashes/sha256`) so that root and
 *   proof computation are pure and synchronous given pre-computed leaf hashes.
 */

import { sha256 as nobleSha256 } from '@noble/hashes/sha256'

const INTERNAL_PREFIX = 0x01

/** A Merkle inclusion proof for a single leaf. */
export interface MerkleProof {
  /** Index of the leaf this proof is for. */
  index: number
  /** Total number of leaves in the tree the proof was generated against. */
  leafCount: number
  /** Sibling hashes from the leaf level up to (but excluding) the root. */
  siblings: Uint8Array[]
}

/** `SHA-256(0x01 || left || right)` — combine two child nodes. */
function hashInternal(left: Uint8Array, right: Uint8Array): Uint8Array {
  const combined = new Uint8Array(1 + left.length + right.length)
  combined[0] = INTERNAL_PREFIX
  combined.set(left, 1)
  combined.set(right, 1 + left.length)
  return nobleSha256(combined)
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** Build the next level up, duplicating the last node on an odd count. */
function nextLevel(level: Uint8Array[]): Uint8Array[] {
  const out: Uint8Array[] = []
  for (let i = 0; i < level.length; i += 2) {
    const left = level[i]
    const right = i + 1 < level.length ? level[i + 1] : level[i] // duplicate-last
    out.push(hashInternal(left, right))
  }
  return out
}

export class IncrementalMerkleTree {
  private leaves: Uint8Array[] = []

  /** Append a pre-computed leaf hash. */
  addLeaf(hash: Uint8Array): void {
    this.leaves.push(hash.slice())
  }

  /** Number of leaves currently in the tree. */
  get leafCount(): number {
    return this.leaves.length
  }

  /** Current Merkle root, or `null` if the tree is empty. */
  get root(): Uint8Array | null {
    if (this.leaves.length === 0) return null
    let level = this.leaves.map((l) => l.slice())
    while (level.length > 1) {
      level = nextLevel(level)
    }
    return level[0]
  }

  /** Read-only copy of the current leaves. */
  getLeaves(): Uint8Array[] {
    return this.leaves.map((l) => l.slice())
  }

  /** Generate an inclusion proof for the leaf at `index`. */
  getProof(index: number): MerkleProof {
    if (index < 0 || index >= this.leaves.length) {
      throw new Error(`Leaf index out of range: ${index} (leafCount=${this.leaves.length})`)
    }
    const siblings: Uint8Array[] = []
    let level = this.leaves.map((l) => l.slice())
    let idx = index
    while (level.length > 1) {
      const isRightNode = idx % 2 === 1
      const siblingIdx = isRightNode ? idx - 1 : idx + 1
      // duplicate-last: a lone right-most node is its own sibling
      const sibling = siblingIdx < level.length ? level[siblingIdx] : level[idx]
      siblings.push(sibling.slice())
      level = nextLevel(level)
      idx = Math.floor(idx / 2)
    }
    return { index, leafCount: this.leaves.length, siblings }
  }
}

/**
 * Verify a Merkle inclusion proof: recompute the root from `leaf` and the
 * proof's sibling path and compare it to the expected `root`.
 */
export function verifyProof(leaf: Uint8Array, proof: MerkleProof, root: Uint8Array): boolean {
  let hash = leaf.slice()
  let idx = proof.index
  for (const sibling of proof.siblings) {
    hash = idx % 2 === 0 ? hashInternal(hash, sibling) : hashInternal(sibling, hash)
    idx = Math.floor(idx / 2)
  }
  return equalBytes(hash, root)
}

/** Compute a Merkle root directly from a list of pre-computed leaf hashes. */
export function computeRoot(leaves: Uint8Array[]): Uint8Array | null {
  const tree = new IncrementalMerkleTree()
  for (const leaf of leaves) tree.addLeaf(leaf)
  return tree.root
}
