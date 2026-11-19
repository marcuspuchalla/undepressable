import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PATCHES, applyPatch, isPatched, RELAY_RETRY_CAP_MS } from './patch-deps.mjs'

// The lines each patch targets, as published in trystero 0.22.
const UPSTREAM = {
  'trystero/src/strategy.js': 'const poolSize = 20\n',
  'trystero/src/torrent.js': 'const offerPoolSize = 10\n',
  'trystero/src/utils.js': '      setTimeout(init, socketRetryPeriods[url])\n      socketRetryPeriods[url] *= 2\n',
}

function fakeNodeModules() {
  const dir = mkdtempSync(join(tmpdir(), 'patch-deps-'))
  for (const [file, code] of Object.entries(UPSTREAM)) {
    mkdirSync(join(dir, file, '..'), { recursive: true })
    writeFileSync(join(dir, file), code)
  }
  return dir
}

describe('patch-deps', () => {
  it('patches every upstream line, then reports them as already applied', () => {
    const dir = fakeNodeModules()
    expect(PATCHES.map((p) => applyPatch(p, dir))).toEqual(PATCHES.map(() => 'patched'))
    expect(PATCHES.map((p) => applyPatch(p, dir))).toEqual(PATCHES.map(() => 'already'))
    expect(isPatched(dir)).toBe(true)
    expect(readFileSync(join(dir, 'trystero/src/utils.js'), 'utf8')).toContain(`Math.min(socketRetryPeriods[url] * 2, ${RELAY_RETRY_CAP_MS})`)
  })

  it('flags a changed upstream line instead of silently skipping it', () => {
    const dir = fakeNodeModules()
    writeFileSync(join(dir, 'trystero/src/utils.js'), 'socketRetryPeriods[url] <<= 1\n')
    expect(applyPatch(PATCHES[2], dir)).toBe('unexpected')
    expect(isPatched(dir)).toBe(false)
  })

  it('the installed copy is patched', () => {
    expect(isPatched()).toBe(true)
  })
})

describe('discovery reconnects after a block lifts', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('retries at most RELAY_RETRY_CAP_MS apart, however long the block', async () => {
    vi.useFakeTimers()
    const opened = []
    // A server that refuses every connection: each socket closes at once.
    class RefusedSocket {
      constructor(url) {
        this.url = url
        this.readyState = 0
        opened.push(Date.now())
        setTimeout(() => this.onclose?.(), 0)
      }
      send() {}
    }
    vi.stubGlobal('WebSocket', RefusedSocket)
    const { makeSocket } = await import('../node_modules/trystero/src/utils.js')
    makeSocket(`wss://blocked-${Math.random()}.example`, () => {})
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000) // twenty minutes blocked
    // Attempt to attempt: the retry delay plus the (simulated, ~1 ms) refusal.
    const gaps = opened.slice(1).map((t, i) => t - opened[i])
    expect(Math.max(...gaps)).toBeLessThanOrEqual(RELAY_RETRY_CAP_MS + 10)
    // Unpatched, twenty minutes held only ~9 attempts (3.3 s doubling).
    expect(opened.length).toBeGreaterThan(35)
  })
})
