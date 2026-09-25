import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProof, generateIdentity, sha256, toHex } from '../integrity'
import type { Recording } from '../../types'
import {
  manifestFor,
  parseManifest,
  verifyEvidence,
  buildBundle,
  readZip,
  readEvidenceInput,
  videoName,
  type EvidenceManifest,
} from './evidence'

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
    expect(r).toEqual({ valid: true, checkedChunks: 3 })
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
