import { describe, it, expect } from 'vitest'
import { toHex, fromHex } from '../integrity/hashing'
import { parseDetached, serializeDetached, parseTimestamp, status, stamp, upgrade, checkAgainstBlock } from './ots'

// The OpenTimestamps project's own example: hello-world.txt ("Hello World!\\n"),
// anchored in Bitcoin block 358391.
const HELLO_OTS = Uint8Array.from(atob('AE9wZW5UaW1lc3RhbXBzAABQcm9vZgC/ieLohOiSlAEIA7ogTlDRJuRnTABeBNguhMITZngK8fQ71Uo3gWtqs0AD8cgBAQAAAAHkgvnTLsw7ple2nYmAEIV7VEV6kEl5gv9W+XxOxY5vmAEAAABrSDBFAiEAslOt0dHPkIRDOKR1oE/xP8nnvSQrB3Yt6gf1YIst42cCIACyaMqcM0KzdpzdBiiRMXzc74eqwxC2hV6dk4mOu+jsASECDY5NEH0rM5sAUO/dS0oJJFqgVgSPElOWN06moqsHCcb/////AmUz5gUAAAAAGXapFAvwV9QPu6Z0SGJRX1tVojEN5XcviKyghgEAAAAAABl2qRTwBoisAAAAAAgI8SCph/cWxTORPDFMeONdNYhMrJQ/pCysSdKyxp9AA/hfiAgI8SDexVs0h+Hj9yKkm1WneDIVhieF9KOss5KEYBn3HcZKnQgI8SCyyhj0heCAR44CXas9RktBbA4ey2Ypya786MghTQQkMggI8CARsOkGYRlv9LCBPD7aFBurXpFgSDe996DJ3zfbDjoRmAgI8CDDS8GkoQk//RSMAWseZkdCkU6Tnvq+TT01ZRWRSybZ4ggI8CDD5ufDjGn2ryTCvjTrrEglft5h7AohuVNeREMne+MGRggI8SAHmL+GBuAAJOXV1UvwyWD2Kd+52taRV0VbbyZSwOjegQgI8CA/mtptYLqiRABrsKrVFEitL6+51LZIegmZz/JrkfD1NggI8SDHAwGelZqN0/rvdIm7MoukhVdHWOcJHwFGTrZYcsl1yAgI8CDL/v/1E/+EuRXj/tb515lnZjD4Nk6ipsdVf62UpbXXiAgI8SAL4jcJhZkTur1EYLvd+O0hPnyHc6Sx+s4w+Kz98JO3BQgIAAWIlg1z1xkBA/fvFQ=='), (c) => c.charCodeAt(0))
const HELLO_DIGEST = '03ba204e50d126e4674c005e04d82e84c21366780af1f43bd54a37816b6ab340'
// Merkle root of block 358391 as block explorers show it.
const BLOCK_358391_ROOT = '8a1b66ecb7cbd07d8139a7e7d7f2c41aab1f5009b8364aaf61d03ad245e47e00'
// A real answer from alice.btc.calendar.opentimestamps.org to a random digest.
const CALENDAR_ANSWER = Uint8Array.from(atob('8Ai27ddWb7rEQgjxIB3tPrLoevoloGretUdYMSjd2DFqXc1n14IYrEjPGnNRCPAQR8GR4uvFGIgq/8a+nMalXQjxIBdbdlRoKbT/573+b1vc84z1uhsGpwTzUHs54KJKDeULCPAgwLC7FxMraRVTlucRIYG/LRBYGFZQZQRJ+hS7QDMY8TAI8CCqMfiJqMifFGdG4/kUvLD7qyQFBnyy8AOA3hFPRIHeogjxBGq5XRLwCJPsRz/6SU3LAIPf4w0u+QyOLi1odHRwczovL2FsaWNlLmJ0Yy5jYWxlbmRhci5vcGVudGltZXN0YW1wcy5vcmc='), (c) => c.charCodeAt(0))

const response = (body: Uint8Array | string, status = 200) => new Response(body as BodyInit, { status })

describe('OpenTimestamps format', () => {
  it('reads the reference proof and reaches the real block header', () => {
    const d = parseDetached(HELLO_OTS)
    expect(toHex(d.digest)).toBe(HELLO_DIGEST)
    expect(status(d).bitcoin).toEqual({ height: 358391, merkleRoot: BLOCK_358391_ROOT })
  })

  it('writes it back byte for byte', () => {
    expect(toHex(serializeDetached(parseDetached(HELLO_OTS)))).toBe(toHex(HELLO_OTS))
  })

  it('reads a calendar answer: a pending attestation at that calendar', () => {
    const ts = parseTimestamp(CALENDAR_ANSWER, new Uint8Array(32))
    const d = { digest: new Uint8Array(32), timestamp: ts }
    expect(status(d)).toEqual({ bitcoin: null, pending: ['https://alice.btc.calendar.opentimestamps.org'] })
  })

  it('refuses things that are not proofs', () => {
    expect(() => parseDetached(new TextEncoder().encode('hello'))).toThrow()
    expect(() => parseDetached(HELLO_OTS.slice(0, 100))).toThrow(/truncated/)
  })
})

