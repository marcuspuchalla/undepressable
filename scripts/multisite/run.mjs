// Multi-site scenario runner (docs/MULTISITE_TEST_PLAN.md).
//
// Starts agents (agent.mjs) on real machines — this Mac natively, the servers
// and the NAS as containers over SSH — wires them into one room, and judges
// each scenario from what the agents report.
//
//   TURN_SECRET_FILE=… node scripts/multisite/run.mjs [scenario ...]
//
// Env: IMAGE (agent image tag on the hosts), TURN_HOST, TURN_SECRET_FILE,
//      RESULTS (JSONL output path). Each site's container is resource-capped
//      and removed afterwards; on Ctrl-C every started container is removed.

import { spawn, execFileSync } from 'node:child_process'
import { readFileSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { EventEmitter } from 'node:events'

const here = dirname(fileURLToPath(import.meta.url))
const IMAGE = process.env.IMAGE || `undep-agent:${execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: here }).toString().trim()}`
const TURN_HOST = process.env.TURN_HOST || '159.195.108.239'
const TURN_SECRET = process.env.TURN_SECRET_FILE ? readFileSync(process.env.TURN_SECRET_FILE, 'utf8').trim() : null
const RESULTS = process.env.RESULTS || join(here, 'results.jsonl')

// --- where things run --------------------------------------------------------
// nat:  the container sits behind Docker's NAT, behind the host's firewall.
// host: the container shares the host's network — its public IP and, on
//       NetBird hosts, its VPN address. Network profiles are refused here.
// publicIp: where each site's traffic appears on the internet — the no-direct
// profile drops UDP to the *other* participants' addresses.
const SITES = {
  mac: { local: true, label: 'Mac (home NAT, 192.168.10.0/24, NetBird)' },
  is: { host: 'mailserver', docker: 'docker', caps: '--cpus 1 --memory 1200m', label: 'mailserver (Iceland)', publicIp: '185.112.147.20' },
  log: { host: 'logserver', docker: 'docker', caps: '--cpus 1.5 --memory 2g', label: 'logserver', publicIp: '159.195.108.239' },
  fmp: { host: 'fmp', docker: 'docker', caps: '--cpus 1 --memory 1500m', label: 'fmp (Coolify prod host)', publicIp: '152.53.160.100' },
  // DSM's 3.10 kernel has no CFS quota, so --cpus is refused; shares still apply.
  nas: { host: 'nas', docker: '/usr/local/bin/docker', caps: '--cpu-shares 512 --memory 2g', label: 'Synology NAS (second home NAT, 192.168.1.0/24)' },
}
// Some networks block one lookup service or another (the Mac's can't reach ipify).
const LOOKUP = 'for u in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com https://ipv4.seeip.org; do curl -4 -s --max-time 6 $u && exit 0; done; exit 1'
function publicIpOf(key) {
  if (SITES[key].publicIp) return SITES[key].publicIp
  try {
    const out = SITES[key].local
      ? execFileSync('sh', ['-c', LOOKUP])
      : execFileSync('ssh', ['-o', 'BatchMode=yes', SITES[key].host, LOOKUP])
    return (SITES[key].publicIp = out.toString().trim())
  } catch {
    log(`  ! could not learn ${key}'s public IP — direct UDP to it is not blocked`)
    return (SITES[key].publicIp = '')
  }
}
// Everyone else's address, minus the relay's (blocking that would block the relay too).
const peersOf = (key) => Object.keys(SITES).filter((k) => k !== key).map(publicIpOf).filter((ip) => ip && ip !== TURN_HOST).join(',')

const turnStorage = (urls) => ({
  undepressable_turn: JSON.stringify({ urls, username: 'undeptest', credential: TURN_SECRET }),
})
const TURN_ALL = [`turn:${TURN_HOST}:3479`, `turn:${TURN_HOST}:3479?transport=tcp`, `turns:${TURN_HOST}:5349?transport=tcp`]

// --- agents ------------------------------------------------------------------
const running = new Set()
let scenarioAgents = []
let seq = 0
const runId = Date.now().toString(36).slice(-5)

function startAgent(siteKey, role, { args = [], profile = 'open', net = 'nat', storage = {}, duration = 60, connectTimeout, pairPath, turnIp } = {}) {
  const site = SITES[siteKey]
  if (!site) throw new Error(`unknown site ${siteKey}`)
  if (profile !== 'open' && (site.local || net === 'host')) throw new Error(`profile ${profile} needs an isolated container network (site ${siteKey}, net ${net})`)
  const name = `ud-${runId}-${++seq}-${siteKey}-${role}`
  const env = {
    SITE: siteKey,
    DURATION_S: String(duration),
    STORAGE_B64: Buffer.from(JSON.stringify(storage)).toString('base64'),
    PROFILE: profile,
    ...(connectTimeout ? { CONNECT_TIMEOUT_S: String(connectTimeout) } : {}),
    ...(pairPath ? { PAIR_PATH: pairPath } : {}),
    ...(turnIp ? { TURN_IP: turnIp, TURN_TLS_PORT: '5349' } : {}),
    ...(profile === 'no-direct' ? { PEER_IPS: peersOf(siteKey) } : {}),
  }
  let proc
  if (site.local) {
    proc = spawn(process.execPath, [join(here, 'agent.mjs'), role, ...args], {
      env: { ...process.env, ...env, DIST: join(here, '../../dist') },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } else {
    const envFlags = Object.entries(env).map(([k, v]) => `-e ${k}='${v}'`).join(' ')
    const netFlags = net === 'host' ? '--network host' : '--cap-add NET_ADMIN --dns 1.1.1.1 --dns 9.9.9.9'
    const cmd = `sudo -n ${site.docker} run --rm -i --name ${name} ${site.caps} ${netFlags} ${envFlags} ${IMAGE} ${role} ${args.map((a) => `'${a}'`).join(' ')}`
    proc = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ServerAliveInterval=15', site.host, cmd], { stdio: ['ignore', 'pipe', 'pipe'] })
  }
  const agent = Object.assign(new EventEmitter(), { siteKey, role, name, site, proc, events: [], summary: null })
  agent.on('error', () => {}) // agents report 'error' events; EventEmitter would throw on them
  running.add(agent)
  scenarioAgents.push(agent)
  let buf = ''
  proc.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      let ev
      try {
        ev = JSON.parse(line)
      } catch {
        continue
      }
      ev.at = Date.now() // one clock for all sites, so reports can be lined up
      agent.events.push(ev)
      if (ev.event === 'summary') agent.summary = ev
      if (ev.event === 'error') log(`  ! ${siteKey}/${role}: ${ev.message}`)
      agent.emit(ev.event, ev)
    }
  })
  let stderr = ''
  proc.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)))
  agent.done = new Promise((resolve) =>
    proc.on('exit', (code) => {
      running.delete(agent)
      if (!agent.summary && code) log(`  ! ${siteKey}/${role} exited ${code}: ${stderr.trim().split('\n').slice(-2).join(' / ')}`)
      resolve(agent.summary)
    }),
  )
  return agent
}

