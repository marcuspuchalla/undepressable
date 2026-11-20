// relay-status: keeps the relays built into Undepressable under their free
// limits, and tells the app — only when a user asks — which ones are on.
//
//   GET  /                 status page (usage per relay this month)
//   GET  /v1/relays        what the app's "Check the built-in relays" button reads:
//                          each relay's verdict, and ICE servers for the active ones
//   POST /v1/admin/usage   {id, usedGB}   set a figure by hand (ExpressTURN)
//   POST /v1/admin/switch  {id, enabled}  switch a relay off/on regardless of usage
//   GET  /healthz
//
// Admin calls need `Authorization: Bearer $ADMIN_TOKEN`. No request is logged
// and no client address is stored: the app's privacy promise extends here.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { timingSafeEqual, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { emptyState, verdict, prune, monthOf } from './usage.mjs';
import { coturnProvider, cloudflareProvider, expressTurnProvider } from './providers.mjs';
import { renderPage } from './page.mjs';

const env = process.env;
const PORT = Number(env.PORT ?? 8080);
const DATA_DIR = env.DATA_DIR ?? '/data';
const POLL_MS = Number(env.POLL_SECONDS ?? 60) * 1000;
const STATE_FILE = join(DATA_DIR, 'state.json');

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const providers = [
  coturnProvider(env, { openDb: (p) => new DatabaseSync(p) }),
  expressTurnProvider(env),
  cloudflareProvider(env),
];

mkdirSync(DATA_DIR, { recursive: true });
let state = load();
const errors = {}; // id -> last poll error (shown on the status page)
let lastPoll = null;

function load() {
  try {
    return { ...emptyState(), ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) };
  } catch {
    return emptyState();
  }
}
function save() {
  const tmp = `${STATE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STATE_FILE);
}

async function round() {
  const now = Date.now();
  for (const p of providers) {
    try {
      await p.poll(state, now);
      delete errors[p.id];
    } catch (err) {
      errors[p.id] = String(err?.message ?? err);
    }
  }
  prune(state, now);
  for (const p of providers) {
    try {
      await p.enforce(verdict(p, state, now).active, now);
    } catch (err) {
      errors[p.id] = `enforce: ${err?.message ?? err}`;
    }
  }
  lastPoll = now;
  save();
}

// A provider that cannot be measured right now is not handed out: an
// unmetered relay is exactly how a free tier turns into a bill.
function verdicts(now = Date.now()) {
  return providers.map((p) => {
    const v = verdict(p, state, now);
    if (v.active && errors[p.id] && p.id !== 'expressturn') return { ...v, active: false, reason: 'usage could not be measured' };
    return v;
  });
}

async function relaysResponse() {
  const now = Date.now();
  const relays = [];
  for (const v of verdicts(now)) {
    const p = providers.find((x) => x.id === v.id);
    if (!p.configured) continue;
    const entry = { ...v };
    if (v.active) {
      try {
        entry.iceServers = await p.iceServers(now);
      } catch (err) {
        entry.active = false;
        entry.reason = 'credentials unavailable';
        errors[p.id] = String(err?.message ?? err);
      }
    }
    relays.push(entry);
  }
  return { month: monthOf(now), checkedAt: new Date(lastPoll ?? now).toISOString(), relays };
}

function authorized(req) {
  const token = env.ADMIN_TOKEN;
  if (!token) return false;
  const given = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const h = (s) => createHash('sha256').update(s).digest();
  return timingSafeEqual(h(given), h(token));
}

async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error('too large');
  }
  return JSON.parse(raw || '{}');
}

function send(res, status, payload, type = 'application/json') {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'referrer-policy': 'no-referrer',
  });
  res.end(type === 'application/json' ? JSON.stringify(payload) : payload);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain');
    if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, { ok: true, lastPoll });
    if (req.method === 'GET' && url.pathname === '/v1/relays') return send(res, 200, await relaysResponse());
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, renderPage({ verdicts: verdicts(), errors, lastPoll, providers }), 'text/html; charset=utf-8');
    }
    if (req.method === 'POST' && url.pathname.startsWith('/v1/admin/')) {
      if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });
      const b = await body(req);
      const p = providers.find((x) => x.id === b.id);
      if (!p) return send(res, 400, { error: 'unknown relay id' });
      if (url.pathname === '/v1/admin/usage' && Number.isFinite(b.usedGB) && b.usedGB >= 0) {
        state.manual[p.id] = { month: monthOf(Date.now()), usedGB: b.usedGB };
      } else if (url.pathname === '/v1/admin/switch' && typeof b.enabled === 'boolean') {
        if (b.enabled) delete state.disabled[p.id];
        else state.disabled[p.id] = true;
      } else {
        return send(res, 400, { error: 'bad request' });
      }
      await round();
      return send(res, 200, verdicts().find((v) => v.id === p.id));
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    send(res, 500, { error: String(err?.message ?? err) });
  }
});

await round();
setInterval(() => round().catch(() => {}), POLL_MS);
server.listen(PORT, () => console.log(`relay-status on :${PORT}, polling every ${POLL_MS / 1000}s`));
