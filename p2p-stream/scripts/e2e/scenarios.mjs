// Connection scenarios, end to end, in real Chromium.
//
// Two (or more) isolated browsers run the real app against a local Nostr
// relay; a firewall rule can drop direct UDP between them, which is exactly
// what two strict NATs (a VPN exit and a mobile carrier, say) do to ICE. A
// local TURN server is then the only way through — as in the field.
//
// Usage (dev server must be running: `npm run dev`):
//   npm i --no-save playwright@1 node-turn ws
//   node scripts/e2e/scenarios.mjs [scenario ...]
//
// Scenarios: open, blocked, relay-link, relay-one-side, relay-rejected,
// public-relay, relay-added-live, crowd, crowd-large, internet-drops, offline-two-viewers,
// offline-isolated, archive.
// Scenarios that block UDP need root (iptables). Env:
//   APP_URL        default http://localhost:4400
//   HOST_IP        this machine's non-loopback IPv4 (auto-detected)
//   CHROMIUM_PATH  a Chromium binary, if Playwright's default is missing
//
// See docs/RELIABILITY_AUDIT_3.md for results and what each one proves.

import { chromium } from 'playwright'
import { spawn, execFileSync } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const APP = process.env.APP_URL || 'http://localhost:4400'
const HOST_IP =
  process.env.HOST_IP ||
  Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address
const RELAY = 'ws://localhost:7777'
const BLOCK_RULE = ['-p', 'udp', '-s', HOST_IP, '-d', HOST_IP, '-m', 'multiport', '!', '--ports', '3478,20000:24000', '-j', 'DROP']

const helpers = []
function startHelper(file, ...args) {
  const child = spawn(process.execPath, [join(here, file), ...args], { stdio: 'ignore' })
  helpers.push(child)
  return child
}
let relayProcess = null
function block(on, rule = BLOCK_RULE) {
  try {
    execFileSync('iptables', [on ? '-I' : '-D', 'OUTPUT', ...rule], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const launchArgs = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  // Real host IPs instead of mDNS names, so peers on one machine can connect.
  '--disable-features=WebRtcHideLocalIpsWithMdns',
]
const browsers = []
async function newPage(storage) {
  const browser = await chromium.launch({ args: launchArgs, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
  browsers.push(browser)
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 } })
  await ctx.addInitScript((entries) => {
    for (const [k, v] of entries) localStorage.setItem(k, v)
  }, Object.entries({
    undepressable_nostr_relays: JSON.stringify([RELAY]),
    undepressable_nostr_relays_only: '1',
    ...storage,
  }))
  return ctx.newPage()
}
async function closeAll() {
  for (const b of browsers.splice(0)) await b.close().catch(() => {})
}

const turn = (credential = 'test') =>
  ({ undepressable_turn: JSON.stringify({ urls: [`turn:${HOST_IP}:3478`], username: 'test', credential }) })

async function startStream(storage) {
  const page = await newPage(storage)
  await page.goto(`${APP}/stream`)
  await page.waitForSelector('text=Share Stream', { timeout: 30000 })
  const code = (await page.textContent('.font-mono.text-lg')).trim()
  const share = await page.evaluate(() => [...document.querySelectorAll('code')].map((c) => c.textContent.trim()).find((t) => t.includes('/collect/')))
  await page.locator('.fixed.inset-0 button').first().click() // close the share sheet
  const u = new URL(share)
  return { page, code, shareUrl: `${APP}${u.pathname}${u.search}` }
}
async function videoWithin(page, ms) {
  const t = Date.now()
  try {
    await page.waitForFunction(() => {
      const v = document.querySelector('video')
      return v && v.videoWidth > 0 && v.currentTime > 0.5
    }, null, { timeout: ms })
    return (Date.now() - t) / 1000
  } catch {
    return null
  }
}
const statusOf = async (page) =>
  (await page.$$eval('[role=status]', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()))).join(' | ')

