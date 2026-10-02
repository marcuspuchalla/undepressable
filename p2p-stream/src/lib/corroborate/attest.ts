/**
 * Live attestations: once a second, the device filming signs a perceptual
 * fingerprint of what its camera shows. They travel to every viewer with the
 * stream (a few hundred bytes a second) and are kept with each viewer's
 * recording, so a viewer's copy can later be checked against what the
 * filmer's device signed — even when that device is long gone.
 */

import { ed25519 } from '@noble/curves/ed25519'
import { toHex, fromHex } from '../integrity/hashing'
import type { Identity } from '../integrity/identity'

export interface Attestation {
  v: 1
  /** Random id of this stream session. */
  s: string
  /** Sequence number within the stream. */
  n: number
  /** Milliseconds since the stream started, on the filming device. */
  t: number
  /** Fingerprint of the frame (lib/corroborate/fingerprint.ts). */
  f: string
  /** The filming device's public key (hex) — the same key that signs its recordings. */
  pk: string
  sig: string
}

/** Receipt annotation added by the viewer: when it arrived, relative to the viewer's recording start. */
export interface ReceivedAttestation extends Attestation {
  rt?: number
}

function message(a: Omit<Attestation, 'sig' | 'pk' | 'v'>): Uint8Array {
  return new TextEncoder().encode(`undepressable-attest-v1\n${a.s}\n${a.n}\n${a.t}\n${a.f}`)
}

export function signAttestation(fields: { s: string; n: number; t: number; f: string }, identity: Identity): Attestation {
  return {
    v: 1,
    ...fields,
    pk: toHex(identity.publicKey),
    sig: toHex(ed25519.sign(message(fields), identity.privateKey)),
  }
}

export function isAttestationShape(x: any): x is Attestation {
  return (
    !!x &&
    x.v === 1 &&
    typeof x.s === 'string' && x.s.length <= 64 &&
    Number.isInteger(x.n) && x.n >= 0 &&
    Number.isFinite(x.t) && x.t >= 0 &&
    typeof x.f === 'string' && /^[0-9a-f]{32}$/.test(x.f) &&
    typeof x.pk === 'string' && /^[0-9a-f]{64}$/.test(x.pk) &&
    typeof x.sig === 'string' && /^[0-9a-f]{128}$/.test(x.sig)
  )
}

export function verifyAttestation(a: unknown): a is Attestation {
  if (!isAttestationShape(a)) return false
  try {
    return ed25519.verify(fromHex(a.sig), message(a), fromHex(a.pk))
  } catch {
    return false
  }
}

export function newStreamId(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(8)))
}
