// "Use it once, then it works even when the site is gone."
//
// Serves the production build, visits it once in two browser profiles, then
// shuts the server down completely — the situation after a takedown or with
// no network at all — and checks that the app still loads (including deep
// links and lazily loaded code) and that two devices can still pair face to
// face and stream to each other.
//
// Usage: npm run build && node scripts/e2e/pwa-offline.mjs
// Needs: npm i --no-save playwright@1

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PORT = 4411
const URL = `http://localhost:${PORT}`
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
}

function startServer() {
  const child = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore', detached: true })
  return child
}
async function waitFor(fn, ms = 20000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

const server = startServer()
const up = await waitFor(async () => (await fetch(URL)).ok)
if (!up) {
  console.log('FAIL could not start vite preview (did you run npm run build?)')
  process.kill(-server.pid)
  process.exit(1)
}

const profiles = []
async function profile() {
  const dir = mkdtempSync(join(tmpdir(), 'und-pwa-'))
  const ctx = await chromium.launchPersistentContext(dir, {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns'],
    viewport: { width: 420, height: 1000 },
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  })
  profiles.push({ ctx, dir })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && /Failed to fetch|dynamically imported|ChunkLoadError/i.test(m.text())) errors.push(m.text())
  })
  return { page, errors }
}

try {
  // 1. First (and only) online visit: the service worker installs and
  //    precaches everything, including code that is only loaded later.
  const A = await profile()
  const B = await profile()
  for (const { page } of [A, B]) {
    await page.goto(URL)
    const ready = await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
    await page.reload() // be controlled by the worker from here on
    const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller)
    check('service worker installed and controlling', ready && controlled)
  }

  // 2. The site disappears.
  process.kill(-server.pid)
  const gone = await waitFor(async () => {
    try {
      await fetch(URL)
      return false
    } catch {
      return true
    }
  })
  check('web server is gone', gone)

  // 3. Everything still loads, from the device alone.
  const { page } = A
  await page.goto(URL)
  check('home page loads with the server gone', await page.locator('text=Live truth that').first().isVisible())
  for (const [path, text] of [
    ['/offline', 'Pair face to face'],
    ['/collect/ABC123', 'Collector'],
    ['/recordings', 'Recordings'],
    ['/network', 'Network & relay'],
    ['/guide', 'Ways to use it'],
  ]) {
    await page.goto(URL + path)
    const ok = await page.locator(`text=${text}`).first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false)
    check(`deep link ${path} loads offline`, ok)
  }
  await page.goto(URL + '/stream')
  await page.waitForTimeout(4000)
  check('streaming screen (lazy P2P code) loads offline', A.errors.length === 0, A.errors.join(' | '))

  // 4. Two devices, no server, no internet: pair face to face and stream.
  const codeOf = async (p) => (await p.locator('[data-testid=pair-code]').first().textContent()).trim()
  const paste = async (p, text) => {
    await p.locator('[data-testid=pair-paste]').first().fill(text)
    await p.getByRole('button', { name: 'Use', exact: true }).first().click()
  }
  await A.page.goto(URL + '/offline')
  await A.page.getByText("I'm filming").click()
  await A.page.waitForSelector('[data-testid=pair-code]', { timeout: 15000 })
  await B.page.goto(URL + '/offline')
  await B.page.getByText("I'm receiving").click()
  await paste(B.page, await codeOf(A.page))
  await B.page.waitForSelector('[data-testid=pair-code]', { timeout: 15000 })
  await paste(A.page, await codeOf(B.page))
  const playing = await B.page
    .waitForFunction(() => {
      const v = [...document.querySelectorAll('video')].find((v) => v.srcObject)
      return v && v.videoWidth > 0 && v.currentTime > 0.5
    }, null, { timeout: 20000 })
    .then(() => true)
    .catch(() => false)
  check('two devices pair and stream with the site gone', playing)
} finally {
  for (const { ctx, dir } of profiles) {
    await ctx.close().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
  try {
    process.kill(-server.pid)
  } catch {
    /* already stopped */
  }
}
process.exit(results.every(Boolean) ? 0 : 1)