// Each scenario returns [passed, detail].
const scenarios = {
  async open() {
    const { page: A, code } = await startStream({})
    const B = await newPage({})
    await B.goto(`${APP}/collect/${code}`)
    const s = await videoWithin(B, 40000)
    return [s !== null && /connected/.test(await statusOf(A)), `video ${s}s; streamer: ${await statusOf(A)}`]
  },
  async blocked() {
    const { page: A, code } = await startStream({})
    const B = await newPage({})
    await B.goto(`${APP}/collect/${code}`)
    await B.waitForSelector('text=your networks block a direct connection', { timeout: 60000 }).catch(() => {})
    const b = await statusOf(B)
    return [/block a direct connection/.test(b) && /Set up a relay/.test(b), `viewer: ${b}`]
  },
  async 'relay-link'() {
    const { page: A, shareUrl } = await startStream(turn())
    const B = await newPage({})
    await B.goto(shareUrl) // the link carries ?turn=… — the viewer sets nothing up
    const s = await videoWithin(B, 40000)
    return [s !== null && /RELAY/.test(await statusOf(A)), `video ${s}s; streamer: ${await statusOf(A)}`]
  },
  async 'relay-one-side'() {
    const { page: A, code } = await startStream({ ...turn(), undepressable_relay_share: '0' })
    const B = await newPage({})
    await B.goto(`${APP}/collect/${code}`)
    const s = await videoWithin(B, 40000)
    return [s !== null, `video ${s}s; streamer: ${await statusOf(A)}`]
  },
  async 'relay-rejected'() {
    const { page: A, shareUrl } = await startStream(turn('WRONG'))
    const B = await newPage({})
    await B.goto(shareUrl)
    await B.waitForSelector('text=rejected its username/password', { timeout: 60000 }).catch(() => {})
    const b = await statusOf(B)
    return [/rejected its username\/password/.test(b), `viewer: ${b}`]
  },
  // A strict pair with no relay of their own: the streamer opts into "free
  // public relays" (pointed at the local TURN server via a dev-only override),
  // the app tests them, keeps the one that answers, and the viewer gets in.
  async 'public-relay'() {
    const candidates = JSON.stringify([
      { id: 'local', label: 'local test relay', server: { urls: [`turn:${HOST_IP}:3478`], username: 'test', credential: 'test' } },
      { id: 'dead', label: 'dead relay', server: { urls: [`turn:${HOST_IP}:3479`], username: 'x', credential: 'y' } },
    ])
    const { page: A, code } = await startStream({ undepressable_dev_public_relay_candidates: candidates })
    const B = await newPage({})
    await B.goto(`${APP}/collect/${code}`)
    await A.waitForSelector('text=your networks block a direct connection', { timeout: 60000 })
    await A.getByRole('button', { name: 'Set up a relay' }).click()
    await A.locator('[data-testid=test-public-relays]').click()
    await A.locator('[data-testid=use-public-relays]').waitFor({ timeout: 20000 })
    const results = (await A.locator('[data-testid=test-public-relays] ~ ul').innerText()).replace(/\s+/g, ' ')
    await A.locator('[data-testid=use-public-relays]').click()
    const s = await videoWithin(B, 40000)
    return [s !== null && /✓ local test relay/.test(results) && /✗ dead relay/.test(results), `tests: ${results}; viewer video ${s}s after opting in`]
  },
  async 'relay-added-live'() {
    const { page: A, code } = await startStream({})
    const B = await newPage({})
    await B.goto(`${APP}/collect/${code}`)
    await A.waitForSelector('text=your networks block a direct connection', { timeout: 60000 })
    await A.getByRole('button', { name: 'Set up a relay' }).click()
    await A.getByPlaceholder('turns:relay.example.org:443').fill(`turn:${HOST_IP}:3478`)
    const inputs = A.locator('input.input.text-sm:not(.font-mono)')
    await inputs.nth(0).fill('test')
    await inputs.nth(1).fill('test')
    await A.getByRole('button', { name: 'Save', exact: true }).click()
    const s = await videoWithin(B, 40000) // the viewer does nothing
    return [s !== null, `viewer video ${s}s after the streamer saved a relay`]
  },
  // Use case 02 at a size where the relay tree matters: the streamer uploads
  // only to its direct children, seed viewers forward to the rest, and every
  // device agrees on how many are watching and recording.
  async 'crowd-large'() {
    const N = 6
    const tree = []
    const { page: A, code } = await startStream({})
    A.on('console', (m) => {
      if (/\[Tree\] (Root streams directly|.* seated under seed)/.test(m.text())) tree.push(m.text())
    })
    const viewers = []
    for (let i = 0; i < N; i++) {
      const p = await newPage({})
      await p.goto(`${APP}/collect/${code}`)
      viewers.push(p)
      await p.waitForTimeout(800)
    }
    const times = await Promise.all(viewers.map((p) => videoWithin(p, 60000)))
    // Counters are a heartbeat away from agreeing; give them a few beats.
    const countsOf = (p) => p.$$eval('.tabular-nums', (els) => els.slice(0, 2).map((e) => Number(e.textContent.trim())))
    const want = JSON.stringify([N, N + 1])
    let all = []
    for (let i = 0; i < 10; i++) {
      all = await Promise.all([A, ...viewers].map(countsOf))
      if (all.every((c) => JSON.stringify(c) === want)) break
      await A.waitForTimeout(2000)
    }
    const direct = new Set(tree.filter((t) => /Root streams directly/.test(t)).map((t) => t.split(' ').pop())).size
    const seeded = tree.filter((t) => /seated under seed/.test(t)).length
    const ok = times.every((t) => t !== null) && all.every((c) => JSON.stringify(c) === want) && direct <= 2 && seeded >= N - 2
    return [ok, `videos ${times.map((t) => (t === null ? 'NONE' : t.toFixed(1))).join(', ')}s; counts [watching, recording] on each device ${all.map((c) => c.join('/')).join(' ')}; streamer uploads to ${direct}, ${seeded} served by seeds`]
  },
  async crowd() {
    const { page: A, code } = await startStream({})
    const viewers = []
    for (let i = 0; i < 3; i++) {
      const p = await newPage({})
      await p.goto(`${APP}/collect/${code}`)
      viewers.push(p)
    }
    const times = await Promise.all(viewers.map((p) => videoWithin(p, 45000)))
    return [times.every((t) => t !== null), `videos ${times.join(', ')}s; streamer: ${await statusOf(A)}`]
  },
}

