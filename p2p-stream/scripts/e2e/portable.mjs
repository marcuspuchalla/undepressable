// The app keeps spreading with no website: one file, passed on by hand.
//
//   1. The web app hands out the single-file app; it is byte-identical to the
//      file listed in the published release.
//   2. Two computers open that file straight from disk (file://): they pair
//      face to face and stream; the viewer's recording (IndexedDB, as file://
//      has no OPFS) verifies unaltered.
//   3. The file shares itself onward, and the copy of the copy runs.
//   4. Uploaded under an arbitrary path (a mirror, e.g. an IPFS gateway), it
//      streams by room code, and its share link — route and relays inside the
//      hash — brings a viewer straight in.
//
// Usage: npm run build && node scripts/e2e/portable.mjs
// Needs: npm i --no-save playwright@1 ws

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WEB = 'http://localhost:4413'
const MIRROR_PORT = 4414
const RELAY_PORT = '7779'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
}
const sha = (buf) => createHash('sha256').update(buf).digest('hex')

const preview = spawn('npx', ['vite', 'preview', '--port', '4413', '--strictPort'], { cwd: root, stdio: 'ignore', detached: true })
const relay = spawn(process.execPath, [join(root, 'scripts', 'e2e', 'nostr-relay.mjs'), RELAY_PORT], { stdio: 'ignore' })
const single = readFileSync(join(root, 'dist', 'undepressable.html'))
const mirror = createServer((req, res) => {
  // Only the one file, under a path nobody chose for it.
  if (/^\/mirror\/any\/path\/(index\.html)?$/.test(req.url.split('?')[0])) {
    res.writeHead(200, { 'content-type': 'text/html' })
    return res.end(single)
  }
  res.writeHead(404)
  res.end()
})
await new Promise((r) => mirror.listen(MIRROR_PORT, r))
for (let i = 0; i < 60; i++) {
  if (await fetch(WEB).then((r) => r.ok).catch(() => false)) break
  await new Promise((r) => setTimeout(r, 300))
}

const dirs = []
const contexts = []
async function device() {
  const dir = mkdtempSync(join(tmpdir(), 'und-port-'))
  dirs.push(dir)
  const ctx = await chromium.launchPersistentContext(dir, {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns'],
    viewport: { width: 420, height: 1000 },
    acceptDownloads: true,
  })
  contexts.push(ctx)
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  return { page, errors }
}
const codeOf = async (p) => (await p.locator('[data-testid=pair-code]').first().textContent()).trim()
const paste = async (p, text) => {
  await p.locator('[data-testid=pair-paste]').first().fill(text)
  await p.getByRole('button', { name: 'Use', exact: true }).first().click()
}
const videoPlays = (p, ms = 25000) =>
  p.waitForFunction(() => {
    const v = [...document.querySelectorAll('video')].find((v) => v.srcObject)
    if (v && v.paused) v.play().catch(() => {})
    return !!v && v.videoWidth > 0 && v.currentTime > 0.5
  }, null, { timeout: ms }).then(() => true).catch(() => false)
async function saveApp(page) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByTestId('save-app').click()])
  const path = join(dirs[0], `${Date.now()}-${dl.suggestedFilename()}`)
  await dl.saveAs(path)
  return { path, name: dl.suggestedFilename() }
}

try {
  // 1. The web app hands out the file.
  const web = await device()
  await web.page.goto(WEB)
  const got = await saveApp(web.page)
  const release = await (await fetch(`${WEB}/release.json`)).json()
  const bytes = readFileSync(got.path)
  check('the web app hands out the single-file app, identical to the published release', sha(bytes) === release.files['undepressable.html'], `${got.name}, ${(bytes.length / 1024 / 1024).toFixed(2)} MB`)

  // 2. Two computers run it straight from disk.
  const fileUrl = 'file://' + got.path
  const A = await device()
  const B = await device()
  await A.page.goto(fileUrl + '#/offline')
  await A.page.getByText("I'm filming").click()
  await A.page.waitForSelector('[data-testid=pair-code]', { timeout: 20000 })
  await B.page.goto(fileUrl + '#/offline')
  await B.page.getByText("I'm receiving").click()
  await paste(B.page, await codeOf(A.page))
  await B.page.waitForSelector('[data-testid=pair-code]', { timeout: 20000 })
  await paste(A.page, await codeOf(B.page))
  check('two copies opened from disk pair face to face and stream', await videoPlays(B.page), fileUrl.slice(-40))
  await B.page.waitForTimeout(3000)
  await B.page.getByRole('button', { name: 'Stop', exact: true }).click()
  await B.page.getByText("I'm receiving").waitFor({ timeout: 15000 }) // stopped and saved
  await B.page.goto(fileUrl + '#/recordings')
  const rec = B.page.locator('[data-testid=recording]').first()
  await rec.waitFor({ timeout: 10000 }).catch(() => {})
  await rec.locator('[data-testid=verify]').click().catch(() => {})
  const verdict = await rec.locator('[data-testid=verify-result]').innerText({ timeout: 15000 }).catch(() => 'no recording')
  check('the viewer running from disk kept a signed copy that verifies', /Unaltered/.test(verdict), verdict)

  // 3. The file passes itself on.
  await A.page.goto(fileUrl + '#/')
  const again = await saveApp(A.page)
  const C = await device()
  await C.page.goto('file://' + again.path + '#/offline')
  const runs = await C.page.locator('text=Pair face to face').first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false)
  check('a copy of the copy runs', runs && C.errors.length === 0, `${(readFileSync(again.path).length / 1024 / 1024).toFixed(2)} MB; errors: ${C.errors.join(' | ') || 'none'}`)

  // 4. A mirror under any path.
  const MIRROR = `http://localhost:${MIRROR_PORT}/mirror/any/path/`
  const S = await device()
  await S.page.goto(MIRROR)
  await S.page.evaluate((port) => {
    localStorage.setItem('undepressable_nostr_relays', JSON.stringify([`ws://localhost:${port}`]))
    localStorage.setItem('undepressable_nostr_relays_only', '1')
  }, RELAY_PORT)
  await S.page.goto(MIRROR + '#/stream')
  await S.page.waitForSelector('text=Share Stream', { timeout: 30000 })
  const link = await S.page.evaluate(() => [...document.querySelectorAll('code')].map((c) => c.textContent.trim()).find((t) => t.includes('/collect/')))
  check('a mirror\'s share link points at the mirror, route in the hash', link?.startsWith(`${MIRROR}#/collect/`) && /relays=/.test(link), link)
  await S.page.locator('.fixed.inset-0 button').first().click()
  const V = await device() // a fresh device: everything it needs comes in the link
  await V.page.goto(link)
  check('a viewer opening that link joins and watches', await videoPlays(V.page, 40000))
} catch (e) {
  check('run', false, e.message)
} finally {
  for (const ctx of contexts) await ctx.close().catch(() => {})
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  mirror.close()
  relay.kill()
  try {
    process.kill(-preview.pid)
  } catch {
    /* gone */
  }
}
process.exit(results.every(Boolean) ? 0 : 1)
