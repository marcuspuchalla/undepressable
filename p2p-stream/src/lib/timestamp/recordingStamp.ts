/**
 * Timestamps for recordings: what is stamped, where it is kept, and how it is
 * checked.
 *
 * The stamped "file" is `root.txt`: the recording's signed Merkle root in hex
 * plus a newline. It covers every chunk (and so the whole footage) without
 * revealing anything, and it ships in evidence bundles next to
 * `root.txt.ots`, so `ots verify root.txt.ots` works with the standard tool.
 */

import type { Recording, RecordingTimestamp } from '../../types'
import type { RecordingProof } from '../integrity'
import { sha256, toHex } from '../integrity/hashing'
import { putRecording } from '../recordingDb'
import { DEFAULT_CALENDARS, stamp, upgrade, status, checkAgainstBlock, parseDetached, serializeDetached, type DetachedTimestamp } from './ots'

const AUTO_KEY = 'undepressable_auto_timestamp'

export function rootFileText(proof: RecordingProof): string {
  return `${proof.merkleRoot}\n`
}

async function rootDigest(proof: RecordingProof): Promise<Uint8Array> {
  return sha256(new TextEncoder().encode(rootFileText(proof)))
}

function b64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
function unb64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
}

export function otsBytes(t: RecordingTimestamp): Uint8Array {
  return unb64(t.ots)
}

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}

/** Calendar servers (tests may point these at local stand-ins in development). */
function calendars(): string[] {
  const dev = (import.meta as any).env?.DEV ? read<string[]>('undepressable_ots_calendars') : null
  return Array.isArray(dev) && dev.length ? dev : DEFAULT_CALENDARS
}
function explorer(): string | undefined {
  const dev = (import.meta as any).env?.DEV ? read<string>('undepressable_ots_explorer') : null
  return typeof dev === 'string' ? dev : undefined
}

export function autoTimestamp(): boolean {
  return read<boolean>(AUTO_KEY) === true
}
export function setAutoTimestamp(on: boolean) {
  try {
    localStorage.setItem(AUTO_KEY, JSON.stringify(on))
  } catch {
    /* storage blocked */
  }
}

/** A timestamp from elsewhere is only kept if it really stamps this recording's proof. */
export async function timestampFits(proof: RecordingProof, t: RecordingTimestamp | undefined): Promise<boolean> {
  if (!t) return false
  try {
    return toHex(parseDetached(otsBytes(t)).digest) === toHex(await rootDigest(proof))
  } catch {
    return false
  }
}

function describe(d: DetachedTimestamp, prev?: RecordingTimestamp): RecordingTimestamp {
  const s = status(d)
  const keepCheck = prev?.bitcoin && s.bitcoin && prev.bitcoin.height === s.bitcoin.height
  return {
    ots: b64(serializeDetached(d)),
    requestedAt: prev?.requestedAt ?? new Date().toISOString(),
    calendars: s.pending.length ? s.pending : prev?.calendars ?? [],
    ...(s.bitcoin ? { bitcoin: keepCheck ? prev!.bitcoin! : { height: s.bitcoin.height, merkleRoot: s.bitcoin.merkleRoot } } : {}),
  }
}

/** Ask the calendars for a timestamp of this recording's proof. */
export async function stampRecording(rec: Recording): Promise<Recording> {
  if (!rec.proof) throw new Error('This recording has no proof to timestamp.')
  if (rec.timestamp) return rec
  const { detached } = await stamp(await rootDigest(rec.proof), calendars())
  const updated: Recording = { ...rec, timestamp: describe(detached) }
  await putRecording(updated)
  return updated
}

/**
 * See whether a pending timestamp has reached Bitcoin, and check the block
 * it names against a block explorer. Returns the recording, updated if
 * anything changed.
 */
export async function refreshTimestamp(rec: Recording): Promise<Recording> {
  if (!rec.timestamp) return rec
  const d = parseDetached(otsBytes(rec.timestamp))
  const changed = await upgrade(d)
  let t = changed ? describe(d, rec.timestamp) : rec.timestamp
  if (t.bitcoin && !t.bitcoin.checkedAt) {
    const res = await checkAgainstBlock(t.bitcoin.height, t.bitcoin.merkleRoot, { explorer: explorer() }).catch(() => ({ ok: false as const }))
    if (res.ok) t = { ...t, bitcoin: { ...t.bitcoin, checkedAt: new Date().toISOString(), blockTime: res.time } }
  }
  if (t === rec.timestamp) return rec
  const updated: Recording = { ...rec, timestamp: t }
  await putRecording(updated)
  return updated
}
