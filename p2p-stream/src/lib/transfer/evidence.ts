/**
 * Evidence files: one recording plus everything needed to prove it unaltered,
 * in a form that survives any way of carrying it — AirDrop, Quick Share,
 * Bluetooth, a USB stick, a messenger, e-mail.
 *
 * Two shapes, same content:
 *   * a bundle, `<name>.zip` (stored, not compressed): the playable video,
 *     `evidence.json` and a README. One file to pass around.
 *   * a pair, `<name>.webm` + `<name>.evidence.txt`: for share sheets that
 *     refuse .zip files (Chrome's Web Share only accepts media, text, PDF).
 *
 * The evidence carries the size of every recorded chunk, so a receiver can cut
 * the video back into the exact pieces that were hashed and signed, and check
 * each one against the proof — no trust in whoever carried the file.
 */

import type { Recording } from '../../types'
import { sha256, toHex, verifyProof, type RecordingProof } from '../integrity'

export const EVIDENCE_FORMAT = 'undepressable-evidence'

export interface EvidenceManifest {
  format: typeof EVIDENCE_FORMAT
  version: 1
  recording: {
    id: string
    campaignId: string
    startedAt: string
    endedAt?: string
    mimeType: string
    resolution: { width: number; height: number }
    bitrate: number
  }
  /** Byte length of each recorded chunk, in order: the video is their concatenation. */
  chunkSizes: number[]
  proof: RecordingProof
}

export interface EvidenceCheck {
  valid: boolean
  reason?: string
  /** Chunks whose bytes matched the signed hashes. */
  checkedChunks: number
}

/** The evidence for a finished, signed recording (null when it has no proof). */
export function manifestFor(recording: Recording): EvidenceManifest | null {
  if (!recording.proof || recording.status !== 'completed') return null
  const chunks = [...recording.chunks].sort((a, b) => a.index - b.index)
  if (chunks.length !== recording.proof.chunkCount) return null
  return {
    format: EVIDENCE_FORMAT,
    version: 1,
    recording: {
      id: recording.id,
      campaignId: recording.campaignId,
      startedAt: recording.startedAt.toISOString(),
      ...(recording.endedAt ? { endedAt: recording.endedAt.toISOString() } : {}),
      mimeType: recording.metadata.codec,
      resolution: recording.metadata.resolution,
      bitrate: recording.metadata.bitrate,
    },
    chunkSizes: chunks.map((c) => c.size),
    proof: recording.proof,
  }
}

const HEX64 = /^[0-9a-f]{64}$/

/** Parse and shape-check evidence JSON; null if it is not ours or malformed. */
export function parseManifest(text: string): EvidenceManifest | null {
  let m: any
  try {
    m = JSON.parse(text)
  } catch {
    return null
  }
  if (!m || m.format !== EVIDENCE_FORMAT || m.version !== 1) return null
  const r = m.recording
  const p = m.proof
  if (!r || typeof r.id !== 'string' || typeof r.campaignId !== 'string' || typeof r.startedAt !== 'string') return null
  if (typeof r.mimeType !== 'string' || !r.resolution || typeof r.bitrate !== 'number') return null
  if (!Array.isArray(m.chunkSizes) || !m.chunkSizes.every((n: unknown) => Number.isInteger(n) && (n as number) > 0)) return null
  if (!p || !Array.isArray(p.chunkHashes) || !p.chunkHashes.every((h: unknown) => typeof h === 'string' && HEX64.test(h))) return null
  if (typeof p.merkleRoot !== 'string' || typeof p.pubKey !== 'string' || typeof p.signature !== 'string') return null
  return m as EvidenceManifest
}

