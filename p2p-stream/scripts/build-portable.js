#!/usr/bin/env node
/**
 * The whole app as ONE html file — the copy nobody can take down.
 *
 * Runs after `vite build --mode portable` (relative paths, hash routes, a
 * single bundle) and inlines script, stylesheet and icon into
 * dist-portable/undepressable.html. That file:
 *   - runs straight from disk in Chrome, Edge and Firefox on a computer
 *     (file:// counts as a secure context there: camera and WebRTC work);
 *   - runs from ANY web address or path: an IPFS gateway, an onion service,
 *     a subfolder of someone's site, a phone's file-server app — upload it as
 *     index.html and it is a full mirror;
 *   - is what "Share this app" hands on, so the app spreads by AirDrop,
 *     Bluetooth, messenger or USB stick without any website.
 *
 *   node scripts/build-portable.js                   build dist-portable/undepressable.html
 *   node scripts/build-portable.js --copy-to <dir>   also put a copy into <dir> (the web build)
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const appDir = path.join(root, 'dist-portable', 'app')
const outFile = path.join(root, 'dist-portable', 'undepressable.html')

const indexPath = path.join(appDir, 'index.html')
if (!fs.existsSync(indexPath)) {
  console.error('dist-portable/app/index.html not found — run "vite build --mode portable" first.')
  process.exit(1)
}
let html = fs.readFileSync(indexPath, 'utf8')
const read = (rel) => fs.readFileSync(path.join(appDir, rel.replace(/^\.\//, '')))

// Script: inline as a module. "</script" must not appear inside it, and it
// only can inside strings, regexes or comments, where "<\/" means the same.
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_m, src) => {
  const js = read(src).toString('utf8').replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--')
  return `<script type="module">${js}</script>`
})
// Stylesheet.
html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_m, href) => `<style>${read(href).toString('utf8')}</style>`)
// Icons: one small data URI; the rest only matter to installed web apps.
html = html.replace(/<link rel="icon" href="\.\/favicon\.ico">/, () => `<link rel="icon" href="data:image/x-icon;base64,${read('favicon.ico').toString('base64')}">`)
html = html.replace(/\s*<link rel="icon" type="image\/png"[^>]*>/g, '')
html = html.replace(/\s*<link rel="apple-touch-icon"[^>]*>/g, '')

if (/src="\.\/assets\/|href="\.\/assets\//.test(html)) {
  console.error('A reference to ./assets/ survived inlining — the file would not be self-contained.')
  process.exit(1)
}

fs.writeFileSync(outFile, html)
console.log(`✓ ${path.relative(root, outFile)} (${(fs.statSync(outFile).size / 1024 / 1024).toFixed(2)} MB)`)

const at = process.argv.indexOf('--copy-to')
if (at > 0 && process.argv[at + 1]) {
  const dest = path.resolve(root, process.argv[at + 1], 'undepressable.html')
  fs.copyFileSync(outFile, dest)
  console.log(`✓ copied to ${path.relative(root, dest)}`)
}
