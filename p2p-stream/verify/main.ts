/**
 * The standalone evidence check: one HTML file, no website, no app. Built
 * from the app's own modules (vite --mode verify, inlined by
 * scripts/build-portable.js) and put inside every evidence bundle, so a
 * bundle checks itself in any browser as long as a browser exists.
 */

import { readEvidenceInput, verifyEvidence, readZip, type EvidenceManifest } from '../src/lib/transfer/evidence'
import { expandLogs, entryCount } from '../src/lib/corroborate/log'
import { corroborate, type Corroboration } from '../src/lib/corroborate/match'
import { sampleRecording } from '../src/lib/corroborate/frames'

const out = document.getElementById('out')!
const input = document.getElementById('files') as HTMLInputElement
const drop = document.getElementById('drop')!

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}
function card(): HTMLElement {
  const c = el('div', 'card')
  out.appendChild(c)
  return c
}
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(Math.max(0, ms) / 1000) % 60).padStart(2, '0')}`

function stretches(ms: number[]): string {
  const parts: string[] = []
  let from = -1
  let to = -1
  for (const m of [...ms].sort((a, b) => a - b)) {
    if (from >= 0 && m - to <= 1500) to = m
    else {
      if (from >= 0) parts.push(from === to ? clock(from) : `${clock(from)}–${clock(to)}`)
      from = to = m
    }
  }
  if (from >= 0) parts.push(from === to ? clock(from) : `${clock(from)}–${clock(to)}`)
  return parts.slice(0, 8).join(', ') + (parts.length > 8 ? ', …' : '')
}

function corroborationText(r: Corroboration): string {
  const key = `key ${r.signer.slice(0, 8)}…`
  const gaps = r.unmatchedAt.length ? ` No match at ${stretches(r.unmatchedAt)}.` : ''
  if (r.verdict === 'too-short') return `Too few signed moments to tell (${r.total}) — ${key}`
  if (r.verdict === 'not-corroborated') return `✗ Does not show what the filming device signed: ${r.matched} of ${r.total} moments match (${key}).${gaps}`
  const still = r.scenes <= 1 ? ' The picture hardly changed, so this says little.' : ''
  return `✓ Shows what the filming device's camera showed: ${r.matched} of ${r.total} signed moments match (${key}).${gaps}${still}`
}

async function checkAttestations(manifest: EvidenceManifest, video: Blob, c: HTMLElement) {
  if (!manifest.attestations?.length) return
  const n = entryCount(manifest.attestations)
  const line = el('p', '', `Comparing the video with ${n} moments the filming device signed live…`)
  const bar = document.createElement('progress')
  bar.max = 100
  c.append(line, bar)
  try {
    const total = manifest.chunkSizes.length * 1000
    const sampled = await sampleRecording(video, { rate: total > 20 * 60_000 ? 16 : 8, onProgress: (ms) => (bar.value = Math.min(99, (100 * ms) / Math.max(1, total))) })
    const report = corroborate(expandLogs(manifest.attestations), sampled.frames, sampled.durationMs)
    bar.remove()
    line.textContent = `${n} moments signed by the filming device, ${sampled.frames.length} frames of this video compared:`
    const list = el('ul', '')
    for (const r of report.results) list.appendChild(el('li', r.verdict === 'corroborated' ? 'ok' : r.verdict === 'too-short' ? 'dim' : 'bad', corroborationText(r)))
    if (!report.results.length) list.appendChild(el('li', 'bad', '✗ None of the signatures check out.'))
    if (report.invalid) list.appendChild(el('li', 'dim', `${report.invalid} attestations with bad signatures were ignored.`))
    c.appendChild(list)
    c.appendChild(el('p', 'dim', 'A match means the same picture (a perceptual fingerprint), not the same bytes. Compare the key with the one in the stream’s share link (fk=…).'))
  } catch (e: any) {
    bar.remove()
    line.className = 'bad'
    line.textContent = `Could not compare: ${e?.message ?? e}`
  }
}

