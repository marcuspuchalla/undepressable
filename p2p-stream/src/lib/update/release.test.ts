import { describe, it, expect } from 'vitest'
import { ed25519 } from '@noble/curves/ed25519'
import { toHex } from '../integrity/hashing'
import { checkRelease, fingerprintOf, parseRelease, shortFingerprint, signRelease, RELEASE_FORMAT, type TrustedKey } from './release'

function keypair(id: string) {
  const priv = ed25519.utils.randomPrivateKey()
  return { priv: toHex(priv), key: { id, publicKey: toHex(ed25519.getPublicKey(priv)) } as TrustedKey }
}

async function manifest(extra: Record<string, string> = {}) {
  const files = { 'index.html': 'a'.repeat(64), 'assets/index-1.js': 'b'.repeat(64), ...extra }
  return JSON.stringify({ format: RELEASE_FORMAT, build: '0.1.0+abc123', builtAt: '2026-09-27T10:00:00Z', files, fingerprint: await fingerprintOf(files) }, null, 2)
}

describe('release manifest', () => {
  it('fingerprint does not depend on file order', async () => {
    expect(await fingerprintOf({ a: '1'.repeat(64), b: '2'.repeat(64) })).toBe(await fingerprintOf({ b: '2'.repeat(64), a: '1'.repeat(64) }))
  })

  it('rejects a manifest whose file list does not match its fingerprint', async () => {
    const text = await manifest()
    const m = JSON.parse(text)
    m.files['assets/evil.js'] = 'c'.repeat(64)
    expect(await parseRelease(JSON.stringify(m))).toBeNull()
    expect(await parseRelease(text)).not.toBeNull()
    expect(await parseRelease('<html>not found</html>')).toBeNull()
  })
})

describe('checkRelease', () => {
  const dev = keypair('maintainer 2026')
  const other = keypair('someone else')

  it('trusts an update signed by a pinned key', async () => {
    const text = await manifest()
    const r = await checkRelease(text, signRelease(text, dev.priv), [dev.key])
    expect(r).toMatchObject({ status: 'signed', keyId: 'maintainer 2026' })
    expect(r.manifest?.build).toBe('0.1.0+abc123')
  })

  it('accepts a signature from any of several pinned keys (key rotation)', async () => {
    const text = await manifest()
    expect((await checkRelease(text, signRelease(text, dev.priv), [other.key, dev.key])).status).toBe('signed')
  })

  it('reports a release signed by anyone else as forged', async () => {
    const text = await manifest()
    expect((await checkRelease(text, signRelease(text, other.priv), [dev.key])).status).toBe('forged')
  })

  it('reports a manifest changed after signing as forged', async () => {
    const text = await manifest()
    const sig = signRelease(text, dev.priv)
    const changed = await manifest({ 'assets/extra.js': 'd'.repeat(64) })
    expect((await checkRelease(changed, sig, [dev.key])).status).toBe('forged')
    expect((await checkRelease(text + ' ', sig, [dev.key])).status).toBe('forged') // exact bytes are signed
  })

  it('reports a missing signature as unsigned when this copy expects signatures', async () => {
    const text = await manifest()
    expect((await checkRelease(text, null, [dev.key])).status).toBe('unsigned')
    expect((await checkRelease(text, '  ', [dev.key])).status).toBe('unsigned')
    expect((await checkRelease(text, 'zz', [dev.key])).status).toBe('forged')
  })

  it('cannot judge anything when this copy carries no keys', async () => {
    const text = await manifest()
    expect((await checkRelease(text, null, [])).status).toBe('unverifiable')
  })

  it('reports no manifest (or a broken one) as missing', async () => {
    expect((await checkRelease(null, null, [dev.key])).status).toBe('missing')
    expect((await checkRelease('{}', 'aa', [dev.key])).status).toBe('missing')
  })

  it('short fingerprints group four hex digits', () => {
    expect(shortFingerprint('0123456789abcdef0123')).toBe('0123 4567 89ab cdef')
  })
})
