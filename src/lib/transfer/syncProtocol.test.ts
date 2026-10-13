import { describe, it, expect } from 'vitest'
import { buildProof, generateIdentity, sha256, toHex } from '../integrity'
import { EVIDENCE_FORMAT, type EvidenceManifest } from './evidence'
import {
  createSyncSender,
  createSyncReceiver,
  missingRanges,
  isSyncMsg,
  type Outbox,
  type Inbox,
  type InboxState,
  type SyncMsg,
  type SyncWire,
} from './syncProtocol'

async function recording(id: string, n = 5) {
  const chunks = Array.from({ length: n }, (_, i) => new TextEncoder().encode(`${id} chunk ${i} `.repeat(i + 1)))
  const hashes = await Promise.all(chunks.map(async (c) => toHex(await sha256(c))))
  const manifest: EvidenceManifest = {
    format: EVIDENCE_FORMAT,
    version: 1,
    recording: { id, campaignId: 'c', startedAt: new Date(0).toISOString(), mimeType: 'video/webm', resolution: { width: 1, height: 1 }, bitrate: 1 },
    chunkSizes: chunks.map((c) => c.length),
    proof: buildProof(id, hashes, generateIdentity()),
  }
  return { manifest, chunks }
}

type Rec = Awaited<ReturnType<typeof recording>>

function outbox(recs: Rec[], tamper?: (id: string, p: number, bytes: Uint8Array) => Uint8Array) {
  const delivered = new Set<string>()
  const box: Outbox & { delivered_: Set<string> } = {
    delivered_: delivered,
    async pending() {
      return recs
        .filter((r) => !delivered.has(r.manifest.recording.id))
        .map((r) => ({ id: r.manifest.recording.id, root: r.manifest.proof.merkleRoot, chunks: r.chunks.length, bytes: r.manifest.chunkSizes.reduce((a, b) => a + b, 0) }))
    },
    async manifest(id) {
      return recs.find((r) => r.manifest.recording.id === id)?.manifest ?? null
    },
    async chunk(id, p) {
      const bytes = recs.find((r) => r.manifest.recording.id === id)?.chunks[p] ?? null
      return bytes && tamper ? tamper(id, p, bytes) : bytes
    },
    async delivered(id) {
      delivered.add(id)
    },
  }
  return box
}

function inbox() {
  const store = new Map<string, InboxState & { chunks: Map<number, Uint8Array> }>()
  const box: Inbox & { store: typeof store } = {
    store,
    async state(id) {
      const s = store.get(id)
      return s ? { complete: s.complete, have: [...s.chunks.keys()], manifest: s.manifest } : null
    },
    async begin(m) {
      if (!store.has(m.recording.id)) store.set(m.recording.id, { complete: false, have: [], manifest: m, chunks: new Map() })
    },
    async put(m, p, bytes) {
      store.get(m.recording.id)!.chunks.set(p, bytes)
    },
    async complete(m) {
      store.get(m.recording.id)!.complete = true
    },
  }
  return box
}

