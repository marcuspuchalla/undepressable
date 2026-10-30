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
// public-relay, relay-added-live, crowd, crowd-large, internet-drops,
// offline-two-viewers, offline-isolated, archive, evidence-file, home-sync,
// offline-handover, offline-chain, offline-chain-repair, messenger-pair,
// messenger-pair-late, amplify-streamer, amplify-viewer, sealed-home,
// sealed-passphrase, sealed-blind-carrier, timestamp, corroborate,
// corroborate-offline, corroborate-sealed, throttled, combine, blend-in,
// self-check (needs npm run build:verify).
// Scenarios that block UDP need root (iptables). Env:
//   APP_URL        default http://localhost:4400
//   HOST_IP        this machine's non-loopback IPv4 (auto-detected)
//   CHROMIUM_PATH  a Chromium binary, if Playwright's default is missing
//   TRACE=1        throttled: print the filming side's link stats every 3 s
//
// See docs/RELIABILITY_AUDIT_3.md for results and what each one proves.

import { chromium } from 'playwright'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
import { spawn, execFileSync } from 'node:child_process'
import { networkInterfaces, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
// LIVE=1: run against a deployed single-file build (routes in the hash, the
// app's modules via window.__und) with the real public discovery relays —
// APP_URL defaults to the GitHub Pages site. LOCAL_RELAY=1 keeps discovery on
// the local test relay even then.
const LIVE = !!process.env.LIVE
const APP = process.env.APP_URL || (LIVE ? 'https://marcuspuchalla.github.io/undepressable/' : 'http://localhost:4400')
const route = (path) => (LIVE ? `${APP.replace(/\/?$/, '/')}#${path}` : `${APP}${path}`)
/** A query parameter of a link, whether it sits in the search part or after the route in the hash. */
function linkParam(url, name) {
  const u = new URL(url)
  const q = u.hash.indexOf('?')
  return u.searchParams.get(name) ?? (q >= 0 ? new URLSearchParams(u.hash.slice(q + 1)).get(name) : null)
}
/** The app's modules inside a page: the dev server's sources, or a built copy's window.__und. */
const LIB = `(window.__und ?? (window.__und ?? await import('/src/lib/recordingDb.ts')))`
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
  '--autoplay-policy=no-user-gesture-required',
  // Real host IPs instead of mDNS names, so peers on one machine can connect.
  '--disable-features=WebRtcHideLocalIpsWithMdns',
]
const browsers = []
let netlogs = 0
async function newPage(storage, extraArgs = []) {
  // NETLOG=<dir>: Chromium's own log of every DNS lookup and socket, per browser.
  const netlog = process.env.NETLOG ? [`--log-net-log=${join(process.env.NETLOG, `netlog-${++netlogs}.json`)}`, '--net-log-capture-mode=Default'] : []
  // A live run reaches the site through whatever proxy the environment sets
  // (Chromium reads it, and leaves localhost alone); one that intercepts TLS,
  // as a sandbox's does, needs its certificate accepted.
  const liveArgs = LIVE ? ['--ignore-certificate-errors'] : []
  const browser = await chromium.launch({ args: [...launchArgs, ...liveArgs, ...extraArgs, ...netlog], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
  browsers.push(browser)
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, ...(LIVE ? { ignoreHTTPSErrors: true } : {}) })
  if (process.env.TRACE)
    await ctx.addInitScript(() => {
      const Orig = window.RTCPeerConnection
      window.__pcs = []
      window.RTCPeerConnection = class extends Orig {
        constructor(...a) {
          super(...a)
          window.__pcs.push(this)
        }
      }
    })
  // The local test relay for discovery — unless a live run uses the public ones.
  const discovery = LIVE && !process.env.LOCAL_RELAY ? {} : { undepressable_nostr_relays: JSON.stringify([RELAY]), undepressable_nostr_relays_only: '1' }
  await ctx.addInitScript((entries) => {
    for (const [k, v] of entries) localStorage.setItem(k, v)
  }, Object.entries({ ...discovery, ...storage }))
  return ctx.newPage()
}
async function closeAll() {
  for (const b of browsers.splice(0)) await b.close().catch(() => {})
}

const turn = (credential = 'test') =>
  ({ undepressable_turn: JSON.stringify({ urls: [`turn:${HOST_IP}:3478`], username: 'test', credential }) })

async function startStream(storage, extraArgs = []) {
  const page = await newPage(storage, extraArgs)
  await page.goto(`${route('/stream')}`)
  await page.waitForSelector('text=Share Stream', { timeout: 30000 })
  const code = (await page.textContent('.font-mono.text-lg')).trim()
  const share = await page.evaluate(() => [...document.querySelectorAll('code')].map((c) => c.textContent.trim()).find((t) => t.includes('/collect/')))
  await page.locator('.fixed.inset-0 button').first().click() // close the share sheet
  const u = new URL(share)
  return { page, code, shareUrl: LIVE ? share : `${APP}${u.pathname}${u.search}` }
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
    await B.goto(`${route(`/collect/${code}`)}`)
    const s = await videoWithin(B, 40000)
    return [s !== null && /connected/.test(await statusOf(A)), `video ${s}s; streamer: ${await statusOf(A)}`]
  },
  async blocked() {
    const { page: A, code } = await startStream({})
    const B = await newPage({})
    await B.goto(`${route(`/collect/${code}`)}`)
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
    await B.goto(`${route(`/collect/${code}`)}`)
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
    await B.goto(`${route(`/collect/${code}`)}`)
    await A.waitForSelector('text=your networks block a direct connection', { timeout: 60000 })
    await A.getByRole('button', { name: 'Set up a relay' }).click()
    await A.locator('[data-testid=test-public-relays]').click()
    await A.locator('[data-testid=use-public-relays]').waitFor({ timeout: 20000 })
    const results = (await A.locator('[data-testid=test-public-relays] ~ ul').innerText()).replace(/\s+/g, ' ')
    await A.locator('[data-testid=use-public-relays]').click()
    const s = await videoWithin(B, 40000)
    return [s !== null && /✓ local test relay/.test(results) && /✗ dead relay/.test(results), `tests: ${results}; viewer video ${s}s after opting in`]
  },
  // The field report (round 9): what the relay panel found stays on screen
  // after the panel was closed and re-opened, and on a strict network the
  // STUN section says it will not help instead of offering a remedy.
  async 'relay-panel-remembers'() {
    const candidates = JSON.stringify([
      { id: 'dead', label: 'dead relay', server: { urls: [`turn:${HOST_IP}:3479`], username: 'x', credential: 'y' } },
    ])
    const { code } = await startStream({ undepressable_dev_public_relay_candidates: candidates })
    const B = await newPage({ undepressable_dev_public_relay_candidates: candidates })
    // The network check cannot see STUN from here; tell the viewer what a VPN or carrier would show it.
    await B.addInitScript(() => sessionStorage.setItem('undepressable_nat_kind', JSON.stringify({ kind: 'hard', at: Date.now() })))
    await B.goto(`${route(`/collect/${code}`)}`)
    await B.waitForSelector('text=your networks block a direct connection', { timeout: 60000 })
    await B.getByRole('button', { name: 'Set up a relay' }).click()
    // The STUN section is folded on a strict network (it opens by itself only where UDP looked blocked).
    const openStun = async () => {
      if (!(await B.locator('[data-testid=stun-section]').evaluate((d) => d.open))) await B.locator('[data-testid=stun-section] summary').click()
    }
    const summary = (await B.locator('[data-testid=stun-section] summary').innerText()).replace(/\s+/g, ' ')
    await openStun()
    const explainer = (await B.locator('[data-testid=stun-explainer]').innerText()).replace(/\s+/g, ' ')
    await B.locator('[data-testid=test-public-relays]').click()
    await B.locator('[data-testid=no-public-relay]').waitFor({ timeout: 20000 })
    const results = (await B.locator('[data-testid=public-relay-results]').innerText()).replace(/\s+/g, ' ')
    await B.locator('[data-testid=test-stun]').click()
    await B.locator('[data-testid=stun-note]').waitFor({ timeout: 20000 })
    const stunNote = (await B.locator('[data-testid=stun-note]').innerText()).replace(/\s+/g, ' ')
    // Close the panel, let the doctor offer it again, re-open: nothing has to be redone.
    await B.locator('button[aria-label=Close]').click()
    await B.locator('[data-testid=public-relay-results]').waitFor({ state: 'detached', timeout: 5000 })
    await B.getByRole('button', { name: 'Set up a relay' }).click()
    const again = (await B.locator('[data-testid=public-relay-results]').innerText().catch(() => '')).replace(/\s+/g, ' ')
    const guidance = await B.locator('[data-testid=no-public-relay]').isVisible().catch(() => false)
    await openStun()
    const stunAgain = (await B.locator('[data-testid=stun-note]').innerText().catch(() => '')).replace(/\s+/g, ' ')
    const ok =
      /will not help here/.test(summary) && /strict NAT on both sides/.test(explainer) &&
      /✗ dead relay/.test(results) && /Tested just now/.test(results) &&
      /None of 8 answered/.test(stunNote) &&
      /✗ dead relay/.test(again) && /Tested just now/.test(again) && guidance && /None of 8 answered/.test(stunAgain) && /tested just now/.test(stunAgain)
    return [ok, `STUN section: "${summary}" / "${explainer.slice(0, 60)}…"; relay test: "${results}"; STUN test: "${stunNote.slice(0, 70)}…"; after close and re-open: "${again}", guidance ${guidance}, STUN note kept ${/None of 8 answered/.test(stunAgain)}`]
  },
  // Round 10: with a relay that speaks UDP the app asks no public STUN server
  // at all (the relay answers STUN); the user can keep them as a fallback; a
  // TLS-only relay cannot replace them, and the page says so. Counted with a
  // firewall rule: UDP to the STUN ports anywhere but the local relay.
  async 'stun-from-relay'() {
    const COUNT_RULE = ['-p', 'udp', '-s', HOST_IP, '!', '-d', HOST_IP, '-m', 'multiport', '--dports', '3478,19302', '-m', 'comment', '--comment', 'undpubstun', '-j', 'ACCEPT']
    const counted = () => {
      const line = execFileSync('iptables', ['-L', 'OUTPUT', '-v', '-n', '-x'], { encoding: 'utf8' }).split('\n').find((l) => l.includes('undpubstun'))
      return line ? Number(line.trim().split(/\s+/)[0]) : 0
    }
    execFileSync('iptables', ['-I', 'OUTPUT', '1', ...COUNT_RULE])
    try {
      const stream = async (storage) => {
        const before = counted()
        const A = await newPage(storage)
        await A.goto(`${route('/network')}`)
        const source = (await A.locator('[data-testid=stun-source]').innerText()).replace(/\s+/g, ' ')
        const fallback = await A.locator('[data-testid=public-stun-too]').isVisible().catch(() => false)
        const tlsNote = await A.locator('[data-testid=tls-only-note]').isVisible().catch(() => false)
        await A.goto(`${route('/stream')}`)
        await A.waitForSelector('text=Share Stream', { timeout: 30000 })
        const code = (await A.textContent('.font-mono.text-lg')).trim()
        await A.locator('.fixed.inset-0 button').first().click()
        const B = await newPage(storage)
        await B.goto(`${route(`/collect/${code}`)}`)
        const video = await videoWithin(B, 45000)
        await B.waitForTimeout(2000)
        const streamer = await statusOf(A)
        await closeAll()
        return { source, fallback, tlsNote, video, streamer, publicStun: counted() - before }
      }
      const udp = await stream(turn())
      const both = await stream({ ...turn(), undepressable_public_stun_with_relay: '1' })
      const tls = await stream(tlsRelay())
      const ok =
        /learned from your relay/.test(udp.source) && udp.fallback && udp.publicStun === 0 && udp.video !== null &&
        both.publicStun > 0 && both.video !== null &&
        /no turn: UDP address/.test(tls.source) && tls.tlsNote && tls.publicStun > 0
      return [ok, `UDP relay: "${udp.source.slice(0, 70)}", fallback offered ${udp.fallback}, UDP packets to public STUN ports ${udp.publicStun}, video ${udp.video}s via "${udp.streamer.slice(0, 32)}" | fallback on: ${both.publicStun} packets, video ${both.video}s | TLS-only relay: "${tls.source.slice(0, 80)}", note shown ${tls.tlsNote}, ${tls.publicStun} packets`]
    } finally {
      execFileSync('iptables', ['-D', 'OUTPUT', ...COUNT_RULE])
    }
  },
  async 'relay-added-live'() {
    const { page: A, code } = await startStream({})
    const B = await newPage({})
    await B.goto(`${route(`/collect/${code}`)}`)
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
      await p.goto(`${route(`/collect/${code}`)}`)
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
      await p.goto(`${route(`/collect/${code}`)}`)
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
  await v.goto(`${route('/offline')}`)
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
    await B.goto(`${route(`/collect/${code}`)}`)
    const s = await videoWithin(B, 40000)
    relayProcess.kill() // discovery (the "internet" here) disappears
    let advancing, interrupted
    try {
      await B.waitForTimeout(15000)
      advancing = await B.evaluate(async () => {
        const v = document.querySelector('video')
        const a = v.currentTime
        await new Promise((r) => setTimeout(r, 2000))
        return v.currentTime > a
      })
      interrupted = await B.locator('text=Stream interrupted').count()
    } finally {
      // Every later scenario needs discovery back, whatever happened here.
      relayProcess = startHelper('nostr-relay.mjs', '7777')
      await new Promise((r) => setTimeout(r, 500))
    }
    return [s !== null && advancing && interrupted === 0, `video ${s}s; 15 s after discovery died: ${advancing ? 'still playing' : 'FROZEN'}, interrupted overlay: ${interrupted}`]
  },
  async 'offline-two-viewers'() {
    const A = await newPage({})
    await A.goto(`${route('/offline')}`)
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
    await A.goto(`${route('/offline')}`)
    await A.getByText("I'm filming").click()
    await A.waitForSelector('[data-testid=pair-code]', { timeout: 15000 })
    await offlineViewer(A)
    await A.waitForSelector("text=couldn't reach them", { timeout: 40000 }).catch(() => {})
    const card = await viewersCard(A)
    return [/couldn't reach them/.test(card) && /hotspot/.test(card), card.slice(0, 160)]
  },
  async archive() {
    const home = await newPage({})
    await home.goto(`${route('/archive')}`)
    await home.waitForFunction(() => /\/pair-home\//.test(document.body.innerText), null, { timeout: 15000 })
    const pairLink = await home.evaluate(() => document.body.innerText.match(/\S*\/pair-home\/\S+/)[0])
    const { code } = await startStream({})
    const phone = await newPage({})
    const u = new URL(pairLink)
    await phone.goto(LIVE ? pairLink : `${APP}${u.pathname}${u.search}`) // pair once
    await phone.goto(`${route(`/collect/${code}`)}`) // then watch at the scene
    const watched = await videoWithin(phone, 40000)
    const archived = await videoWithin(home, 40000)
    await home.waitForSelector('text=Recording a forwarded stream', { timeout: 15000 }).catch(() => {})
    const status = (await home.locator('.card').nth(1).innerText()).replace(/\s+/g, ' ')
    // The filmer's attestations come home with the picture (via the phone).
    await home.waitForTimeout(6000)
    const phoneKept = (await phone.locator('[data-testid=attested-count]').innerText().catch(() => 'none')).replace(/\s+/g, ' ')
    await phone.close() // the phone leaves: home banks its recording
    let homeRecs = []
    for (let t = 0; t < 60 && !homeRecs.length; t++) {
      await home.waitForTimeout(1000)
      homeRecs = await storedRecordings(home)
    }
    const attested = homeRecs[0]?.logs[0]?.n ?? 0
    return [watched !== null && archived !== null && /Recording a forwarded stream/.test(status) && attested >= 3, `phone video ${watched}s, home video ${archived}s; home: ${status.slice(0, 120)}; phone: "${phoneKept}"; filmer's attestations at home: ${attested}`]
  },
})
// Record `seconds` of the fake camera through the app's own recorder (the dev
// server serves source modules, so the page can import them directly).
async function recordOnDevice(page, seconds) {
  return page.evaluate(async (ms) => {
    const { useRecording } = (window.__und ?? await import('/src/composables/useRecording.ts'))
    const rec = useRecording()
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    await rec.startRecording(stream, 'low')
    await new Promise((r) => setTimeout(r, ms))
    const saved = await rec.stopRecording()
    stream.getTracks().forEach((t) => t.stop())
    return { id: saved.id, chunks: saved.chunks.length, signed: !!saved.proof }
  }, seconds * 1000)
}
const importStatus = async (p) => (await p.locator('[data-testid=import-status]').innerText()).replace(/\s+/g, ' ')
async function importFiles(p, files) {
  await p.locator('[data-testid=import-input]').setInputFiles(files)
  await p.waitForFunction(() => {
    const el = document.querySelector('[data-testid=import-status]')
    return el && !/Checking every second/.test(el.textContent)
  }, null, { timeout: 30000 })
  return importStatus(p)
}

