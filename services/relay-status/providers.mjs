// The three relays: how each one's usage is measured, how it is switched off,
// and which ICE servers a client gets while it is on. I/O is injected (fetch,
// the coturn database) so the logic is testable without the network.
import { createHash } from 'node:crypto';
import { GB, addCounterReading, setMonthTotal, monthOf, monthStart } from './usage.mjs';

const list = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const num = (s, d) => (s === undefined || s === '' ? d : Number(s));

// --- our own coturn ------------------------------------------------------------
// Usage: coturn's Prometheus totals, bytes sent to clients plus to peers — the
// traffic leaving the server. Off: the TURN user is removed from coturn's user
// database, so new allocations and refreshes are refused while STUN keeps
// answering (the app asks its relay for its public address; that must not
// stop when relaying does).

const COTURN_SCHEMA = `
CREATE TABLE IF NOT EXISTS turnusers_lt (realm varchar(127) default '', name varchar(512), hmackey char(128), PRIMARY KEY (realm,name));
CREATE TABLE IF NOT EXISTS turn_secret (realm varchar(127) default '', value varchar(256), primary key (realm,value));
CREATE TABLE IF NOT EXISTS allowed_peer_ip (realm varchar(127) default '', ip_range varchar(256), primary key (realm,ip_range));
CREATE TABLE IF NOT EXISTS denied_peer_ip (realm varchar(127) default '', ip_range varchar(256), primary key (realm,ip_range));
CREATE TABLE IF NOT EXISTS turn_origin_to_realm (origin varchar(127), realm varchar(127), primary key (origin));
CREATE TABLE IF NOT EXISTS turn_realm_option (realm varchar(127) default '', opt varchar(32), value varchar(128), primary key (realm,opt));
CREATE TABLE IF NOT EXISTS oauth_key (kid varchar(128), ikm_key varchar(256), timestamp bigint default 0, lifetime integer default 0, as_rs_alg varchar(64) default '', realm varchar(127), primary key (kid));
CREATE TABLE IF NOT EXISTS admin_user (name varchar(32), realm varchar(32), password varchar(128), primary key (name));
`;

export function turnHmacKey(username, realm, password) {
  return createHash('md5').update(`${username}:${realm}:${password}`).digest('hex');
}

export function coturnProvider(env, { fetch = globalThis.fetch, openDb } = {}) {
  const cfg = {
    urls: list(env.FMP_URLS),
    username: env.FMP_USERNAME ?? '',
    password: env.FMP_PASSWORD ?? '',
    realm: env.FMP_REALM ?? 'undepressable',
    metricsUrl: env.FMP_METRICS_URL ?? '',
    metrics: list(env.FMP_METRICS ?? 'turn_total_traffic_sentb,turn_total_traffic_peer_sentb'),
    userdb: env.FMP_USERDB ?? '',
  };
  const configured = cfg.urls.length > 0 && !!cfg.username && !!cfg.password && !!cfg.metricsUrl && !!cfg.userdb;
  let lastEnforced = null;
  return {
    id: 'fmp',
    label: env.FMP_LABEL ?? 'Undepressable relay',
    limitGB: num(env.FMP_LIMIT_GB, 20),
    configured,
    measured: 'counted by the relay itself',
    async poll(state, now) {
      if (!configured) return;
      const res = await fetch(cfg.metricsUrl, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`metrics answered ${res.status}`);
      const { sumMetrics } = await import('./usage.mjs');
      const total = sumMetrics(await res.text(), cfg.metrics);
      if (total === null) throw new Error(`none of ${cfg.metrics.join(', ')} in the metrics`);
      addCounterReading(state, 'fmp', total, now);
    },
    /** Make coturn's user database match the verdict. Idempotent. */
    enforce(active) {
      if (!configured || lastEnforced === active) return;
      const db = openDb(cfg.userdb);
      try {
        db.exec(COTURN_SCHEMA);
        if (active) {
          db.prepare('INSERT OR REPLACE INTO turnusers_lt (realm, name, hmackey) VALUES (?, ?, ?)').run(
            cfg.realm,
            cfg.username,
            turnHmacKey(cfg.username, cfg.realm, cfg.password),
          );
        } else {
          db.prepare('DELETE FROM turnusers_lt WHERE realm = ? AND name = ?').run(cfg.realm, cfg.username);
        }
      } finally {
        db.close();
      }
      lastEnforced = active;
    },
    async iceServers() {
      return [{ urls: cfg.urls, username: cfg.username, credential: cfg.password }];
    },
  };
}

// --- Cloudflare Realtime TURN -------------------------------------------------
// Usage: the GraphQL analytics, egress bytes of our TURN key this month — the
// figure Cloudflare bills (ingress is free). Credentials live at most 48 hours,
// so they are minted here and handed out by /v1/relays only; the app never has
// them built in. One credential is shared by everyone for its lifetime (fewer
// to revoke, and Cloudflare asks that issued credentials get used). Off: every
// credential still alive is revoked and no new one is minted.

