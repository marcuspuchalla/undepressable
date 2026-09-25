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
}
function block(on) {
  try {
    execFileSync('iptables', [on ? '-I' : '-D', 'OUTPUT', ...BLOCK_RULE], { stdio: 'ignore' })
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
const NEEDS_BLOCK = new Set(['blocked', 'relay-link', 'relay-one-side', 'relay-rejected', 'relay-added-live'])

startHelper('nostr-relay.mjs', '7777')
startHelper('turn-server.mjs', HOST_IP)
await new Promise((r) => setTimeout(r, 1000))

let failures = 0
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenarios)
try {
  for (const name of wanted) {
    const needsBlock = NEEDS_BLOCK.has(name)
    if (needsBlock && !block(true)) {
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
      if (needsBlock) block(false)
    }
  }
} finally {
  for (const h of helpers) h.kill()
}
process.exit(failures ? 1 : 0)
