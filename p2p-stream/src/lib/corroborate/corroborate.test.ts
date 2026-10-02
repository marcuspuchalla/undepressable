import { describe, it, expect } from 'vitest'
import { fingerprint, distance, SAME_PICTURE } from './fingerprint'
import { signAttestation, verifyAttestation, isAttestationShape, newStreamId, type Attestation } from './attest'
import { corroborate, type FrameSample } from './match'
import { addToLogs, expandLogs, isLogsShape, createIntake, MAX_ENTRIES, type AttestationLog } from './log'
import { generateIdentity } from '../integrity/identity'
import { toHex } from '../integrity/hashing'

// --- synthetic pictures -------------------------------------------------------

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 2 ** 32
  }
}

/** A "scene": a few soft blobs of different brightness on a gradient, size×size RGBA. */
function scene(seed: number, size = 64): Uint8ClampedArray {
  const r = rng(seed)
  const blobs = Array.from({ length: 6 }, () => ({ x: r(), y: r(), rad: 0.1 + r() * 0.25, v: 40 + r() * 200 }))
  const gx = r() * 80 - 40
  const out = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 90 + gx * (x / size - 0.5)
      for (const b of blobs) {
        const d = Math.hypot(x / size - b.x, y / size - b.y)
        if (d < b.rad) v = v * 0.3 + b.v * 0.7
      }
      const i = (y * size + x) * 4
      out[i] = v
      out[i + 1] = v * 0.9 + 10
      out[i + 2] = v * 0.8
      out[i + 3] = 255
    }
  }
  return out
}

/** What a picture looks like after its trip to a viewer: noise, a brightness shift. */
function degrade(img: Uint8ClampedArray, seed: number, noise = 8, shift = 6): Uint8ClampedArray {
  const r = rng(seed)
  const out = new Uint8ClampedArray(img.length)
  for (let i = 0; i < img.length; i += 4) {
    for (let c = 0; c < 3; c++) out[i + c] = img[i + c] + shift + (r() - 0.5) * 2 * noise
    out[i + 3] = 255
  }
  return out
}

/** Nearest-neighbour rescale of a square RGBA picture. */
function rescale(img: Uint8ClampedArray, from: number, to: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(to * to * 4)
  for (let y = 0; y < to; y++)
    for (let x = 0; x < to; x++) {
      const sx = Math.floor((x * from) / to)
      const sy = Math.floor((y * from) / to)
      for (let c = 0; c < 4; c++) out[(y * to + x) * 4 + c] = img[(sy * from + sx) * 4 + c]
    }
  return out
}

describe('perceptual fingerprints', () => {
  it('stay close when the same picture is degraded or rescaled', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const f = fingerprint(scene(seed))
      expect(f).toMatch(/^[0-9a-f]{32}$/)
      expect(distance(f, fingerprint(degrade(scene(seed), seed + 100)))).toBeLessThanOrEqual(SAME_PICTURE)
      expect(distance(f, fingerprint(rescale(scene(seed, 128), 128, 128), 128, 128))).toBeLessThanOrEqual(SAME_PICTURE)
    }
  })

  it('differ a lot between different pictures', () => {
    const fps = Array.from({ length: 20 }, (_, i) => fingerprint(scene(i + 1)))
    let close = 0
    for (let i = 0; i < fps.length; i++) for (let j = i + 1; j < fps.length; j++) if (distance(fps[i], fps[j]) <= SAME_PICTURE) close++
    // 190 pairs; a stray look-alike is possible, a pattern is not.
    expect(close).toBeLessThanOrEqual(2)
  })

  it('read a flat picture the same despite encoder noise', () => {
    const flat = new Uint8ClampedArray(64 * 64 * 4).fill(128)
    expect(distance(fingerprint(flat), fingerprint(degrade(flat, 7, 1.5, 0)))).toBeLessThanOrEqual(4)
  })

  it('distance counts differing bits', () => {
    expect(distance('0'.repeat(32), 'f'.repeat(32))).toBe(128)
    expect(distance('0'.repeat(32), '1' + '0'.repeat(31))).toBe(1)
  })
})

// --- attestations ---------------------------------------------------------------