Object.assign(scenarios, {
  // Relay to a safe place with no network: a recording travels as a file
  // (share sheet / USB) and the receiving device checks every second of it.
  async 'evidence-file'() {
    const { readFileSync, writeFileSync, mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const phone = await newPage({})
    await phone.goto(`${route('/recordings')}`)
    const rec = await recordOnDevice(phone, 4)
    await phone.reload()
    await phone.locator('[data-testid=recording]').first().waitFor()
    // The phone's own copy verifies from disk.
    await phone.getByRole('button', { name: 'Verify integrity' }).first().click()
    const selfCheck = await phone.locator('[data-testid=verify-result]').first().innerText({ timeout: 15000 })
    await phone.locator('[data-testid=send-evidence]').first().click()
    const [download] = await Promise.all([
      phone.waitForEvent('download'),
      phone.locator('[data-testid=save-evidence]').first().click(),
    ])
    const dir = mkdtempSync(join(tmpdir(), 'und-evidence-'))
    const bundle = join(dir, download.suggestedFilename())
    await download.saveAs(bundle)

    const other = await newPage({})
    await other.goto(`${route('/recordings')}`)
    const imported = await importFiles(other, bundle)
    const listed = await other.locator('[data-testid=recording]').count()
    const again = await importFiles(other, bundle)

    // One flipped byte in the middle of the video must be caught.
    const bytes = readFileSync(bundle)
    bytes[Math.floor(bytes.length / 2)] ^= 0xff
    const tampered = join(dir, 'tampered.zip')
    writeFileSync(tampered, bytes)
    const third = await newPage({})
    await third.goto(`${route('/recordings')}`)
    const refused = await importFiles(third, tampered)
    const thirdListed = await third.locator('[data-testid=recording]').count()

    const ok =
      rec.signed && /Unaltered/.test(selfCheck) && /\.zip$/.test(bundle) &&
      /Verified and imported/.test(imported) && listed === 1 && /already has/.test(again) &&
      /Not imported/.test(refused) && /altered/.test(refused) && thirdListed === 0
    return [ok, `recorded ${rec.chunks} chunks; self-check "${selfCheck}"; import: "${imported.slice(0, 60)}"; again: "${again.slice(0, 50)}"; tampered: "${refused.slice(0, 110)}"`]
  },

  // Store and forward: what the phone recorded on its own reaches the home
  // archive once both are online, checked chunk by chunk on arrival.
  async 'home-sync'() {
    const HOME = 'HQMRT7XP'
    const home = await newPage({ undepressable_home_key: HOME })
    await home.goto(`${route('/archive')}`)
    const phone = await newPage({ undepressable_paired_home: HOME })
    await phone.goto(`${route('/recordings')}`)
    const a = await recordOnDevice(phone, 3)
    const b = await recordOnDevice(phone, 5)
    await phone.reload()
    await phone.locator('[data-testid=send-home]').waitFor({ timeout: 10000 })
    const before = await phone.locator('[data-testid=home-sync-status]').innerText()
    const t0 = Date.now()
    await phone.locator('[data-testid=send-home]').click()
    const done = await phone
      .waitForFunction(() => /Everything is at home/.test(document.querySelector('[data-testid=home-sync-status]')?.textContent ?? ''), null, { timeout: 60000 })
      .then(() => (Date.now() - t0) / 1000)
      .catch(() => null)
    const homeCard = await home.locator('[data-testid=archive-received]').innerText().catch(() => '')
    const atHome = await phone.locator('[data-testid=at-home]').count()
    // The home device now holds complete, verifiable copies.
    await home.goto(`${route('/recordings')}`)
    await home.locator('[data-testid=recording]').first().waitFor({ timeout: 10000 }).catch(() => {})
    const homeRecs = await home.locator('[data-testid=recording]').count()
    const verdicts = []
    for (let i = 0; i < homeRecs; i++) {
      const card = home.locator('[data-testid=recording]').nth(i)
      await card.locator('[data-testid=verify]').click()
      verdicts.push(await card.locator('[data-testid=verify-result]').innerText({ timeout: 15000 }).catch(() => 'no verdict'))
    }
    const ok = done !== null && atHome === 2 && homeRecs === 2 && verdicts.length === 2 && verdicts.every((v) => /Unaltered/.test(v)) && (homeCard.match(/verified/g) ?? []).length === 2
    return [ok, `${a.chunks}+${b.chunks} chunks; before: "${before.slice(0, 45)}"; home: "${homeCard.replace(/\s+/g, ' ').slice(0, 90)}"; delivered in ${done}s; phone "at home" badges ${atHome}; home has ${homeRecs}: ${verdicts.join(', ')}`]
  },
})
Object.assign(scenarios, {
  // No internet, face to face: each device hands its signed recordings to the
  // other over the pairing link — e.g. to someone leaving the scene.
  async 'offline-handover'() {
    const A = await newPage({})
    await A.goto(`${route('/offline')}`)
    await A.getByText("I'm filming").click()
    await A.waitForSelector('[data-testid=pair-code]', { timeout: 15000 })
    const B = await offlineViewer(A)
    const playing = await videoWithin(B, 20000)
    await B.waitForTimeout(3000) // a few seconds of footage on both devices
    const statusOf = (p) => p.locator('[data-testid=transfer-status]').first().innerText().catch(() => '')
    const until = (p, re) =>
      p.waitForFunction((src) => new RegExp(src).test(document.querySelector('[data-testid=transfer-status]')?.textContent ?? ''), re.source, { timeout: 30000 }).then(() => true).catch(() => false)
    // The viewer hands its copy to the person filming…
    await B.locator('[data-testid=send-recordings]').click()
    const aGot = await until(A, /received ✓/)
    const bSent = await until(B, /handed over ✓/)
    // …and the person filming hands theirs to the viewer.
    await A.locator('[data-testid=send-recordings]').first().click()
    const bGot = await until(B, /received ✓/)
    const aStatus = await statusOf(A)
    const bStatus = await statusOf(B)
    // What arrived is a complete, verifiable recording on the other device.
    await B.goto(`${route('/recordings')}`)
    const fromA = B.locator('[data-testid=recording]', { hasText: 'from a paired phone' }).first()
    await fromA.locator('[data-testid=verify]').click().catch(() => {})
    const verdict = await fromA.locator('[data-testid=verify-result]').innerText({ timeout: 15000 }).catch(() => 'no verdict')
    const ok = playing !== null && aGot && bSent && bGot && /Unaltered/.test(verdict)
    return [ok, `video ${playing}s; filming device: "${aStatus}"; viewer: "${bStatus}"; viewer's copy of A's recording: ${verdict}`]
  },
})
Object.assign(scenarios, {
  // Off-grid chain: C is out of the filming phone's reach (or the hotspot is
  // full), so C pairs with viewer B, who passes A's picture on.
  async 'offline-chain'() {
    const A = await newPage({})
    await A.goto(`${route('/offline')}`)
    await A.getByText("I'm filming").click()
    await A.waitForSelector('[data-testid=pair-code]', { timeout: 15000 })
    const B = await offlineViewer(A)
    const b = await videoWithin(B, 20000)
    await B.locator('[data-testid=share-onward]').click()
    await B.waitForSelector('[data-testid=pair-code]', { timeout: 15000 })
    const C = await newPage({})
    await C.goto(`${route('/offline')}`)
    await C.getByText("I'm receiving").click()
    await pasteCode(C, await codeOf(B))
    await C.waitForSelector('[data-testid=pair-code]', { timeout: 15000 })
    await pasteCode(B, await codeOf(C))
    const c = await videoWithin(C, 25000)
    // C's picture keeps moving: it is A's live camera, relayed.
    const moving = await C.evaluate(async () => {
      const v = document.querySelector('video')
      const f0 = v.getVideoPlaybackQuality?.().totalVideoFrames ?? 0
      await new Promise((r) => setTimeout(r, 2000))
      return (v.getVideoPlaybackQuality?.().totalVideoFrames ?? 0) > f0
    })
    const aViewers = await A.locator('text=/\\d+ watching/').first().innerText()
    const bCard = await B.locator('.card', { has: B.locator('h2', { hasText: 'Watching through you' }) }).innerText().catch(() => '')
    const ok = b !== null && c !== null && moving && /^1 watching/.test(aViewers) && /connected/.test(bCard)
    return [ok, `B video ${b}s, C video ${c}s via B, moving ${moving}; A: "${aViewers}"; B: "${bCard.replace(/\s+/g, ' ').slice(0, 80)}"`]
  },
})
Object.assign(scenarios, {
  // The relay in a chain loses the filming phone and pairs with another one;
  // the device watching through it must get the new picture, untouched.
  async 'offline-chain-repair'() {
    const A = await newPage({})
    await A.goto(`${route('/offline')}`)
    await A.getByText("I'm filming").click()
    await A.waitForSelector('[data-testid=pair-code]', { timeout: 15000 })
    const B = await offlineViewer(A)
    await videoWithin(B, 20000)
    await B.locator('[data-testid=share-onward]').click()
    await B.waitForSelector('[data-testid=pair-code]', { timeout: 15000 })
    const C = await newPage({})
    await C.goto(`${route('/offline')}`)
    await C.getByText("I'm receiving").click()
    await pasteCode(C, await codeOf(B))
    await C.waitForSelector('[data-testid=pair-code]', { timeout: 15000 })
    await pasteCode(B, await codeOf(C))
    const first = await videoWithin(C, 25000)
    // A disappears (battery, arrest, out of range).
    await A.context().browser().close()
    const pairAgain = B.getByRole('button', { name: 'Pair again' })
    const lostSeen = await pairAgain.waitFor({ timeout: 40000 }).then(() => true).catch(() => false)
    await pairAgain.click().catch(() => {})
    // A second filming phone; B pairs with it, C does nothing.
    const A2 = await newPage({})
    await A2.goto(`${route('/offline')}`)
    await A2.getByText("I'm filming").click()
    await A2.waitForSelector('[data-testid=pair-code]', { timeout: 15000 })
    await pasteCode(B, await codeOf(A2))
    const replyBox = B.locator('[data-testid=pair-code]')
    await B.waitForFunction(() => document.querySelectorAll('[data-testid=pair-code]').length >= 1, null, { timeout: 15000 })
    // B shows its reply to A2 (the only code on screen once its invite for C was used).
    await pasteCode(A2, (await replyBox.last().textContent()).trim())
    await videoWithin(B, 25000)
    const moving = await C.evaluate(async () => {
      const v = document.querySelector('video')
      if (v.paused) await v.play().catch(() => {})
      const f0 = v.getVideoPlaybackQuality().totalVideoFrames
      await new Promise((r) => setTimeout(r, 3000))
      return v.getVideoPlaybackQuality().totalVideoFrames - f0
    })
    const cLinks = await C.locator('text=Pair again').count()
    const ok = first !== null && lostSeen && moving > 5 && cLinks === 0
    return [ok, `C first video ${first}s; B saw the loss: ${lostSeen}; after B re-paired with a new filming phone, C decoded ${moving} frames in 3 s without re-pairing`]
  },
})
// Discovery blocked AND the two networks strict: codes go over a messenger
// (pasted here), the relay on one side carries the video.
async function messengerPair(replyDelayMs) {
  const A = await newPage({ ...turn(), undepressable_nostr_relays: JSON.stringify(['ws://127.0.0.1:9']) })
  await A.goto(`${route('/offline')}`)
  await A.locator('[data-testid=mode-internet]').click()
  await A.getByText("I'm filming").click()
  await A.waitForSelector('[data-testid=pair-code]', { timeout: 20000 })
  const invite = await codeOf(A)
  // The viewer opens the ordinary face-to-face screen: the code itself says it came over the internet.
  const B = await newPage({ undepressable_nostr_relays: JSON.stringify(['ws://127.0.0.1:9']) })
  await B.goto(`${route('/offline')}`)
  await B.getByText("I'm receiving").click()
  await pasteCode(B, invite)
  await B.waitForSelector('[data-testid=pair-code]', { timeout: 20000 })
  const reply = await codeOf(B)
  if (replyDelayMs) await B.waitForTimeout(replyDelayMs)
  await pasteCode(A, reply)
  // Direct UDP between the two is dropped here, so any video came through the relay.
  const s = await videoWithin(B, 30000)
  return [s !== null, `invite ${invite.length} chars (${/^UND2/.test(invite) ? 'compact' : 'full'}), reply ${reply.length} chars; reply pasted after ${replyDelayMs / 1000}s; video ${s}s via the relay`]
}
Object.assign(scenarios, {
  'messenger-pair': () => messengerPair(0),
  'messenger-pair-late': () => messengerPair(90_000),
})
// A stand-in broadcast server: WHIP over HTTP in front of a browser page that
// plays whatever is published (MediaMTX, Owncast, Cloudflare Stream… speak
// the same protocol).
async function whipServer(port = 4415) {
  const { createServer } = await import('node:http')
  const ingest = await newPage({})
  await ingest.goto('about:blank')
  const log = { posts: 0, deletes: 0, auth: [] }
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, DELETE, OPTIONS', 'access-control-expose-headers': 'location' }
  const server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return res.writeHead(204, cors), res.end()
    if (req.method === 'DELETE') {
      log.deletes++
      return res.writeHead(200, cors), res.end()
    }
    let body = ''
    for await (const chunk of req) body += chunk
    log.posts++
    log.auth.push(req.headers.authorization ?? '')
    if (req.headers.authorization !== 'Bearer good-token') return res.writeHead(401, cors), res.end('bad token')
    const answer = await ingest.evaluate(async (offer) => {
      const pc = new RTCPeerConnection()
      pc.ontrack = (e) => {
        if (e.track.kind !== 'video') return
        const v = document.createElement('video')
        v.muted = true
        v.autoplay = true
        v.srcObject = new MediaStream([e.track])
        document.body.append(v)
        v.play().catch(() => {})
      }
      window.__pcs = [...(window.__pcs ?? []), pc]
      await pc.setRemoteDescription({ type: 'offer', sdp: offer })
      await pc.setLocalDescription(await pc.createAnswer())
      await new Promise((r) => (pc.iceGatheringState === 'complete' ? r() : pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && r())))
      return pc.localDescription.sdp
    }, body)
    res.writeHead(201, { ...cors, 'content-type': 'application/sdp', location: `/cam/whip/resource/${log.posts}` })
    res.end(answer)
  })
  await new Promise((r) => server.listen(port, r))
  const receiving = () =>
    ingest.waitForFunction(() => [...document.querySelectorAll('video')].some((v) => v.videoWidth > 0 && v.currentTime > 0.5), null, { timeout: 30000 }).then(() => true).catch(() => false)
  const codec = () =>
    ingest.evaluate(async () => {
      for (const pc of window.__pcs ?? []) {
        const stats = await pc.getStats()
        for (const s of stats.values()) if (s.type === 'inbound-rtp' && s.kind === 'video' && s.codecId) return stats.get(s.codecId)?.mimeType
      }
      return 'unknown'
    })
  return { url: `http://localhost:${port}/cam/whip`, log, receiving, codec, close: () => server.close() }
}
async function amplifyFrom(page, url, token) {
  const panel = page.locator('[data-testid=amplify]')
  if (!(await page.locator('[data-testid=amplify-url]').isVisible().catch(() => false))) await panel.getByText('Amplify — broadcast to a server').click()
  await page.locator('[data-testid=amplify-url]').fill(url)
  await page.locator('[data-testid=amplify-token]').fill(token)
  await page.locator('[data-testid=amplify-start]').click()
  await page.waitForFunction(() => /live|failed/.test(document.querySelector('[data-testid=amplify-status]')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {})
  return (await panel.innerText()).replace(/\s+/g, ' ')
}
Object.assign(scenarios, {
  // The person filming also pushes to a broadcast server, for everyone without the app.
  async 'amplify-streamer'() {
    const srv = await whipServer()
    try {
      const A = await newPage({})
      await A.goto(`${route('/stream')}`)
      await A.waitForSelector('text=Share Stream', { timeout: 30000 })
      const wrong = await amplifyFrom(A, srv.url, 'bad-token')
      const status = await amplifyFrom(A, srv.url, 'good-token')
      const got = await srv.receiving()
      const codec = await srv.codec()
      await A.locator('[data-testid=amplify-stop]').click()
      await A.waitForTimeout(500)
      const ok = /rejected the token/.test(wrong) && /live/.test(status) && got && srv.log.deletes === 1
      return [ok, `wrong token: "${wrong.match(/The broadcast server[^.]*\./)?.[0]}"; then: ${status.match(/live[^A-Z]*/)?.[0]?.trim()}; server receiving video: ${got} (${codec}); stopped with DELETE: ${srv.log.deletes === 1}`]
    } finally {
      srv.close()
    }
  },
  // A viewer re-broadcasts what it watches — e.g. from a country where the
  // broadcast server isn't blocked, for someone whose network is.
  async 'amplify-viewer'() {
    const srv = await whipServer(4416)
    try {
      const { code } = await startStream({})
      const B = await newPage({})
      await B.goto(`${route(`/collect/${code}`)}`)
      const watching = await videoWithin(B, 40000)
      const status = await amplifyFrom(B, srv.url, 'good-token')
      const got = await srv.receiving()
      return [watching !== null && /live/.test(status) && got, `viewer video ${watching}s; amplify: ${status.match(/live[^A-Z]*/)?.[0]?.trim()}; broadcast server receiving the streamer's picture via the viewer: ${got}`]
    } finally {
      srv.close()
    }
  },
})
// Is the first stored chunk of a recording plain WebM (EBML header) or sealed?
const firstChunkIsWebm = (page, id) =>
  page.evaluate(async (rid) => {
    const { getRecording } = (window.__und ?? await import('/src/lib/recordingDb.ts'))
    const { useOPFS } = (window.__und ?? await import('/src/composables/useOPFS.ts'))
    const r = await getRecording(rid)
    const blob = await useOPFS().readChunk(r.campaignId, r.id, 0)
    const b = new Uint8Array(await blob.slice(0, 4).arrayBuffer())
    return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3
  }, id)
async function openProtect(page) {
  if (!(await page.locator('[data-testid=seal-home]').isVisible().catch(() => false))) await page.getByText('Protect recordings on this device').click()
}
async function verifyFirst(page, hasText) {
  const card = hasText ? page.locator('[data-testid=recording]', { hasText }).first() : page.locator('[data-testid=recording]').first()
  await card.locator('[data-testid=verify]').click()
  return card.locator('[data-testid=verify-result]').innerText({ timeout: 15000 }).catch(() => 'no verdict')
}
async function pairPhoneWithHome(home, phone) {
  await home.goto(`${route('/archive')}`)
  await home.waitForFunction(() => /\/pair-home\//.test(document.body.innerText), null, { timeout: 15000 })
  const link = await home.evaluate(() => document.body.innerText.match(/\S*\/pair-home\/\S+/)[0])
  const u = new URL(link)
  await phone.goto(LIVE ? link : `${APP}${u.pathname}${u.search}`)
  return phone.locator('text=receive sealed recordings').waitFor({ timeout: 5000 }).then(() => true).catch(() => false)
}
Object.assign(scenarios, {
  // A seized phone gives nothing away: recordings sealed to the home archive
  // are unreadable on the phone and open only at home.
  async 'sealed-home'() {
    const home = await newPage({ undepressable_home_key: 'HQMRT7XP' })
    const phone = await newPage({})
    const sealingOffered = await pairPhoneWithHome(home, phone)
    await home.goto(`${route('/archive')}`)
    await phone.goto(`${route('/recordings')}`)
    await openProtect(phone)
    await phone.locator('[data-testid=seal-home]').check()
    const rec = await recordOnDevice(phone, 3)
    await phone.reload()
    const badge = await phone.locator('[data-testid=sealed-badge]').first().innerText().catch(() => '')
    const plainOnDisk = await firstChunkIsWebm(phone, rec.id)
    await phone.getByTitle('Play').first().click()
    const refusal = await phone.locator('[data-testid=sealed-notice]').first().innerText().catch(() => '')
    const intact = await verifyFirst(phone)
    await phone.locator('[data-testid=send-home]').click()
    const sent = await phone
      .waitForFunction(() => /Everything is at home/.test(document.querySelector('[data-testid=home-sync-status]')?.textContent ?? ''), null, { timeout: 60000 })
      .then(() => true)
      .catch(() => false)
    await home.goto(`${route('/recordings')}`)
    await home.locator('[data-testid=recording]').first().waitFor({ timeout: 10000 }).catch(() => {})
    const opened = await home.locator('text=arrived sealed · opened here').count()
    const homeVerdict = await verifyFirst(home)
    const homePlain = await firstChunkIsWebm(home, rec.id)
    const ok = sealingOffered && /sealed for home/.test(badge) && !plainOnDisk && /cannot open it/.test(refusal) && /Intact \(sealed/.test(intact) && sent && opened === 1 && /Unaltered/.test(homeVerdict) && homePlain
    return [ok, `pairing offered sealing: ${sealingOffered}; phone: "${badge}", plain WebM on disk: ${plainOnDisk}, play → "${refusal.slice(0, 50)}", verify → ${intact}; sent home: ${sent}; home: opened ${opened}, ${homeVerdict}, plain on disk: ${homePlain}`]
  },

  // Locked with a passphrase: unreadable after a reload until unlocked.
  async 'sealed-passphrase'() {
    const phone = await newPage({})
    await phone.goto(`${route('/recordings')}`)
    await openProtect(phone)
    await phone.locator('[data-testid=seal-passphrase]').check()
    await phone.locator('[data-testid=pass-new]').fill('correct horse battery')
    await phone.locator('[data-testid=pass-again]').fill('correct horse battery')
    await phone.locator('[data-testid=pass-save]').click()
    await phone.locator('text=Passphrase set').waitFor({ timeout: 20000 })
    const rec = await recordOnDevice(phone, 3)
    await phone.reload() // the unlocked key lives in memory only
    const plainOnDisk = await firstChunkIsWebm(phone, rec.id)
    await phone.getByTitle('Play').first().click()
    const refusal = await phone.locator('[data-testid=sealed-notice]').first().innerText().catch(() => '')
    const locked = await verifyFirst(phone)
    await openProtect(phone)
    await phone.locator('[data-testid=pass-unlock]').fill('wrong passphrase')
    await phone.locator('[data-testid=unlock]').click()
    const wrong = await phone.locator('text=Wrong passphrase').waitFor({ timeout: 20000 }).then(() => true).catch(() => false)
    await phone.locator('[data-testid=pass-unlock]').fill('correct horse battery')
    await phone.locator('[data-testid=unlock]').click()
    await phone.locator('text=Unlocked for this session').waitFor({ timeout: 20000 }).catch(() => {})
    const unlocked = await verifyFirst(phone)
    await phone.getByTitle('Play').first().click()
    const plays = await phone
      .waitForFunction(() => {
        const v = document.querySelector('.fixed video')
        return !!v && v.readyState >= 2 && v.videoWidth > 0
      }, null, { timeout: 15000 })
      .then(() => true)
      .catch(() => false)
    const ok = !plainOnDisk && /unlock/.test(refusal) && /Intact \(sealed/.test(locked) && wrong && /Unaltered/.test(unlocked) && plays
    return [ok, `plain on disk: ${plainOnDisk}; locked: play → "${refusal.slice(0, 40)}", verify → ${locked}; wrong passphrase refused: ${wrong}; unlocked: ${unlocked}, plays: ${plays}`]
  },

  // A friend carries a sealed recording to safety without being able to watch it.
  async 'sealed-blind-carrier'() {
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const HOME = 'HQMRT7XP'
    const home = await newPage({ undepressable_home_key: HOME })
    const phone = await newPage({})
    await pairPhoneWithHome(home, phone)
    await home.goto(`${route('/archive')}`)
    await phone.goto(`${route('/recordings')}`)
    await openProtect(phone)
    await phone.locator('[data-testid=seal-home]').check()
    await recordOnDevice(phone, 3)
    await phone.reload()
    await phone.locator('[data-testid=send-evidence]').first().click()
    const [download] = await Promise.all([phone.waitForEvent('download'), phone.locator('[data-testid=save-evidence]').first().click()])
    const file = join(mkdtempSync(join(tmpdir(), 'und-sealed-')), download.suggestedFilename())
    await download.saveAs(file)
    // The friend: paired with the same home (by code — no key of their own).
    const friend = await newPage({ undepressable_paired_home: HOME })
    await friend.goto(`${route('/recordings')}`)
    const imported = await importFiles(friend, file)
    const intact = await verifyFirst(friend)
    await friend.getByTitle('Play').first().click()
    const cannot = await friend.locator('[data-testid=sealed-notice]').first().innerText().catch(() => '')
    await friend.locator('[data-testid=send-home]').click()
    const sent = await friend
      .waitForFunction(() => /Everything is at home/.test(document.querySelector('[data-testid=home-sync-status]')?.textContent ?? ''), null, { timeout: 60000 })
      .then(() => true)
      .catch(() => false)
    await home.goto(`${route('/recordings')}`)
    await home.locator('[data-testid=recording]').first().waitFor({ timeout: 10000 }).catch(() => {})
    const homeVerdict = await verifyFirst(home)
    const ok = /\.zip$/.test(file) && /Verified and imported/.test(imported) && /Intact \(sealed/.test(intact) && /someone else/.test(cannot) && sent && /Unaltered/.test(homeVerdict)
    return [ok, `sealed file ${download.suggestedFilename()}; friend: "${imported.slice(0, 40)}", ${intact}, play → "${cannot.slice(0, 40)}"; sent home: ${sent}; home: ${homeVerdict}`]
  },
})
// A stand-in OpenTimestamps calendar and block explorer (same wire format as
// the real ones; they answer with Access-Control-Allow-Origin: * and do not
// answer preflights — so any preflight is logged as a failure).
async function otsServer(port = 4417) {
  const { createServer } = await import('node:http')
  const { createHash } = await import('node:crypto')
  const sha = (b) => createHash('sha256').update(b).digest()
  const HEIGHT = 870123
  const state = { confirmed: false, preflights: 0, posts: 0, merkleRoot: null }
  const base = `http://localhost:${port}`
  const server = createServer(async (req, res) => {
    const cors = { 'access-control-allow-origin': '*' }
    if (req.method === 'OPTIONS') {
      state.preflights++
      return res.writeHead(404), res.end()
    }
    const url = new URL(req.url, base)
    if (req.method === 'POST' && url.pathname === '/digest') {
      for await (const _ of req);
      state.posts++
      const uri = Buffer.from(base)
      // append 0x01, sha256, pending attestation at this calendar
      const body = Buffer.concat([Buffer.from([0xf0, 1, 1, 0x08, 0x00]), Buffer.from('83dfe30d2ef90c8e', 'hex'), Buffer.from([uri.length + 1, uri.length]), uri])
      return res.writeHead(200, { ...cors, 'content-type': 'application/vnd.opentimestamps.v1' }), res.end(body)
    }
    const m = /^\/timestamp\/([0-9a-f]{64})$/.exec(url.pathname)
    if (m) {
      if (!state.confirmed) return res.writeHead(404, cors), res.end('Pending confirmation in Bitcoin blockchain')
      // prepend 0x02, sha256, Bitcoin attestation at HEIGHT
      const msg = sha(Buffer.concat([Buffer.from([2]), Buffer.from(m[1], 'hex')]))
      state.merkleRoot = Buffer.from(msg).reverse().toString('hex')
      const h = []
      let n = HEIGHT
      do {
        let b = n % 128
        n = Math.floor(n / 128)
        if (n > 0) b |= 0x80
        h.push(b)
      } while (n > 0)
      const body = Buffer.concat([Buffer.from([0xf1, 1, 2, 0x08, 0x00]), Buffer.from('0588960d73d71901', 'hex'), Buffer.from([h.length, ...h])])
      return res.writeHead(200, cors), res.end(body)
    }
    if (url.pathname === `/api/block-height/${HEIGHT}`) return res.writeHead(200, cors), res.end('00'.repeat(32))
    if (url.pathname === `/api/block/${'00'.repeat(32)}`) return res.writeHead(200, { ...cors, 'content-type': 'application/json' }), res.end(JSON.stringify({ merkle_root: state.merkleRoot, timestamp: 1790000000 }))
    res.writeHead(404, cors)
    res.end()
  })
  await new Promise((r) => server.listen(port, r))
  return { base, state, HEIGHT, close: () => server.close() }
}
Object.assign(scenarios, {
  // Proof of when: the recording's proof is anchored in (a stand-in for) Bitcoin.
  async timestamp() {
    const { readFileSync, mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { createHash } = await import('node:crypto')
    if (LIVE) {
      // A built copy ignores the stand-in calendars: this asks the real
      // OpenTimestamps calendars. Anchoring takes hours, so what can be seen
      // is the request landing, the proof pending, and the bundle's .ots
      // stamping root.txt and naming a real calendar.
      const phone = await newPage({})
      await phone.goto(route('/recordings'))
      await recordOnDevice(phone, 3)
      await phone.reload()
      await phone.locator('[data-testid=timestamp]').first().click()
      const appeared = await phone.locator('[data-testid=timestamp-status]').first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false)
      const row = (await phone.locator('[data-testid=timestamp-row]').first().innerText().catch(() => '?')).replace(/\s+/g, ' ')
      if (!appeared) return [false, `no timestamp from the real calendars: "${row.slice(0, 160)}"`]
      await phone.locator('[data-testid=timestamp-check]').first().click()
      await phone.waitForTimeout(3000)
      const after = (await phone.locator('[data-testid=timestamp-status]').first().innerText()).replace(/\s+/g, ' ')
      await phone.locator('[data-testid=send-evidence]').first().click()
      const [download] = await Promise.all([phone.waitForEvent('download'), phone.locator('[data-testid=save-evidence]').first().click()])
      const dir = mkdtempSync(join(tmpdir(), 'und-ots-live-'))
      const zip = join(dir, download.suggestedFilename())
      await download.saveAs(zip)
      execFileSync('unzip', ['-q', zip, '-d', dir])
      const root = readFileSync(join(dir, 'root.txt'))
      const ots = readFileSync(join(dir, 'root.txt.ots'))
      const evidence = JSON.parse(readFileSync(join(dir, 'evidence.json'), 'utf8'))
      const digestMatches = ots.subarray(33, 65).equals(createHash('sha256').update(root).digest())
      const calendar = (ots.toString('latin1').match(/https?:\/\/[a-z0-9.-]*opentimestamps[a-z0-9./-]*/) ?? [''])[0]
      const ok = /requested/.test(row) && /requested/.test(after) && root.toString() === `${evidence.proof.merkleRoot}\n` && digestMatches && /opentimestamps/.test(calendar)
      return [ok, `real calendars: "${row.slice(0, 70)}" → after Check now: "${after.slice(0, 50)}"; bundle: root.txt = proof root ${root.toString().trim() === evidence.proof.merkleRoot}, .ots digest matches ${digestMatches}, calendar ${calendar || 'none named'}`]
    }
    const cal = await otsServer()
    try {
      const phone = await newPage({ undepressable_ots_calendars: JSON.stringify([cal.base]), undepressable_ots_explorer: JSON.stringify(`${cal.base}/api`) })
      await phone.goto(`${route('/recordings')}`)
      await recordOnDevice(phone, 3)
      await phone.reload()
      const status = () => phone.locator('[data-testid=timestamp-status]').first().innerText().catch(() => '')
      await phone.locator('[data-testid=timestamp]').first().click()
      const appeared = await phone.locator('[data-testid=timestamp-status]').first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false)
      if (!appeared) return [false, `no timestamp: "${(await phone.locator('[data-testid=timestamp-row]').first().innerText().catch(() => '?')).replace(/\s+/g, ' ')}"; calendar posts ${cal.state.posts}, preflights ${cal.state.preflights}`]
      const requested = await status()
      await phone.locator('[data-testid=timestamp-check]').first().click()
      await phone.waitForTimeout(1500)
      const stillPending = await status()
      cal.state.confirmed = true
      await phone.locator('[data-testid=timestamp-check]').first().click()
      await phone.waitForFunction(() => /checked/.test(document.querySelector('[data-testid=timestamp-status]')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {})
      const anchored = await status()
      // The evidence file now carries root.txt and its .ots proof.
      await phone.locator('[data-testid=send-evidence]').first().click()
      const [download] = await Promise.all([phone.waitForEvent('download'), phone.locator('[data-testid=save-evidence]').first().click()])
      const dir = mkdtempSync(join(tmpdir(), 'und-ots-'))
      const zip = join(dir, download.suggestedFilename())
      await download.saveAs(zip)
      execFileSync('unzip', ['-q', zip, '-d', dir])
      const root = readFileSync(join(dir, 'root.txt'))
      const ots = readFileSync(join(dir, 'root.txt.ots'))
      const evidence = JSON.parse(readFileSync(join(dir, 'evidence.json'), 'utf8'))
      const digestMatches = ots.subarray(33, 65).equals(createHash('sha256').update(root).digest())
      const ok =
        /requested/.test(requested) && /requested/.test(stillPending) && new RegExp(`block #${cal.HEIGHT}.*checked`).test(anchored) &&
        root.toString() === `${evidence.proof.merkleRoot}\n` && ots.subarray(0, 16).toString('latin1').includes('OpenTimestamps') && digestMatches &&
        cal.state.preflights === 0
      return [ok, `"${requested.slice(0, 40)}" → still "${stillPending.slice(2, 22)}" → "${anchored}"; bundle: root.txt = proof root ${root.toString().trim() === evidence.proof.merkleRoot}, .ots digest matches ${digestMatches}; CORS preflights: ${cal.state.preflights}`]
    } finally {
      cal.close()
    }
  },
})

// --- corroborated copies --------------------------------------------------------

// A camera file for Chromium's fake capture: a different picture every second
// (soft blobs on a gradient, from `seed`), so two files never look alike and
// one file's moments can be told apart. Grayscale 4:2:0 Y4M, looped by Chromium.
async function writeY4m(path, seed, seconds = 30, w = 240, h = 180, fps = 10) {
  const { openSync, writeSync, closeSync } = await import('node:fs')
  let st = seed >>> 0 || 1
  const rnd = () => {
    st ^= st << 13
    st ^= st >>> 17
    st ^= st << 5
    return (st >>> 0) / 2 ** 32
  }
  const fd = openSync(path, 'w')
  writeSync(fd, `YUV4MPEG2 W${w} H${h} F${fps}:1 Ip A1:1 C420jpeg\n`)
  const chroma = Buffer.alloc((w / 2) * (h / 2) * 2, 128)
  for (let sec = 0; sec < seconds; sec++) {
    const blobs = Array.from({ length: 6 }, () => ({ x: rnd(), y: rnd(), r: 0.1 + rnd() * 0.25, v: 30 + rnd() * 200 }))
    const g = rnd() * 120 - 60
    const y = Buffer.alloc(w * h)
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        let v = 110 + g * (i / w - 0.5)
        for (const b of blobs) if (Math.hypot(i / w - b.x, j / h - b.y) < b.r) v = v * 0.3 + b.v * 0.7
        y[j * w + i] = Math.max(16, Math.min(235, v))
      }
    for (let f = 0; f < fps; f++) {
      writeSync(fd, 'FRAME\n')
      writeSync(fd, y)
      writeSync(fd, chroma)
    }
  }
  closeSync(fd)
  return path
}
async function cameraFiles() {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'und-cam-'))
  return { a: await writeY4m(join(dir, 'a.y4m'), 11), b: await writeY4m(join(dir, 'b.y4m'), 9001), dir }
}
const camera = (file) => [`--use-file-for-fake-video-capture=${file}`]

/** On the Recordings screen: check one card against the filmer, return its verdict text. */
async function checkCard(page, card) {
  await card.locator('[data-testid=corroborate]').click()
  await page.waitForTimeout(300)
  await card.locator('[data-testid=corroborate]', { hasNotText: 'Comparing' }).waitFor({ timeout: 90000 }).catch(() => {})
  return (await card.locator('[data-testid=corroborate-row]').innerText().catch(() => 'no row')).replace(/\s+/g, ' ')
}

/** In a page: the stored recordings, newest first, with attestation counts. */
const storedRecordings = (page) =>
  page.evaluate(async () => {
    const { getAllRecordings } = (window.__und ?? await import('/src/lib/recordingDb.ts'))
    const all = await getAllRecordings()
    return all
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .map((r) => ({ id: r.id, chunks: r.chunks.length, logs: (r.attestations ?? []).map((l) => ({ pk: l.pk, n: l.a.length })) }))
  })

Object.assign(scenarios, {
  // Two streams from two cameras showing different pictures; one viewer
  // records both through share links. Each copy matches what its filmer
  // signed; with the other stream's attestations swapped in, it does not.
  // The filmer's own recording carries the same attestations.
  async corroborate() {
    const cams = await cameraFiles()
    const A = await startStream({}, camera(cams.a))
    const C = await startStream({}, camera(cams.b))
    const V = await newPage({})
    const watchAndRecord = async (shareUrl, seconds) => {
      await V.goto(shareUrl)
      if ((await videoWithin(V, 40000)) === null) throw new Error(`no video from ${shareUrl}`)
      await V.waitForSelector('text=Stop Recording', { timeout: 20000 })
      await V.waitForTimeout(seconds * 1000)
      const kept = await V.locator('[data-testid=attested-count]').innerText().catch(() => 'none')
      await V.getByText('Stop Recording').click()
      await V.waitForTimeout(1500)
      return kept.replace(/\s+/g, ' ')
    }
    const keptA = await watchAndRecord(A.shareUrl, 10)
    const keptC = await watchAndRecord(C.shareUrl, 10)
    const fkA = linkParam(A.shareUrl, 'fk')
    const fkC = linkParam(C.shareUrl, 'fk')

    await V.goto(`${route('/recordings')}`)
    const recs = await storedRecordings(V)
    if (!(await V.waitForSelector('[data-testid=corroborate]', { timeout: 15000 }).catch(() => null)))
      return [false, `viewer has no checkable copy; kept: "${keptA}" / "${keptC}"; stored: ${JSON.stringify(recs)}`]
    const [recC, recA] = recs // newest first
    const signersOk = recA?.logs.length === 1 && recA.logs[0].pk === fkA && recC?.logs.length === 1 && recC.logs[0].pk === fkC
    const cardA = V.locator('[data-testid=recording]').nth(1)
    const cardC = V.locator('[data-testid=recording]').nth(0)
    const verdictA = await checkCard(V, cardA)
    const verdictC = await checkCard(V, cardC)

    // A carrier attaches another stream's attestations to copy A.
    await V.evaluate(async ([a, c]) => {
      const db = (window.__und ?? await import('/src/lib/recordingDb.ts'))
      const recA = await db.getRecording(a)
      const recC = await db.getRecording(c)
      await db.putRecording({ ...recA, attestations: recC.attestations, corroboration: undefined })
    }, [recA.id, recC.id])
    await V.reload()
    await V.waitForSelector('[data-testid=corroborate]', { timeout: 15000 })
    const swapped = await checkCard(V, V.locator('[data-testid=recording]').nth(1))

    // The evidence file carries them.
    const inManifest = await V.evaluate(async (id) => {
      const db = (window.__und ?? await import('/src/lib/recordingDb.ts'))
      const { manifestFor } = (window.__und ?? await import('/src/lib/transfer/evidence.ts'))
      return manifestFor(await db.getRecording(id))?.attestations?.[0]?.a.length ?? 0
    }, recC.id)

    // The filmer's own recording, checked on the filming phone.
    await A.page.locator('button[title="End Stream"]').click()
    await A.page.waitForTimeout(3000)
    await A.page.goto(`${route('/recordings')}`)
    await A.page.waitForSelector('[data-testid=corroborate]', { timeout: 15000 })
    const own = await checkCard(A.page, A.page.locator('[data-testid=recording]').first())

    const ok =
      /✓/.test(keptA) && /✓/.test(keptC) && signersOk &&
      /✓ Shows what the filming phone/.test(verdictA) && /✓ Shows what the filming phone/.test(verdictC) &&
      /✗ Does not show/.test(swapped) && inManifest > 3 && /✓ Shows what the filming phone/.test(own)
    return [ok, `kept: "${keptA.slice(0, 60)}" / "${keptC.slice(0, 60)}"; signers = link keys ${signersOk} (${JSON.stringify(recs.map((r) => r.logs))}); A: ${verdictA.slice(0, 160)} | C: ${verdictC.slice(0, 160)} | A with C's attestations: ${swapped.slice(0, 160)} | in evidence: ${inManifest} | filmer's own: ${own.slice(0, 120)}`]
  },
})

Object.assign(scenarios, {
  // Face to face, through a chain: A films (its own camera file), B relays
  // onward, C records. The attestations travel down the chain with the
  // picture, and C's copy checks out against A's key.
  async 'corroborate-offline'() {
    const cams = await cameraFiles()
    const A = await newPage({}, camera(cams.a))
    await A.goto(`${route('/offline')}`)
    await A.getByText("I'm filming").click()
    await A.waitForSelector('[data-testid=pair-code]', { timeout: 15000 })
    const B = await offlineViewer(A)
    if ((await videoWithin(B, 20000)) === null) return [false, 'B got no video']
    await B.locator('[data-testid=share-onward]').click()
    await B.waitForSelector('[data-testid=pair-code]', { timeout: 15000 })
    const C = await newPage({})
    await C.goto(`${route('/offline')}`)
    await C.getByText("I'm receiving").click()
    await pasteCode(C, await codeOf(B))
    await C.waitForSelector('[data-testid=pair-code]', { timeout: 15000 })
    await pasteCode(B, await codeOf(C))
    if ((await videoWithin(C, 25000)) === null) return [false, 'C got no video through B']
    await C.waitForTimeout(10000)
    const kept = (await C.locator('[data-testid=attested-count]').innerText().catch(() => 'none')).replace(/\s+/g, ' ')
    await C.getByRole('button', { name: 'Stop', exact: true }).click()
    await C.waitForTimeout(1500)
    await C.goto(`${route('/recordings')}`)
    const recs = await storedRecordings(C)
    if (!(await C.waitForSelector('[data-testid=corroborate]', { timeout: 15000 }).catch(() => null))) return [false, `C has no checkable copy; kept "${kept}"; ${JSON.stringify(recs)}`]
    const verdict = await checkCard(C, C.locator('[data-testid=recording]').first())
    // The key C holds is A's: the one A's own recording carries too.
    await A.getByRole('button', { name: 'Stop filming' }).click()
    await A.waitForTimeout(1500)
    const aRecs = await storedRecordings(A)
    const sameKey = recs[0]?.logs[0]?.pk && recs[0].logs[0].pk === aRecs[0]?.logs[0]?.pk
    const ok = /✓/.test(kept) && /✓ Shows what the filming phone/.test(verdict) && sameKey
    return [ok, `C kept "${kept}"; C's copy: ${verdict.slice(0, 160)}; signed by A's key: ${!!sameKey}`]
  },
})

// --- throttled links ---------------------------------------------------------------

/** Police UDP between the browsers to `kBps` kilobytes a second per flow (excess dropped). */
const throttleRule = (kBps) => ['-p', 'udp', '-s', HOST_IP, '-d', HOST_IP, '-m', 'hashlimit', '--hashlimit-name', `und${kBps}`, '--hashlimit-mode', 'srcport,dstport', '--hashlimit-above', `${kBps}kb/s`, '--hashlimit-burst', '48kb', '-j', 'DROP']
/** Frames the page's video showed in the next `ms`. */
const framesIn = (page, ms = 3000) =>
  page.evaluate(async (ms) => {
    const v = document.querySelector('video')
    const n = () => v?.getVideoPlaybackQuality?.().totalVideoFrames ?? 0
    const a = n()
    await new Promise((r) => setTimeout(r, ms))
    return n() - a
  }, ms)
async function until(fn, ms, every = 2000) {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn().catch(() => null)
    if (v) return v
    if (Date.now() > end) return null
    await new Promise((r) => setTimeout(r, every))
  }
}

Object.assign(scenarios, {
  // The viewer's link is throttled, as networks are during protests: to
  // ~320 kbit/s the picture keeps moving, smaller; to ~56 kbit/s the filming
  // phone switches that viewer to sound only — and the viewer keeps
  // recording instead of declaring the stream lost. Lifted, the picture
  // comes back on its own.
  async throttled() {
    const A = await startStream({})
    const B = await newPage({})
    await B.goto(`${route(`/collect/${A.code}`)}`)
    if ((await videoWithin(B, 40000)) === null) return [false, 'no video before throttling']
    const pill = () => A.page.locator('[data-testid=slow-links]').innerText().catch(() => '')
    const notes = []
    let rule = throttleRule(40)
    if (!block(true, rule)) return [false, 'needs root for iptables']
    try {
      if (process.env.TRACE) {
        for (let i = 0; i < 25; i++) {
          const st = await A.page.evaluate(async () => {
            const out = []
            for (const pc of window.__pcs ?? []) {
              const r = await pc.getStats()
              r.forEach((e) => {
                if (e.type === 'candidate-pair' && e.nominated && e.state === 'succeeded') out.push(`E=${Math.round((e.availableOutgoingBitrate ?? 0) / 1000)}k`)
                if (e.type === 'remote-inbound-rtp') out.push(`${e.kind}Loss=${(e.fractionLost ?? 0).toFixed(2)}`)
                if (e.type === 'outbound-rtp' && e.kind === 'video') out.push(`q=${e.qualityLimitationReason} ${e.frameWidth}x${e.frameHeight}@${e.framesPerSecond}`)
              })
            }
            return out.join(' ')
          })
          console.log(`t=${i * 3}s pill="${await pill()}" frames=${await framesIn(B, 1000)} ${st}`)
          await A.page.waitForTimeout(2000)
        }
      }
      const reduced = await until(async () => (await pill()) || null, 60000)
      // For the next 30 s: the picture keeps moving, and is never dropped for sound only.
      const seen = []
      let movingSamples = 0
      for (let i = 0; i < 10; i++) {
        seen.push(await pill())
        if ((await framesIn(B, 1000)) >= 5) movingSamples++
        await B.waitForTimeout(2000)
      }
      const neverSoundOnly = seen.every((p) => !/sound only/.test(p))
      notes.push(`~320 kbit/s: "${reduced}"; picture moving in ${movingSamples}/10 samples; tiers seen: ${[...new Set(seen.map((p) => p.replace(/^.*: /, '') || 'full'))].join(', ')}`)

      block(false, rule)
      rule = throttleRule(7)
      block(true, rule)
      const soundOnly = await until(async () => (/sound only/.test(await pill()) && (await B.locator('[data-testid=sound-only]').isVisible()) ? await pill() : null), 90000)
      const stillRecording = await B.getByText('Stop Recording').isVisible().catch(() => false)
      const interrupted = await B.getByText('Stream interrupted').isVisible().catch(() => false)
      notes.push(`~56 kbit/s: "${soundOnly}", viewer banner ${await B.locator('[data-testid=sound-only]').isVisible()}, still recording ${stillRecording}, interrupted ${interrupted}`)

      block(false, rule)
      rule = null
      // Sound only sends nothing that could raise the estimate, so the climb
      // back is by timed tries: up to a minute, then three trials of 15 s.
      const back = await until(async () => (!(await pill()) && (await framesIn(B, 2000)) > 10 ? true : null), 240000, 3000)
      const bannerGone = !(await B.locator('[data-testid=sound-only]').isVisible().catch(() => false))
      notes.push(`lifted: picture back ${!!back}, banner gone ${bannerGone}`)
      const ok = !!reduced && movingSamples >= 8 && neverSoundOnly && !!soundOnly && stillRecording && !interrupted && !!back && bannerGone
      return [ok, notes.join(' | ')]
    } finally {
      if (rule) block(false, rule)
    }
  },
})

Object.assign(scenarios, {
  // A viewer whose recordings are sealed to home: on the phone the filmer's
  // attestations are sealed with the footage (nothing readable ties the phone
  // to the stream); sent home, they open with it, and the copy checks out.
  async 'corroborate-sealed'() {
    const cams = await cameraFiles()
    const home = await newPage({ undepressable_home_key: 'HQMRT7XQ' })
    const phone = await newPage({})
    await pairPhoneWithHome(home, phone)
    await phone.goto(`${route('/recordings')}`)
    await openProtect(phone)
    await phone.locator('[data-testid=seal-home]').check()
    await home.goto(`${route('/archive')}`)
    const A = await startStream({}, camera(cams.a))
    await phone.goto(A.shareUrl)
    if ((await videoWithin(phone, 40000)) === null) return [false, 'phone got no video']
    await phone.waitForSelector('text=Stop Recording', { timeout: 20000 })
    await phone.waitForTimeout(10000)
    await phone.getByText('Stop Recording').click()
    await phone.waitForTimeout(1500)
    await phone.goto(`${route('/recordings')}`)
    const onPhone = await phone.evaluate(async () => {
      const { getAllRecordings } = (window.__und ?? await import('/src/lib/recordingDb.ts'))
      const r = (await getAllRecordings()).find((x) => x.sealed)
      return r && { id: r.id, clear: (r.attestations ?? []).length, sealed: typeof r.sealed.attestations === 'string', raw: JSON.stringify(r) }
    })
    const fk = linkParam(A.shareUrl, 'fk')
    const keyHidden = !!onPhone && !onPhone.raw.includes(fk)
    const phoneCard = phone.locator('[data-testid=recording]', { has: phone.locator('[data-testid=sealed-badge]') }).first()
    const phoneCheck = await checkCard(phone, phoneCard)
    await phone.locator('[data-testid=send-home]').click()
    const sent = await phone
      .waitForFunction(() => /Everything is at home/.test(document.querySelector('[data-testid=home-sync-status]')?.textContent ?? ''), null, { timeout: 90000 })
      .then(() => true)
      .catch(() => false)
    await home.goto(`${route('/recordings')}`)
    await home.locator('[data-testid=recording]').first().waitFor({ timeout: 10000 }).catch(() => {})
    const homeCard = home.locator('[data-testid=recording]', { hasText: 'arrived sealed · opened here' }).first()
    const atHome = await checkCard(home, homeCard)
    const ok = onPhone?.clear === 0 && onPhone?.sealed && keyHidden && /could not be opened|sealed/.test(phoneCheck) && sent && /✓ Shows what the filming phone/.test(atHome)
    return [ok, `phone: ${onPhone?.clear} in the clear, sealed blob ${onPhone?.sealed}, stream key absent from the record ${keyHidden}, check → "${phoneCheck.slice(0, 110)}"; sent home ${sent}; home: ${atHome.slice(0, 150)}`]
  },
})

// --- combined records --------------------------------------------------------------

/** Save the first recording's evidence bundle from the Recordings screen; returns its path. */
async function saveFirstBundle(page, dir) {
  await page.goto(`${route('/recordings')}`)
  await page.locator('[data-testid=send-evidence]').first().click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-testid=save-evidence]').first().click()])
  const file = join(dir, download.suggestedFilename())
  await download.saveAs(file)
  return file
}

