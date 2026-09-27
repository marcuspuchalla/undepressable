#!/usr/bin/env node
/**
 * Write dist/release.json (every shipped file's SHA-256 + a fingerprint) and,
 * when a signing key is available, dist/release.sig. Runs after `vite build`.
 *
 *   node scripts/sign-release.mjs [dir]         sign dir (default: dist)
 *   node scripts/sign-release.mjs --keygen      print a new key pair
 *
 * Key: UNDEPRESSABLE_RELEASE_KEY (hex) or UNDEPRESSABLE_RELEASE_KEY_FILE.
 * Keep the private key off any build server you do not fully control, and
 * offline if you can: whoever holds it can make every installed copy accept
 * an update. Without a key the manifest is written unsigned.
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { ed25519 } from '@noble/curves/ed25519'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const hex = (bytes) => Buffer.from(bytes).toString('hex')

if (process.argv.includes('--keygen')) {
  const priv = ed25519.utils.randomPrivateKey()
  console.log(`public  ${hex(ed25519.getPublicKey(priv))}   → add to src/lib/update/trustedKeys.ts (or VITE_RELEASE_KEYS)`)
  console.log(`private ${hex(priv)}   → keep secret: UNDEPRESSABLE_RELEASE_KEY`)
  process.exit(0)
}

const dir = path.resolve(root, process.argv[2] ?? 'dist')
const SKIP = new Set(['release.json', 'release.sig'])

function walk(d, prefix = '') {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const rel = prefix + e.name
    if (e.isDirectory()) return walk(path.join(d, e.name), rel + '/')
    if (SKIP.has(rel) || e.name.endsWith('.map')) return []
    return [rel]
  })
}

const files = {}
for (const rel of walk(dir).sort()) {
  files[rel] = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, rel))).digest('hex')
}
const lines = Object.keys(files).sort().map((p) => `${p} ${files[p]}\n`).join('')
const fingerprint = crypto.createHash('sha256').update(lines).digest('hex')

const build = process.env.VITE_BUILD_ID || buildId()
function buildId() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  let commit = 'local'
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    /* not a git checkout */
  }
  return `${pkg.version}+${commit}`
}

const manifest = JSON.stringify({ format: 'undepressable-release', build, builtAt: new Date().toISOString(), files, fingerprint }, null, 2) + '\n'
fs.writeFileSync(path.join(dir, 'release.json'), manifest)

const keyHex =
  process.env.UNDEPRESSABLE_RELEASE_KEY ||
  (process.env.UNDEPRESSABLE_RELEASE_KEY_FILE ? fs.readFileSync(process.env.UNDEPRESSABLE_RELEASE_KEY_FILE, 'utf8').trim() : '')
const sigPath = path.join(dir, 'release.sig')
if (keyHex) {
  const sig = ed25519.sign(new TextEncoder().encode(manifest), Buffer.from(keyHex, 'hex'))
  fs.writeFileSync(sigPath, hex(sig) + '\n')
  console.log(`✓ release ${build} signed by ${hex(ed25519.getPublicKey(Buffer.from(keyHex, 'hex'))).slice(0, 16)}… — fingerprint ${fingerprint.slice(0, 16)}`)
} else {
  fs.rmSync(sigPath, { force: true })
  console.log(`• release ${build} NOT signed (no UNDEPRESSABLE_RELEASE_KEY) — fingerprint ${fingerprint.slice(0, 16)}`)
}