describe('stamping and upgrading', () => {
  const digest = fromHex(HELLO_DIGEST)

  it('asks every calendar, needs only one, and hides the digest behind a nonce', async () => {
    const posted: { url: string; body: Uint8Array; headers: any }[] = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      posted.push({ url, body: init.body as Uint8Array, headers: init.headers })
      return url.startsWith('https://down') ? response('', 503) : response(CALENDAR_ANSWER)
    }) as unknown as typeof fetch
    const { detached, answered } = await stamp(digest, ['https://cal.one', 'https://down.two'], { fetchImpl })
    expect(answered).toEqual(['https://cal.one'])
    expect(posted.map((p) => p.url)).toEqual(['https://cal.one/digest', 'https://down.two/digest'])
    expect(toHex(posted[0].body)).not.toBe(HELLO_DIGEST) // only the nonce'd commitment leaves the device
    expect(Object.keys(posted[0].headers)).toEqual(['Accept']) // a simple request: no CORS preflight
    const back = parseDetached(serializeDetached(detached))
    expect(toHex(back.digest)).toBe(HELLO_DIGEST)
    expect(status(back).pending).toEqual(['https://alice.btc.calendar.opentimestamps.org'])
  })

  it('fails clearly when no calendar answers', async () => {
    const fetchImpl = (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch
    await expect(stamp(digest, ['https://a', 'https://b'], { fetchImpl })).rejects.toThrow(/No timestamp server answered/)
  })

  it('folds in the Bitcoin attestation once the calendar has it', async () => {
    const fetchStamp = (async () => response(pendingAnswer('https://cal.test'))) as unknown as typeof fetch
    const { detached } = await stamp(digest, ['https://cal.test'], { fetchImpl: fetchStamp })
    // Still pending: nothing changes.
    expect(await upgrade(detached, { fetchImpl: (async () => response('Pending', 404)) as unknown as typeof fetch })).toBe(false)
    // Confirmed: the calendar returns the path from the commitment to a block.
    const asked: string[] = []
    const fetchUpgrade = (async (url: string) => {
      asked.push(url)
      return response(bitcoinAnswer(123456))
    }) as unknown as typeof fetch
    expect(await upgrade(detached, { fetchImpl: fetchUpgrade })).toBe(true)
    expect(asked[0]).toMatch(/^https:\/\/cal\.test\/timestamp\/[0-9a-f]{64}$/)
    const s = status(parseDetached(serializeDetached(detached)))
    expect(s.pending).toEqual([])
    expect(s.bitcoin?.height).toBe(123456)
  })

  it('checks an attestation against the block header a block explorer serves', async () => {
    const fetchImpl = (async (url: string) =>
      url.includes('block-height') ? response('000000000000000003e892881a8cdcdc117c06d444057c98b6f04a9ee75a2319') : new Response(JSON.stringify({ merkle_root: BLOCK_358391_ROOT, timestamp: 1432827678 }))) as unknown as typeof fetch
    expect(await checkAgainstBlock(358391, BLOCK_358391_ROOT, { fetchImpl })).toEqual({ ok: true, time: 1432827678 })
    expect((await checkAgainstBlock(358391, '00'.repeat(32), { fetchImpl })).ok).toBe(false)
  })
})

// --- tiny calendar answers built with the same format ---
function pendingAnswer(uri: string): Uint8Array {
  const u = new TextEncoder().encode(uri)
  // append 0x01, sha256, then a pending attestation for the calendar
  return Uint8Array.from([0xf0, 0x01, 0x01, 0x08, 0x00, ...fromHex('83dfe30d2ef90c8e'), u.length + 1, u.length, ...u])
}
function bitcoinAnswer(height: number): Uint8Array {
  const h: number[] = []
  let n = height
  do {
    let b = n % 128
    n = Math.floor(n / 128)
    if (n > 0) b |= 0x80
    h.push(b)
  } while (n > 0)
  // prepend 0x02, sha256, then the Bitcoin attestation
  return Uint8Array.from([0xf1, 0x01, 0x02, 0x08, 0x00, ...fromHex('0588960d73d71901'), h.length, ...h])
}
