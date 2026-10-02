/**
 * How a recording keeps the attestations it received: grouped by stream
 * (signer + stream id), each entry just `[n, t, f, sig]` — about 200 bytes per
 * second of footage, small next to the video itself.
 *
 * The log is not covered by the recording's own proof, and needs not be:
 * every entry is signed by the filming device. Whoever carries a copy can
 * drop entries (that only weakens the check) but cannot make new ones.
 */

import { isAttestationShape, verifyAttestation, type Attestation } from './attest'

export interface AttestationLog {
  v: 1
  /** Signer: the filming device's key for this stream. */
  pk: string
  /** Stream id. */
  s: string
  /** [sequence number, filmer's ms since stream start, fingerprint, signature] */
  a: [number, number, string, string][]
}

/** Six hours of attestations per recording; past that, new ones are not kept. */
export const MAX_ENTRIES = 6 * 3600
const MAX_LOGS = 16

/**
 * Add a (verified) attestation to the logs. Returns false when it was a
 * duplicate or a limit was reached.
 */
export function addToLogs(logs: AttestationLog[], a: Attestation): boolean {
  let log = logs.find((l) => l.pk === a.pk && l.s === a.s)
  if (!log) {
    if (logs.length >= MAX_LOGS) return false
    log = { v: 1, pk: a.pk, s: a.s, a: [] }
    logs.push(log)
  }
  if (entryCount(logs) >= MAX_ENTRIES) return false
  if (log.a.some((e) => e[0] === a.n)) return false
  log.a.push([a.n, a.t, a.f, a.sig])
  return true
}

export function entryCount(logs: AttestationLog[]): number {
  return logs.reduce((n, l) => n + l.a.length, 0)
}

/** Every entry as a full attestation (for verifying and matching). */
export function expandLogs(logs: AttestationLog[]): Attestation[] {
  return logs.flatMap((l) => l.a.map(([n, t, f, sig]) => ({ v: 1 as const, s: l.s, n, t, f, pk: l.pk, sig })))
}

/** Shape check for logs that arrive from elsewhere (signatures are checked when matching). */
export function isLogsShape(x: unknown): x is AttestationLog[] {
  if (!Array.isArray(x) || x.length > MAX_LOGS) return false
  let total = 0
  for (const l of x as any[]) {
    if (!l || l.v !== 1 || !Array.isArray(l.a)) return false
    total += l.a.length
    if (total > MAX_ENTRIES) return false
    for (const e of l.a) {
      if (!Array.isArray(e) || e.length !== 4) return false
      if (!isAttestationShape({ v: 1, s: l.s, n: e[0], t: e[1], f: e[2], pk: l.pk, sig: e[3] })) return false
    }
  }
  return true
}

/**
 * Who a viewer takes attestations from. With the filmer's key from the share
 * link, only attestations signed by it; without one, only from the peer that
 * is sending the stream. Either way the signature must check out, and each
 * sender is held to a few per second.
 */
export function createIntake(opts: { expectedKey?: string | null; isSource: (peerId: string) => boolean; perSecond?: number; now?: () => number }) {
  const limit = opts.perSecond ?? 4
  const now = opts.now ?? Date.now
  const buckets = new Map<string, { at: number; n: number }>()
  return (data: unknown, peerId: string): Attestation | null => {
    if (!isAttestationShape(data)) return null
    if (opts.expectedKey ? data.pk !== opts.expectedKey : !opts.isSource(peerId)) return null
    const sec = Math.floor(now() / 1000)
    const b = buckets.get(peerId)
    if (b && b.at === sec) {
      if (++b.n > limit) return null
    } else {
      if (buckets.size > 256) buckets.clear()
      buckets.set(peerId, { at: sec, n: 1 })
    }
    return verifyAttestation(data) ? data : null
  }
}