function waitFor(agent, event, ms) {
  return new Promise((resolve) => {
    const found = agent.events.find((e) => e.event === event)
    if (found) return resolve(found)
    const timer = setTimeout(() => resolve(null), ms)
    agent.once(event, (ev) => {
      clearTimeout(timer)
      resolve(ev)
    })
    agent.done.then(() => resolve(agent.events.find((e) => e.event === event) || null))
  })
}

function remote(siteKey, cmd) {
  const site = SITES[siteKey]
  try {
    return execFileSync('ssh', ['-o', 'BatchMode=yes', site.host, `sudo -n ${site.docker} ${cmd}`], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }).toString()
  } catch (err) {
    return `ERR ${err.message.split('\n')[0]}`
  }
}
const kill = (agent) => (agent.site.local ? agent.proc.kill('SIGKILL') : remote(agent.siteKey, `kill ${agent.name}`))
// Ask an agent to wrap up now: it still emits its summary.
const stop = (agent) => (agent.site.local ? agent.proc.kill('SIGTERM') : remote(agent.siteKey, `kill --signal TERM ${agent.name}`))
// The most recent report that still had a media path (a peer may have left since).
const lastWithMedia = (agent) => [...agent.events].reverse().find((e) => (e.event === 'tick' || e.event === 'summary') && e.paths?.length) || agent.summary
const exec = (agent, cmd) => remote(agent.siteKey, `exec ${agent.name} ${cmd}`)

