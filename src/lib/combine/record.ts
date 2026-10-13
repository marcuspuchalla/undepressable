/**
 * Combined records on this device: the copies' footage, the rendered video,
 * and the bundle that carries both.
 */

import type { Recording, CombinedInfo } from '../../types'
import { getRecording, putRecording } from '../recordingDb'
import { plainEvidence } from '../transfer/library'
import { buildBundle, buildZip, bundleName, manifestFor, readZip, type ZipFileEntry } from '../transfer/evidence'
import { addToLogs, type AttestationLog } from '../corroborate/log'
import { mainLog, type CopyGroup } from './align'
import { renderTimeline, type RenderOptions } from './player'
import { verifierEntries } from '../transfer/verifier'
import type { Timeline } from './timeline'

/** The playable footage of every placed copy (sealed ones opened, when this device can). */
export async function loadSources(group: CopyGroup): Promise<{ sources: Map<string, Blob>; missing: string[] }> {
  const sources = new Map<string, Blob>()
  const missing: string[] = []
  for (const p of group.placements) {
    if (!p.copy) continue
    const ev = await plainEvidence(p.recording)
    if (ev) sources.set(p.recording.id, ev.video)
    else missing.push(p.recording.id)
  }
  return { sources, missing }
}

/** What the rendered video is made of. */
export function describeCombined(group: CopyGroup, timeline: Timeline): CombinedInfo {
  const used = new Set(timeline.segments.map((s) => s.copy))
  return {
    v: 1,
    ...(group.key.kind === 'stream' ? { stream: { pk: group.key.pk!, s: group.key.s! } } : {}),
    sources: group.placements
      .filter((p) => p.copy && used.has(p.recording.id))
      .map((p) => ({ id: p.recording.id, merkleRoot: p.recording.proof!.merkleRoot, pubKey: p.recording.proof!.pubKey, startMs: p.copy!.startMs, alignment: p.copy!.alignment })),
    segments: timeline.segments,
    alignment: timeline.alignment,
  }
}

/**
 * The filmer's attestations the copies carry, merged, with receipt times
 * dropped (they belonged to the copies' own clocks).
 */
export function mergedAttestations(group: CopyGroup): AttestationLog[] {
  if (group.key.kind !== 'stream') return []
  const out: AttestationLog[] = []
  for (const p of group.placements) {
    const log = p.copy ? mainLog(p.recording) : null
    if (!log) continue
    for (const [n, t, f, sig] of log.a) addToLogs(out, { v: 1, s: log.s, n, t, f, pk: log.pk, sig })
  }
  for (const l of out) l.a.sort((a, b) => a[0] - b[0])
  return out
}

export interface Recorder {
  startRecording(stream: MediaStream, quality: 'low' | 'medium' | 'high', campaignId?: string): Promise<boolean>
  stopRecording(): Promise<Recording | null>
}

/** Render the timeline into one signed recording on this device. */
export async function renderCombined(group: CopyGroup, timeline: Timeline, sources: Map<string, Blob>, recorder: Recorder, opts: RenderOptions = {}): Promise<Recording> {
  const rec = await renderTimeline(
    timeline,
    sources,
    async (stream) => {
      if (!(await recorder.startRecording(stream, 'medium', 'combined'))) throw new Error('Could not start recording the rendered video.')
      return () => recorder.stopRecording()
    },
    opts,
  )
  if (!rec) throw new Error('The rendered video was not saved.')
  const saved = (await getRecording(rec.id)) ?? rec
  const updated: Recording = { ...saved, combined: describeCombined(group, timeline) }
  const logs = mergedAttestations(group)
  if (logs.length) updated.attestations = logs
  await putRecording(updated)
  return updated
}

export const COMBINED_README = `
COMBINED RECORD

This video was rendered out of several copies of one stream, recorded by
different devices (evidence.json → "combined"). It is signed by the device
that rendered it, like any recording — but the copies it was made from are
the evidence: each is in sources/ as its own evidence bundle, signed by the
device that recorded it, and "combined.sources" names each one's signed
Merkle root and key. "combined.segments" says which copy plays when, on a
common clock ("alignment": picture = matched against the filmer's
signatures, signals = by when they arrived, clock = the devices' clocks).
Import the .zip in Undepressable → Recordings to get the rendered video and
every source copy, each checked against its own signature.
`

/** The rendered video with proof, plus every source copy as its own bundle under sources/. */
export async function buildCombinedBundle(rec: Recording, sources: Recording[]): Promise<{ zip: Blob; name: string } | null> {
  const own = await plainEvidence(rec)
  if (!own) return null
  const entries = [
    { name: `${bundleName(own.manifest).replace(/\.zip$/, '')}.webm`, parts: [own.video] },
    { name: 'evidence.json', parts: [new Blob([JSON.stringify(own.manifest, null, 2)], { type: 'application/json' })] },
    { name: 'README.txt', parts: [new Blob([COMBINED_README])] },
    ...verifierEntries(),
  ]
  for (const src of sources) {
    const ev = await plainEvidence(src)
    if (!ev) continue
    entries.push({ name: `sources/${bundleName(ev.manifest)}`, parts: [await buildBundle(ev.manifest, [ev.video])] })
  }
  return { zip: await buildZip(entries, rec.startedAt), name: `combined-${bundleName(manifestFor(rec)!)}` }
}

/** Source bundles inside a combined record (entries of the outer zip). */
export async function sourceBundles(zip: Blob): Promise<ZipFileEntry[]> {
  const entries = await readZip(zip)
  return (entries ?? []).filter((e) => /^sources\/.+\.zip$/i.test(e.name) && e.stored)
}
