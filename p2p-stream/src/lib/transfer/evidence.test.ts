import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProof, generateIdentity, sha256, toHex } from '../integrity'
import type { Recording } from '../../types'
import { generateSealKeyPair, newContentKey, sealContentKey, encryptChunk, openContentKey, sealJson } from '../seal/crypto'
import {
  manifestFor,
  parseManifest,
  verifyEvidence,
  buildBundle,
  readZip,
  readEvidenceInput,
  videoName,
  openSealedEvidence,
  type EvidenceManifest,
} from './evidence'
import { signAttestation, newStreamId } from '../corroborate/attest'
import { addToLogs, type AttestationLog } from '../corroborate/log'

async function fixture(chunkTexts = ['first second of video', 'second second', 'third']) {
  const chunks = chunkTexts.map((t) => new Blob([t]))
  const hashes = await Promise.all(chunks.map(async (c) => toHex(await sha256(new Uint8Array(await c.arrayBuffer())))))
  const recording: Recording = {
    id: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
    campaignId: 'rec-1',
    recordedBy: 'local-x',
    startedAt: new Date('2026-09-25T14:32:10Z'),
    endedAt: new Date('2026-09-25T14:32:13Z'),
    status: 'completed',
    // Stored out of order on purpose: the manifest must follow chunk index.
    chunks: chunks
      .map((c, index) => ({ index, timestamp: new Date(), duration: 1000, size: c.size, opfsPath: '', checksum: hashes[index].slice(0, 16) }))
      .reverse(),
    metadata: { resolution: { width: 1280, height: 720 }, bitrate: 2_500_000, codec: 'video/webm;codecs=vp8,opus' },
  }
  recording.proof = buildProof(recording.id, hashes, generateIdentity())
  const manifest = manifestFor(recording)!
  return { recording, chunks, manifest, video: new Blob(chunks) }
}

describe('evidence manifest', () => {
  it('describes a signed recording with chunk sizes in recording order', async () => {
    const { manifest, chunks } = await fixture()
    expect(manifest.chunkSizes).toEqual(chunks.map((c) => c.size))
    expect(manifest.recording.mimeType).toBe('video/webm;codecs=vp8,opus')
    expect(parseManifest(JSON.stringify(manifest))).toEqual(manifest)
  })

  it('is not offered for unsigned or unfinished recordings', async () => {
    const { recording } = await fixture()
    expect(manifestFor({ ...recording, proof: undefined })).toBeNull()
    expect(manifestFor({ ...recording, status: 'recording' })).toBeNull()
  })

  it("carries the filmer's attestations, and refuses malformed ones", async () => {
    const { recording } = await fixture()
    const filmer = generateIdentity()
    const s = newStreamId()
    const logs: AttestationLog[] = []
    for (let n = 0; n < 3; n++) addToLogs(logs, signAttestation({ s, n, t: n * 1000, f: '0123456789abcdef0123456789abcdef' }, filmer))
    const manifest = manifestFor({ ...recording, attestations: logs })!
    expect(manifest.attestations).toEqual(logs)
    expect(parseManifest(JSON.stringify(manifest))).toEqual(manifest)
    expect(manifestFor({ ...recording, attestations: [] })!.attestations).toBeUndefined()
    const broken = { ...manifest, attestations: [{ ...logs[0], a: [[0, 0, 'not-hex', 'x']] }] }
    expect(parseManifest(JSON.stringify(broken))).toBeNull()
  })

  it('rejects anything that is not evidence', () => {
    expect(parseManifest('not json')).toBeNull()
    expect(parseManifest('{"format":"something-else"}')).toBeNull()
    expect(parseManifest(JSON.stringify({ format: 'undepressable-evidence', version: 1 }))).toBeNull()
  })
})