async function cleanup() {
  for (const a of running) {
    if (a.site.local) a.proc.kill('SIGKILL')
    else remote(a.siteKey, `rm -f ${a.name}`)
  }
}
process.on('SIGINT', async () => {
  await cleanup()
  process.exit(130)
})

// --- reading results ---------------------------------------------------------
const pathOf = (summary) => {
  const p = (summary?.paths || []).find((x) => x.state === 'connected') || summary?.paths?.[0]
  return p ? `${p.local} → ${p.remote} @${p.remoteAddr} rtt ${p.rttMs}ms` : 'no media path'
}
const videoIn = (summary) => (summary?.paths || []).map((p) => p.in).find(Boolean)
const quality = (summary) => {
  const v = videoIn(summary)
  return v ? `${v.size} ${v.fps}fps lost ${v.lost} freezes ${v.freezes} jitter ${v.jitterMs}ms` : 'no inbound video'
}
// Inbound video bytes per tick: proves frames kept arriving (or stalled).
const bytesSeries = (agent) =>
  agent.events.filter((e) => e.event === 'tick').map((e) => (e.paths || []).map((p) => p.in?.bytes || 0).reduce((a, b) => Math.max(a, b), 0))

function log(s) {
  console.log(s)
}

// --- scenarios ----------------------------------------------------------------
// Each returns { pass, detail, metrics }.
async function oneToOne(streamerSite, viewerSite, { streamer = {}, viewer = {}, expect = () => true, connectTimeout = 90 } = {}) {
  const A = startAgent(streamerSite, 'streamer', { duration: connectTimeout + 45, ...streamer })
  const room = await waitFor(A, 'room', 90000)
  if (!room) return { pass: false, detail: `streamer on ${streamerSite} never opened a room` }
  const B = startAgent(viewerSite, 'viewer', { args: [room.path], duration: 25, connectTimeout, ...viewer })
  const vs = await B.done
  const live = lastWithMedia(A) // while the viewer was still there
  stop(A)
  await A.done
  const ttff = vs?.ttffS ?? null
  const metrics = { ttffS: ttff, viewerPath: pathOf(vs), streamerPath: pathOf(live), quality: quality(vs), streamerStatus: live?.status, viewerStatus: vs?.status }
  return { pass: expect({ ttff, vs, as: live, metrics }), detail: `${streamerSite} → ${viewerSite}: video ${ttff ?? 'NONE'}s; ${metrics.viewerPath}; ${metrics.quality}; streamer says "${live?.status ?? ''}"`, metrics }
}
const hasVideo = ({ ttff }) => ttff !== null
const viaRelay = ({ ttff, vs }) => ttff !== null && (vs?.paths || []).some((p) => /relay/.test(`${p.local} ${p.remote}`))
const relayOver = (proto) => ({ ttff, vs }) => ttff !== null && (vs?.paths || []).some((p) => new RegExp(`relay/[a-z]+/${proto}`).test(p.local || ''))