describe('attestations', () => {
  const id = generateIdentity()
  const s = newStreamId()

  it('sign and verify; any change breaks the signature', () => {
    const a = signAttestation({ s, n: 3, t: 3000, f: fingerprint(scene(1)) }, id)
    expect(a.pk).toBe(toHex(id.publicKey))
    expect(isAttestationShape(a)).toBe(true)
    expect(verifyAttestation(a)).toBe(true)
    expect(verifyAttestation({ ...a, t: 3001 })).toBe(false)
    expect(verifyAttestation({ ...a, n: 4 })).toBe(false)
    expect(verifyAttestation({ ...a, f: fingerprint(scene(2)) })).toBe(false)
    expect(verifyAttestation({ ...a, s: newStreamId() })).toBe(false)
    expect(verifyAttestation({ ...a, pk: toHex(generateIdentity().publicKey) })).toBe(false)
  })

  it('rejects malformed input', () => {
    for (const bad of [null, 1, 'x', {}, { v: 2 }, { v: 1, s: 'a', n: -1, t: 0, f: '0'.repeat(32), pk: '0'.repeat(64), sig: '0'.repeat(128) }]) {
      expect(verifyAttestation(bad)).toBe(false)
    }
  })
})

// --- matching ---------------------------------------------------------------------

const SECONDS = 20
const scenes = Array.from({ length: SECONDS }, (_, i) => scene(1000 + i)) // the picture changes every second

/** The filmer signs second k at stream time `k*1000 + 200`. */
function attest(id = generateIdentity(), s = newStreamId(), from = 0, to = SECONDS): Attestation[] {
  const out: Attestation[] = []
  for (let k = from; k < to; k++) out.push(signAttestation({ s, n: k, t: k * 1000 + 200, f: fingerprint(scenes[k]) }, id))
  return out
}

/**
 * A viewer's recording that started at filmer second `start` and lasts `len`
 * seconds, decoded at 4 samples a second, degraded on the way.
 */
function recordingFrames(start: number, len: number, pick = (k: number) => scenes[k]): FrameSample[] {
  const out: FrameSample[] = []
  for (let m = 0; m < len * 1000; m += 250) {
    const k = start + Math.floor((m + 350) / 1000) // ~350 ms of network delay
    if (k >= SECONDS) break
    out.push({ m, f: fingerprint(degrade(pick(k), m + 1)) })
  }
  return out
}

describe('corroborate', () => {
  it('finds the offset and corroborates a matching recording', () => {
    const atts = attest(undefined, undefined, 5, 15) // received while recording seconds 5…15
    const report = corroborate(atts, recordingFrames(5, 10), 10_000)
    expect(report.invalid).toBe(0)
    expect(report.results).toHaveLength(1)
    const r = report.results[0]
    expect(r.verdict).toBe('corroborated')
    expect(r.matched / r.total).toBeGreaterThanOrEqual(0.9)
    expect(r.scenes).toBeGreaterThan(5)
    expect(Math.abs(r.offsetMs! - (5000 - 350))).toBeLessThanOrEqual(750)
  })

  it('does not corroborate a recording of something else', () => {
    const other = Array.from({ length: SECONDS }, (_, i) => scene(5000 + i))
    const r = corroborate(attest(undefined, undefined, 5, 15), recordingFrames(5, 10, (k) => other[k]), 10_000).results[0]
    expect(r.verdict).toBe('not-corroborated')
  })

  it('does not corroborate when the footage was cut and spliced', () => {
    // Seconds 9–13 replaced with something else.
    const other = Array.from({ length: SECONDS }, (_, i) => scene(7000 + i))
    const frames = recordingFrames(5, 10, (k) => (k >= 9 && k < 14 ? other[k] : scenes[k]))
    const r = corroborate(attest(undefined, undefined, 5, 15), frames, 10_000).results[0]
    expect(r.matched).toBeLessThan(r.total)
    expect(r.matched / r.total).toBeLessThan(0.7)
    // The unmatched moments point at the replaced stretch (recording time ≈ 4–9 s).
    expect(r.unmatchedAt.length).toBeGreaterThanOrEqual(4)
    for (const at of r.unmatchedAt) expect(at).toBeGreaterThan(3000)
    for (const at of r.unmatchedAt) expect(at).toBeLessThan(9500)
  })

  it('drops attestations with bad signatures and reports each signer separately', () => {
    const filmer = attest(undefined, undefined, 5, 15)
    const forged = filmer.map((a) => ({ ...a, t: a.t + 1 }))
    const impostor = attest(undefined, undefined, 5, 8)
    const report = corroborate([...filmer, ...forged, ...impostor], recordingFrames(5, 10), 10_000)
    expect(report.invalid).toBe(forged.length)
    expect(report.results.map((r) => r.signer)).toEqual([filmer[0].pk, impostor[0].pk])
  })

  it('says too short when only a couple of moments were attested', () => {
    expect(corroborate(attest(undefined, undefined, 5, 7), recordingFrames(5, 2), 2000).results[0].verdict).toBe('too-short')
    expect(corroborate([], recordingFrames(5, 2), 2000).results).toEqual([])
  })

  it('flags a picture that never changed', () => {
    const still = scene(42)
    const id = generateIdentity()
    const s = newStreamId()
    const atts = Array.from({ length: 8 }, (_, k) => signAttestation({ s, n: k, t: k * 1000, f: fingerprint(still) }, id))
    const frames = Array.from({ length: 32 }, (_, i) => ({ m: i * 250, f: fingerprint(degrade(still, i)) }))
    const r = corroborate(atts, frames, 8000).results[0]
    expect(r.verdict).toBe('corroborated')
    expect(r.scenes).toBe(1)
  })
})