describe('verifyEvidence', () => {
  it('accepts the untouched video', async () => {
    const { manifest, video } = await fixture()
    const progress: number[] = []
    const r = await verifyEvidence(manifest, video, (done) => progress.push(done))
    expect(r).toMatchObject({ valid: true, checkedChunks: 3, sealed: false })
    expect(progress).toEqual([1, 2, 3])
  })

  it('names the altered second', async () => {
    const { manifest, chunks } = await fixture()
    const altered = new Blob([chunks[0], new Blob(['secOnd second']), chunks[2]])
    const r = await verifyEvidence(manifest, altered)
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/Second 2 of the video/)
    expect(r.checkedChunks).toBe(1)
  })

  it('notices a cut or padded video', async () => {
    const { manifest, chunks } = await fixture()
    expect((await verifyEvidence(manifest, new Blob(chunks.slice(0, 2)))).reason).toMatch(/shorter/)
    expect((await verifyEvidence(manifest, new Blob([...chunks, 'x']))).reason).toMatch(/more data/)
  })

  it('refuses a forged proof', async () => {
    const { manifest, video } = await fixture()
    const forged: EvidenceManifest = { ...manifest, proof: { ...manifest.proof, signature: '00'.repeat(64) } }
    expect((await verifyEvidence(forged, video)).valid).toBe(false)
    const swapped: EvidenceManifest = { ...manifest, recording: { ...manifest.recording, id: 'other' } }
    expect((await verifyEvidence(swapped, video)).reason).toMatch(/different recording/)
  })
})

