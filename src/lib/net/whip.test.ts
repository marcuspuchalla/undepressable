import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { publishWhip, isValidWhipUrl, getWhipTarget, setWhipTarget, WhipError } from './whip'

class FakePC {
  static last: FakePC | null = null
  closed = false
  iceGatheringState = 'complete'
  localDescription: { sdp: string } | null = null
  remote: string | null = null
  transceivers: any[] = []
  constructor(public config: unknown) {
    FakePC.last = this
  }
  addTransceiver(track: any) {
    const t = { sender: { track, replaceTrack: vi.fn(async () => {}) }, setCodecPreferences() {} }
    this.transceivers.push(t)
    return t
  }
  async createOffer() {
    return { type: 'offer', sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n' }
  }
  async setLocalDescription(d: any) {
    this.localDescription = d
  }
  async setRemoteDescription(d: any) {
    this.remote = d.sdp
  }
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.closed = true
  }
}

const stream = { getTracks: () => [{ kind: 'audio' }, { kind: 'video' }] } as unknown as MediaStream

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = []
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return respond(url, init)
  }) as unknown as typeof fetch
  return { fn, calls }
}

beforeEach(() => {
  ;(globalThis as any).RTCPeerConnection = FakePC
})
afterEach(() => {
  delete (globalThis as any).RTCPeerConnection
})

describe('WHIP publishing', () => {
  it('posts the offer with the token, applies the answer and remembers the resource', async () => {
    const { fn, calls } = fakeFetch(() => new Response('v=0\r\nanswer', { status: 201, headers: { Location: '/whip/resource/abc' } }))
    const s = await publishWhip(stream, { url: 'https://live.example.org/cam/whip', token: 's3cret' }, { fetchImpl: fn })
    expect(calls[0].init.method).toBe('POST')
    expect((calls[0].init.headers as any)['Content-Type']).toBe('application/sdp')
    expect((calls[0].init.headers as any).Authorization).toBe('Bearer s3cret')
    expect(calls[0].init.body).toMatch(/^v=0/)
    expect(FakePC.last!.remote).toBe('v=0\r\nanswer')
    expect(s.resource).toBe('https://live.example.org/whip/resource/abc')
    expect(FakePC.last!.transceivers.length).toBe(2)

    await s.stop()
    expect(calls[1]).toMatchObject({ url: 'https://live.example.org/whip/resource/abc', init: { method: 'DELETE' } })
    expect((calls[1].init.headers as any).Authorization).toBe('Bearer s3cret')
    expect(FakePC.last!.closed).toBe(true)
  })

  it('swaps in a new source stream without renegotiating', async () => {
    const { fn } = fakeFetch(() => new Response('v=0\r\n', { status: 201 }))
    const s = await publishWhip(stream, { url: 'https://x.example/whip' }, { fetchImpl: fn })
    const next = { getTracks: () => [{ kind: 'audio', id: 'a2' }, { kind: 'video', id: 'v2' }] } as unknown as MediaStream
    await s.replaceStream(next)
    for (const t of FakePC.last!.transceivers) expect(t.sender.replaceTrack).toHaveBeenCalled()
  })

  it('explains a rejected token, a refusal, garbage and an unreachable server — and cleans up', async () => {
    const cases: [() => Response | Promise<Response>, string][] = [
      [() => new Response('no', { status: 401 }), 'rejected'],
      [() => new Response('busy', { status: 503 }), 'refused'],
      [() => new Response('<html>', { status: 201 }), 'bad-answer'],
      [() => Promise.reject(new TypeError('Failed to fetch')), 'unreachable'],
    ]
    for (const [respond, kind] of cases) {
      const { fn } = fakeFetch(respond)
      const err = await publishWhip(stream, { url: 'https://x.example/whip' }, { fetchImpl: fn }).catch((e) => e)
      expect(err).toBeInstanceOf(WhipError)
      expect(err.kind).toBe(kind)
      expect(FakePC.last!.closed).toBe(true)
    }
  })
})

describe('WHIP target settings', () => {
  it('accepts https anywhere, plain http only on this machine', () => {
    expect(isValidWhipUrl('https://live.example.org/whip')).toBe(true)
    expect(isValidWhipUrl('http://localhost:8889/cam/whip')).toBe(true)
    expect(isValidWhipUrl('http://live.example.org/whip')).toBe(false)
    expect(isValidWhipUrl('not a url')).toBe(false)
  })

  it('stores and reads the target', () => {
    const map = new Map<string, string>()
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) }
    setWhipTarget({ url: 'https://live.example.org/whip', token: 't' }, storage)
    expect(getWhipTarget(storage)).toEqual({ url: 'https://live.example.org/whip', token: 't' })
    setWhipTarget(null, storage)
    expect(getWhipTarget(storage)).toBeNull()
  })
})
