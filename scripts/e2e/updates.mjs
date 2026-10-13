// A seized website must not be able to slip new code into installed copies
// unnoticed. Builds three versions of the app and serves them in turn from
// one origin (the "website"):
//   v1  installed first; carries the developers' release key
//   v2  a proper update, signed with that key         → offered, installs
//   v3  what a new owner of the domain would publish  → loud warning, no
//       install button, and reloading keeps the trusted version
//
// Usage: node scripts/e2e/updates.mjs      (builds into dist-updates/, ~2 min)
// Needs: npm i --no-save playwright@1

import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname, extname, normalize } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(root, 'dist-updates')
const PORT = 4412
const SITE = `http://localhost:${PORT}`
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
}

const hex = (b) => Buffer.from(b).toString('hex')
const dev = ed25519.utils.randomPrivateKey()
const intruder = ed25519.utils.randomPrivateKey()
const devPub = hex(ed25519.getPublicKey(dev))

function build(name, signWith) {
  const dir = join(OUT, name)
  const env = { ...process.env, VITE_BUILD_ID: `e2e-${name}`, VITE_RELEASE_KEYS: `maintainer:${devPub}` }
  execFileSync('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir'], { cwd: root, env, stdio: 'ignore' })
  const signEnv = { ...env, UNDEPRESSABLE_RELEASE_KEY: signWith ? hex(signWith) : '' }
  execFileSync(process.execPath, [join(root, 'scripts', 'sign-release.mjs'), dir], { cwd: root, env: signEnv, stdio: 'ignore' })
  return dir
}

console.log('building v1, v2 (signed update), v3 (intruder-signed)…')
const v1 = build('v1', dev)
const v2 = build('v2', dev)
const v3 = build('v3', intruder)

// The "website": one origin whose content can be swapped under the installed app.
let current = v1
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon', '.sig': 'text/plain' }
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, SITE).pathname)).replace(/^(\.\.[/\\])+/, '')
  let file = join(current, path)
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (extname(path)) {
      res.writeHead(404)
      return res.end()
    }
    file = join(current, 'index.html') // SPA routes
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' })
  res.end(readFileSync(file))
})
await new Promise((r) => server.listen(PORT, r))

const profile = mkdtempSync(join(tmpdir(), 'und-upd-'))
const ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 420, height: 1000 } })
const page = ctx.pages()[0] ?? (await ctx.newPage())
const buildShown = async () => (await page.locator('[data-testid=this-copy] dd').first().innerText()).trim()
const banner = () => page.locator('[data-testid=update-banner]')
async function offerUpdate() {
  await page.goto(`${SITE}/network`)
  await page.getByRole('button', { name: /Check for updates|An update is waiting/ }).click()
  await banner().waitFor({ timeout: 30000 })
  await page.waitForFunction(() => !/checking who made it/.test(document.querySelector('[data-testid=update-banner]')?.textContent ?? ''), null, { timeout: 15000 })
  return (await banner().innerText()).replace(/\s+/g, ' ')
}

try {
  // Install v1.
  await page.goto(`${SITE}/network`)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await page.waitForFunction(() => /signed by the developers/.test(document.querySelector('[data-testid=this-copy]')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {})
  const v1Card = (await page.locator('[data-testid=this-copy]').innerText()).replace(/\s+/g, ' ')
  check('installed copy knows its build and that it is signed', /e2e-v1/.test(v1Card) && /signed by the developers/.test(v1Card), v1Card.slice(0, 120))

  // The developers publish v2.
  current = v2
  const offered = await offerUpdate()
  check('a signed update is offered', /signed by the developers/.test(offered) && /e2e-v2/.test(offered), offered.slice(0, 140))
  await page.getByTestId('apply-update').click()
  await page.waitForFunction(() => /e2e-v2/.test(document.querySelector('[data-testid=this-copy]')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {})
  check('accepting installs it', (await buildShown()) === 'e2e-v2', await buildShown())

  // The domain changes hands; the new owner publishes v3.
  current = v3
  const warned = await offerUpdate()
  const installButtons = await page.getByTestId('apply-update').count()
  check('an update signed by anyone else is flagged, with no install button', /not signed by the Undepressable developers/.test(warned) && installButtons === 0, warned.slice(0, 160))

  // Reloading keeps the trusted copy running.
  await page.reload()
  await page.locator('[data-testid=this-copy]').waitFor()
  check('reloading keeps the trusted version', (await buildShown()) === 'e2e-v2', await buildShown())
} catch (e) {
  check('run', false, e.message)
} finally {
  await ctx.close().catch(() => {})
  rmSync(profile, { recursive: true, force: true })
  server.close()
}
process.exit(results.every(Boolean) ? 0 : 1)