const scenarios = {
  // --- use case 01, real networks, no help -----------------------------------
  'home-to-home': () => oneToOne('mac', 'nas', { expect: hasVideo }),
  'server-to-home': () => oneToOne('is', 'mac', { expect: hasVideo }),
  'home-to-server': () => oneToOne('nas', 'fmp', { expect: hasVideo }),
  'server-to-server': () => oneToOne('log', 'is', { expect: hasVideo }),

  // --- VPN mesh (NetBird): both ends see each other's 100.113.x address -------
  'vpn-home-to-home': () => oneToOne('nas', 'mac', { streamer: { net: 'host' }, expect: hasVideo }),
  'vpn-server-to-server': () => oneToOne('log', 'is', { streamer: { net: 'host' }, viewer: { net: 'host' }, expect: hasVideo }),

  // --- strict NATs: no direct path ---------------------------------------------
  // Without a relay the app must say so honestly, not spin forever.
  'blocked-no-relay': async () => {
    const r = await oneToOne('is', 'nas', {
      streamer: { profile: 'no-direct' },
      viewer: { profile: 'no-direct' },
      connectTimeout: 75,
      expect: ({ ttff, vs }) => ttff === null && /block a direct connection/i.test(vs?.status || ''),
    })
    return r
  },
  // The streamer has a relay; its share link carries it to the viewer.
  'relay-via-link': () =>
    oneToOne('is', 'nas', {
      streamer: { profile: 'no-direct', turnIp: TURN_HOST, storage: turnStorage(TURN_ALL) },
      viewer: { profile: 'no-direct', turnIp: TURN_HOST },
      expect: viaRelay,
    }),
  // Only the streamer has a relay and does not share it.
  'relay-one-side': () =>
    oneToOne('is', 'nas', {
      streamer: { profile: 'no-direct', turnIp: TURN_HOST, storage: { ...turnStorage(TURN_ALL), undepressable_relay_share: '0' } },
      viewer: { profile: 'no-direct', turnIp: TURN_HOST },
      expect: hasVideo,
    }),
  // No UDP at all on the viewer's network: TURN over TCP is the only way.
  'relay-tcp-udp-blocked': () =>
    oneToOne('mac', 'fmp', { streamer: { storage: turnStorage(TURN_ALL) }, viewer: { profile: 'udp-blocked' }, expect: relayOver('tcp') }),
  // Only port 443 and the relay's TLS port: discovery over 443 only, media over TURN/TLS.
  'relay-tls-hostile': () =>
    oneToOne('mac', 'log', { streamer: { storage: turnStorage(TURN_ALL) }, viewer: { profile: 'hostile', turnIp: TURN_HOST }, expect: relayOver('tls') }),
  // Same, from a machine that isn't the relay's own host (rules out hairpinning).
  'relay-tls-hostile-remote': () =>
    oneToOne('mac', 'fmp', { streamer: { storage: turnStorage(TURN_ALL) }, viewer: { profile: 'hostile', turnIp: TURN_HOST }, expect: relayOver('tls') }),
  // "Always connect through the relay": the viewer never sees the streamer's IP.
  'force-relay-privacy': () =>
    oneToOne('mac', 'is', {
      streamer: { storage: { ...turnStorage(TURN_ALL), undepressable_force_relay: '1' } },
      expect: ({ ttff, vs }) => ttff !== null && (vs?.paths || []).every((p) => p.remoteAddr === TURN_HOST || /relay/.test(p.remote || '')),
    }),

  // --- degraded links ----------------------------------------------------------
  'bad-mobile-viewer': () => oneToOne('fmp', 'is', { viewer: { profile: 'bad-mobile' }, connectTimeout: 120, expect: hasVideo }),
  'lossy-streamer-uplink': () => oneToOne('log', 'nas', { streamer: { profile: 'lossy' }, expect: hasVideo }),

  // --- use case 03: discovery dies mid-stream, video must keep flowing ---------
  'internet-drops': async () => {
    const A = startAgent('log', 'streamer', { duration: 170 })
    const room = await waitFor(A, 'room', 90000)
    if (!room) return { pass: false, detail: 'no room' }
    const B = startAgent('is', 'viewer', { args: [room.path], duration: 90 })
    const v = await waitFor(B, 'video', 100000)
    if (!v?.ttffS) {
      kill(A)
      return { pass: false, detail: `no video before the cut (${v?.status})` }
    }
    await new Promise((r) => setTimeout(r, 10000))
    // Cut every TCP connection both ways: Nostr, trackers and MQTT are all TCP,
    // while the established WebRTC media path is UDP.
    const cut = 'iptables -I OUTPUT -p tcp ! -o lo -j DROP'
    const cutA = exec(A, cut)
    const cutB = exec(B, cut)
    const cutAt = bytesSeries(B).length
    const vs = await B.done
    kill(A)
    const series = bytesSeries(B)
    const after = series.slice(cutAt)
    const flowing = after.length >= 6 && after[after.length - 1] > after[0]
    return { pass: flowing, detail: `video ${v.ttffS}s; discovery cut (${(cutA + cutB).includes('ERR') ? 'cut FAILED' : 'ok'}) at tick ${cutAt}; inbound video bytes after the cut: ${after.join(' → ')}; ${pathOf(vs)}` }
  },

  // --- use case 02: crowd across sites, relay tree ----------------------------
  crowd: () => crowd(false),
  'crowd-seed-dies': () => crowd(true),

  // --- use case 04: phone at the scene forwards to a home archive --------------
  'home-archive': async () => {
    const H = startAgent('nas', 'home', { duration: 30, connectTimeout: 180 })
    const pair = await waitFor(H, 'pair', 90000)
    if (!pair) return { pass: false, detail: 'home node never showed a pairing link' }
    const A = startAgent('mac', 'streamer', { duration: 200 })
    const room = await waitFor(A, 'room', 90000)
    const P = startAgent('is', 'viewer', { args: [room.path], duration: 120, pairPath: pair.path })
    const phone = waitFor(P, 'video', 120000)
    const hs = await H.done
    const pv = await phone
    kill(P)
    kill(A)
    return {
      pass: hs?.ttffS != null && /Recording a forwarded stream/.test(hs?.card || ''),
      detail: `phone (Iceland) video ${pv?.ttffS ?? 'NONE'}s; home (NAS) video ${hs?.ttffS ?? 'NONE'}s after it opened; home card: "${hs?.card ?? ''}"; home path ${pathOf(hs)}`,
    }
  },
}

