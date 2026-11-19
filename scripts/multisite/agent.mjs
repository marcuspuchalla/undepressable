// One participant of a multi-site test, run on a real machine somewhere on
// the internet (docs/MULTISITE_TEST_PLAN.md).
//
// Serves the built app to itself on localhost (a secure context, and the exact
// build under test), drives it in headless Chromium with Chrome's fake camera,
// and reports what happened as one JSON object per line on stdout — the
// controller (run.mjs) collects those lines over SSH.
//
//   node agent.mjs streamer                 → emits {"event":"room","code":…}
//   node agent.mjs viewer <path-and-query>  → e.g. /collect/AB12CD?turn=…
//                                             (PAIR_PATH: pair with a home first)
//   node agent.mjs home                     → emits {"event":"pair","path":…}
//
// Env: DURATION_S (how long to stay after connecting, default 60),
//      STORAGE_JSON (localStorage entries to preload, e.g. a TURN relay),
//      SITE (label echoed in every event), DIST (built app, default ./dist),
//      CHROMIUM_PATH (optional).

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const DIST = process.env.DIST || join(here, 'dist')
const DURATION_S = Number(process.env.DURATION_S || 60)
const SITE = process.env.SITE || 'unknown'
// STORAGE_B64 is the same JSON, base64-encoded so it survives SSH quoting.
const STORAGE = JSON.parse(
  process.env.STORAGE_JSON || (process.env.STORAGE_B64 ? Buffer.from(process.env.STORAGE_B64, 'base64').toString() : '{}'),
)
const [role, target] = process.argv.slice(2)

const t0 = Date.now()
const emit = (event, data = {}) =>
  process.stdout.write(JSON.stringify({ event, site: SITE, role, t: +((Date.now() - t0) / 1000).toFixed(1), ...data }) + '\n')

// --- the app, served to this machine only ----------------------------------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.wasm': 'application/wasm' }
async function serve() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
    let file = join(DIST, path)
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
    } catch {
      file = join(DIST, 'index.html') // SPA fallback for /stream, /collect/CODE …
    }
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return `http://localhost:${server.address().port}`
}

// --- WebRTC introspection ----------------------------------------------------
// Keep a handle on every RTCPeerConnection the app (Trystero) creates, so the
// agent can report which path the media actually took: direct (host), via a
// NAT mapping (srflx/prflx), or through a TURN relay — and over UDP or TCP.
function trackPeerConnections() {
  const Orig = window.RTCPeerConnection
  const pcs = []
  window.__pcs = pcs
  window.RTCPeerConnection = class extends Orig {
    constructor(...args) {
      super(...args)
      pcs.push(this)
    }
  }
}

async function mediaPaths(page) {
  return page.evaluate(async () => {
    const out = []
    for (const [index, pc] of (window.__pcs || []).entries()) {
      if (pc.connectionState === 'closed') continue
      const stats = await pc.getStats()
      const byId = new Map()
      stats.forEach((s) => byId.set(s.id, s))
      let pair = null
      let inbound = null
      let outbound = null
      stats.forEach((s) => {
        if (s.type === 'transport' && s.selectedCandidatePairId) pair = byId.get(s.selectedCandidatePairId)
        if (s.type === 'inbound-rtp' && s.kind === 'video') inbound = s
        if (s.type === 'outbound-rtp' && s.kind === 'video') outbound = s
      })
      if (!inbound && !outbound) continue // a signaling/data-only connection
      const local = pair && byId.get(pair.localCandidateId)
      const remote = pair && byId.get(pair.remoteCandidateId)
      out.push({
        pc: index, // stable across ticks, so the controller can tell which uploads are still sending
        state: pc.connectionState,
        local: local && `${local.candidateType}/${local.protocol}${local.relayProtocol ? '/' + local.relayProtocol : ''}`,
        remote: remote && `${remote.candidateType}/${remote.protocol}`,
        remoteAddr: remote && remote.address,
        rttMs: pair && pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null,
        in: inbound && {
          fps: inbound.framesPerSecond ?? null,
          size: inbound.frameWidth ? `${inbound.frameWidth}x${inbound.frameHeight}` : null,
          bytes: inbound.bytesReceived,
          lost: inbound.packetsLost,
          freezes: inbound.freezeCount ?? null,
          jitterMs: inbound.jitter != null ? Math.round(inbound.jitter * 1000) : null,
        },
        out: outbound && { bytes: outbound.bytesSent, fps: outbound.framesPerSecond ?? null, limit: outbound.qualityLimitationReason ?? null },
      })
    }
    return out
  })
}

const statusOf = async (page) =>
  (await page.$$eval('[role=status]', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()))).join(' | ')
const countsOf = (page) =>
  page.$$eval('.tabular-nums', (els) => els.slice(0, 2).map((e) => Number(e.textContent.trim()))).catch(() => [])

