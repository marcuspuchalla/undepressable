/**
 * The recording-sync protocol over a plain RTCDataChannel — the face-to-face
 * path, where two devices paired by code with no internet (hotspot, same
 * Wi-Fi) hand recordings to each other.
 *
 * A second of video is often larger than one data-channel message may be
 * (Chrome: 256 KB), so a chunk goes as a JSON header followed by binary
 * frames. The channel is ordered and reliable, so frames need no numbering.
 * Sends wait while the channel's buffer is full: a big transfer then paces
 * itself to the link instead of piling hundreds of MB into memory.
 */

import type { SyncWire } from './syncProtocol'

const FRAME = 64 * 1024
const HIGH_WATER = 1024 * 1024
const LOW_WATER = 256 * 1024
/** Refuse absurd headers from a misbehaving peer. */
const MAX_CHUNK = 64 * 1024 * 1024
/**
 * A message too big for one data-channel message (the evidence of a long
 * recording: a hash per second, and the filmer's attestations) goes like a
 * chunk: a header, then binary frames of its JSON.
 */
const MAX_BIG_MSG = 16 * 1024 * 1024

type Header = { k: 'm'; msg: unknown } | { k: 'M'; size: number } | { k: 'c'; id: string; p: number; size: number }

export interface ChannelWire extends SyncWire {
  close(): void
}

export function channelWire(
  dc: RTCDataChannel,
  handlers: { onMsg(msg: unknown): void; onChunk(id: string, p: number, bytes: Uint8Array): void },
): ChannelWire {
  dc.binaryType = 'arraybuffer'
  dc.bufferedAmountLowThreshold = LOW_WATER
  let incoming: { id: string | null; p: number; buf: Uint8Array; got: number } | null = null

  dc.addEventListener('message', (e: MessageEvent) => {
    if (typeof e.data === 'string') {
      let h: Header
      try {
        h = JSON.parse(e.data)
      } catch {
        return
      }
      if (h?.k === 'm') handlers.onMsg(h.msg)
      else if (h?.k === 'M' && Number.isInteger(h.size) && h.size > 0 && h.size <= MAX_BIG_MSG) {
        incoming = { id: null, p: 0, buf: new Uint8Array(h.size), got: 0 }
      } else if (h?.k === 'c' && typeof h.id === 'string' && Number.isInteger(h.p) && Number.isInteger(h.size) && h.size > 0 && h.size <= MAX_CHUNK) {
        incoming = { id: h.id, p: h.p, buf: new Uint8Array(h.size), got: 0 }
      }
      return
    }
    if (!incoming) return
    const frame = new Uint8Array(e.data as ArrayBuffer)
    if (incoming.got + frame.length > incoming.buf.length) {
      incoming = null // framing broken; the receiver will ask again
      return
    }
    incoming.buf.set(frame, incoming.got)
    incoming.got += frame.length
    if (incoming.got === incoming.buf.length) {
      const { id, p, buf } = incoming
      incoming = null
      if (id !== null) {
        handlers.onChunk(id, p, buf)
        return
      }
      let msg: unknown
      try {
        msg = JSON.parse(new TextDecoder().decode(buf))
      } catch {
        return
      }
      handlers.onMsg(msg)
    }
  })

  async function ready(): Promise<void> {
    if (dc.readyState === 'connecting') {
      // A channel created a moment ago: wait for it rather than fail.
      await new Promise<void>((resolve, reject) => {
        dc.addEventListener('open', () => resolve(), { once: true })
        dc.addEventListener('close', () => reject(new Error('channel closed')), { once: true })
      })
    }
    if (dc.readyState !== 'open') throw new Error('channel closed')
    if (dc.bufferedAmount <= HIGH_WATER) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const done = () => {
        dc.removeEventListener('bufferedamountlow', done)
        dc.removeEventListener('close', fail)
        resolve()
      }
      const fail = () => {
        dc.removeEventListener('bufferedamountlow', done)
        reject(new Error('channel closed'))
      }
      dc.addEventListener('bufferedamountlow', done)
      dc.addEventListener('close', fail, { once: true })
    })
  }

  async function frames(bytes: Uint8Array) {
    for (let off = 0; off < bytes.length; off += FRAME) {
      await ready()
      dc.send(bytes.subarray(off, Math.min(off + FRAME, bytes.length)))
    }
  }

  return {
    async send(msg) {
      await ready()
      const text = JSON.stringify({ k: 'm', msg })
      if (text.length <= FRAME) {
        dc.send(text)
        return
      }
      const bytes = new TextEncoder().encode(JSON.stringify(msg))
      if (bytes.length > MAX_BIG_MSG) throw new Error('message too large')
      dc.send(JSON.stringify({ k: 'M', size: bytes.length }))
      await frames(bytes)
    },
    async sendChunk(id, p, bytes) {
      await ready()
      dc.send(JSON.stringify({ k: 'c', id, p, size: bytes.length }))
      await frames(bytes)
    },
    close() {
      try {
        dc.close()
      } catch {
        /* already closed */
      }
    },
  }
}
