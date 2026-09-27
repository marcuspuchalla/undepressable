import { describe, it, expect } from 'vitest'
import { channelWire } from './channelWire'

/** Two in-memory data channels wired back to back, with a bounded buffer. */
function channelPair() {
  class FakeChannel extends EventTarget {
    readyState: RTCDataChannelState = 'open'
    binaryType = 'blob'
    bufferedAmount = 0
    bufferedAmountLowThreshold = 0
    peer!: FakeChannel
    maxMessage = 256 * 1024
    sent = 0
    send(data: string | ArrayBufferView) {
      const size = typeof data === 'string' ? data.length : data.byteLength
      if (size > this.maxMessage) throw new Error('message too large')
      this.sent++
      this.bufferedAmount += size
      const payload = typeof data === 'string' ? data : (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
      setTimeout(() => {
        this.bufferedAmount -= size
        if (this.bufferedAmount <= this.bufferedAmountLowThreshold) this.dispatchEvent(new Event('bufferedamountlow'))
        this.peer.dispatchEvent(new MessageEvent('message', { data: payload }))
      }, 0)
    }
    close() {
      this.readyState = 'closed'
      this.dispatchEvent(new Event('close'))
    }
  }
  const a = new FakeChannel()
  const b = new FakeChannel()
  a.peer = b
  b.peer = a
  return [a, b] as unknown as [RTCDataChannel & FakeChannel, RTCDataChannel & FakeChannel]
}

describe('channelWire', () => {
  it('carries messages and chunks bigger than one data-channel message', async () => {
    const [a, b] = channelPair()
    const got: unknown[] = []
    const chunks: [string, number, Uint8Array][] = []
    const sender = channelWire(a, { onMsg: () => {}, onChunk: () => {} })
    channelWire(b, { onMsg: (m) => got.push(m), onChunk: (id, p, bytes) => chunks.push([id, p, bytes]) })

    const big = new Uint8Array(700 * 1024).map((_, i) => i % 251)
    await sender.send({ t: 'offer', items: [] }, 'peer')
    await sender.sendChunk('rec', 7, big, 'peer')
    await sender.sendChunk('rec', 8, new Uint8Array([1, 2, 3]), 'peer')
    await new Promise((r) => setTimeout(r, 20))

    expect(got).toEqual([{ t: 'offer', items: [] }])
    expect(chunks.map(([id, p, bytes]) => [id, p, bytes.length])).toEqual([
      ['rec', 7, big.length],
      ['rec', 8, 3],
    ])
    expect(chunks[0][2]).toEqual(big)
    expect(a.sent).toBeGreaterThan(10) // split into frames
  })

  it('waits for a full buffer to drain instead of queueing everything', async () => {
    const [a, b] = channelPair()
    let peak = 0
    const origSend = a.send.bind(a)
    a.send = (d: any) => {
      origSend(d)
      peak = Math.max(peak, a.bufferedAmount)
    }
    const sender = channelWire(a, { onMsg: () => {}, onChunk: () => {} })
    let received = 0
    channelWire(b, { onMsg: () => {}, onChunk: () => received++ })
    for (let p = 0; p < 10; p++) await sender.sendChunk('rec', p, new Uint8Array(600 * 1024), 'peer')
    await new Promise((r) => setTimeout(r, 20))
    expect(received).toBe(10)
    expect(peak).toBeLessThan(2 * 1024 * 1024)
  })

  it('fails sends once the channel is closed', async () => {
    const [a] = channelPair()
    const sender = channelWire(a, { onMsg: () => {}, onChunk: () => {} })
    a.close()
    await expect(sender.send({ t: 'have', id: 'x' }, 'peer')).rejects.toThrow(/closed/)
  })

  it('ignores a header for an absurdly large chunk', async () => {
    const [a, b] = channelPair()
    const chunks: unknown[] = []
    channelWire(b, { onMsg: () => {}, onChunk: (...c) => chunks.push(c) })
    a.send(JSON.stringify({ k: 'c', id: 'x', p: 0, size: 2 ** 40 }))
    a.send(new Uint8Array(10))
    await new Promise((r) => setTimeout(r, 10))
    expect(chunks).toEqual([])
  })
})