/** Check a video against its evidence, chunk by chunk. */
export async function verifyEvidence(
  manifest: EvidenceManifest,
  video: Blob,
  onProgress?: (done: number, total: number) => void,
): Promise<EvidenceCheck> {
  const { proof, chunkSizes } = manifest
  const fail = (reason: string, checkedChunks = 0): EvidenceCheck => ({ valid: false, reason, checkedChunks })
  if (proof.recordingId !== manifest.recording.id) return fail('The proof belongs to a different recording')
  if (chunkSizes.length !== proof.chunkHashes.length) return fail('The evidence lists a different number of chunks than the proof')
  const signed = verifyProof(proof)
  if (!signed.valid) return fail(signed.reason ?? 'Invalid proof')
  const total = chunkSizes.reduce((a, b) => a + b, 0)
  if (total !== video.size) {
    return fail(video.size < total ? 'The video is shorter than what was signed — incomplete or cut' : 'The video has more data than what was signed')
  }
  let offset = 0
  for (let i = 0; i < chunkSizes.length; i++) {
    const bytes = new Uint8Array(await video.slice(offset, offset + chunkSizes[i]).arrayBuffer())
    if (toHex(await sha256(bytes)) !== proof.chunkHashes[i]) {
      return fail(`Second ${i + 1} of the video does not match what was signed — it was altered`, i)
    }
    offset += chunkSizes[i]
    onProgress?.(i + 1, chunkSizes.length)
  }
  return { valid: true, checkedChunks: chunkSizes.length }
}

// --- names ---

function stamp(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}
export function baseName(manifest: EvidenceManifest): string {
  return `undepressable_${stamp(manifest.recording.startedAt)}_${manifest.recording.id.slice(0, 8)}`
}
export const videoName = (m: EvidenceManifest) => `${baseName(m)}.webm`
export const evidenceTxtName = (m: EvidenceManifest) => `${baseName(m)}.evidence.txt`
export const bundleName = (m: EvidenceManifest) => `${baseName(m)}.zip`

export const README = `UNDEPRESSABLE EVIDENCE BUNDLE

The .webm file is the recording — it plays in VLC, Firefox or Chrome.

evidence.json proves the video was not altered after it was recorded:
the video was saved as a sequence of chunks (sizes in "chunkSizes"), each
chunk's SHA-256 hash is in proof.chunkHashes, the Merkle root over those
hashes is proof.merkleRoot, and proof.signature is an Ed25519 signature of
that root by the recording device's anonymous key (proof.pubKey).

To check it: open Undepressable → Recordings → Import, and choose this
.zip (or the .webm together with its evidence file). Every chunk is
re-hashed and compared; nothing is uploaded anywhere.

To check it without the app: cut the .webm into pieces of the listed sizes,
SHA-256 each piece and compare with proof.chunkHashes; rebuild the Merkle
root (each parent = SHA-256(0x01 || left || right) over the raw 32-byte
hashes; on a level with an odd count the last node is paired with itself;
a single chunk's hash is itself the root) and verify proof.signature over
the root bytes with any Ed25519 library.
`

// --- ZIP (stored entries only; no compression, no dependencies) ---

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crcUpdate(crc: number, bytes: Uint8Array): number {
  let c = crc
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return c
}

const ZIP_LIMIT = 0xfffffffe // no ZIP64: a bundle holds up to ~4 GB (hours of video)

function dosDateTime(d: Date): { date: number; time: number } {
  const year = Math.max(1980, d.getFullYear())
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
  }
}

interface ZipEntry {
  name: string
  parts: Blob[]
}

/** Build a stored ZIP. Parts are referenced, not copied, so large videos stay on disk. */
export async function buildZip(entries: ZipEntry[], when = new Date()): Promise<Blob> {
  const { date, time } = dosDateTime(when)
  const out: BlobPart[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name)
    let crc = 0xffffffff
    let size = 0
    for (const part of entry.parts) {
      const bytes = new Uint8Array(await part.arrayBuffer())
      crc = crcUpdate(crc, bytes)
      size += bytes.length
    }
    crc = (crc ^ 0xffffffff) >>> 0
    if (size > ZIP_LIMIT || offset > ZIP_LIMIT) throw new Error('too large for a single bundle')

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true) // UTF-8 names
    local.setUint16(8, 0, true) // stored
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, size, true)
    local.setUint32(22, size, true)
    local.setUint16(26, name.length, true)
    out.push(local.buffer, name, ...entry.parts)

    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x0800, true)
    c.setUint16(10, 0, true)
    c.setUint16(12, time, true)
    c.setUint16(14, date, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, size, true)
    c.setUint32(24, size, true)
    c.setUint16(28, name.length, true)
    c.setUint32(42, offset, true)
    central.push(new Uint8Array(c.buffer), name)
    offset += 30 + name.length + size
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)
  return new Blob([...out, ...central, end.buffer], { type: 'application/zip' })
}

