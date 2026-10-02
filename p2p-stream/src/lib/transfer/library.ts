/**
 * The device's recordings as seen by export, import and sync: footage in OPFS,
 * metadata in IndexedDB. Recordings that arrive from elsewhere are stored
 * exactly like local ones (chunk p in chunk-00000p.webm), so they play, verify
 * and travel onward the same way.
 */

import { useOPFS } from '../../composables/useOPFS'
import { getAllRecordings, getRecording, putRecording } from '../recordingDb'
import type { Recording, RecordingOrigin } from '../../types'
import { manifestFor, verifyEvidence, openSealedEvidence, type EvidenceManifest, type EvidenceCheck } from './evidence'
import type { Inbox, Outbox, OfferItem } from './syncProtocol'
import { openWithAvailableKeys } from '../seal/keys'
import { timestampFits } from '../timestamp/recordingStamp'

/** Drop a timestamp that does not belong to this recording's proof. */
async function keepFittingTimestamp(m: EvidenceManifest): Promise<EvidenceManifest> {
  if (!m.timestamp || (await timestampFits(m.proof, m.timestamp))) return m
  const { timestamp: _dropped, ...rest } = m
  return rest
}

function announceSaved(id: string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('undepressable:recording-saved', { detail: id }))
}

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

/**
 * Full integrity check of what is on disk against the signed proof. A sealed
 * recording is opened and checked footage and all when this device holds a
 * key for it right now; otherwise its encrypted chunks are checked.
 */
export async function verifyStored(rec: Recording, onProgress?: (done: number, total: number) => void): Promise<EvidenceCheck> {
  const manifest = manifestOf(rec)
  if (!manifest) return { valid: false, reason: 'No integrity proof was recorded', checkedChunks: 0 }
  const blobs = await chunkBlobs(rec)
  if (!blobs) return { valid: false, reason: 'Some of the footage is missing from this device', checkedChunks: 0 }
  const stored = new Blob(blobs)
  if (manifest.sealed) {
    const intact = await verifyEvidence(manifest, stored, onProgress)
    const key = intact.valid ? await openWithAvailableKeys(manifest.sealed.keys) : null
    if (!key) return intact
    try {
      const opened = await openSealedEvidence(manifest, stored, key)
      return verifyEvidence(opened.manifest, opened.video)
    } catch (e: any) {
      return { valid: false, reason: e?.message ?? 'could not be opened', checkedChunks: 0 }
    }
  }
  return verifyEvidence(manifest, stored, onProgress)
}

export type PlainFootage = { video: Blob } | { sealedFor: 'no-key' } | { missing: true }

/** The footage as a playable video — decrypted if sealed and a key is available. */
export async function footage(rec: Recording): Promise<PlainFootage> {
  const blobs = await chunkBlobs(rec)
  if (!blobs) return { missing: true }
  if (!rec.sealed) return { video: new Blob(blobs, { type: rec.metadata.codec }) }
  const manifest = manifestOf(rec)
  const key = await openWithAvailableKeys(rec.sealed.keys)
  if (!manifest || !key) return { sealedFor: 'no-key' }
  return { video: (await openSealedEvidence(manifest, new Blob(blobs), key)).video }
}

/** Plaintext evidence for a recording (opened if sealed and possible), or null. */
export async function plainEvidence(rec: Recording): Promise<{ manifest: EvidenceManifest; video: Blob } | null> {
  const manifest = manifestFor(rec)
  const blobs = manifest ? await chunkBlobs(rec) : null
  if (!manifest || !blobs) return null
  if (!manifest.sealed) return { manifest, video: new Blob(blobs, { type: rec.metadata.codec }) }
  const key = await openWithAvailableKeys(manifest.sealed.keys)
  return key ? openSealedEvidence(manifest, new Blob(blobs), key) : null
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
    ...(m.sealed ? { sealed: { v: 1 as const, keys: m.sealed.keys, proof: m.sealed.proof, ...(m.sealed.attestations ? { attestations: m.sealed.attestations } : {}) } } : {}),
    ...(m.timestamp ? { timestamp: m.timestamp } : {}),
    ...(m.attestations?.length ? { attestations: m.attestations } : {}),
    origin,
  }
}

async function writeAll(m: EvidenceManifest, video: Blob) {
  let offset = 0
  for (let p = 0; p < m.chunkSizes.length; p++) {
    const ok = await opfs.writeChunk(m.recording.campaignId, m.recording.id, p, video.slice(offset, offset + m.chunkSizes[p]))
    if (!ok) throw new Error('Could not store the footage on this device (storage full?)')
    offset += m.chunkSizes[p]
  }
}

/**
 * Sealed evidence that this device can open (a home archive's key, or an
 * unlocked passphrase key) is stored opened; anything else stays sealed.
 */
async function openIfPossible(m: EvidenceManifest, video: Blob): Promise<{ manifest: EvidenceManifest; video: Blob; opened: boolean }> {
  if (!m.sealed) return { manifest: m, video, opened: false }
  const key = await openWithAvailableKeys(m.sealed.keys)
  if (!key) return { manifest: m, video, opened: false }
  try {
    return { ...(await openSealedEvidence(m, video, key)), opened: true }
  } catch {
    return { manifest: m, video, opened: false }
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
  const o = await openIfPossible(await keepFittingTimestamp(m), video)
  await writeAll(o.manifest, o.video)
  const origin: RecordingOrigin = { kind: 'imported', at: new Date().toISOString(), verified: true, ...(o.opened ? { opened: true } : {}) }
  await putRecording(recordingFromManifest(o.manifest, origin, 'completed'))
  announceSaved(m.recording.id)
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
      // A sealed copy arrives encrypted (checked chunk by chunk against its
      // sealed proof). The home archive holds the key: open it here, check
      // the footage against its own proof, and keep it opened. A device
      // without a key keeps it sealed — a blind carrier.
      let final = await keepFittingTimestamp(m)
      let opened = false
      if (m.sealed) {
        const parts: Blob[] = []
        for (let p = 0; p < m.chunkSizes.length; p++) {
          const blob = await opfs.readChunk(m.recording.campaignId, m.recording.id, p)
          if (!blob) throw new Error('a received chunk went missing')
          parts.push(blob)
        }
        const o = await openIfPossible(final, new Blob(parts))
        if (o.opened) {
          await writeAll(o.manifest, o.video)
          final = o.manifest
          opened = true
        }
      }
      const origin: RecordingOrigin = { kind: 'synced', at: new Date().toISOString(), verified: true, ...(opened ? { opened: true } : {}) }
      await putRecording(recordingFromManifest(final, origin, 'completed'))
      announceSaved(m.recording.id)
    },
  }
}
