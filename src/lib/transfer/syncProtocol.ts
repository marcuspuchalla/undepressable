/**
 * Store-and-forward of finished recordings to a safe device.
 *
 * The live forward to a home archive only carries what the connection manages
 * to deliver while filming; a flaky uplink leaves gaps, and footage recorded
 * with no connection at all never gets there. This moves the phone's own
 * signed recordings afterwards, whenever the two devices can talk — over the
 * internet (Trystero) or face to face (an offline pairing link).
 *
 * The receiver trusts nothing it is sent: the proof's signature must verify
 * before anything is stored, and every chunk must hash to the value the proof
 * signed, so the copy that lands is bit-for-bit the recording that was signed.
 * Transfers resume: the receiver asks only for chunks it does not have yet.
 *
 *   sender                         receiver
 *     offer [{id, root, n, bytes}] →
 *                                  ← want {id, manifest?, need: ranges}   (or `have` if complete)
 *     manifest {id, manifest}      →   (verify signature → begin)
 *     chunk (id, p, bytes) × need  →   (hash must match → store)
 *     sent {id}                    →
 *                                  ← have {id}   (or `want` for what is still missing)
 */

import { verifyProof } from '../integrity'
import { sha256, toHex } from '../integrity'
import { parseManifest, type EvidenceManifest } from './evidence'

export interface OfferItem {
  id: string
  /** Merkle root: two different recordings never share it. */
  root: string
  chunks: number
  bytes: number
}

/** Half-open chunk ranges [start, end). */
export type Range = [number, number]

export type SyncMsg =
  | { t: 'offer'; items: OfferItem[] }
  | { t: 'want'; id: string; manifest: boolean; need: Range[] }
  | { t: 'have'; id: string }
  | { t: 'manifest'; id: string; manifest: EvidenceManifest }
  | { t: 'sent'; id: string }
  | { t: 'refuse'; id: string; reason: string }

export interface SyncWire {
  send(msg: SyncMsg, peer: string): void | Promise<void>
  sendChunk(id: string, p: number, bytes: Uint8Array, peer: string): Promise<void>
}

export function isSyncMsg(x: unknown): x is SyncMsg {
  if (!x || typeof x !== 'object') return false
  const m = x as any
  switch (m.t) {
    case 'offer':
      return Array.isArray(m.items) && m.items.length <= 1000 && m.items.every(isOfferItem)
    case 'want':
      return typeof m.id === 'string' && typeof m.manifest === 'boolean' && Array.isArray(m.need) && m.need.every(isRange)
    case 'have':
    case 'sent':
      return typeof m.id === 'string'
    case 'manifest':
      return typeof m.id === 'string' && typeof m.manifest === 'object'
    case 'refuse':
      return typeof m.id === 'string' && typeof m.reason === 'string'
    default:
      return false
  }
}
function isOfferItem(i: any): i is OfferItem {
  return !!i && typeof i.id === 'string' && typeof i.root === 'string' && Number.isInteger(i.chunks) && i.chunks > 0 && Number.isInteger(i.bytes)
}
function isRange(r: any): r is Range {
  return Array.isArray(r) && r.length === 2 && Number.isInteger(r[0]) && Number.isInteger(r[1]) && r[0] >= 0 && r[1] > r[0]
}

/** Collapse sorted-or-not indexes missing from `have` in [0, total) into ranges. */
export function missingRanges(have: Iterable<number>, total: number): Range[] {
  const got = new Set(have)
  const out: Range[] = []
  let start = -1
  for (let i = 0; i <= total; i++) {
    const missing = i < total && !got.has(i)
    if (missing && start < 0) start = i
    if (!missing && start >= 0) {
      out.push([start, i])
      start = -1
    }
  }
  return out
}

// ---------------------------------------------------------------- sender ---

export interface Outbox {
  /** Signed, finished recordings this side would like delivered. */
  pending(): Promise<OfferItem[]>
  manifest(id: string): Promise<EvidenceManifest | null>
  chunk(id: string, p: number): Promise<Uint8Array | null>
  delivered(id: string): Promise<void>
}

export interface SenderEvents {
  /** How many recordings were just offered (0: nothing new to send). */
  onOffered?(count: number): void
  onProgress?(p: { id: string; sent: number; total: number }): void
  onDelivered?(id: string): void
  onRefused?(id: string, reason: string): void
}