/** Two endpoints joined back to back; `log` records every message type. */
function link(out: Outbox, inb: Inbox) {
  const log: string[] = []
  let chunksSent = 0
  const toReceiver: SyncWire = {
    async send(msg) {
      log.push(`S>${msg.t}`)
      receiver.handle(JSON.parse(JSON.stringify(msg)), 'phone')
    },
    async sendChunk(id, p, bytes) {
      chunksSent++
      receiver.handleChunk(id, p, bytes.slice())
    },
  }
  const toSender: SyncWire = {
    async send(msg) {
      log.push(`R>${msg.t}`)
      sender.handle(JSON.parse(JSON.stringify(msg)), 'home')
    },
    async sendChunk() {
      throw new Error('receiver never sends chunks')
    },
  }
  const events = { delivered: [] as string[], complete: [] as string[], rejected: [] as string[], refused: [] as string[] }
  const sender = createSyncSender(toReceiver, out, {
    onDelivered: (id) => events.delivered.push(id),
    onRefused: (id, reason) => events.refused.push(`${id}: ${reason}`),
  })
  const receiver = createSyncReceiver(toSender, inb, {
    onComplete: (m) => events.complete.push(m.recording.id),
    onRejected: (id, reason) => events.rejected.push(`${id}: ${reason}`),
  })
  async function settle() {
    for (let i = 0; i < 50; i++) {
      await sender.idle()
      await receiver.idle()
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  return { sender, receiver, log, events, settle, chunksSent: () => chunksSent }
}

const bytesOf = (box: ReturnType<typeof inbox>, id: string) =>
  [...box.store.get(id)!.chunks.entries()].sort(([a], [b]) => a - b).map(([, c]) => c)

describe('missingRanges', () => {
  it('collapses gaps into half-open ranges', () => {
    expect(missingRanges([], 4)).toEqual([[0, 4]])
    expect(missingRanges([0, 1, 2, 3], 4)).toEqual([])
    expect(missingRanges([1, 2, 5], 7)).toEqual([[0, 1], [3, 5], [6, 7]])
  })
})

describe('isSyncMsg', () => {
  it('only lets well-formed protocol messages through', () => {
    expect(isSyncMsg({ t: 'want', id: 'x', manifest: true, need: [[0, 3]] })).toBe(true)
    expect(isSyncMsg({ t: 'want', id: 'x', manifest: true, need: [[3, 0]] })).toBe(false)
    expect(isSyncMsg({ t: 'offer', items: [{ id: 'x', root: 'r', chunks: 0, bytes: 1 }] })).toBe(false)
    expect(isSyncMsg({ t: 'nope' })).toBe(false)
    expect(isSyncMsg(null)).toBe(false)
  })
})

describe('recording sync', () => {
  it('delivers every recording, byte for byte, and both sides know it', async () => {
    const a = await recording('rec-a', 5)
    const b = await recording('rec-b', 3)
    const out = outbox([a, b])
    const inb = inbox()
    const l = link(out, inb)
    l.sender.offerTo('home')
    await l.settle()
    expect(l.events.complete.sort()).toEqual(['rec-a', 'rec-b'])
    expect(l.events.delivered.sort()).toEqual(['rec-a', 'rec-b'])
    expect(bytesOf(inb, 'rec-a')).toEqual(a.chunks)
    expect(bytesOf(inb, 'rec-b')).toEqual(b.chunks)
    // Nothing left to offer afterwards.
    expect(await out.pending()).toEqual([])
  })

  it('resumes: only the chunks the receiver lacks are sent again', async () => {
    const a = await recording('rec-a', 6)
    const inb = inbox()
    await inb.begin(a.manifest)
    for (const p of [0, 1, 2, 4]) await inb.put(a.manifest, p, a.chunks[p])
    const l = link(outbox([a]), inb)
    l.sender.offerTo('home')
    await l.settle()
    expect(l.chunksSent()).toBe(2)
    expect(l.log).not.toContain('S>manifest')
    expect(bytesOf(inb, 'rec-a')).toEqual(a.chunks)
    expect(l.events.complete).toEqual(['rec-a'])
  })

  it('answers "have" straight away for a recording already home', async () => {
    const a = await recording('rec-a', 2)
    const inb = inbox()
    await inb.begin(a.manifest)
    await inb.complete(a.manifest)
    const out = outbox([a])
    const l = link(out, inb)
    l.sender.offerTo('home')
    await l.settle()
    expect(l.chunksSent()).toBe(0)
    expect(l.events.delivered).toEqual(['rec-a'])
  })

  it('drops a chunk damaged in transit and asks for it again', async () => {
    const a = await recording('rec-a', 4)
    let damaged = 0
    const out = outbox([a], (_id, p, bytes) => {
      if (p === 2 && damaged++ === 0) {
        const bad = bytes.slice()
        bad[0] ^= 0xff
        return bad
      }
      return bytes
    })
    const inb = inbox()
    const l = link(out, inb)
    l.sender.offerTo('home')
    await l.settle()
    expect(bytesOf(inb, 'rec-a')).toEqual(a.chunks)
    expect(l.chunksSent()).toBe(5)
    expect(l.events.complete).toEqual(['rec-a'])
  })

  it('gives up on chunks that never verify, without storing them', async () => {
    const a = await recording('rec-a', 3)
    const out = outbox([a], (_id, p, bytes) => (p === 1 ? new Uint8Array(bytes.length) : bytes))
    const inb = inbox()
    const l = link(out, inb)
    l.sender.offerTo('home')
    await l.settle()
    expect(l.events.complete).toEqual([])
    expect(l.events.rejected[0]).toMatch(/kept failing/)
    expect(l.events.refused[0]).toMatch(/kept failing/)
    expect(inb.store.get('rec-a')!.chunks.has(1)).toBe(false)
    expect(inb.store.get('rec-a')!.complete).toBe(false)
  })

  it('refuses evidence whose signature does not verify', async () => {
    const a = await recording('rec-a', 2)
    const forged = { ...a, manifest: { ...a.manifest, proof: { ...a.manifest.proof, signature: '11'.repeat(64) } } }
    const inb = inbox()
    const l = link(outbox([forged]), inb)
    l.sender.offerTo('home')
    await l.settle()
    expect(inb.store.size).toBe(0)
    expect(l.events.rejected[0]).toMatch(/signature/i)
    expect(l.events.refused.length).toBe(1)
  })

  it('refuses evidence that does not match what was offered', async () => {
    const a = await recording('rec-a', 2)
    const other = await recording('rec-a', 3) // same id, different footage
    const out = outbox([a])
    out.manifest = async () => other.manifest
    const inb = inbox()
    const l = link(out, inb)
    l.sender.offerTo('home')
    await l.settle()
    expect(inb.store.size).toBe(0)
    expect(l.events.rejected[0]).toMatch(/does not match the offer/)
  })

  it('lets the receiver decline an offer', async () => {
    const a = await recording('rec-a', 2)
    const inb = inbox()
    const out = outbox([a])
    const log: SyncMsg[] = []
    const receiver = createSyncReceiver({ send: async (m) => void log.push(m), sendChunk: async () => {} }, inb, { accept: () => false })
    receiver.handle({ t: 'offer', items: await out.pending() }, 'phone')
    await receiver.idle()
    expect(log).toEqual([])
  })
})