const CF_API = 'https://rtc.live.cloudflare.com/v1/turn/keys';
const CF_GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';
// UDP for the common case, TLS on 443 for networks that let only HTTPS out.
const CF_KEEP = (u) => /^turn:turn\.cloudflare\.com:3478\?transport=udp$/i.test(u) || /^turns:turn\.cloudflare\.com:443\?transport=tcp$/i.test(u);

const day = (t) => new Date(t).toISOString().slice(0, 10);

export function cloudflareQuery(accountId, keyId, now) {
  return {
    query: `query($accountTag: string!, $keyId: string!, $from: Date!, $to: Date!) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    callsTurnUsageAdaptiveGroups(limit: 1, filter: { keyId: $keyId, date_geq: $from, date_leq: $to }) { sum { egressBytes } }
  } }
}`,
    variables: { accountTag: accountId, keyId, from: day(monthStart(now)), to: day(now) },
  };
}

export function cloudflareEgress(json) {
  if (json?.errors?.length) throw new Error(`analytics: ${json.errors.map((e) => e.message).join('; ')}`);
  const groups = json?.data?.viewer?.accounts?.[0]?.callsTurnUsageAdaptiveGroups;
  if (!Array.isArray(groups)) throw new Error('analytics: unexpected response');
  return groups.reduce((sum, g) => sum + (Number(g?.sum?.egressBytes) || 0), 0);
}

export function cloudflareProvider(env, { fetch = globalThis.fetch } = {}) {
  const cfg = {
    accountId: env.CF_ACCOUNT_ID ?? '',
    analyticsToken: env.CF_ANALYTICS_TOKEN ?? '',
    keyId: env.CF_TURN_KEY_ID ?? '',
    keyToken: env.CF_TURN_KEY_TOKEN ?? '',
    ttlS: Math.min(48, num(env.CF_CREDENTIAL_TTL_HOURS, 6)) * 3600,
  };
  const configured = !!(cfg.accountId && cfg.analyticsToken && cfg.keyId && cfg.keyToken);
  let current = null; // { servers, expires }
  const issued = []; // { username, expires }
  return {
    id: 'cloudflare',
    label: env.CF_LABEL ?? 'Cloudflare',
    limitGB: num(env.CF_LIMIT_GB, 900),
    configured,
    measured: "Cloudflare's own analytics (egress, the billed direction)",
    issued,
    async poll(state, now) {
      if (!configured) return;
      const res = await fetch(CF_GRAPHQL, {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.analyticsToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(cloudflareQuery(cfg.accountId, cfg.keyId, now)),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`analytics answered ${res.status}`);
      setMonthTotal(state, 'cloudflare', cloudflareEgress(await res.json()), now);
    },
    async enforce(active, now = Date.now()) {
      if (!configured || active) return;
      current = null;
      for (const c of issued.splice(0)) {
        if (c.expires <= now) continue;
        await fetch(`${CF_API}/${cfg.keyId}/credentials/${encodeURIComponent(c.username)}/revoke`, {
          method: 'POST',
          headers: { authorization: `Bearer ${cfg.keyToken}` },
          signal: AbortSignal.timeout(10000),
        }).catch(() => issued.push(c)); // try again on the next round
      }
    },
    async iceServers(now = Date.now()) {
      if (!configured) return [];
      // Reuse one credential until half its life is gone.
      if (current && current.expires - now > (cfg.ttlS * 1000) / 2) return current.servers;
      const res = await fetch(`${CF_API}/${cfg.keyId}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.keyToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ttl: cfg.ttlS }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`credentials answered ${res.status}`);
      const body = await res.json();
      const servers = (Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers])
        .map((s) => ({ urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter(CF_KEEP), username: s.username, credential: s.credential }))
        .filter((s) => s.urls.length > 0 && s.username);
      if (servers.length === 0) throw new Error('credentials: no usable servers');
      const expires = now + cfg.ttlS * 1000;
      issued.push({ username: servers[0].username, expires });
      current = { servers, expires };
      return servers;
    },
    expiresAt() {
      return current?.expires ?? null;
    },
  };
}

// --- ExpressTURN --------------------------------------------------------------
// Fixed credentials from the account dashboard, built into the app. It has no
// usage API: the operator types the dashboard's figure into the admin form,
// and the verdict follows it. Exceeding its free plan costs nothing (it simply
// stops), so the cap here is about knowing, not about money.

export function expressTurnProvider(env) {
  const urls = list(env.ET_URLS ?? 'turn:free.expressturn.com:3478');
  const configured = !!(env.ET_USERNAME && env.ET_PASSWORD);
  return {
    id: 'expressturn',
    label: env.ET_LABEL ?? 'ExpressTURN',
    limitGB: num(env.ET_LIMIT_GB, 900),
    configured,
    measured: 'entered by hand from the ExpressTURN dashboard',
    async poll(state, now) {
      const m = state.manual.expressturn;
      if (m && m.month === monthOf(now)) setMonthTotal(state, 'expressturn', m.usedGB * GB, now);
    },
    enforce() {},
    async iceServers() {
      return configured ? [{ urls, username: env.ET_USERNAME, credential: env.ET_PASSWORD }] : [];
    },
  };
}