export function createSyncSender(wire: SyncWire, outbox: Outbox, events: SenderEvents = {}) {
  let stopped = false
  let queue: Promise<void> = Promise.resolve()
  const enqueue = (job: () => Promise<void>) => (queue = queue.then(job).catch((e) => console.warn('[sync] send failed:', e)))

  async function offerTo(peer: string) {
    const items = await outbox.pending()
    events.onOffered?.(items.length)
    if (items.length && !stopped) await wire.send({ t: 'offer', items }, peer)
  }

  async function sendWanted(peer: string, msg: Extract<SyncMsg, { t: 'want' }>) {
    const manifest = await outbox.manifest(msg.id)
    if (!manifest) return
    const total = manifest.chunkSizes.length
    if (msg.manifest) await wire.send({ t: 'manifest', id: msg.id, manifest }, peer)
    let sent = total - msg.need.reduce((n, [a, b]) => n + (Math.min(b, total) - a), 0)
    for (const [a, b] of msg.need) {
      for (let p = a; p < Math.min(b, total); p++) {
        if (stopped) return
        const bytes = await outbox.chunk(msg.id, p)
        if (!bytes) {
          console.warn(`[sync] chunk ${p} of ${msg.id} is missing on this device`)
          continue
        }
        await wire.sendChunk(msg.id, p, bytes, peer)
        events.onProgress?.({ id: msg.id, sent: ++sent, total })
      }
    }
    if (!stopped) await wire.send({ t: 'sent', id: msg.id }, peer)
  }

  function handle(msg: unknown, peer: string) {
    if (stopped || !isSyncMsg(msg)) return
    if (msg.t === 'want') enqueue(() => sendWanted(peer, msg))
    else if (msg.t === 'have') {
      enqueue(async () => {
        if ((await outbox.manifest(msg.id)) === null) return // not ours
        await outbox.delivered(msg.id)
        events.onDelivered?.(msg.id)
      })
    } else if (msg.t === 'refuse') events.onRefused?.(msg.id, msg.reason)
  }

  return {
    offerTo: (peer: string) => enqueue(() => offerTo(peer)),
    handle,
    /** Resolves when everything queued so far has been sent. */
    idle: () => queue,
    stop() {
      stopped = true
    },
  }
}

// -------------------------------------------------------------- receiver ---

export interface InboxState {
  complete: boolean
  have: number[]
  manifest: EvidenceManifest | null
}

export interface Inbox {
  state(id: string): Promise<InboxState | null>
  begin(manifest: EvidenceManifest): Promise<void>
  put(manifest: EvidenceManifest, p: number, bytes: Uint8Array): Promise<void>
  complete(manifest: EvidenceManifest): Promise<void>
}

export interface ReceiverEvents {
  onProgress?(p: { id: string; have: number; total: number }): void
  onComplete?(manifest: EvidenceManifest): void
  onRejected?(id: string, reason: string): void
  /** Decide per offer; e.g. refuse when storage is nearly full. */
  accept?(item: OfferItem): boolean | Promise<boolean>
}

/** Rounds of re-asking before giving up on a recording whose chunks keep failing. */
const MAX_ROUNDS = 3

/** Check untrusted evidence before storing anything under its name. */
export function checkManifest(id: string, raw: unknown): { ok: true; manifest: EvidenceManifest } | { ok: false; reason: string } {
  const manifest = parseManifest(JSON.stringify(raw ?? null))
  if (!manifest) return { ok: false, reason: 'malformed evidence' }
  if (manifest.recording.id !== id || manifest.proof.recordingId !== id) return { ok: false, reason: 'evidence is for a different recording' }
  if (manifest.chunkSizes.length !== manifest.proof.chunkHashes.length) return { ok: false, reason: 'chunk count does not match the proof' }
  const v = verifyProof(manifest.proof)
  if (!v.valid) return { ok: false, reason: v.reason ?? 'invalid signature' }
  // A sealed copy travels as encrypted chunks, checked against the proof the
  // same device made over them — so a device that cannot open it can still
  // carry it and know it is intact.
  const sealed = manifest.sealed?.proof
  if (sealed) {
    if (sealed.recordingId !== id || sealed.pubKey !== manifest.proof.pubKey) return { ok: false, reason: 'sealed proof is from a different recording or device' }
    if (sealed.chunkHashes.length !== manifest.chunkSizes.length) return { ok: false, reason: 'sealed chunk count does not match' }
    const sv = verifyProof(sealed)
    if (!sv.valid) return { ok: false, reason: sv.reason ?? 'invalid sealed signature' }
  }
  return { ok: true, manifest }
}

/** The hash a transferred chunk must have: of the encrypted chunk for sealed copies. */
export function expectedChunkHash(manifest: EvidenceManifest, p: number): string | undefined {
  return (manifest.sealed?.proof ?? manifest.proof).chunkHashes[p]
}

