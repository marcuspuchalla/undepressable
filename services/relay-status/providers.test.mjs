import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { coturnProvider, cloudflareProvider, expressTurnProvider, cloudflareQuery, cloudflareEgress, turnHmacKey } from './providers.mjs'
import { emptyState, usedBytes, GB } from './usage.mjs'

// Through require: Vite's resolver does not know node:sqlite.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')

const NOV = Date.UTC(2026, 10, 19, 12)
const res = (body, ok = true, status = 200) => ({ ok, status, json: async () => body, text: async () => body })

describe('coturn (fmp)', () => {
  const dbPath = () => join(mkdtempSync(join(tmpdir(), 'relay-status-')), 'turndb')
  const env = (userdb) => ({
    FMP_URLS: 'turn:relay.example:3478,turns:relay.example:443?transport=tcp',
    FMP_USERNAME: 'undepressable',
    FMP_PASSWORD: 'pw',
    FMP_REALM: 'undepressable',
    FMP_METRICS_URL: 'http://127.0.0.1:9641/metrics',
    FMP_USERDB: userdb,
  })
  const openDb = (p) => new DatabaseSync(p)

  it('counts bytes leaving the server from the relay metrics', async () => {
    let total = 1000
    const fetch = vi.fn(async () => res(`turn_total_traffic_sentb ${total}\nturn_total_traffic_peer_sentb ${total}\nturn_total_traffic_rcvb 9`))
    const p = coturnProvider(env(dbPath()), { fetch, openDb })
    const s = emptyState()
    await p.poll(s, NOV)
    total = 1000 + 2 * GB
    await p.poll(s, NOV)
    expect(usedBytes(s, 'fmp', NOV)).toBe(4 * GB)
  })

  it('counts a fresh relay with no traffic counters yet as zero, but not a non-relay answer', async () => {
    const s = emptyState()
    await coturnProvider(env(dbPath()), { fetch: async () => res('turn_ratelimit_total_buckets 0'), openDb }).poll(s, NOV)
    expect(usedBytes(s, 'fmp', NOV)).toBe(0)
    await expect(coturnProvider(env(dbPath()), { fetch: async () => res('<html>'), openDb }).poll(emptyState(), NOV)).rejects.toThrow('none of')
  })

  it('adds the user to coturn while active and removes it when not', () => {
    const path = dbPath()
    const p = coturnProvider(env(path), { openDb })
    p.enforce(true)
    const rows = () => new DatabaseSync(path).prepare('SELECT realm, name, hmackey FROM turnusers_lt').all()
    expect(rows()).toEqual([{ realm: 'undepressable', name: 'undepressable', hmackey: turnHmacKey('undepressable', 'undepressable', 'pw') }])
    p.enforce(false)
    expect(rows()).toEqual([])
    p.enforce(true)
    expect(rows()).toHaveLength(1)
  })

  it('computes the long-term-credential key coturn expects', () => {
    // md5("user:realm:pass"), as turnadmin -k would print it.
    expect(turnHmacKey('user', 'realm', 'pass')).toBe('8493fbc53ba582fb4c044c456bdc40eb')
  })

  it('is unconfigured without its settings', () => {
    expect(coturnProvider({}).configured).toBe(false)
  })
})

describe('Cloudflare', () => {
  const env = { CF_ACCOUNT_ID: 'acc', CF_ANALYTICS_TOKEN: 'an', CF_TURN_KEY_ID: 'key', CF_TURN_KEY_TOKEN: 'tok', CF_CREDENTIAL_TTL_HOURS: '6' }
  const minted = (username) =>
    res({
      iceServers: {
        urls: [
          'stun:stun.cloudflare.com:3478',
          'turn:turn.cloudflare.com:3478?transport=udp',
          'turn:turn.cloudflare.com:3478?transport=tcp',
          'turns:turn.cloudflare.com:443?transport=tcp',
        ],
        username,
        credential: 'secret',
      },
    })

  it('asks the analytics for this month of our key', () => {
    const q = cloudflareQuery('acc', 'key', NOV)
    expect(q.variables).toEqual({ accountTag: 'acc', keyId: 'key', from: '2026-11-01', to: '2026-11-19' })
    expect(q.query).toContain('callsTurnUsageAdaptiveGroups')
    expect(q.query).toContain('egressBytes')
  })

  it('reads the egress total, and refuses an error answer', () => {
    expect(cloudflareEgress({ data: { viewer: { accounts: [{ callsTurnUsageAdaptiveGroups: [{ sum: { egressBytes: 123 } }] }] } } })).toBe(123)
    expect(cloudflareEgress({ data: { viewer: { accounts: [{ callsTurnUsageAdaptiveGroups: [] }] } } })).toBe(0)
    expect(() => cloudflareEgress({ errors: [{ message: 'not authorized' }] })).toThrow('not authorized')
  })

  it('mints one credential, shares it, keeps UDP 3478 and TLS 443 only', async () => {
    const fetch = vi.fn(async () => minted('u1'))
    const p = cloudflareProvider(env, { fetch })
    const a = await p.iceServers(NOV)
    const b = await p.iceServers(NOV + 3600_000)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(b).toBe(a)
    expect(a[0].urls).toEqual(['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'])
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ ttl: 6 * 3600 })
  })

  it('mints a fresh one when half the lifetime is gone', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(minted('u1')).mockResolvedValueOnce(minted('u2'))
    const p = cloudflareProvider(env, { fetch })
    await p.iceServers(NOV)
    const later = await p.iceServers(NOV + 3.5 * 3600_000)
    expect(later[0].username).toBe('u2')
  })

  it('revokes every live credential when switched off', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(minted('u1')).mockResolvedValueOnce(minted('u2')).mockResolvedValue(res(null, true, 204))
    const p = cloudflareProvider(env, { fetch })
    await p.iceServers(NOV)
    await p.iceServers(NOV + 4 * 3600_000)
    await p.enforce(false, NOV + 4 * 3600_000)
    const revoked = fetch.mock.calls.filter(([url]) => url.endsWith('/revoke')).map(([url]) => url)
    expect(revoked).toEqual([
      'https://rtc.live.cloudflare.com/v1/turn/keys/key/credentials/u1/revoke',
      'https://rtc.live.cloudflare.com/v1/turn/keys/key/credentials/u2/revoke',
    ])
    expect(p.issued).toEqual([])
  })

  it('caps the credential lifetime at 48 hours', async () => {
    const fetch = vi.fn(async () => minted('u1'))
    await cloudflareProvider({ ...env, CF_CREDENTIAL_TTL_HOURS: '100' }, { fetch }).iceServers(NOV)
    expect(JSON.parse(fetch.mock.calls[0][1].body).ttl).toBe(48 * 3600)
  })
})

describe('ExpressTURN', () => {
  it('uses the figure entered for this month, ignores an old month', async () => {
    const p = expressTurnProvider({ ET_USERNAME: 'u', ET_PASSWORD: 'p' })
    const s = emptyState()
    s.manual.expressturn = { month: '2026-10', usedGB: 500 }
    await p.poll(s, NOV)
    expect(usedBytes(s, 'expressturn', NOV)).toBe(0)
    s.manual.expressturn = { month: '2026-11', usedGB: 12.5 }
    await p.poll(s, NOV)
    expect(usedBytes(s, 'expressturn', NOV)).toBe(12.5 * GB)
    expect(await p.iceServers()).toEqual([{ urls: ['turn:free.expressturn.com:3478'], username: 'u', credential: 'p' }])
  })
})
