/**
 * Does a recording show what the filming device attested?
 *
 * The attestations carry the filmer's clock (ms since the stream started);
 * the recording has its own media time. The offset between the two — set by
 * when the viewer started recording, plus network delay — is unknown, so it
 * is found by voting: every attestation/frame pair that looks alike proposes
 * an offset, and the most proposed one wins. Then each attestation whose
 * moment falls inside the recording either finds a matching frame near that
 * moment, or not.
 *
 * Anyone can sign fingerprints of any video with a key of their own, so a
 * result only means something together with whose key it is: one per signer.
 */

import { distance, SAME_PICTURE } from './fingerprint'
import { verifyAttestation, type Attestation } from './attest'

export interface FrameSample {
  /** Media time in the recording, ms. */
  m: number
  f: string
}

export type CorroborationVerdict = 'corroborated' | 'not-corroborated' | 'too-short'

export interface Corroboration {
  /** The key the checked attestations were signed with. */
  signer: string
  /** Attestations whose moment falls within the recording. */
  total: number
  matched: number
  /** Clearly different pictures among the matched moments: 1 means the scene hardly changed, which says less. */
  scenes: number
  /** filmer time − recording time, ms. */
  offsetMs: number | null
  /** Recording times (ms) of attested moments with no matching picture — where to look for a cut. */
  unmatchedAt: number[]
  verdict: CorroborationVerdict
}

export interface CorroborationReport {
  /** One result per signer, most attestations first. */
  results: Corroboration[]
  /** Attestations dropped for a bad signature. */
  invalid: number
}

const BIN_MS = 250
const WINDOW_MS = 700
export const MIN_ATTESTED = 3
export const MIN_RATIO = 0.6
const MAX_UNMATCHED = 100

function verdictOf(total: number, matched: number): CorroborationVerdict {
  return total < MIN_ATTESTED ? 'too-short' : matched / total >= MIN_RATIO ? 'corroborated' : 'not-corroborated'
}

function forSigner(signer: string, atts: Attestation[], frames: FrameSample[], durationMs: number): Corroboration {
  const votes = new Map<number, number>()
  for (const a of atts) {
    for (const fr of frames) {
      if (distance(a.f, fr.f) <= SAME_PICTURE) {
        const bin = Math.round((a.t - fr.m) / BIN_MS)
        votes.set(bin, (votes.get(bin) ?? 0) + 1)
      }
    }
  }
  if (!votes.size) {
    // Nothing alike at any offset. The attestations were received while
    // recording, so all of them count.
    return { signer, total: atts.length, matched: 0, scenes: 0, offsetMs: null, unmatchedAt: [], verdict: verdictOf(atts.length, 0) }
  }
  // Most votes; among equals (a picture that never changes), the smallest shift.
  const bestBin = [...votes.entries()].sort((x, y) => y[1] - x[1] || Math.abs(x[0]) - Math.abs(y[0]))[0][0]
  const offset = bestBin * BIN_MS

  let total = 0
  const matchedFps: string[] = []
  const unmatchedAt: number[] = []
  for (const a of [...atts].sort((x, y) => x.t - y.t)) {
    const at = a.t - offset
    if (at < -WINDOW_MS / 2 || at > durationMs + WINDOW_MS / 2) continue
    total++
    if (frames.some((fr) => Math.abs(fr.m - at) <= WINDOW_MS && distance(a.f, fr.f) <= SAME_PICTURE)) matchedFps.push(a.f)
    else if (unmatchedAt.length < MAX_UNMATCHED) unmatchedAt.push(Math.max(0, at))
  }
  const distinct: string[] = []
  for (const f of matchedFps) if (distinct.every((d) => distance(d, f) > SAME_PICTURE)) distinct.push(f)
  return { signer, total, matched: matchedFps.length, scenes: distinct.length, offsetMs: offset, unmatchedAt, verdict: verdictOf(total, matchedFps.length) }
}

export function corroborate(attestations: unknown[], frames: FrameSample[], durationMs: number): CorroborationReport {
  const valid = attestations.filter(verifyAttestation) as Attestation[]
  const bySigner = new Map<string, Attestation[]>()
  for (const a of valid) bySigner.set(a.pk, [...(bySigner.get(a.pk) ?? []), a])
  const results = [...bySigner.entries()]
    .sort((x, y) => y[1].length - x[1].length)
    .map(([signer, atts]) => forSigner(signer, atts, frames, durationMs))
  return { results, invalid: attestations.length - valid.length }
}