async function crowd(killASeed) {
  const viewerSites = ['is', 'log', 'fmp', 'nas', 'log', 'fmp']
  const N = viewerSites.length
  const A = startAgent('mac', 'streamer', { duration: killASeed ? 300 : 210 })
  const tree = []
  A.on('tree', (e) => tree.push(e.line))
  const room = await waitFor(A, 'room', 90000)
  if (!room) return { pass: false, detail: 'no room' }
  const viewers = []
  for (const s of viewerSites) {
    const v = startAgent(s, 'viewer', { args: [room.path], duration: killASeed ? 180 : 90, connectTimeout: 120 })
    v.forwarding = 0
    v.on('tree', (e) => /Forwarding stream to/.test(e.line) && v.forwarding++)
    viewers.push(v)
    await new Promise((r) => setTimeout(r, 2500))
  }
  const firstFrames = await Promise.all(viewers.map((v) => waitFor(v, 'video', 150000)))
  let killed = null
  let recovery = ''
  if (killASeed) {
    await new Promise((r) => setTimeout(r, 20000))
    killed = viewers.find((v) => v.forwarding > 0)
    if (!killed) recovery = 'no viewer became a seed — nothing to kill'
    else {
      const at = Date.now()
      kill(killed)
      // Every survivor must still be receiving fresh frames a minute later.
      await new Promise((r) => setTimeout(r, 60000))
      const alive = viewers.filter((v) => v !== killed)
      const fresh = alive.map((v) => {
        const s = bytesSeries(v)
        return s.length >= 3 && s[s.length - 1] > s[s.length - 3]
      })
      recovery = `killed seed on ${killed.siteKey} (it forwarded to ${killed.forwarding}); ${Math.round((Date.now() - at) / 1000)}s later fresh frames on ${fresh.filter(Boolean).length}/${alive.length} survivors (${alive.map((v, i) => `${v.siteKey}:${fresh[i] ? 'ok' : 'STALLED'}`).join(' ')})`
      killed.recovered = fresh.every(Boolean)
    }
  }
  await Promise.all(viewers.map((v) => v.done))
  stop(A)
  await A.done
  const seated = tree.filter((t) => /seated under seed/.test(t)).length
  const times = firstFrames.map((f) => (f?.ttffS == null ? 'NONE' : f.ttffS))
  const allVideo = firstFrames.every((f) => f?.ttffS != null)
  // The fan-out cap is about any one moment, not the whole session.
  const uploads = activeUploads(A)
  const peak = Math.max(0, ...uploads)
  // Counts compared at one moment when everyone was present: 20 s after the
  // last first frame (before any seed is killed).
  const moment = Math.max(...firstFrames.map((f) => f?.at || 0)) + 20000
  const countsAt = [A, ...viewers].map((a) => (nearestTick(a, moment)?.counts || []).join('/'))
  const want = `${N}/${N + 1}`
  const agree = countsAt.every((c) => c === want)
  const pass = allVideo && peak <= 2 && agree && (!killASeed || (killed && killed.recovered))
  return {
    pass,
    detail: `viewers ${viewerSites.join(',')}: first frames ${times.join(', ')}s; streamer's simultaneous uploads per report ${uploads.join(' ')} (peak ${peak}); ${seated} seatings under seeds; counts [watching/recording] on streamer+viewers at one moment ${countsAt.join(' ')} (want ${want})${killASeed ? `; ${recovery}` : ''}`,
  }
}

