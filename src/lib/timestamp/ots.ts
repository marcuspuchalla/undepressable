/**
 * Trusted timestamps with OpenTimestamps: proof that a recording existed
 * before a given moment, anchored in the Bitcoin blockchain — something
 * nobody, including us, can backdate.
 *
 * A signature proves a recording is unaltered since it was signed, not when.
 * Here a fingerprint of the recording (never the footage) goes to public
 * OpenTimestamps calendar servers; within hours they commit it into a Bitcoin
 * transaction. The resulting `.ots` proof is the standard format: anyone can
 * check it with the `ots` command-line tool, or with this app.
 *
 * Browsers can talk to the calendars directly: they answer with
 * `Access-Control-Allow-Origin: *`, and the requests here are "simple" ones
 * (no preflight, which the calendars do not answer).
 */

import { sha256 as nobleSha256 } from '@noble/hashes/sha256'
import { sha1 } from '@noble/hashes/sha1'
import { ripemd160 } from '@noble/hashes/ripemd160'
import { keccak_256 } from '@noble/hashes/sha3'
import { toHex, fromHex } from '../integrity/hashing'

export const DEFAULT_CALENDARS = [
  'https://a.pool.opentimestamps.org',
  'https://b.pool.opentimestamps.org',
  'https://a.pool.eternitywall.com',
]

const MAGIC = new Uint8Array([
  0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00, 0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2,
  0xe8, 0x84, 0xe8, 0x92, 0x94,
])
const TAG_PENDING = '83dfe30d2ef90c8e'
const TAG_BITCOIN = '0588960d73d71901'

const OP_SHA1 = 0x02
const OP_RIPEMD160 = 0x03
const OP_SHA256 = 0x08
const OP_KECCAK256 = 0x67
const OP_APPEND = 0xf0
const OP_PREPEND = 0xf1
const OP_REVERSE = 0xf2
const OP_HEXLIFY = 0xf3
const BINARY_OPS = new Set([OP_APPEND, OP_PREPEND])
const UNARY_OPS = new Set([OP_SHA1, OP_RIPEMD160, OP_SHA256, OP_KECCAK256, OP_REVERSE, OP_HEXLIFY])

export type Attestation =
  | { kind: 'pending'; uri: string }
  | { kind: 'bitcoin'; height: number }
  | { kind: 'unknown'; tag: string; payload: Uint8Array }

export interface Op {
  tag: number
  arg?: Uint8Array
}

/** A timestamp tree: what is attested about `msg`, and where operations lead. */
export interface Timestamp {
  msg: Uint8Array
  attestations: Attestation[]
  ops: { op: Op; child: Timestamp }[]
}

export interface DetachedTimestamp {
  /** SHA-256 of the timestamped file. */
  digest: Uint8Array
  timestamp: Timestamp
}

// ------------------------------------------------------------ primitives ---