async function checkFiles(files: File[]) {
  out.replaceChildren()
  const c = card()
  const status = el('p', '', 'Reading…')
  c.appendChild(status)
  const picked = await readEvidenceInput(files)
  if (!picked.ok) {
    status.className = 'bad'
    status.textContent = `Not evidence: ${picked.reason}`
    return
  }
  const { manifest, video } = picked
  const r = manifest.recording
  status.className = 'dim'
  status.textContent = `Recording ${r.id.slice(0, 8)}… · started ${new Date(r.startedAt).toLocaleString()} · ${manifest.chunkSizes.length} s · ${r.mimeType}`
  c.appendChild(el('p', 'mono', `Signed by key ${manifest.proof.pubKey}`))

  const line = el('p', '', `Checking every second against its signature…`)
  const bar = document.createElement('progress')
  bar.max = 100
  c.append(line, bar)
  const check = await verifyEvidence(manifest, video, (done, total) => (bar.value = (100 * done) / Math.max(1, total)))
  bar.remove()
  if (!check.valid) {
    line.className = 'bad'
    line.textContent = `✗ Not the recording that was signed: ${check.reason}`
    return
  }
  line.className = 'ok'
  line.textContent = check.sealed
    ? `✓ Intact: all ${check.checkedChunks} encrypted seconds match the signed proof (sealed — the footage itself cannot be seen without a key).`
    : `✓ Unaltered: all ${check.checkedChunks} seconds match the signature.`

  if (manifest.timestamp) {
    const t = manifest.timestamp
    c.appendChild(
      el(
        'p',
        '',
        t.bitcoin
          ? `⏱ Timestamp: the proof existed by Bitcoin block #${t.bitcoin.height}${t.bitcoin.blockTime ? ` (${new Date(t.bitcoin.blockTime * 1000).toLocaleString()})` : ''}. Check root.txt.ots with the OpenTimestamps client: ots verify root.txt.ots`
          : `⏱ Timestamp requested ${new Date(t.requestedAt).toLocaleString()}, not yet anchored when this bundle was made: ots upgrade root.txt.ots, then ots verify.`,
      ),
    )
  }
  if (manifest.combined) {
    const cb = manifest.combined
    c.appendChild(el('p', '', `Rendered out of ${cb.sources.length} copies of one stream (aligned by ${cb.alignment}). The copies are the evidence — each is in sources/ as its own bundle; check them here one by one:`))
    const list = el('ul', 'mono')
    for (const s of cb.sources) list.appendChild(el('li', '', `${s.id.slice(0, 8)}… root ${s.merkleRoot.slice(0, 16)}… key ${s.pubKey.slice(0, 8)}… from ${clock(s.startMs - cb.segments[0].from)}`))
    c.appendChild(list)
  }
  if (!check.sealed) await checkAttestations(manifest, video, c)
  else if (manifest.sealed?.attestations) c.appendChild(el('p', 'dim', 'The filming device’s signatures are sealed with the footage; they can be checked where it is opened.'))
}

/** A combined record's outer zip also holds the source bundles: offer each. */
async function listSources(files: File[]) {
  for (const f of files) {
    const entries = (await readZip(f).catch(() => null)) ?? []
    const sources = entries.filter((e) => /^sources\/.+\.zip$/i.test(e.name))
    if (!sources.length) continue
    const c = card()
    c.appendChild(el('p', '', `This bundle carries ${sources.length} source copies. Check one:`))
    for (const s of sources) {
      const b = el('button', '', s.name.replace(/^sources\//, ''))
      b.addEventListener('click', () => checkFiles([new File([s.blob], s.name.replace(/^sources\//, ''), { type: 'application/zip' })]))
      c.appendChild(b)
      c.appendChild(document.createTextNode(' '))
    }
  }
}

async function run(files: File[]) {
  if (!files.length) return
  try {
    await checkFiles(files)
    await listSources(files)
  } catch (e: any) {
    card().appendChild(el('p', 'bad', `Check failed: ${e?.message ?? e}`))
  }
}

input.addEventListener('change', () => run([...(input.files ?? [])]))
drop.addEventListener('dragover', (e) => {
  e.preventDefault()
  drop.classList.add('over')
})
drop.addEventListener('dragleave', () => drop.classList.remove('over'))
drop.addEventListener('drop', (e) => {
  e.preventDefault()
  drop.classList.remove('over')
  run([...(e.dataTransfer?.files ?? [])])
})
