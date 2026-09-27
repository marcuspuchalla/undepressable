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
// sealed-passphrase, sealed-blind-carrier.
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
// Record `seconds` of the fake camera through the app's own recorder (the dev
// server serves source modules, so the page can import them directly).
async function recordOnDevice(page, seconds) {
  return page.evaluate(async (ms) => {
    const { useRecording } = await import('/src/composables/useRecording.ts')
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
    await phone.goto(`${APP}/recordings`)
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
    await other.goto(`${APP}/recordings`)
    const imported = await importFiles(other, bundle)
    const listed = await other.locator('[data-testid=recording]').count()
    const again = await importFiles(other, bundle)

    // One flipped byte in the middle of the video must be caught.
    const bytes = readFileSync(bundle)
    bytes[Math.floor(bytes.length / 2)] ^= 0xff
    const tampered = join(dir, 'tampered.zip')
    writeFileSync(tampered, bytes)
    const third = await newPage({})
    await third.goto(`${APP}/recordings`)
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
    await home.goto(`${APP}/archive`)
    const phone = await newPage({ undepressable_paired_home: HOME })
    await phone.goto(`${APP}/recordings`)
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
    await home.goto(`${APP}/recordings`)
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
    await A.goto(`${APP}/offline`)
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
    await B.goto(`${APP}/recordings`)
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
    await A.goto(`${APP}/offline`)
    await A.getByText("I'm filming").click()
    await A.waitForSelector('[data-testid=pair-code]', { timeout: 15000 })
    const B = await offlineViewer(A)
    const b = await videoWithin(B, 20000)
    await B.locator('[data-testid=share-onward]').click()
    await B.waitForSelector('[data-testid=pair-code]', { timeout: 15000 })
    const C = await newPage({})
    await C.goto(`${APP}/offline`)
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
    await A.goto(`${APP}/offline`)
    await A.getByText("I'm filming").click()
    await A.waitForSelector('[data-testid=pair-code]', { timeout: 15000 })
    const B = await offlineViewer(A)
    await videoWithin(B, 20000)
    await B.locator('[data-testid=share-onward]').click()
    await B.waitForSelector('[data-testid=pair-code]', { timeout: 15000 })
    const C = await newPage({})
    await C.goto(`${APP}/offline`)
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
    await A2.goto(`${APP}/offline`)
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
  await A.goto(`${APP}/offline`)
  await A.locator('[data-testid=mode-internet]').click()
  await A.getByText("I'm filming").click()
  await A.waitForSelector('[data-testid=pair-code]', { timeout: 20000 })
  const invite = await codeOf(A)
  // The viewer opens the ordinary face-to-face screen: the code itself says it came over the internet.
  const B = await newPage({ undepressable_nostr_relays: JSON.stringify(['ws://127.0.0.1:9']) })
  await B.goto(`${APP}/offline`)
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
      await A.goto(`${APP}/stream`)
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
      await B.goto(`${APP}/collect/${code}`)
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
    const { getRecording } = await import('/src/lib/recordingDb.ts')
    const { useOPFS } = await import('/src/composables/useOPFS.ts')
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
  await home.goto(`${APP}/archive`)
  await home.waitForFunction(() => /\/pair-home\//.test(document.body.innerText), null, { timeout: 15000 })
  const link = await home.evaluate(() => document.body.innerText.match(/\S*\/pair-home\/\S+/)[0])
  const u = new URL(link)
  await phone.goto(`${APP}${u.pathname}${u.search}`)
  return phone.locator('text=receive sealed recordings').waitFor({ timeout: 5000 }).then(() => true).catch(() => false)
}
Object.assign(scenarios, {
  // A seized phone gives nothing away: recordings sealed to the home archive
  // are unreadable on the phone and open only at home.
  async 'sealed-home'() {
    const home = await newPage({ undepressable_home_key: 'HQMRT7XP' })
    const phone = await newPage({})
    const sealingOffered = await pairPhoneWithHome(home, phone)
    await home.goto(`${APP}/archive`)
    await phone.goto(`${APP}/recordings`)
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
    await home.goto(`${APP}/recordings`)
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
    await phone.goto(`${APP}/recordings`)
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
    await home.goto(`${APP}/archive`)
    await phone.goto(`${APP}/recordings`)
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
    await friend.goto(`${APP}/recordings`)
    const imported = await importFiles(friend, file)
    const intact = await verifyFirst(friend)
    await friend.getByTitle('Play').first().click()
    const cannot = await friend.locator('[data-testid=sealed-notice]').first().innerText().catch(() => '')
    await friend.locator('[data-testid=send-home]').click()
    const sent = await friend
      .waitForFunction(() => /Everything is at home/.test(document.querySelector('[data-testid=home-sync-status]')?.textContent ?? ''), null, { timeout: 60000 })
      .then(() => true)
      .catch(() => false)
    await home.goto(`${APP}/recordings`)
    await home.locator('[data-testid=recording]').first().waitFor({ timeout: 10000 }).catch(() => {})
    const homeVerdict = await verifyFirst(home)
    const ok = /\.zip$/.test(file) && /Verified and imported/.test(imported) && /Intact \(sealed/.test(intact) && /someone else/.test(cannot) && sent && /Unaltered/.test(homeVerdict)
    return [ok, `sealed file ${download.suggestedFilename()}; friend: "${imported.slice(0, 40)}", ${intact}, play → "${cannot.slice(0, 40)}"; sent home: ${sent}; home: ${homeVerdict}`]
  },
})
const BLOCK_ALL_RULE = ['-p', 'udp', '-s', HOST_IP, '-d', HOST_IP, '-j', 'DROP']
const NEEDS_BLOCK = new Set(['blocked', 'relay-link', 'relay-one-side', 'relay-rejected', 'relay-added-live', 'public-relay', 'offline-isolated', 'messenger-pair', 'messenger-pair-late'])

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
