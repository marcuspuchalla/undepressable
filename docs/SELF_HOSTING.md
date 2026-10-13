# Self-hosting relays (optional, recommended for organizers)

The app is zero-config by default: discovery rides public BitTorrent/Nostr/MQTT
infrastructure and media flows peer-to-peer. Two situations justify running
your own infrastructure:

1. **Strict NAT on both ends** (common phone↔phone across carriers, or a VPN
   ↔ mobile data): a TURN relay is required — there is no bundled one (the
   free public TURN the app once shipped is dead; see `RELIABILITY_AUDIT.md`
   §1). The app can try volunteer-run public relays as a stopgap (below).
2. **Censored networks** that block the public discovery relays.

Nothing here is required for same-network / hotspot use.

## TURN relay (coturn) in ~10 minutes

On any small VPS (put it in a jurisdiction you trust; use a boring domain):

```bash
apt install coturn
```

`/etc/turnserver.conf` — the important part is TLS on **443**, which survives
networks that block UDP and non-HTTPS ports:

```
listening-port=3478
tls-listening-port=443
fingerprint
lt-cred-mech
user=demo:strongpassword
realm=example.org
cert=/etc/letsencrypt/live/example.org/fullchain.pem
pkey=/etc/letsencrypt/live/example.org/privkey.pem
no-cli
# Every connection *attempt* allocates a relay port — Trystero pre-builds
# offers and races several in parallel — so leave generous headroom.
min-port=49152
max-port=65535
user-quota=300
```

> **Allocation budget.** With a relay configured, each device holds a few dozen
> relay allocations at once while connecting (Trystero's offer pools plus one
> parallel attempt per discovery relay), falling to one per live viewer once
> connected. A TURN provider with a low per-user cap answers `486 Allocation
> Quota Reached` / `508`, which the app now names in its status. See
> `RELIABILITY_AUDIT_3.md` §11.

```bash
systemctl enable --now coturn
```

### Handing the relay to participants

**In the app (recommended).** Open **Network** (tap the *Online* pill in the
header, or *Can't connect? Check your network* on Home). Paste the server
address, username and password — or a provider's **credentials link** — then
**Test** and **Save**. From then on:

- the stream's share link and QR carry the relay, so viewers set nothing up
  (turn off "Include the relay in my share links" to stop that);
- only one of two devices needs a relay to cross two strict NATs;
- "Always connect through the relay" hides your IP address from the people you
  connect to (they see the relay's instead).

The status card on the Stream/Collect screens has a *Set up a relay* button
whenever a connection fails because the networks block a direct path.

**No relay at all? Public ones, as a stopgap.** The relay sheet opens with
*Try free public ones*: the app tests a short list of volunteer-run TURN
servers from this network and, only after you tap *Use the N that answered*,
adds those. They stay on this device (never in share links) and can be
removed with *Stop using*. Expect them to be slow, full or gone — there is no
dependable public TURN without sign-up — and remember a relay operator sees
which addresses talk to each other (never the video, which is end-to-end
encrypted). A free account at a TURN provider (ExpressTURN, Metered,
Cloudflare) or the coturn setup above is the real fix. The same card offers
*More STUN servers* for networks that block the usual ones; STUN never gets
two strict NATs connected, only a relay does.

**Credentials link.** Many TURN providers issue short-lived credentials from an
HTTPS endpoint (for example `https://<app>.metered.live/api/v1/turn/credentials?apiKey=…`).
Paste that instead of static credentials: the app fetches fresh ones on every
join (4 s timeout, cached for up to 10 minutes, stale credentials used if the
endpoint is down). Bare arrays, `{iceServers: …}` (including Cloudflare's
single-object form), `{ice_servers: …}` and Xirsys' `{v: {iceServers}}` are
understood. Build-time equivalent: `VITE_ICE_SERVERS_URL`. For public events,
prefer this over static credentials: a leaked link then lends out your relay
only until the credentials expire.

The other ways, highest precedence first (settings on the device win over all
of them):

- **Share link** (easiest at a scene — no one configures anything):
  append `?turn=` (or `?ice=<credentials link>`) to any collect link you
  distribute:

  ```
  https://app.example/collect/A1B2C3?turn=turns%3Aexample.org%3A443|demo|strongpassword
  ```

  Format: `urls|username|credential` (URL-encode it). Multiple URLs
  comma-separated, e.g. `turn:example.org:3478,turns:example.org:443`. The
  setting persists on the device (localStorage) and applies to every later
  session, including streaming.

- **Build time**: `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`.

- **Console** (debugging): `localStorage.undepressable_turn =
  JSON.stringify({urls:['turns:example.org:443'],username:'demo',credential:'strongpassword'})`

Verify it works: chrome://webrtc-internals while connecting should show
`relay` candidate pairs when direct paths are blocked.

## Broadcast server (WHIP) for everyone without the app

*Amplify* (share sheet while streaming, or under the player while watching)
pushes the live stream to any server that accepts WHIP, the standard
WebRTC-ingest protocol. The server then serves it to anyone — HLS in a
browser or a video player, RTMP onward to other platforms — with no app and
no room code.

- **Self-hosted:** [MediaMTX](https://github.com/bluenviron/mediamtx) (one
  binary) accepts WHIP at `https://<host>:8889/<path>/whip` and serves HLS at
  `https://<host>:8888/<path>/`. Put it behind TLS: the app only sends to
  `https://` (plain `http://` only to localhost), and it must answer browser
  requests (CORS — MediaMTX does by default; set `webrtcAllowOrigin` to narrow
  it). Owncast and others offer WHIP too.
- **Hosted:** e.g. Cloudflare Stream gives a WHIP URL with the secret built in
  — paste it, leave the token empty.
- **Authentication:** the app sends the token as `Authorization: Bearer …`,
  which is what the WHIP standard specifies; check how your server maps it
  (some accept credentials in the URL instead).
- **Codecs:** the app prefers H.264, which most servers repackage without
  transcoding. Browsers without an H.264 encoder send VP8; configure the
  server to accept or transcode it.
- The server sees the video. Run your own, or use one you trust — and several
  in different places, since a single broadcast server is easy to block. A
  viewer abroad can amplify when the server is blocked where you are.

## Nostr relay (discovery) for censored networks

Any Nostr relay that accepts ephemeral events works (e.g.
[strfry](https://github.com/hoytech/strfry) behind nginx/TLS on 443). Add it on
the **Network** page under *Discovery relays* — no rebuild needed. It is tried
before the public relays, and it travels in share links (`?relays=wss://…`), so
viewers who open your link use it too. *Only use my relays* switches public
discovery (Nostr, BitTorrent, MQTT) off entirely: less metadata leaves your
group, but everyone must then share your relay.

For a group deployment you can still bake it in by editing `NOSTR_RELAYS` in
`src/types.ts`. Keep 2–3 public relays as fallback unless they are what's
blocked.

## The app's public address (share links and QR codes)

Share links must point at an address other phones can open. When the app runs
from `localhost`, a LAN address, or inside the desktop/mobile app shells, set
where the web app is publicly hosted — on the **Network** page (*Share links &
QR codes*), or at build time with `VITE_PUBLIC_URL=https://app.example.org`.
The in-app scanner reads the room code from any link, so scanning inside the
app works either way; this is about a phone's own camera app. The host must
serve `index.html` for deep links like `/collect/CODE` (SPA fallback).

Public infrastructure rots (three separate incidents so far — see audit §6):
if you pin your own relay list, re-verify it before relying on it.
