import { ref, shallowRef } from 'vue'
import type { useTrystero, RoomChannel } from './useTrystero'
import {
  createSyncReceiver,
  createSyncSender,
  type SyncWire,
} from '../lib/transfer/syncProtocol'
import { makeInbox, makeOutbox } from '../lib/transfer/library'
import type { EvidenceManifest } from '../lib/transfer/evidence'

type Trystero = ReturnType<typeof useTrystero>

// Action names on the room (Trystero allows at most 12 bytes).
const JSON_CHANNEL = 'rsync'
const DATA_CHANNEL = 'rsyncb'

export interface TransferProgress {
  id: string
  done: number
  total: number
}

function wireOver(json: RoomChannel, data: RoomChannel): SyncWire {
  return {
    async send(msg, peer) {
      await json.send(msg, peer)
    },
    async sendChunk(id, p, bytes, peer) {
      if (!(await data.send(bytes, peer, { id, p }))) throw new Error('peer is gone')
    },
  }
}

/**
 * Phone side: offer this device's signed recordings to whoever it meets in
 * the room (the paired home archive), and send what is asked for.
 * `dest` names the destination for "already delivered" bookkeeping.
 */
export function useSyncSender(trystero: Trystero, dest: string) {
  const progress = ref<TransferProgress | null>(null)
  const delivered = ref<string[]>([])
  const refused = ref<{ id: string; reason: string }[]>([])
  const outbox = makeOutbox(dest)

  // The sender exists before the channels: registering a channel reports the
  // peers already connected, and each of them must get an offer.
  const channels: { json?: RoomChannel; data?: RoomChannel } = {}
  const wire: SyncWire = {
    send: (msg, peer) => wireOver(channels.json!, channels.data!).send(msg, peer),
    sendChunk: (id, p, bytes, peer) => wireOver(channels.json!, channels.data!).sendChunk(id, p, bytes, peer),
  }
  const sender = createSyncSender(wire, outbox, {
    onProgress: ({ id, sent, total }) => (progress.value = { id, done: sent, total }),
    onDelivered: (id) => {
      delivered.value = [...delivered.value, id]
      if (progress.value?.id === id) progress.value = null
    },
    onRefused: (id, reason) => (refused.value = [...refused.value, { id, reason }]),
  })
  channels.data = trystero.addChannel(DATA_CHANNEL, { onData: () => {} })
  channels.json = trystero.addChannel(JSON_CHANNEL, {
    onData: (msg, peer) => sender.handle(msg, peer),
    onPeerJoin: (peer) => sender.offerTo(peer),
  })

  return {
    progress,
    delivered,
    refused,
    pending: () => outbox.pending(),
    /** Offer again to everyone connected (e.g. after a new recording finished). */
    offerAll() {
      for (const peer of trystero.peers.value.keys()) sender.offerTo(peer)
    },
    stop() {
      sender.stop()
      channels.json?.remove()
      channels.data?.remove()
    },
  }
}

/** Home side: accept signed recordings from anyone in the (private) room. */
export function useSyncReceiver(trystero: Trystero) {
  const incoming = shallowRef<Record<string, TransferProgress>>({})
  const received = ref<EvidenceManifest[]>([])
  const rejected = ref<{ id: string; reason: string }[]>([])

  const channels: { json?: RoomChannel; data?: RoomChannel } = {}
  const wire: SyncWire = {
    send: (msg, peer) => wireOver(channels.json!, channels.data!).send(msg, peer),
    sendChunk: async () => {
      throw new Error('the archive only receives')
    },
  }
  const receiver = createSyncReceiver(wire, makeInbox(), {
    onProgress: ({ id, have, total }) => (incoming.value = { ...incoming.value, [id]: { id, done: have, total } }),
    onComplete: (manifest) => {
      const { [manifest.recording.id]: _done, ...rest } = incoming.value
      incoming.value = rest
      received.value = [manifest, ...received.value]
    },
    onRejected: (id, reason) => (rejected.value = [...rejected.value, { id, reason }]),
  })
  channels.json = trystero.addChannel(JSON_CHANNEL, { onData: (msg, peer) => receiver.handle(msg, peer) })
  channels.data = trystero.addChannel(DATA_CHANNEL, {
    onData: (bytes, _peer, meta) => {
      const m = meta as { id?: unknown; p?: unknown } | undefined
      if (bytes instanceof Uint8Array && typeof m?.id === 'string' && typeof m.p === 'number') receiver.handleChunk(m.id, m.p, bytes)
    },
  })

  return {
    incoming,
    received,
    rejected,
    stop() {
      channels.json?.remove()
      channels.data?.remove()
    },
  }
}