export function applyOp(op: Op, msg: Uint8Array): Uint8Array {
  switch (op.tag) {
    case OP_SHA256:
      return nobleSha256(msg)
    case OP_SHA1:
      return sha1(msg)
    case OP_RIPEMD160:
      return ripemd160(msg)
    case OP_KECCAK256:
      return keccak_256(msg)
    case OP_APPEND:
      return concat(msg, op.arg!)
    case OP_PREPEND:
      return concat(op.arg!, msg)
    case OP_REVERSE:
      return msg.slice().reverse()
    case OP_HEXLIFY:
      return new TextEncoder().encode(toHex(msg))
    default:
      throw new Error(`unknown operation 0x${op.tag.toString(16)}`)
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

class Reader {
  i = 0
  constructor(readonly b: Uint8Array) {}
  byte(): number {
    if (this.i >= this.b.length) throw new Error('truncated timestamp')
    return this.b[this.i++]
  }
  bytes(n: number): Uint8Array {
    if (this.i + n > this.b.length) throw new Error('truncated timestamp')
    const out = this.b.slice(this.i, this.i + n)
    this.i += n
    return out
  }
  varuint(): number {
    let value = 0
    let shift = 0
    for (;;) {
      const b = this.byte()
      value += (b & 0x7f) * 2 ** shift
      if (!(b & 0x80)) return value
      shift += 7
      if (shift > 49) throw new Error('varuint too long')
    }
  }
  varbytes(max = 8192): Uint8Array {
    const n = this.varuint()
    if (n > max) throw new Error('field too long')
    return this.bytes(n)
  }
}

class Writer {
  parts: number[] = []
  byte(b: number) {
    this.parts.push(b)
  }
  bytes(b: Uint8Array) {
    for (const x of b) this.parts.push(x)
  }
  varuint(n: number) {
    do {
      let b = n % 128
      n = Math.floor(n / 128)
      if (n > 0) b |= 0x80
      this.parts.push(b)
    } while (n > 0)
  }
  varbytes(b: Uint8Array) {
    this.varuint(b.length)
    this.bytes(b)
  }
  out(): Uint8Array {
    return Uint8Array.from(this.parts)
  }
}

// --------------------------------------------------------- serialization ---

function readTimestamp(r: Reader, msg: Uint8Array, depth = 0): Timestamp {
  if (depth > 256) throw new Error('timestamp nested too deeply')
  const ts: Timestamp = { msg, attestations: [], ops: [] }
  const entry = (tag: number) => {
    if (tag === 0x00) {
      const t = toHex(r.bytes(8))
      const payload = new Reader(r.varbytes())
      if (t === TAG_PENDING) ts.attestations.push({ kind: 'pending', uri: new TextDecoder().decode(payload.varbytes(1000)) })
      else if (t === TAG_BITCOIN) ts.attestations.push({ kind: 'bitcoin', height: payload.varuint() })
      else ts.attestations.push({ kind: 'unknown', tag: t, payload: payload.b })
      return
    }
    const op: Op = BINARY_OPS.has(tag) ? { tag, arg: r.varbytes(4096) } : UNARY_OPS.has(tag) ? { tag } : (() => { throw new Error(`unknown operation 0x${tag.toString(16)}`) })()
    ts.ops.push({ op, child: readTimestamp(r, applyOp(op, msg), depth + 1) })
  }
  let tag = r.byte()
  while (tag === 0xff) {
    entry(r.byte())
    tag = r.byte()
  }
  entry(tag)
  return ts
}

function writeTimestamp(w: Writer, ts: Timestamp) {
  const entries: (() => void)[] = []
  for (const a of ts.attestations) {
    entries.push(() => {
      w.byte(0x00)
      const payload = new Writer()
      if (a.kind === 'pending') {
        w.bytes(fromHex(TAG_PENDING))
        payload.varbytes(new TextEncoder().encode(a.uri))
      } else if (a.kind === 'bitcoin') {
        w.bytes(fromHex(TAG_BITCOIN))
        payload.varuint(a.height)
      } else {
        w.bytes(fromHex(a.tag))
        payload.bytes(a.payload)
      }
      w.varbytes(payload.out())
    })
  }
  for (const { op, child } of ts.ops) {
    entries.push(() => {
      w.byte(op.tag)
      if (op.arg) w.varbytes(op.arg)
      writeTimestamp(w, child)
    })
  }
  if (entries.length === 0) throw new Error('empty timestamp')
  entries.forEach((write, i) => {
    if (i < entries.length - 1) w.byte(0xff)
    write()
  })
}

/** Parse a calendar's answer: the timestamp of `msg`. */
export function parseTimestamp(bytes: Uint8Array, msg: Uint8Array): Timestamp {
  const r = new Reader(bytes)
  const ts = readTimestamp(r, msg)
  if (r.i !== bytes.length) throw new Error('trailing bytes after timestamp')
  return ts
}

/** Parse a `.ots` file (SHA-256 file hash only, which is all this app writes). */
export function parseDetached(bytes: Uint8Array): DetachedTimestamp {
  const r = new Reader(bytes)
  const magic = r.bytes(MAGIC.length)
  if (!magic.every((b, i) => b === MAGIC[i])) throw new Error('not an OpenTimestamps proof')
  if (r.varuint() !== 1) throw new Error('unsupported OpenTimestamps version')
  if (r.byte() !== OP_SHA256) throw new Error('only SHA-256 file hashes are supported')
  const digest = r.bytes(32)
  const timestamp = readTimestamp(r, digest)
  if (r.i !== bytes.length) throw new Error('trailing bytes after timestamp')
  return { digest, timestamp }
}

export function serializeDetached(d: DetachedTimestamp): Uint8Array {
  const w = new Writer()
  w.bytes(MAGIC)
  w.varuint(1)
  w.byte(OP_SHA256)
  w.bytes(d.digest)
  writeTimestamp(w, d.timestamp)
  return w.out()
}

/** Every attestation in the tree, with the message it attests. */
export function attestations(ts: Timestamp): { msg: Uint8Array; attestation: Attestation; node: Timestamp }[] {
  const out: { msg: Uint8Array; attestation: Attestation; node: Timestamp }[] = []
  const walk = (t: Timestamp) => {
    for (const a of t.attestations) out.push({ msg: t.msg, attestation: a, node: t })
    for (const { child } of t.ops) walk(child)
  }
  walk(ts)
  return out
}

function merge(into: Timestamp, other: Timestamp) {
  for (const a of other.attestations) {
    const dup = into.attestations.some((b) => JSON.stringify(b, replacer) === JSON.stringify(a, replacer))
    if (!dup) into.attestations.push(a)
  }
  for (const { op, child } of other.ops) {
    const same = into.ops.find((o) => o.op.tag === op.tag && toHex(o.op.arg ?? new Uint8Array()) === toHex(op.arg ?? new Uint8Array()))
    if (same) merge(same.child, child)
    else into.ops.push({ op, child })
  }
}
function replacer(_k: string, v: unknown) {
  return v instanceof Uint8Array ? toHex(v) : v
}

// ---------------------------------------------------------- the workflow ---

type Fetch = typeof fetch

/**
 * Timestamp a file digest at several calendars. A random nonce keeps the
 * calendars from learning even the digest. Resolves once at least one
 * calendar answered; rejects if none did.
 */
export async function stamp(
  digest: Uint8Array,
  calendars: string[] = DEFAULT_CALENDARS,
  opts: { fetchImpl?: Fetch; timeoutMs?: number } = {},
): Promise<{ detached: DetachedTimestamp; answered: string[] }> {
  const doFetch = opts.fetchImpl ?? fetch
  const nonce = crypto.getRandomValues(new Uint8Array(16))
  const appendOp: Op = { tag: OP_APPEND, arg: nonce }
  const withNonce = applyOp(appendOp, digest)
  const tip = nobleSha256(withNonce)
  const tipTs: Timestamp = { msg: tip, attestations: [], ops: [] }
  const answered: string[] = []
  await Promise.all(
    calendars.map(async (cal) => {
      try {
        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 15000)
        // A "simple" cross-origin request: no custom content type, so no preflight.
        const res = await doFetch(`${cal.replace(/\/+$/, '')}/digest`, {
          method: 'POST',
          headers: { Accept: 'application/vnd.opentimestamps.v1' },
          body: tip as BodyInit,
          credentials: 'omit',
          signal: ctl.signal,
        })
        clearTimeout(timer)
        if (!res.ok) return
        merge(tipTs, parseTimestamp(new Uint8Array(await res.arrayBuffer()), tip))
        answered.push(cal)
      } catch {
        /* this calendar is down or blocked: the others suffice */
      }
    }),
  )
  if (answered.length === 0) throw new Error('No timestamp server answered (offline, or blocked).')
  const shaOp: Op = { tag: OP_SHA256 }
  const nonceTs: Timestamp = { msg: withNonce, attestations: [], ops: [{ op: shaOp, child: tipTs }] }
  return { detached: { digest, timestamp: { msg: digest, attestations: [], ops: [{ op: appendOp, child: nonceTs }] } }, answered }
}

/**
 * Ask the calendars whether pending attestations have made it into Bitcoin
 * yet, and fold the answers in. Returns true if anything changed.
 */
export async function upgrade(d: DetachedTimestamp, opts: { fetchImpl?: Fetch } = {}): Promise<boolean> {
  const doFetch = opts.fetchImpl ?? fetch
  let changed = false
  for (const { msg, attestation, node } of attestations(d.timestamp)) {
    if (attestation.kind !== 'pending' || !/^https:\/\//.test(attestation.uri) && !/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(attestation.uri)) continue
    try {
      const res = await doFetch(`${attestation.uri.replace(/\/+$/, '')}/timestamp/${toHex(msg)}`, {
        headers: { Accept: 'application/vnd.opentimestamps.v1' },
        credentials: 'omit',
      })
      if (!res.ok) continue // still pending
      const found = parseTimestamp(new Uint8Array(await res.arrayBuffer()), msg)
      if (!attestations(found).some((a) => a.attestation.kind === 'bitcoin')) continue
      merge(node, found)
      node.attestations = node.attestations.filter((a) => a !== attestation)
      changed = true
    } catch {
      /* try again later */
    }
  }
  return changed
}

export interface StampStatus {
  /** Earliest Bitcoin block the proof reaches, if any. */
  bitcoin: { height: number; merkleRoot: string } | null
  /** Calendars still to hear back from. */
  pending: string[]
}

export function status(d: DetachedTimestamp): StampStatus {
  const all = attestations(d.timestamp)
  const btc = all
    .filter((a) => a.attestation.kind === 'bitcoin')
    .map((a) => ({ height: (a.attestation as { height: number }).height, merkleRoot: toHex(a.msg.slice().reverse()) }))
    .sort((a, b) => a.height - b.height)
  const pending = all.filter((a) => a.attestation.kind === 'pending').map((a) => (a.attestation as { uri: string }).uri)
  return { bitcoin: btc[0] ?? null, pending }
}

/**
 * Check a Bitcoin attestation against the block header, as published by a
 * block explorer: the proof's result must be that block's Merkle root. Returns
 * the block time. (A full node does this without trusting anyone: `ots verify`.)
 */
export async function checkAgainstBlock(
  height: number,
  merkleRoot: string,
  opts: { fetchImpl?: Fetch; explorer?: string } = {},
): Promise<{ ok: boolean; time?: number }> {
  const doFetch = opts.fetchImpl ?? fetch
  const api = (opts.explorer ?? 'https://blockstream.info/api').replace(/\/+$/, '')
  const hash = (await (await doFetch(`${api}/block-height/${height}`, { credentials: 'omit' })).text()).trim()
  if (!/^[0-9a-f]{64}$/.test(hash)) return { ok: false }
  const block = await (await doFetch(`${api}/block/${hash}`, { credentials: 'omit' })).json()
  return block?.merkle_root === merkleRoot ? { ok: true, time: block.timestamp } : { ok: false }
}
