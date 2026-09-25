/**
 * The device's recordings as seen by export, import and sync: footage in OPFS,
 * metadata in IndexedDB. Recordings that arrive from elsewhere are stored
 * exactly like local ones (chunk p in chunk-00000p.webm), so they play, verify
 * and travel onward the same way.
 */

import { useOPFS } from '../../composables/useOPFS'
import { getAllRecordings, getRecording, putRecording } from '../recordingDb'
import type { Recording, RecordingOrigin } from '../../types'
import { manifestFor, verifyEvidence, type EvidenceManifest } from './evidence'
import type { Inbox, Outbox, OfferItem } from './syncProtocol'

const opfs = useOPFS()

const ordered = (rec: Recording) => [...rec.chunks].sort((a, b) => a.index - b.index)

/** Evidence for a recording regardless of its status (for partial arrivals). */
export function manifestOf(rec: Recording): EvidenceManifest | null {
  return manifestFor({ ...rec, status: 'completed' })
}

/** The recording's chunk files in order, or null if any is missing. */
export async function chunkBlobs(rec: Recording): Promise<Blob[] | null> {
  const out: Blob[] = []
  for (const c of ordered(rec)) {
    const blob = await opfs.readChunk(rec.campaignId, rec.id, c.index)
    if (!blob) return null
    out.push(blob)
  }
  return out
}

/** Full integrity check of what is on disk against the signed proof. */
export async function verifyStored(rec: Recording, onProgress?: (done: number, total: number) => void) {
  const manifest = manifestOf(rec)
  if (!manifest) return { valid: false, reason: 'No integrity proof was recorded', checkedChunks: 0 }
  const blobs = await chunkBlobs(rec)
  if (!blobs) return { valid: false, reason: 'Some of the footage is missing from this device', checkedChunks: 0 }
  return verifyEvidence(manifest, new Blob(blobs), onProgress)
}

/** The metadata record for footage described by evidence. */
export function recordingFromManifest(
  m: EvidenceManifest,
  origin: RecordingOrigin,
  status: Recording['status'],
): Recording {
  const r = m.recording
  return {
    id: r.id,
    campaignId: r.campaignId,
    recordedBy: `signer-${m.proof.pubKey.slice(0, 8)}`,
    startedAt: new Date(r.startedAt),
    ...(r.endedAt ? { endedAt: new Date(r.endedAt) } : {}),
    status,
    chunks: m.chunkSizes.map((size, p) => ({
      index: p,
      timestamp: new Date(r.startedAt),
      duration: 1000,
      size,
      opfsPath: `${r.campaignId}/${r.id}/chunk-${String(p).padStart(6, '0')}.webm`,
      checksum: m.proof.chunkHashes[p].slice(0, 16),
    })),
    metadata: { resolution: r.resolution, bitrate: r.bitrate, codec: r.mimeType },
    proof: m.proof,
    origin,
  }
}

export type ImportResult = 'imported' | 'exists'

/**
 * Store verified evidence (call verifyEvidence first). A recording this
 * device already holds completely is left alone.
 */
export async function importEvidence(m: EvidenceManifest, video: Blob): Promise<ImportResult> {
  const existing = await getRecording(m.recording.id)
  if (existing?.status === 'completed') return 'exists'
  let offset = 0
  for (let p = 0; p < m.chunkSizes.length; p++) {
    const ok = await opfs.writeChunk(m.recording.campaignId, m.recording.id, p, video.slice(offset, offset + m.chunkSizes[p]))
    if (!ok) throw new Error('Could not store the footage on this device (storage full?)')
    offset += m.chunkSizes[p]
  }
  await putRecording(recordingFromManifest(m, { kind: 'imported', at: new Date().toISOString(), verified: true }, 'completed'))
  return 'imported'
}

// --- delivery bookkeeping (sender side), per destination ---

const deliveredKey = (dest: string) => `undepressable_delivered_${dest}`

export function deliveredTo(dest: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(deliveredKey(dest)) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

function markDelivered(dest: string, id: string) {
  const all = deliveredTo(dest)
  all[id] = new Date().toISOString()
  try {
    localStorage.setItem(deliveredKey(dest), JSON.stringify(all))
  } catch {
    /* storage blocked: the receiver will answer "have" next time anyway */
  }
}

/** Signed, finished recordings on this device (its own, imported or received). */
export async function signedRecordings(): Promise<Recording[]> {
  return (await getAllRecordings()).filter((r) => manifestFor(r) !== null)
}

/**
 * What this device would send to `dest`: everything signed it has not
 * confirmed there. With `remember: false` (a face-to-face peer with no stable
 * identity) confirmations only last for this session.
 */
export function makeOutbox(dest: string, opts: { remember?: boolean } = {}): Outbox {
  const remember = opts.remember ?? true
  const sessionDone = new Set<string>()
  const cache = new Map<string, Recording>()
  async function rec(id: string) {
    if (!cache.has(id)) {
      const r = await getRecording(id)
      if (r) cache.set(id, r)
    }
    return cache.get(id) ?? null
  }
  return {
    async pending(): Promise<OfferItem[]> {
      const done = remember ? deliveredTo(dest) : {}
      return (await signedRecordings())
        .filter((r) => !done[r.id] && !sessionDone.has(r.id))
        .map((r) => ({
          id: r.id,
          root: r.proof!.merkleRoot,
          chunks: r.proof!.chunkCount,
          bytes: r.chunks.reduce((n, c) => n + c.size, 0),
        }))
    },
    async manifest(id) {
      const r = await rec(id)
      return r ? manifestFor(r) : null
    },
    async chunk(id, p) {
      const r = await rec(id)
      const c = r ? ordered(r)[p] : undefined
      const blob = r && c ? await opfs.readChunk(r.campaignId, r.id, c.index) : null
      return blob ? new Uint8Array(await blob.arrayBuffer()) : null
    },
    async delivered(id) {
      sessionDone.add(id)
      if (remember) markDelivered(dest, id)
    },
  }
}

/** Where recordings sent to this device land. */
export function makeInbox(): Inbox {
  return {
    async state(id) {
      const r = await getRecording(id)
      if (!r) return null
      const have = r.status === 'completed' ? [] : await opfs.listChunkIndexes(r.campaignId, r.id)
      return { complete: r.status === 'completed', have, manifest: manifestOf(r) }
    },
    async begin(m) {
      if (await getRecording(m.recording.id)) return
      await putRecording(recordingFromManifest(m, { kind: 'synced', at: new Date().toISOString(), verified: false }, 'receiving'))
    },
    async put(m, p, bytes) {
      const ok = await opfs.writeChunk(m.recording.campaignId, m.recording.id, p, new Blob([bytes]))
      if (!ok) throw new Error('storage write failed')
    },
    async complete(m) {
      await putRecording(recordingFromManifest(m, { kind: 'synced', at: new Date().toISOString(), verified: true }, 'completed'))
    },
  }
}
