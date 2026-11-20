# relay-status

Keeps the relays built into Undepressable under their free monthly limits, and
tells the app which ones are on — **only when a user taps "Check which are
available"**. The app never contacts this service on its own.

| Relay | In the app | Usage measured by | Switched off at the limit by | Default limit |
|---|---|---|---|---|
| **Own relay (coturn on fmp)** | built in | coturn's own counters (bytes sent to clients + to peers) | removing its user from coturn's database: relaying stops, STUN keeps answering | 20 GB |
| **ExpressTURN** (free plan) | built in | **by hand**: ExpressTURN has no usage API; enter the dashboard figure | the app skipping it after a check (its free plan stops by itself, at no cost) | 900 GB |
| **Cloudflare Realtime TURN** | only after a check | Cloudflare's analytics, egress (the billed direction), about 30 s behind | no new credentials minted, every live one revoked | 900 GB |

Months are calendar months in UTC; a relay over its limit comes back on the
first of the next month. A relay whose usage cannot be measured right now
(analytics or metrics unreachable) is not handed out — an unmetered relay is
how a free tier turns into a bill.

## Why Cloudflare is not built in

Cloudflare's credentials live at most 48 hours, so they cannot be compiled
into an app that must work for months without asking anyone. They are minted
here and only reach the app through the check. One credential (6 h) is shared
by everyone and replaced after half its life.

## What it serves

- `GET /` — the status page: usage per relay this month.
- `GET /v1/relays` — the check: each relay's verdict, and ICE servers for the
  active ones. CORS-open, `no-store`.
- `POST /v1/admin/usage` `{"id":"expressturn","usedGB":312.4}` — a figure by hand.
- `POST /v1/admin/switch` `{"id":"fmp","enabled":false}` — off/on regardless of usage.

Admin calls need `Authorization: Bearer $ADMIN_TOKEN`. The service logs no
requests and stores no client addresses.

## Deploying (coturn + relay-status on one host)

`deploy/compose.yml` runs coturn on the host network and relay-status behind
the host's Traefik (Coolify's proxy on `fmp`), which also terminates TLS for
`turns:` on port 443 and passes plain TURN over TCP to coturn.

1. Two DNS names pointing at the host, e.g. `turn.example.org` and
   `relay-status.example.org` (or `*.152-53-160-100.sslip.io` names without DNS).
2. `cp deploy/.env.example deploy/.env` and fill it in (`openssl rand -hex 24`
   for `FMP_PASSWORD` and `ADMIN_TOKEN`).
3. Firewall: UDP and TCP 3478, UDP `RELAY_MIN_PORT`–`RELAY_MAX_PORT` open to
   the world; 9641 (coturn's metrics) open only to the proxy network.
4. `docker compose -f deploy/compose.yml up -d --build`.
5. In the app's repository: secret `VITE_BUILTIN_RELAYS`, e.g.
   ```json
   [{"id":"fmp","label":"Undepressable relay","server":{"urls":["turn:turn.example.org:3478","turns:turn.example.org:443?transport=tcp"],"username":"undepressable","credential":"…"}},
    {"id":"expressturn","label":"ExpressTURN","server":{"urls":["turn:free.expressturn.com:3478"],"username":"…","credential":"…"}}]
   ```
   and variable `VITE_RELAY_STATUS_URL=https://relay-status.example.org`.
   The credentials end up in the public app by design; the limits here are
   what keep that safe.

## Accounts needed

- **ExpressTURN**: free account; copy username and password from the dashboard
  into `ET_USERNAME` / `ET_PASSWORD` and the app's `VITE_BUILTIN_RELAYS`.
  Rotating them in the dashboard and in `.env` lets a check hand out the new
  ones to every copy.
- **Cloudflare**: Realtime → TURN → create a TURN key (`CF_TURN_KEY_ID`,
  `CF_TURN_KEY_TOKEN`); an API token with *Account Analytics: Read*
  (`CF_ANALYTICS_TOKEN`); the account id (`CF_ACCOUNT_ID`). Cloudflare
  documents no spending cap of its own: the 900 GB limit here, polled every
  minute, is the cap. Not adding a payment method to the account is the
  second safeguard.

## Tests

`npx vitest run services/relay-status` (from the repository root): monthly
accounting, counter restarts, month rollover, coturn's user database,
Cloudflare minting, sharing, refresh and revocation, ExpressTURN's manual figure.
