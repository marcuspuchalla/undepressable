// Trystero pre-builds 20 offers per discovery transport — each one a peer
// connection gathering ICE — and its torrent transport hands 10 fresh ones to
// every tracker on every announce. On a join or a reconnect that is some 60
// peer connections and hundreds of STUN requests (and, with a relay, TURN
// allocations) in one burst. VPNs and mobile carriers throttle such bursts for
// a while, a small relay's quota is gone in minutes, and a STUN test run right
// after one finds nothing answering (the field report in
// docs/RELIABILITY_AUDIT_3.md, part 9). Offers are made on demand when the
// pool runs low, so a handful is enough.
//
// Its relay and tracker sockets also double their reconnect delay on every
// failure, without limit, and only reset after a connection succeeds. On a
// network that blocks discovery the delay passes ten minutes within the first
// quarter hour — so after a switch to a network that works (blocked Wi-Fi to
// mobile data, a VPN turned on), the app sat idle for that long before even
// trying again. Capped, so recovery takes at most RELAY_RETRY_CAP_MS.
//
// Runs on install (package.json "postinstall") and is idempotent;
// vite.config.ts refuses to build or serve an unpatched copy.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

export const OFFER_POOL = 4
export const TORRENT_OFFERS_PER_ANNOUNCE = 5
export const RELAY_RETRY_CAP_MS = 30_000

export const PATCHES = [
  { file: 'trystero/src/strategy.js', from: /const poolSize = \d+/, to: `const poolSize = ${OFFER_POOL}` },
  { file: 'trystero/src/torrent.js', from: /const offerPoolSize = \d+/, to: `const offerPoolSize = ${TORRENT_OFFERS_PER_ANNOUNCE}` },
  {
    file: 'trystero/src/utils.js',
    from: /socketRetryPeriods\[url\] \*= 2/,
    to: `socketRetryPeriods[url] = Math.min(socketRetryPeriods[url] * 2, ${RELAY_RETRY_CAP_MS})`,
  },
]

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 'patched' | 'already' | 'missing' | 'unexpected' (the line to patch is not there). */
export function applyPatch({ file, from, to }, nodeModules = join(root, 'node_modules')) {
  const path = join(nodeModules, file)
  if (!existsSync(path)) return 'missing'
  const code = readFileSync(path, 'utf8')
  if (code.includes(to)) return 'already'
  if (!from.test(code)) return 'unexpected'
  writeFileSync(path, code.replace(from, to))
  return 'patched'
}

/** True when every patch is in place. */
export function isPatched(nodeModules = join(root, 'node_modules')) {
  return PATCHES.every(({ file, to }) => existsSync(join(nodeModules, file)) && readFileSync(join(nodeModules, file), 'utf8').includes(to))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const p of PATCHES) {
    const r = applyPatch(p)
    console.log(`${p.file}: ${r}`)
    if (r === 'unexpected') process.exitCode = 1
  }
}