export function createSyncReceiver(wire: SyncWire, inbox: Inbox, events: ReceiverEvents = {}) {
  // Everything is handled strictly in arrival order: a chunk still being
  // hashed and stored must not be overtaken by the `sent` that follows it.
  let chain: Promise<void> = Promise.resolve()
  const inOrder = (fn: () => Promise<void>) => (chain = chain.then(fn).catch((e) => console.warn('[sync] receive failed:', e)))

  const manifests = new Map<string, EvidenceManifest>()
  const have = new Map<string, Set<number>>()
  const rounds = new Map<string, number>()
  const offered = new Map<string, OfferItem>()

  async function load(id: string): Promise<EvidenceManifest | null> {
    if (manifests.has(id)) return manifests.get(id)!
    const st = await inbox.state(id)
    if (!st?.manifest) return null
    manifests.set(id, st.manifest)
    have.set(id, new Set(st.have))
    return st.manifest
  }

  async function onOffer(items: OfferItem[], peer: string) {
    for (const item of items) {
      const st = await inbox.state(item.id)
      if (st?.complete) {
        await wire.send({ t: 'have', id: item.id }, peer)
        continue
      }
      if (!st && events.accept && !(await events.accept(item))) continue
      offered.set(item.id, item)
      if (st?.manifest) {
        manifests.set(item.id, st.manifest)
        have.set(item.id, new Set(st.have))
      }
      const total = st?.manifest?.chunkSizes.length ?? item.chunks
      await wire.send({ t: 'want', id: item.id, manifest: !st?.manifest, need: missingRanges(st?.have ?? [], total) }, peer)
    }
  }

  async function onManifest(id: string, raw: unknown, peer: string) {
    if (manifests.has(id)) return
    const offer = offered.get(id)
    const checked = checkManifest(id, raw)
    const reason = !checked.ok ? checked.reason : offer && checked.manifest.proof.merkleRoot !== offer.root ? 'evidence does not match the offer' : null
    if (reason || !checked.ok) {
      events.onRejected?.(id, reason ?? 'invalid')
      await wire.send({ t: 'refuse', id, reason: reason ?? 'invalid' }, peer)
      return
    }
    await inbox.begin(checked.manifest)
    manifests.set(id, checked.manifest)
    have.set(id, new Set())
  }

  async function onChunk(id: string, p: number, bytes: Uint8Array) {
    const manifest = await load(id)
    if (!manifest) return
    const got = have.get(id)!
    if (got.has(p) || !(p >= 0 && p < manifest.chunkSizes.length)) return
    if (bytes.length !== manifest.chunkSizes[p]) return
    if (toHex(await sha256(bytes)) !== expectedChunkHash(manifest, p)) {
      console.warn(`[sync] chunk ${p} of ${id} failed verification — dropped`)
      return
    }
    await inbox.put(manifest, p, bytes)
    got.add(p)
    events.onProgress?.({ id, have: got.size, total: manifest.chunkSizes.length })
  }

  async function onSent(id: string, peer: string) {
    const manifest = await load(id)
    if (!manifest) return
    const total = manifest.chunkSizes.length
    const need = missingRanges(have.get(id)!, total)
    if (need.length === 0) {
      await inbox.complete(manifest)
      manifests.delete(id)
      have.delete(id)
      rounds.delete(id)
      await wire.send({ t: 'have', id }, peer)
      events.onComplete?.(manifest)
      return
    }
    const round = (rounds.get(id) ?? 0) + 1
    rounds.set(id, round)
    if (round >= MAX_ROUNDS) {
      const reason = 'some chunks kept failing verification'
      events.onRejected?.(id, reason)
      await wire.send({ t: 'refuse', id, reason }, peer)
      return
    }
    await wire.send({ t: 'want', id, manifest: false, need }, peer)
  }

  return {
    handle(msg: unknown, peer: string) {
      if (!isSyncMsg(msg)) return
      if (msg.t === 'offer') inOrder(() => onOffer(msg.items, peer))
      else if (msg.t === 'manifest') inOrder(() => onManifest(msg.id, msg.manifest, peer))
      else if (msg.t === 'sent') inOrder(() => onSent(msg.id, peer))
    },
    handleChunk(id: string, p: number, bytes: Uint8Array) {
      if (typeof id !== 'string' || !Number.isInteger(p)) return
      inOrder(() => onChunk(id, p, bytes))
    },
    idle: () => chain,
  }
}
