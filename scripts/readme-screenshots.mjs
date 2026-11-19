// README screenshots (docs/img/): phone screens at 400×860 @2x and a desktop
// banner of the home screen. Needs the dev server (`npm run dev`) and
// Playwright (`npm i --no-save playwright@1`). Chrome's fake camera stands in
// for a real one. Run: APP_URL=http://localhost:4400 node scripts/readme-screenshots.mjs
import { chromium } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = process.env.APP_URL || 'http://localhost:4400'
const out = join(dirname(fileURLToPath(import.meta.url)), '../docs/img')
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })

async function page(viewport, scale = 2) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, colorScheme: 'dark' })
  return ctx.newPage()
}

// Let the home screen's one entrance (inks into register, copies fanning out)
// finish before the picture is taken.
const SETTLE_MS = 1800

const phone = { width: 400, height: 860 }
for (const [name, path] of [['home', '/'], ['guide', '/guide'], ['offline', '/offline'], ['network', '/network']]) {
  const p = await page(phone)
  await p.goto(`${APP}${path}`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(SETTLE_MS)
  await p.screenshot({ path: join(out, `${name}.png`) })
  console.log(`docs/img/${name}.png`)
}

// The share sheet appears once a stream is live. With the published site as
// the app's public address, it shows the link real users get, not a
// "this link only opens on this device" warning for the dev server.
{
  const p = await page(phone)
  await p.addInitScript(() => localStorage.setItem('undepressable_public_url', 'https://marcuspuchalla.github.io/undepressable/'))
  await p.goto(`${APP}/stream`)
  await p.waitForSelector('text=Share Stream', { timeout: 30000 })
  await p.waitForTimeout(1200)
  await p.screenshot({ path: join(out, 'share.png') })
  console.log('docs/img/share.png')
}

// Desktop banner: the header and hero of the home screen.
{
  const p = await page({ width: 1440, height: 820 }, 1.5)
  await p.goto(`${APP}/`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(SETTLE_MS)
  await p.screenshot({ path: join(out, 'banner.png'), clip: { x: 0, y: 0, width: 1440, height: 640 } })
  console.log('docs/img/banner.png')
}

await browser.close()
console.log('compress with: pngquant --force --ext .png --quality 70-90 docs/img/*.png')