describe('bundle', () => {
  it('round-trips through the zip and verifies', async () => {
    const { manifest, chunks } = await fixture()
    const zip = await buildBundle(manifest, chunks)
    const entries = await readZip(zip)
    expect(entries?.map((e) => e.name)).toEqual([videoName(manifest), 'evidence.json', 'README.txt'])
    const input = await readEvidenceInput([zip])
    expect(input.ok).toBe(true)
    if (!input.ok) return
    expect(input.manifest).toEqual(manifest)
    expect((await verifyEvidence(input.manifest, input.video)).valid).toBe(true)
  })

  it('is a zip that standard tools open', async () => {
    const { manifest, chunks } = await fixture()
    const zip = await buildBundle(manifest, chunks)
    const dir = mkdtempSync(join(tmpdir(), 'evidence-'))
    try {
      const path = join(dir, 'bundle.zip')
      writeFileSync(path, new Uint8Array(await zip.arrayBuffer()))
      let out: string
      try {
        out = execFileSync('unzip', ['-t', path], { encoding: 'utf8' })
      } catch (e: any) {
        if (e.code === 'ENOENT') return // no unzip on this machine
        throw e
      }
      expect(out).toMatch(/No errors detected/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('also takes the video and evidence as two files, in any order', async () => {
    const { manifest, video } = await fixture()
    const txt = new Blob([JSON.stringify(manifest)], { type: 'text/plain' })
    for (const files of [[video, txt], [txt, video]]) {
      const input = await readEvidenceInput(files)
      expect(input.ok).toBe(true)
      if (input.ok) expect((await verifyEvidence(input.manifest, input.video)).valid).toBe(true)
    }
  })

  it('explains what is missing', async () => {
    const { manifest, video } = await fixture()
    expect(await readEvidenceInput([video])).toMatchObject({ ok: false, reason: expect.stringMatching(/No evidence file/) })
    expect(await readEvidenceInput([new Blob([JSON.stringify(manifest)])])).toMatchObject({ ok: false, reason: expect.stringMatching(/no video/) })
  })

  it('flags a bundle someone re-compressed', async () => {
    const { manifest, chunks } = await fixture()
    const bytes = new Uint8Array(await (await buildBundle(manifest, chunks)).arrayBuffer())
    // Mark the first central-directory entry as deflated.
    const view = new DataView(bytes.buffer)
    const cdOffset = view.getUint32(bytes.length - 22 + 16, true)
    view.setUint16(cdOffset + 10, 8, true)
    const input = await readEvidenceInput([new Blob([bytes])])
    expect(input).toMatchObject({ ok: false, reason: expect.stringMatching(/re-compressed/) })
  })
})

describe('sealed evidence', () => {
  async function sealedFixture() {
    const { recording, chunks } = await fixture()
    const home = generateSealKeyPair()
    const ck = newContentKey()
    const cipher = await Promise.all(chunks.map(async (c) => encryptChunk(ck, new Uint8Array(await c.arrayBuffer()))))
    const cipherHashes = await Promise.all(cipher.map(async (c) => toHex(await sha256(c))))
    const identity = generateIdentity()
    // Both proofs by the same recording device, as the recorder makes them.
    const proof = buildProof(recording.id, recording.proof!.chunkHashes, identity)
    const sealedProof = buildProof(recording.id, cipherHashes, identity)
    const sealedRec: Recording = {
      ...recording,
      proof,
      chunks: recording.chunks.map((c) => ({ ...c, size: cipher[c.index].length })),
      sealed: { v: 1, keys: await sealContentKey(ck, [home.publicKey]), proof: sealedProof },
    }
    const manifest = manifestFor(sealedRec)!
    return { manifest, video: new Blob(cipher as BlobPart[]), home, plainChunks: chunks, ck, sealedRec }
  }

  it("keeps the filmer's attestations sealed, and opens them with the footage", async () => {
    const { video, home, ck, sealedRec } = await sealedFixture()
    const logs: AttestationLog[] = []
    const filmer = generateIdentity()
    const s = newStreamId()
    for (let n = 0; n < 3; n++) addToLogs(logs, signAttestation({ s, n, t: n * 1000, f: '0123456789abcdef0123456789abcdef' }, filmer))
    const manifest = manifestFor({ ...sealedRec, sealed: { ...sealedRec.sealed!, attestations: await sealJson(ck, logs) } })!
    // Nothing readable about the stream in the sealed evidence.
    const text = JSON.stringify(manifest)
    expect(text).not.toContain(logs[0].pk)
    expect(manifest.attestations).toBeUndefined()
    expect(parseManifest(text)).toEqual(manifest)
    const opened = await openSealedEvidence(manifest, video, (await openContentKey(manifest.sealed!.keys, home.privateKey))!)
    expect(opened.manifest.attestations).toEqual(logs)
    // A blob that will not open is left out; the footage still opens.
    const garbled = { ...manifest, sealed: { ...manifest.sealed!, attestations: btoa('not sealed by anyone') } }
    expect((await openSealedEvidence(garbled, video, ck)).manifest.attestations).toBeUndefined()
    expect(parseManifest(JSON.stringify({ ...manifest, sealed: { ...manifest.sealed!, attestations: 'not base64!' } }))).toBeNull()
  })

  it('describes the encrypted chunks and carries both proofs', async () => {
    const { manifest } = await sealedFixture()
    expect(manifest.sealed?.keys.length).toBe(1)
    expect(videoName(manifest)).toMatch(/\.sealed$/)
    expect(parseManifest(JSON.stringify(manifest))).toEqual(manifest)
  })

  it('anyone can check a sealed copy is intact without opening it', async () => {
    const { manifest, video } = await sealedFixture()
    expect(await verifyEvidence(manifest, video)).toMatchObject({ valid: true, sealed: true })
    const bytes = new Uint8Array(await video.arrayBuffer())
    bytes[40] ^= 1
    expect((await verifyEvidence(manifest, new Blob([bytes]))).valid).toBe(false)
  })

  it('a sealed proof from a different device is refused', async () => {
    const { manifest, video } = await sealedFixture()
    const other = buildProof(manifest.recording.id, manifest.sealed!.proof.chunkHashes, generateIdentity())
    const r = await verifyEvidence({ ...manifest, sealed: { ...manifest.sealed!, proof: other } }, video)
    expect(r.reason).toMatch(/different device/)
  })

  it('the key holder opens it into verified, playable evidence', async () => {
    const { manifest, video, home, plainChunks } = await sealedFixture()
    const ck = (await openContentKey(manifest.sealed!.keys, home.privateKey))!
    const opened = await openSealedEvidence(manifest, video, ck)
    expect(opened.manifest.sealed).toBeUndefined()
    expect(opened.manifest.chunkSizes).toEqual(plainChunks.map((c) => c.size))
    expect(await verifyEvidence(opened.manifest, opened.video)).toMatchObject({ valid: true, sealed: false })
    await expect(openSealedEvidence(manifest, video, newContentKey())).rejects.toThrow(/could not be opened/)
  })

  it('travels in a bundle like any other evidence', async () => {
    const { manifest, video } = await sealedFixture()
    const input = await readEvidenceInput([await buildBundle(manifest, [video])])
    expect(input.ok).toBe(true)
    if (input.ok) expect(await verifyEvidence(input.manifest, input.video)).toMatchObject({ valid: true, sealed: true })
  })
})

