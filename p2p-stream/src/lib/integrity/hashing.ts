/**
 * Hashing + hex helpers for the integrity module.
 *
 * SHA-256 uses the native Web Crypto API (`crypto.subtle.digest`), which is
 * available both in browsers and in Node 20+ via `globalThis.crypto`. This keeps
 * the module dependency-free and works unchanged under jsdom / node test envs.
 */

/** Convert bytes to a lowercase hex string. */
export function toHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0')
  }
  return out
}

/** Parse a hex string (optionally `0x`-prefixed, any case) into bytes. */
export function fromHex(hex: string): Uint8Array {
  let h = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
  if (h.length % 2 !== 0) {
    throw new Error(`Invalid hex string: odd length (${h.length})`)
  }
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) {
      throw new Error(`Invalid hex string: non-hex characters`)
    }
    out[i] = byte
  }
  return out
}

/** Compute the SHA-256 digest of the given bytes using Web Crypto. */
export async function sha256(data: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  const buffer =
    data instanceof Uint8Array
      ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      : data
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return new Uint8Array(digest)
}

/** Compute the SHA-256 digest of a Blob's contents (e.g. a recording chunk). */
export async function hashBlob(blob: Blob): Promise<Uint8Array> {
  const buffer = await blob.arrayBuffer()
  return sha256(buffer)
}
