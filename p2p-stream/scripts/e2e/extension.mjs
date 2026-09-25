// The browser extension carries its own copy of the app: no website involved.
//
// Loads dist-extension/chrome unpacked into Chromium, checks that the app
// renders from chrome-extension:// (hash routes, no CSP violations, lazily
// loaded code), and that it streams to a device running the ordinary web app
// both online (room code over a local Nostr relay) and face to face.
//
// Usage: npm run build:extension && node scripts/e2e/extension.mjs
//        (the web side is http://localhost:4400 — run `npm run dev -- --port 4400` first)
// Needs: npm i --no-save playwright@1

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const EXT = join(root, 'dist-extension', 'chrome')
const WEB = process.env.WEB_URL ?? 'http://localhost:4400'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
}
if (!existsSync(join(EXT, 'manifest.json'))) {
  console.log('FAIL dist-extension/chrome not found — run npm run build:extension')
  process.exit(1)
}

// Discovery through a local relay, so the online check needs no internet.
const RELAY_PORT = '7778'
const relay = spawn(process.execPath, [join(root, 'scripts', 'e2e', 'nostr-relay.mjs'), RELAY_PORT], { stdio: 'ignore' })
const RELAY_STORAGE = { undepressable_nostr_relays: JSON.stringify([`ws://localhost:${RELAY_PORT}`]), undepressable_nostr_relays_only: '1' }
const setStorage = (page, entries) => page.evaluate((e) => { for (const [k, v] of e) localStorage.setItem(k, v) }, Object.entries(entries))

const MEDIA = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns']
const dirs = []
const contexts = []
async function launch(extra = []) {
  const dir = mkdtempSync(join(tmpdir(), 'und-ext-'))
  dirs.push(dir)
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: 'chromium', // the "new" headless mode, which can load extensions
    args: [...MEDIA, ...extra],
    viewport: { width: 420, height: 1000 },
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  })
  contexts.push(ctx)
  return ctx
}
function watch(page) {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy|Refused to|Failed to fetch|dynamically imported/i.test(m.text())) errors.push(m.text())
  })
  return errors
}

try {
  const extCtx = await launch([`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`])
  let [worker] = extCtx.serviceWorkers()
  worker ??= await extCtx.waitForEvent('serviceworker', { timeout: 10000 }).catch(() => null)
  check('extension loads (background worker running)', !!worker)
  if (!worker) throw new Error('extension did not load')
  const id = new URL(worker.url()).host
  const base = `chrome-extension://${id}/index.html`

  const A = extCtx.pages()[0] ?? (await extCtx.newPage())
  const errA = watch(A)
  await A.goto(base)
  check('home page renders inside the extension', await A.locator('text=Live truth that').first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false))
  for (const [hash, text] of [
    ['#/offline', 'Pair face to face'],
    ['#/guide', 'Ways to use it'],
    ['#/network', 'Network & relay'],
    ['#/recordings', 'Recordings'],
  ]) {
    await A.goto(base + hash)
    const ok = await A.locator(`text=${text}`).first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false)
    check(`route ${hash} renders`, ok)
  }
  // An in-app link must stay inside the hash router (not navigate to chrome-extension://id/offline).
  await A.goto(base)
  await A.locator('a[href="#/offline"]').first().click().catch(() => {})
  await A.waitForTimeout(500)
  check('in-app links use hash routes', A.url().endsWith('#/offline'), A.url())

  await A.goto(base + '#/stream')
  await A.waitForTimeout(3000)
  check('streaming screen loads without CSP or chunk errors', errA.length === 0, errA.join(' | '))

  const webCtx = await launch()
  const B = webCtx.pages()[0] ?? (await webCtx.newPage())
  watch(B)
  const videoPlays = (p) =>
    p.waitForFunction(() => {
      const v = [...document.querySelectorAll('video')].find((v) => v.srcObject)
      if (v && v.paused) v.play().catch(() => {})
      return !!v && v.videoWidth > 0 && v.currentTime > 0.5
    }, null, { timeout: 25000 }).then(() => true).catch(() => false)

  // Online: the extension streams to a room, a web-app viewer joins by code.
  await A.goto(base + '#/')
  await setStorage(A, RELAY_STORAGE)
  await A.reload()
  await B.goto(WEB + '/')
  await setStorage(B, RELAY_STORAGE)
  await A.goto(base + '#/stream')
  await A.waitForSelector('text=Share Stream', { timeout: 30000 })
  const room = (await A.textContent('.font-mono.text-lg')).trim()
  // chrome-extension:// links open nowhere else: the sheet must say so and point to the in-app scanner.
  check('share sheet warns the link only opens here', await A.locator('text=only opens on this device').first().isVisible())
  await A.locator('.fixed.inset-0 button').first().click()
  await B.goto(`${WEB}/collect/${room}`)
  check('extension streams to a web-app viewer online (room code)', await videoPlays(B))
  await A.goto(base + '#/')
  await B.goto(WEB + '/')

  // Face to face: pair the extension (filming) with the web app (receiving).
  const codeOf = async (p) => (await p.locator('[data-testid=pair-code]').first().textContent()).trim()
  const paste = async (p, text) => {
    await p.locator('[data-testid=pair-paste]').first().fill(text)
    await p.getByRole('button', { name: 'Use', exact: true }).first().click()
  }
  await A.goto(base + '#/offline')
  await A.getByText("I'm filming").click()
  await A.waitForSelector('[data-testid=pair-code]', { timeout: 15000 })
  await B.goto(WEB + '/offline')
  await B.getByText("I'm receiving").click()
  await paste(B, await codeOf(A))
  await B.waitForSelector('[data-testid=pair-code]', { timeout: 15000 })
  await paste(A, await codeOf(B))
  check('extension streams to a web-app viewer face to face', await videoPlays(B))
  check('no errors in the extension page', errA.length === 0, errA.join(' | '))
} catch (e) {
  check('run', false, e.message)
} finally {
  for (const ctx of contexts) await ctx.close().catch(() => {})
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  relay.kill()
}
process.exit(results.every(Boolean) ? 0 : 1)
