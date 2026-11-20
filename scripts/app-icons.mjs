// The app icon, in every size every platform needs, from one drawing.
//
// The mark is a heavy U printed twice — pink and aqua, a little off register,
// overlapping near white — on the indigo paper of the app: the same two-ink
// overprint as the home screen's headline. Writes public/icon.svg (the master,
// also served as the SVG favicon) and renders the PNG/ICO/ICNS sets for the
// web app, Android, iOS, the desktop build, and the splash screens.
//
// Needs Playwright (npm i --no-save playwright@1) and ImageMagick (`magick`);
// macOS's iconutil for the .icns. Run: node scripts/app-icons.mjs [--preview DIR]
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PAPER = '#121530'
const PINK = '#ff4fa0'
const AQUA = '#4fe0d9'

// A geometric U on a 1024 grid: two stems joined by a round bowl.
const U = 'M322 238H446V588A66 66 0 0 0 578 588V238H702V588A190 190 0 0 1 322 588Z'

/**
 * shape: 'rounded' (squircle-ish tile), 'square' (full bleed — the platform
 * masks it), 'circle', or 'none' (transparent, for Android's adaptive
 * foreground). scale shrinks the mark into a platform's safe zone.
 */
function svg({ shape = 'rounded', scale = 1.12, offset = 14 } = {}) {
  const bg =
    shape === 'rounded' ? `<rect width="1024" height="1024" rx="228" fill="${PAPER}"/>` :
    shape === 'square' ? `<rect width="1024" height="1024" fill="${PAPER}"/>` :
    shape === 'circle' ? `<circle cx="512" cy="512" r="512" fill="${PAPER}"/>` : ''
  const t = `translate(512 512) scale(${scale}) translate(-512 -512)`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <title>Undepressable</title>
  ${bg}
  <g transform="${t}" style="isolation:isolate">
    <path d="${U}" fill="${PINK}" transform="translate(${-offset} ${-offset * 0.55})" style="mix-blend-mode:screen"/>
    <path d="${U}" fill="${AQUA}" transform="translate(${offset} ${offset * 0.55})" style="mix-blend-mode:screen"/>
  </g>
</svg>
`
}

const browser = await chromium.launch()
const page = await browser.newPage()
async function render(markup, size, file, { transparent = false } = {}) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup.replace('width="1024" height="1024"', `width="${size}" height="${size}"`)}</body></html>`)
  mkdirSync(dirname(file), { recursive: true })
  await page.screenshot({ path: file, omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } })
}
const magick = (...args) => execFileSync('magick', args)

// --- preview: render a few sizes without touching the repo -------------------
const previewAt = process.argv.indexOf('--preview')
if (previewAt > 0) {
  const dir = process.argv[previewAt + 1]
  mkdirSync(dir, { recursive: true })
  for (const size of [512, 120, 64, 32, 16]) await render(svg(), size, join(dir, `icon-${size}.png`), { transparent: true })
  await browser.close()
  process.exit(0)
}

// --- the master ----------------------------------------------------------------
writeFileSync(join(root, 'public/icon.svg'), svg())

// --- web app -------------------------------------------------------------------
const pub = (f) => join(root, 'public', f)
await render(svg(), 512, pub('icon-512x512.png'), { transparent: true })
await render(svg(), 192, pub('icon-192x192.png'), { transparent: true })
// Maskable: full bleed, mark inside the central 80 % safe circle.
await render(svg({ shape: 'square', scale: 1.05 }), 512, pub('icon-maskable-512x512.png'))
// iOS rounds the corners itself and wants no transparency.
await render(svg({ shape: 'square' }), 180, pub('apple-touch-icon.png'))
{
  const tmp = join(tmpdir(), `undep-ico-${process.pid}`)
  mkdirSync(tmp, { recursive: true })
  for (const s of [16, 32, 48]) await render(svg(), s, join(tmp, `${s}.png`), { transparent: true })
  magick(join(tmp, '16.png'), join(tmp, '32.png'), join(tmp, '48.png'), pub('favicon.ico'))
  rmSync(tmp, { recursive: true })
}