// --- logs and intake -----------------------------------------------------------------

describe('attestation logs', () => {
  it('group by stream, drop duplicates, and expand back to verifiable attestations', () => {
    const atts = attest(undefined, undefined, 0, 5)
    const second = attest(undefined, undefined, 0, 2)
    const logs: AttestationLog[] = []
    for (const a of [...atts, ...atts, ...second]) addToLogs(logs, a)
    expect(logs).toHaveLength(2)
    expect(logs[0].a).toHaveLength(5)
    const back = expandLogs(logs)
    expect(back).toHaveLength(7)
    expect(back.every(verifyAttestation)).toBe(true)
    expect(isLogsShape(JSON.parse(JSON.stringify(logs)))).toBe(true)
  })

  it('reject malformed logs', () => {
    const logs: AttestationLog[] = []
    addToLogs(logs, attest(undefined, undefined, 0, 1)[0])
    expect(isLogsShape('x')).toBe(false)
    expect(isLogsShape([{ ...logs[0], v: 2 }])).toBe(false)
    expect(isLogsShape([{ ...logs[0], a: [[0, 0, 'zz', logs[0].a[0][3]]] }])).toBe(false)
    expect(isLogsShape([{ ...logs[0], a: new Array(MAX_ENTRIES + 1).fill(logs[0].a[0]) }])).toBe(false)
  })

  it('stop growing at the cap', () => {
    const id = generateIdentity()
    const s = newStreamId()
    const a = signAttestation({ s, n: 0, t: 0, f: '0'.repeat(32) }, id)
    const logs: AttestationLog[] = [{ v: 1, pk: a.pk, s, a: Array.from({ length: MAX_ENTRIES }, (_, n) => [n + 1, 0, a.f, a.sig] as [number, number, string, string]) }]
    expect(addToLogs(logs, a)).toBe(false)
  })
})

describe('intake', () => {
  const filmer = generateIdentity()
  const s = newStreamId()
  const good = signAttestation({ s, n: 1, t: 1000, f: '0'.repeat(32) }, filmer)
  const stranger = signAttestation({ s, n: 1, t: 1000, f: '0'.repeat(32) }, generateIdentity())

  it('with the key from the link, takes only that key — from anyone who relays it', () => {
    const take = createIntake({ expectedKey: toHex(filmer.publicKey), isSource: () => false })
    expect(take(good, 'relay-peer')).toEqual(good)
    expect(take(stranger, 'streamer-peer')).toBeNull()
    expect(take({ ...good, t: 2 }, 'relay-peer')).toBeNull()
  })

  it('without a key, takes only what the stream source sends', () => {
    const take = createIntake({ isSource: (p) => p === 'streamer-peer' })
    expect(take(good, 'streamer-peer')).toEqual(good)
    expect(take(good, 'someone-else')).toBeNull()
  })

  it('holds each sender to a few per second', () => {
    let t = 0
    const take = createIntake({ isSource: () => true, perSecond: 2, now: () => t })
    expect(take(good, 'p')).not.toBeNull()
    expect(take(good, 'p')).not.toBeNull()
    expect(take(good, 'p')).toBeNull()
    expect(take(good, 'q')).not.toBeNull()
    t = 1000
    expect(take(good, 'p')).not.toBeNull()
  })
})