async function videoWithin(page, ms) {
  const start = Date.now()
  try {
    await page.waitForFunction(() => {
      const v = document.querySelector('video')
      return v && v.videoWidth > 0 && v.currentTime > 0.5
    }, null, { timeout: ms })
    return (Date.now() - start) / 1000
  } catch {
    return null
  }
}

// --- main ------------------------------------------------------------------
const APP = await serve()
const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
})
const ctx = await browser.newContext({ viewport: { width: 400, height: 860 } })
await ctx.addInitScript((entries) => {
  for (const [k, v] of entries) localStorage.setItem(k, v)
}, Object.entries(STORAGE))
await ctx.addInitScript(trackPeerConnections)
const page = await ctx.newPage()
const logs = []
page.on('console', (m) => {
  const text = m.text()
  if (/\[(Tree|Trystero|CollectView|StreamView|Archive)/.test(text)) logs.push(`${((Date.now() - t0) / 1000).toFixed(1)} ${text}`)
  // Relay-tree decisions, live, so the controller can see who seeds whom.
  if (/\[Tree\] (Forwarding stream to|Root streams directly to|.* seated under seed)/.test(text)) emit('tree', { line: text })
})

let stopping = false
async function finish(extra = {}) {
  if (stopping) return
  stopping = true
  const paths = await mediaPaths(page).catch(() => [])
  emit('summary', { status: await statusOf(page).catch(() => ''), counts: await countsOf(page), paths, log: logs.slice(-40), ...extra })
  await browser.close().catch(() => {})
  process.exit(0)
}
process.on('SIGTERM', () => finish({ aborted: true }))
process.on('SIGINT', () => finish({ aborted: true }))

async function heartbeat(untilS) {
  const end = Date.now() + untilS * 1000
  while (Date.now() < end) {
    await page.waitForTimeout(5000)
    emit('tick', { status: await statusOf(page).catch(() => ''), counts: await countsOf(page), paths: await mediaPaths(page).catch(() => []) })
  }
}

try {
  if (role === 'streamer') {
    await page.goto(`${APP}/stream`)
    await page.waitForSelector('text=Share Stream', { timeout: 45000 })
    const code = (await page.textContent('.font-mono.text-lg')).trim()
    const share = await page.evaluate(() => [...document.querySelectorAll('code')].map((c) => c.textContent.trim()).find((t) => t.includes('/collect/')))
    await page.locator('.fixed.inset-0 button').first().click() // close the share sheet
    const u = new URL(share)
    emit('room', { code, path: `${u.pathname}${u.search}` })
    await heartbeat(DURATION_S)
    await finish()
  } else if (role === 'home') {
    // Use case 04's home node: publish the pairing link, then wait for a
    // forwarded stream to arrive and be recorded.
    await page.goto(`${APP}/archive`)
    await page.waitForFunction(() => /\/pair-home\//.test(document.body.innerText), null, { timeout: 30000 })
    const pair = new URL(await page.evaluate(() => document.body.innerText.match(/\S*\/pair-home\/\S+/)[0]))
    emit('pair', { path: `${pair.pathname}${pair.search}` })
    const start = Date.now()
    const playing = await videoWithin(page, Number(process.env.CONNECT_TIMEOUT_S || 180) * 1000)
    const ttffS = playing === null ? null : +((Date.now() - start) / 1000).toFixed(1)
    await page.waitForSelector('text=Recording a forwarded stream', { timeout: 15000 }).catch(() => {})
    const card = await page.locator('.card').nth(1).innerText().catch(() => '')
    emit('video', { ttffS, card: card.replace(/\s+/g, ' ').slice(0, 160) })
    await heartbeat(ttffS === null ? 0 : DURATION_S)
    await finish({ ttffS, card: card.replace(/\s+/g, ' ').slice(0, 160) })
  } else if (role === 'viewer') {
    // A phone at the scene that forwards to a home archive pairs once first.
    if (process.env.PAIR_PATH) await page.goto(`${APP}${process.env.PAIR_PATH}`)
    // Time to first frame counts from navigation: app load, discovery, ICE
    // and the first decoded frames — what a person at the scene waits for.
    const start = Date.now()
    await page.goto(`${APP}${target}`)
    const playing = await videoWithin(page, Number(process.env.CONNECT_TIMEOUT_S || 90) * 1000)
    const ttffS = playing === null ? null : +((Date.now() - start) / 1000).toFixed(1)
    emit('video', { ttffS, status: await statusOf(page) })
    await heartbeat(ttffS === null ? 0 : DURATION_S)
    await finish({ ttffS })
  } else {
    throw new Error(`unknown role ${role}`)
  }
} catch (err) {
  // A deliberate stop closes the browser under a pending wait — not a failure.
  if (!stopping) {
    emit('error', { message: String(err && err.message || err) })
    await finish({ error: true })
  }
}