// How many video uploads were still sending at each report (bytes grew since the last).
function activeUploads(agent) {
  const series = []
  let prev = new Map()
  for (const t of agent.events.filter((e) => e.event === 'tick')) {
    const now = new Map((t.paths || []).filter((p) => p.out).map((p) => [p.pc, p.out.bytes]))
    series.push([...now].filter(([pc, bytes]) => prev.has(pc) && bytes > prev.get(pc)).length)
    prev = now
  }
  return series
}
const nearestTick = (agent, at) =>
  agent.events.filter((e) => e.event === 'tick').reduce((best, e) => (!best || Math.abs(e.at - at) < Math.abs(best.at - at) ? e : best), null)

// --- main ----------------------------------------------------------------------
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenarios)
if (!TURN_SECRET && names.some((n) => /relay|crowd/.test(n))) log('note: no TURN_SECRET_FILE — relay scenarios will fail')
log(`image ${IMAGE}, run ${runId}`)
let passed = 0
for (const name of names) {
  const fn = scenarios[name]
  if (!fn) {
    log(`? unknown scenario ${name}`)
    continue
  }
  const started = Date.now()
  log(`▶ ${name}`)
  scenarioAgents = []
  let r
  try {
    r = await fn()
  } catch (err) {
    r = { pass: false, detail: `harness error: ${err.message}` }
  }
  await cleanup()
  const secs = Math.round((Date.now() - started) / 1000)
  log(`${r.pass ? '✅' : '❌'} ${name} (${secs}s) — ${r.detail}`)
  if (r.pass) passed++
  appendFileSync(RESULTS, JSON.stringify({ run: runId, image: IMAGE, at: new Date().toISOString(), name, pass: r.pass, secs, detail: r.detail, metrics: r.metrics }) + '\n')
  // Every agent's raw reports, for digging into a result afterwards.
  for (const a of scenarioAgents) for (const e of a.events) appendFileSync(RESULTS.replace(/\.jsonl$/, '') + `-raw-${runId}.jsonl`, JSON.stringify({ scenario: name, agent: a.name, ...e }) + '\n')
}
log(`\n${passed}/${names.length} passed — results in ${RESULTS}`)
process.exit(passed === names.length ? 0 : 1)