// --- Android -------------------------------------------------------------------
const res = join(root, 'android/app/src/main/res')
for (const [dpi, legacy, fg] of [['mdpi', 48, 108], ['hdpi', 72, 162], ['xhdpi', 96, 216], ['xxhdpi', 144, 324], ['xxxhdpi', 192, 432]]) {
  await render(svg(), legacy, join(res, `mipmap-${dpi}/ic_launcher.png`), { transparent: true })
  await render(svg({ shape: 'circle', scale: 1.05 }), legacy, join(res, `mipmap-${dpi}/ic_launcher_round.png`), { transparent: true })
  // Adaptive foreground: 108 dp canvas, mark inside the 66 dp safe circle
  // (radius 313 on this grid; the U's far corners sit 333 × scale out).
  await render(svg({ shape: 'none', scale: 0.88 }), fg, join(res, `mipmap-${dpi}/ic_launcher_foreground.png`), { transparent: true })
}
writeFileSync(join(res, 'values/ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${PAPER.toUpperCase()}</color>
</resources>
`)

// --- iOS -----------------------------------------------------------------------
await render(svg({ shape: 'square' }), 1024, join(root, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'))

// --- desktop (Tauri) -------------------------------------------------------------
const tauri = (f) => join(root, 'src-tauri/icons', f)
for (const [file, size] of [['32x32.png', 32], ['128x128.png', 128], ['128x128@2x.png', 256], ['icon.png', 512],
  ['Square30x30Logo.png', 30], ['Square44x44Logo.png', 44], ['Square71x71Logo.png', 71], ['Square89x89Logo.png', 89],
  ['Square107x107Logo.png', 107], ['Square142x142Logo.png', 142], ['Square150x150Logo.png', 150],
  ['Square284x284Logo.png', 284], ['Square310x310Logo.png', 310], ['StoreLogo.png', 50]]) {
  await render(svg(), size, tauri(file), { transparent: true })
}
{
  const tmp = join(tmpdir(), `undep-tauri-${process.pid}`)
  mkdirSync(tmp, { recursive: true })
  for (const s of [16, 24, 32, 48, 64, 256]) await render(svg(), s, join(tmp, `${s}.png`), { transparent: true })
  magick(...[16, 24, 32, 48, 64, 256].map((s) => join(tmp, `${s}.png`)), tauri('icon.ico'))
  // macOS .icns via an .iconset (iconutil ships with macOS).
  const set = join(tmp, 'icon.iconset')
  mkdirSync(set)
  for (const s of [16, 32, 128, 256, 512]) {
    await render(svg(), s, join(set, `icon_${s}x${s}.png`), { transparent: true })
    await render(svg(), s * 2, join(set, `icon_${s}x${s}@2x.png`), { transparent: true })
  }
  try {
    execFileSync('iconutil', ['-c', 'icns', set, '-o', tauri('icon.icns')])
  } catch {
    console.warn('iconutil not available — src-tauri/icons/icon.icns left unchanged')
  }
  rmSync(tmp, { recursive: true })
}

// --- splash screens (Android and iOS): the mark centred on the paper ---------------
{
  const splashes = [
    ...['', '-land-hdpi', '-land-mdpi', '-land-xhdpi', '-land-xxhdpi', '-land-xxxhdpi', '-port-hdpi', '-port-mdpi', '-port-xhdpi', '-port-xxhdpi', '-port-xxxhdpi']
      .map((d) => join(res, `drawable${d}/splash.png`)),
    ...['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'].map((f) => join(root, 'ios/App/App/Assets.xcassets/Splash.imageset', f)),
  ].filter(existsSync)
  const markFile = join(tmpdir(), `undep-mark-${process.pid}.png`)
  await render(svg({ shape: 'none' }), 1024, markFile, { transparent: true })
  for (const f of splashes) {
    const [w, h] = execFileSync('magick', ['identify', '-format', '%w %h', f]).toString().split(' ').map(Number)
    const mark = Math.round(Math.min(w, h) * 0.32)
    magick('-size', `${w}x${h}`, `xc:${PAPER}`, '(', markFile, '-resize', `${mark}x${mark}`, ')', '-gravity', 'center', '-composite', f)
  }
  rmSync(markFile)
  console.log(`splash screens: ${splashes.length}`)
}

await browser.close()
console.log('icons written')
