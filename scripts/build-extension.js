#!/usr/bin/env node
/**
 * Package the app as a browser extension (Chrome/Edge/Brave and Firefox).
 *
 * Why an extension at all: a website can be taken down, blocked, or have its
 * domain seized — and whoever controls the domain controls what the page
 * becomes. An installed extension carries its own copy of the app, runs from
 * the browser with no server, and can be passed around as a file (USB stick,
 * AirDrop) and installed where the store is blocked.
 *
 * Usage: npm run build:extension
 *   -> dist-extension/chrome/, dist-extension/firefox/ (load unpacked)
 *   -> dist-extension/undepressable-<version>-chrome.zip / -firefox.zip
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'dist-extension')
const app = path.join(out, 'app')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

if (!fs.existsSync(path.join(app, 'index.html'))) {
  console.error('dist-extension/app/index.html not found — run "vite build --mode extension" first.')
  process.exit(1)
}

// Opens the app in a tab when the toolbar button is clicked. Works with the
// chrome.* namespace in both Chromium and Firefox.
const BACKGROUND = `chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') })
})
`

function manifest(browser) {
  const base = {
    manifest_version: 3,
    name: 'Undepressable',
    short_name: 'Undepressable',
    version: pkg.version,
    description:
      'Censorship-resistant peer-to-peer live streaming. Runs entirely from this browser — no website needed.',
    icons: { 48: 'icon-192x192.png', 128: 'icon-192x192.png' },
    action: { default_title: 'Open Undepressable', default_icon: { 48: 'icon-192x192.png', 128: 'icon-192x192.png' } },
    // No permissions: camera access is asked for in the page like on the web,
    // and everything else is ordinary web APIs.
  }
  if (browser === 'firefox') {
    return {
      ...base,
      background: { scripts: ['background.js'] },
      browser_specific_settings: { gecko: { id: 'undepressable@p2p-stream', strict_min_version: '128.0' } },
    }
  }
  return { ...base, background: { service_worker: 'background.js' }, minimum_chrome_version: '116' }
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name)
    const b = path.join(to, entry.name)
    if (entry.isDirectory()) copyDir(a, b)
    else if (!entry.name.endsWith('.map')) fs.copyFileSync(a, b) // source maps only bloat the package
  }
}

// --- minimal ZIP writer (stored entries), so packaging needs no extra tools ---
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function listFiles(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(path.join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
  )
}
function writeZip(dir, zipPath) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const name of listFiles(dir).sort()) {
    const data = fs.readFileSync(path.join(dir, name))
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(0, 8) // stored
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += local.length + nameBuf.length + data.length
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(centrals.length / 2, 8)
  end.writeUInt16LE(centrals.length / 2, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  fs.writeFileSync(zipPath, Buffer.concat([...locals, ...centrals, end]))
}

for (const browser of ['chrome', 'firefox']) {
  const dir = path.join(out, browser)
  fs.rmSync(dir, { recursive: true, force: true })
  copyDir(app, dir)
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest(browser), null, 2) + '\n')
  fs.writeFileSync(path.join(dir, 'background.js'), BACKGROUND)
  const zip = path.join(out, `undepressable-${pkg.version}-${browser}.zip`)
  writeZip(dir, zip)
  console.log(`✓ ${path.relative(root, dir)}/  and  ${path.relative(root, zip)} (${(fs.statSync(zip).size / 1024 / 1024).toFixed(1)} MB)`)
}