// --- offline pairing (no relays, no internet involved) -----------------------
const codeOf = async (p) => (await p.locator('[data-testid=pair-code]').first().textContent()).trim()
async function pasteCode(p, text) {
  await p.locator('[data-testid=pair-paste]').first().fill(text)
  await p.getByRole('button', { name: 'Use', exact: true }).first().click()
}
async function offlineViewer(streamer) {
  const v = await newPage({})
  await v.goto(`${APP}/offline`)
  await v.getByText("I'm receiving").click()
  await pasteCode(v, await codeOf(streamer)) // the codes travel as text: no cameras needed
  await v.waitForSelector('[data-testid=pair-code]', { timeout: 15000 })
  await pasteCode(streamer, await codeOf(v))
  return v
}
const viewersCard = async (p) =>
  (await p.locator('.card', { has: p.locator('h2', { hasText: 'Viewers' }) }).innerText()).replace(/\s+/g, ' ')

Object.assign(scenarios, {
  // Use case 03: connected over a hotspot, then the internet goes away. Media
  // is peer-to-peer, so the picture must keep flowing with discovery gone.
  async 'internet-drops'() {
    const { code } = await startStream({})
    const B = await newPage({})
    await B.goto(`${APP}/collect/${code}`)
    const s = await videoWithin(B, 40000)
    relayProcess.kill() // discovery (the "internet" here) disappears
    await B.waitForTimeout(15000)
    const advancing = await B.evaluate(async () => {
      const v = document.querySelector('video')
      const a = v.currentTime
      await new Promise((r) => setTimeout(r, 2000))
      return v.currentTime > a
    })
    const interrupted = await B.locator('text=Stream interrupted').count()
    relayProcess = startHelper('nostr-relay.mjs', '7777')
    await new Promise((r) => setTimeout(r, 500))
    return [s !== null && advancing && interrupted === 0, `video ${s}s; 15 s after discovery died: ${advancing ? 'still playing' : 'FROZEN'}, interrupted overlay: ${interrupted}`]
  },
  async 'offline-two-viewers'() {
    const A = await newPage({})
    await A.goto(`${APP}/offline`)
    await A.getByText("I'm filming").click()
    await A.waitForSelector('[data-testid=pair-code]', { timeout: 15000 })
    const codeLength = (await codeOf(A)).length
    const B = await offlineViewer(A)
    const b = await videoWithin(B, 20000)
    await A.getByRole('button', { name: 'Add another viewer' }).click()
    await A.waitForSelector('[data-testid=pair-code]', { timeout: 15000 })
    const C = await offlineViewer(A)
    const c = await videoWithin(C, 20000)
    await A.waitForSelector('text=recording a copy', { timeout: 10000 }).catch(() => {})
    const card = await viewersCard(A)
    const ok = b !== null && c !== null && (card.match(/connected/g) ?? []).length === 2 && codeLength < 200
    return [ok, `code ${codeLength} chars; videos ${b}s, ${c}s; ${card}`]
  },
  async 'offline-isolated'() {
    const A = await newPage({})
    await A.goto(`${APP}/offline`)
    await A.getByText("I'm filming").click()
    await A.waitForSelector('[data-testid=pair-code]', { timeout: 15000 })
    await offlineViewer(A)
    await A.waitForSelector("text=couldn't reach them", { timeout: 40000 }).catch(() => {})
    const card = await viewersCard(A)
    return [/couldn't reach them/.test(card) && /hotspot/.test(card), card.slice(0, 160)]
  },
  async archive() {
    const home = await newPage({})
    await home.goto(`${APP}/archive`)
    await home.waitForFunction(() => /\/pair-home\//.test(document.body.innerText), null, { timeout: 15000 })
    const pairLink = await home.evaluate(() => document.body.innerText.match(/\S*\/pair-home\/\S+/)[0])
    const { code } = await startStream({})
    const phone = await newPage({})
    const u = new URL(pairLink)
    await phone.goto(`${APP}${u.pathname}${u.search}`) // pair once
    await phone.goto(`${APP}/collect/${code}`) // then watch at the scene
    const watched = await videoWithin(phone, 40000)
    const archived = await videoWithin(home, 40000)
    await home.waitForSelector('text=Recording a forwarded stream', { timeout: 15000 }).catch(() => {})
    const status = (await home.locator('.card').nth(1).innerText()).replace(/\s+/g, ' ')
    return [watched !== null && archived !== null && /Recording a forwarded stream/.test(status), `phone video ${watched}s, home video ${archived}s; home: ${status.slice(0, 120)}`]
  },
})
const BLOCK_ALL_RULE = ['-p', 'udp', '-s', HOST_IP, '-d', HOST_IP, '-j', 'DROP']
const NEEDS_BLOCK = new Set(['blocked', 'relay-link', 'relay-one-side', 'relay-rejected', 'relay-added-live', 'public-relay', 'offline-isolated'])

relayProcess = startHelper('nostr-relay.mjs', '7777')
startHelper('turn-server.mjs', HOST_IP)
await new Promise((r) => setTimeout(r, 1000))

let failures = 0
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenarios)
try {
  for (const name of wanted) {
    const needsBlock = NEEDS_BLOCK.has(name)
    const rule = name === 'offline-isolated' ? BLOCK_ALL_RULE : BLOCK_RULE
    if (needsBlock && !block(true, rule)) {
      console.log(`SKIP ${name}: needs root for iptables`)
      continue
    }
    try {
      const [ok, detail] = await scenarios[name]()
      if (!ok) failures++
      console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`)
    } catch (err) {
      failures++
      console.log(`FAIL ${name}: ${err.message}`)
    } finally {
      await closeAll()
      if (needsBlock) block(false, rule)
    }
  }
} finally {
  for (const h of helpers) h.kill()
}
process.exit(failures ? 1 : 0)