Object.assign(scenarios, {
  // Two viewers record different stretches of one stream (with a gap between);
  // their evidence files meet on a third device, which lays them on the
  // filmer's clock, plays them through as one, and renders one signed video
  // that still checks out against the filmer — and whose record carries both
  // copies, importable elsewhere.
  async combine() {
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const cams = await cameraFiles()
    const dir = mkdtempSync(join(tmpdir(), 'und-combine-'))
    const A = await startStream({}, camera(cams.a))
    const watch = async (seconds) => {
      const V = await newPage({})
      await V.goto(A.shareUrl)
      if ((await videoWithin(V, 40000)) === null) throw new Error('viewer got no video')
      await V.waitForSelector('text=Stop Recording', { timeout: 20000 })
      await V.waitForTimeout(seconds * 1000)
      await V.getByText('Stop Recording').click()
      await V.waitForTimeout(1500)
      return V
    }
    const V1 = await watch(10)
    await V1.waitForTimeout(3000) // nobody records: a gap
    const V2 = await watch(10)
    const b1 = await saveFirstBundle(V1, dir)
    const b2 = await saveFirstBundle(V2, dir)

    const H = await newPage({})
    await H.goto(`${route('/recordings')}`)
    await importFiles(H, b1)
    await importFiles(H, b2)
    const linkShown = await H.locator('[data-testid=combine-link]').isVisible().catch(() => false)
    await H.goto(`${route('/combine')}`)
    const group = H.locator('[data-testid=group]').first()
    await group.waitFor({ timeout: 10000 })
    const before = (await group.locator('[data-testid=alignment]').allInnerTexts()).join(' | ')
    await group.locator('[data-testid=check-all]').click()
    await group.locator('[data-testid=check-all]').waitFor({ state: 'detached', timeout: 60000 }).catch(() => {})
    const after = (await group.locator('[data-testid=alignment]').allInnerTexts()).join(' | ')
    const coverage = (await group.locator('[data-testid=coverage-text]').innerText()).replace(/\s+/g, ' ')

    // Play through: the position advances, the copy switches, the gap shows.
    await group.locator('[data-testid=play-through]').click()
    const seen = new Set()
    let sawGap = false
    for (let i = 0; i < 40; i++) {
      await H.waitForTimeout(500)
      const pos = (await group.locator('[data-testid=player-position]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      const m = /copy (\w+)/.exec(pos)
      if (m) seen.add(m[1])
      if (await group.locator('[data-testid=gap-card]').isVisible().catch(() => false)) sawGap = true
      if (seen.size >= 2 && sawGap) break
    }
    await group.locator('[data-testid=play-through]').click() // stop

    // Render one video (real time), then check it against the filmer.
    await group.locator('[data-testid=render]').click()
    await group.locator('[data-testid=rendered]').waitFor({ timeout: 120000 })
    await H.goto(`${route('/recordings')}`)
    const renderedCard = H.locator('[data-testid=recording]', { has: H.locator('[data-testid=combined-badge]') }).first()
    const badge = await renderedCard.locator('[data-testid=combined-badge]').innerText()
    const checked = await checkCard(H, renderedCard)
    const rendered = await H.evaluate(async () => {
      const { getAllRecordings } = (window.__und ?? await import('/src/lib/recordingDb.ts'))
      const r = (await getAllRecordings()).find((x) => x.combined)
      return r && { seconds: r.chunks.length, signed: !!r.proof, sources: r.combined.sources.length, segments: r.combined.segments.map((s) => [s.copy ? 'copy' : 'gap', Math.round((s.to - s.from) / 1000)]), alignment: r.combined.alignment }
    })

    // The combined record travels with its copies.
    await renderedCard.locator('[data-testid=send-evidence]').click()
    const [download] = await Promise.all([H.waitForEvent('download'), renderedCard.locator('[data-testid=save-combined]').click()])
    const combinedZip = join(dir, download.suggestedFilename())
    await download.saveAs(combinedZip)
    const F = await newPage({})
    await F.goto(`${route('/recordings')}`)
    const importedText = await importFiles(F, combinedZip)
    const onF = await F.locator('[data-testid=recording]').count()

    const ok =
      linkShown && /signals/.test(before) && (after.match(/Matched against the filmer/g) ?? []).length === 2 &&
      /2 stretches/.test(coverage) && /in gaps/.test(coverage) && /aligned by ✓ matched/i.test(coverage) &&
      seen.size === 2 && sawGap && /2 copies/.test(badge) && rendered?.signed && rendered.sources === 2 && rendered.alignment === 'picture' &&
      /✓ Shows what the filming phone/.test(checked) && /Source copies: 2 verified and imported/.test(importedText) && onF === 3
    return [ok, `link ${linkShown}; before: "${before}" → after: "${after}"; ${coverage}; play-through saw copies ${seen.size}, gap ${sawGap}; rendered ${rendered?.seconds}s signed ${rendered?.signed}, ${JSON.stringify(rendered?.segments)}, ${rendered?.alignment}; "${badge}"; check → ${checked.slice(0, 140)}; import elsewhere: "${importedText.slice(0, 120)}", ${onF} recordings`]
  },
})

// --- blend in: nothing but TLS to 443 -------------------------------------------------

/** Drop (and count) every UDP packet this host sends, except the TURN server's relay sockets talking to each other. */
const NO_UDP_RULE = ['-p', 'udp', '-s', HOST_IP, '-m', 'multiport', '!', '--sports', '20000:24000', '-m', 'comment', '--comment', 'undnoudp', '-j', 'DROP']
function udpPacketsDropped() {
  try {
    const line = execFileSync('iptables', ['-L', 'OUTPUT', '-v', '-n', '-x'], { encoding: 'utf8' }).split('\n').find((l) => l.includes('undnoudp'))
    return line ? Number(line.trim().split(/\s+/)[0]) : null
  } catch {
    return null
  }
}
/**
 * Chromium must not send TURN-over-TCP through this machine's HTTPS proxy, and
 * must accept the test relay's self-signed certificate. Its own background
 * requests (account checks, push registration, DoH probes to Google — all of
 * which send UDP) are silenced by refusing to resolve any other host, so what
 * is counted is the app's traffic; the browser's net log shows the hosts.
 */
const TLS_RELAY_ARGS = [
  // A live run behind a proxy still needs it for the site itself; only the
  // relay goes direct — and Chromium honours a bypass list only next to an
  // explicit --proxy-server, not with the proxy taken from the environment.
  ...(LIVE && process.env.HTTPS_PROXY
    ? [`--proxy-server=${process.env.HTTPS_PROXY}`, `--proxy-bypass-list=${HOST_IP};localhost;127.0.0.1`]
    : ['--no-proxy-server']),
  '--ignore-certificate-errors',
  // Refuse every name but the test hosts' (and the loopback the proxy lives on:
  // the rules catch IP literals too).
  `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE ${HOST_IP}`,
]
/** Distinct hosts a Chromium net log shows connections or lookups to. */
function netlogHosts(file) {
  const { readFileSync } = require('node:fs')
  const text = readFileSync(file, 'utf8')
  return [...new Set([...text.matchAll(/"host":"([^"]+)"/g)].map((m) => m[1].replace(/^https?:\/\//, '')))].sort()
}
const tlsRelay = () => ({ undepressable_turn: JSON.stringify({ urls: [`turns:${HOST_IP}:443`], username: 'test', credential: 'test' }) })

Object.assign(scenarios, {
  // With Blend in on and a turns: relay on 443, a stream works while every
  // UDP packet from this host is dropped — and none is even attempted. With
  // it off, the same setup tries UDP (STUN, direct candidates) at once.
  async 'blend-in'() {
    if (!block(true, NO_UDP_RULE)) return [false, 'needs root for iptables']
    // TRACE=1: what the dropped packets were (counted by class, before the drop).
    const trace = process.env.TRACE
      ? [
          ['-p', 'udp', '-s', HOST_IP, '-m', 'multiport', '--sports', '20000:24000', '-m', 'comment', '--comment', 'from-relay-sockets', '-j', 'ACCEPT'],
          ['-p', 'udp', '-s', HOST_IP, '--dport', '3478', '-m', 'comment', '--comment', 'to-turn-3478', '-j', 'ACCEPT'],
          ['-p', 'udp', '-s', HOST_IP, '--dport', '53', '-m', 'comment', '--comment', 'dns', '-j', 'ACCEPT'],
          ['-p', 'udp', '-s', HOST_IP, '--dport', '5353', '-m', 'comment', '--comment', 'mdns', '-j', 'ACCEPT'],
          ['-p', 'udp', '-s', HOST_IP, '--dport', '443', '-m', 'comment', '--comment', 'quic-443', '-j', 'ACCEPT'],
          ['-p', 'udp', '-s', HOST_IP, '--dport', '19302', '-m', 'comment', '--comment', 'google-stun', '-j', 'ACCEPT'],
          ['-p', 'udp', '-s', HOST_IP, '-d', HOST_IP, '--dport', '20000:24000', '-m', 'comment', '--comment', 'browser-to-relay-ports', '-j', 'ACCEPT'],
          ['-p', 'udp', '-s', HOST_IP, '-d', HOST_IP, '-m', 'comment', '--comment', 'host-to-host-other', '-j', 'ACCEPT'],
          ['-p', 'udp', '-s', HOST_IP, '-m', 'comment', '--comment', 'elsewhere', '-j', 'ACCEPT'],
        ]
      : []
    // Specific classes first, the catch-all last (each insert goes to the top).
    for (const r of [...trace].reverse()) execFileSync('iptables', ['-I', 'OUTPUT', '1', ...r])
    const table = () => execFileSync('iptables', ['-L', 'OUTPUT', '-v', '-n', '-x'], { encoding: 'utf8' }).split('\n').filter((l) => /\/\*/.test(l)).map((l) => l.trim().replace(/\s+/g, ' ')).join('\n')
    const { mkdtempSync, existsSync } = await import('node:fs')
    const logDir = mkdtempSync(join(tmpdir(), 'und-netlog-'))
    const run = async (blend) => {
      try {
        execFileSync('iptables', ['-Z', 'OUTPUT'])
      } catch {
        /* counters then read by difference */
      }
      const before = udpPacketsDropped() ?? 0
      // The control uses every discovery transport, as a device without "only my relays" would.
      const storage = { ...tlsRelay(), ...(blend ? { undepressable_blend_in: '1' } : { undepressable_nostr_relays_only: '' }) }
      const logs = ['a', 'b'].map((n) => join(logDir, `${blend ? 'on' : 'off'}-${n}.json`))
      const A = await newPage(storage, [...TLS_RELAY_ARGS, `--log-net-log=${logs[0]}`])
      const rooms = []
      A.on('console', (m) => {
        const t = /\[Trystero\] Created (\w+) room/.exec(m.text())
        if (t) rooms.push(t[1])
      })
      await A.goto(`${route('/network')}`)
      const status = (await A.locator('[data-testid=blend-in-status]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      await A.goto(`${route('/stream')}`)
      await A.waitForSelector('text=Share Stream', { timeout: 30000 })
      const code = (await A.textContent('.font-mono.text-lg')).trim()
      await A.locator('.fixed.inset-0 button').first().click()
      const B = await newPage(storage, [...TLS_RELAY_ARGS, `--log-net-log=${logs[1]}`])
      await B.goto(`${route(`/collect/${code}`)}`)
      const video = await videoWithin(B, 45000)
      await B.waitForTimeout(3000)
      const dropped = (udpPacketsDropped() ?? 0) - before
      const streamer = await statusOf(A)
      if (trace.length) console.log(`--- blend in ${blend ? 'on' : 'off'}:\n${table()}`)
      await closeAll()
      const hosts = [...new Set(logs.filter(existsSync).flatMap(netlogHosts))].filter((h) => !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h)).sort()
      return { video, dropped, streamer, rooms: [...new Set(rooms)].sort(), status, hosts }
    }
    try {
      const on = await run(true)
      const off = await run(false)
      // Beyond the dev server and discovery on localhost — and Chromium's own
      // lookups (Google services, refused by the resolver rules above) — the
      // only host either browser touched is the TLS relay.
      const browserOwn = /(^|\.)(google\.com|googleapis\.com|gvt1\.com|gstatic\.com)$|^dns\.google$|^~notfound$/
      const appHosts = on.hosts.filter((h) => !browserOwn.test(h))
      // A live run also loads the page itself from the site (through the proxy).
      const site = LIVE ? new URL(APP).host : null
      const onlyRelay = appHosts.length > 0 && appHosts.every((h) => h === HOST_IP || h === `${HOST_IP}:443` || (site && (h === site || h === `${site}:443`)))
      const ok =
        on.video !== null && on.dropped === 0 && onlyRelay && /RELAY/.test(on.streamer) && on.rooms.join() === 'nostr' && /✓ A TLS relay on port 443/.test(on.status) &&
        off.dropped > 0
      return [ok, `blend in: video ${on.video}s via "${on.streamer.slice(0, 40)}", discovery rooms ${JSON.stringify(on.rooms)}, UDP packets attempted ${on.dropped}, the app's hosts beyond localhost: ${JSON.stringify(appHosts)}, Network page: "${on.status.slice(0, 60)}" | same relay, blend in off: UDP packets attempted ${off.dropped}, video ${off.video}s, rooms ${JSON.stringify(off.rooms)}, hosts ${JSON.stringify(off.hosts.filter((h) => !browserOwn.test(h)))}`]
    } finally {
      for (const r of trace) execFileSync('iptables', ['-D', 'OUTPUT', ...r])
      block(false, NO_UDP_RULE)
    }
  },
})

// --- self-checking bundles ------------------------------------------------------------

Object.assign(scenarios, {
  // A viewer's evidence bundle carries verify.html: opened from disk in a
  // plain browser, with no website and no app, it checks the video against
  // its signature and against the filmer's attestations — and refuses a copy
  // with one byte changed.
  async 'self-check'() {
    const { mkdtempSync, readFileSync, writeFileSync, existsSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const cams = await cameraFiles()
    const dir = mkdtempSync(join(tmpdir(), 'und-selfcheck-'))
    const A = await startStream({}, camera(cams.a))
    const V = await newPage({})
    await V.goto(A.shareUrl)
    if ((await videoWithin(V, 40000)) === null) return [false, 'viewer got no video']
    await V.waitForSelector('text=Stop Recording', { timeout: 20000 })
    await V.waitForTimeout(8000)
    await V.getByText('Stop Recording').click()
    await V.waitForTimeout(1500)
    const bundle = await saveFirstBundle(V, dir)
    execFileSync('unzip', ['-q', bundle, '-d', dir])
    const verifier = join(dir, 'verify.html')
    if (!existsSync(verifier)) return [false, `no verify.html in the bundle (run npm run build:verify and restart the dev server); entries: ${execFileSync('unzip', ['-Z1', bundle], { encoding: 'utf8' }).trim().split('\n').join(', ')}`]
    const webm = join(dir, execFileSync('unzip', ['-Z1', bundle], { encoding: 'utf8' }).split('\n').find((n) => /\.webm$/.test(n)))
    const size = readFileSync(verifier).length

    // A plain browser, from disk: no dev server, no app.
    const P = await newPage({})
    const resultText = () => P.locator('#out').innerText().then((t) => t.replace(/\s+/g, ' '))
    const settle = (re) => P.waitForFunction((src) => new RegExp(src).test(document.getElementById('out')?.textContent ?? ''), re.source, { timeout: 90000 }).then(() => true).catch(() => false)
    await P.goto(`file://${verifier}`)
    await P.locator('#files').setInputFiles([webm, join(dir, 'evidence.json')])
    const okFiles = (await settle(/Unaltered/)) && (await settle(/Shows what the filming device|Does not show|Too few|None of the signatures/))
    const pair = await resultText()
    await P.goto(`file://${verifier}`)
    await P.locator('#files').setInputFiles([bundle])
    const okZip = await settle(/Unaltered/)
    const zipText = await resultText()
    // One flipped byte in the middle of the video.
    const bytes = readFileSync(webm)
    bytes[Math.floor(bytes.length / 2)] ^= 0xff
    const tampered = join(dir, 'tampered.webm')
    writeFileSync(tampered, bytes)
    await P.goto(`file://${verifier}`)
    await P.locator('#files').setInputFiles([tampered, join(dir, 'evidence.json')])
    const refused = await settle(/Not the recording that was signed/)
    const tamperedText = await resultText()
    const ok = okFiles && /✓ Unaltered/.test(pair) && /✓ Shows what the filming device/.test(pair) && okZip && /✓ Unaltered/.test(zipText) && refused
    return [ok, `verify.html ${(size / 1024).toFixed(0)} KB from disk: video + evidence.json → "${pair.slice(0, 220)}" | the .zip → unaltered ${okZip} | one byte changed → "${tamperedText.slice(-90)}"`]
  },
})
const BLOCK_ALL_RULE = ['-p', 'udp', '-s', HOST_IP, '-d', HOST_IP, '-j', 'DROP']
// Scenarios a published build cannot run: they lean on a dev-only override.
const NOT_ON_LIVE = {
  'public-relay': 'the published build ignores the dev-only relay candidate list, so this would test the real public relays (UDP to the internet; run it from outside a sandbox, or check the opt-in by hand)',
  'relay-panel-remembers': 'the published build ignores the dev-only relay candidate list this scenario relies on',
}
// Needs root for its counting rule, like the NAT scenarios need theirs.
const NEEDS_BLOCK = new Set(['blocked', 'relay-link', 'relay-one-side', 'relay-rejected', 'relay-added-live', 'public-relay', 'relay-panel-remembers', 'offline-isolated', 'messenger-pair', 'messenger-pair-late'])

// A run killed mid-scenario leaves its firewall rule behind, and the next run
// then fails on "no direct path": clear any such leftovers first.
for (const rule of [BLOCK_RULE, BLOCK_ALL_RULE, NO_UDP_RULE]) while (block(false, rule)) {}

relayProcess = startHelper('nostr-relay.mjs', '7777')
startHelper('turn-server.mjs', HOST_IP)
// TURN over TLS on 443 and over TCP on 8443, in front of the UDP server (blend-in).
startHelper('turn-tcp-bridge.mjs', HOST_IP, '443', '8443', join(tmpdir(), 'und-turn-cert'))
await new Promise((r) => setTimeout(r, 1000))

let failures = 0
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenarios)
try {
  for (const name of wanted) {
    if (LIVE && NOT_ON_LIVE[name]) {
      console.log(`SKIP ${name}: ${NOT_ON_LIVE[name]}`)
      continue
    }
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