export interface ZipFileEntry {
  name: string
  /** The entry's bytes as a slice of the archive (no copy). */
  blob: Blob
  stored: boolean
}

/** List a ZIP's entries. Only stored entries can be read back; others are flagged. */
export async function readZip(zip: Blob): Promise<ZipFileEntry[] | null> {
  const tailLen = Math.min(zip.size, 22 + 0xffff)
  const tail = new DataView(await zip.slice(zip.size - tailLen).arrayBuffer())
  let eocd = -1
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return null
  const count = tail.getUint16(eocd + 10, true)
  const cdSize = tail.getUint32(eocd + 12, true)
  const cdOffset = tail.getUint32(eocd + 16, true)
  if (cdOffset + cdSize > zip.size) return null
  const cd = new DataView(await zip.slice(cdOffset, cdOffset + cdSize).arrayBuffer())
  const entries: ZipFileEntry[] = []
  let p = 0
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== 0x02014b50) return null
    const method = cd.getUint16(p + 10, true)
    const compSize = cd.getUint32(p + 20, true)
    const nameLen = cd.getUint16(p + 28, true)
    const extraLen = cd.getUint16(p + 30, true)
    const commentLen = cd.getUint16(p + 32, true)
    const localOffset = cd.getUint32(p + 42, true)
    const name = new TextDecoder().decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen))
    p += 46 + nameLen + extraLen + commentLen
    const local = new DataView(await zip.slice(localOffset, localOffset + 30).arrayBuffer())
    if (local.byteLength < 30 || local.getUint32(0, true) !== 0x04034b50) return null
    const dataStart = localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true)
    entries.push({ name, blob: zip.slice(dataStart, dataStart + compSize), stored: method === 0 })
  }
  return entries
}

/** The bundle for a recording, given its chunk blobs in order. */
export function buildBundle(manifest: EvidenceManifest, chunks: Blob[]): Promise<Blob> {
  const json = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })
  return buildZip(
    [
      { name: videoName(manifest), parts: chunks },
      { name: 'evidence.json', parts: [json] },
      { name: 'README.txt', parts: [new Blob([README])] },
    ],
    new Date(manifest.recording.startedAt),
  )
}

export type EvidenceInput =
  | { ok: true; manifest: EvidenceManifest; video: Blob }
  | { ok: false; reason: string }

async function looksLikeZip(file: Blob): Promise<boolean> {
  if (file.size < 22) return false
  const head = new DataView(await file.slice(0, 4).arrayBuffer())
  return head.getUint32(0, true) === 0x04034b50
}

async function manifestIn(file: Blob): Promise<EvidenceManifest | null> {
  if (file.size > 16 * 1024 * 1024) return null // evidence is small; never read a video as text
  return parseManifest(await file.text())
}

/**
 * Work out what the user picked: a bundle, or a video plus its evidence file
 * (in either order, with whatever names the share sheet gave them).
 */
export async function readEvidenceInput(files: Blob[]): Promise<EvidenceInput> {
  if (files.length === 0) return { ok: false, reason: 'No file chosen' }
  let manifest: EvidenceManifest | null = null
  let video: Blob | null = null
  for (const file of files) {
    if (await looksLikeZip(file)) {
      const entries = await readZip(file)
      if (!entries) return { ok: false, reason: 'This .zip file is damaged' }
      const ev = entries.find((e) => /(^|\/)evidence\.json$/.test(e.name))
      const vid = entries.find((e) => /\.webm$/i.test(e.name))
      if (!ev || !vid) return { ok: false, reason: 'This .zip is not an evidence bundle' }
      if (!ev.stored || !vid.stored) {
        return { ok: false, reason: 'This .zip was re-compressed. Unzip it and import the video and evidence.json together.' }
      }
      manifest = await manifestIn(ev.blob)
      video = vid.blob
      if (!manifest) return { ok: false, reason: 'The evidence inside the bundle is damaged' }
      continue
    }
    const m = await manifestIn(file)
    if (m) manifest = m
    else video = file
  }
  if (!manifest) return { ok: false, reason: 'No evidence file — choose the video together with its .evidence file (or the .zip bundle)' }
  if (!video) return { ok: false, reason: 'Evidence found, but no video — choose both files together' }
  return { ok: true, manifest, video }
}
