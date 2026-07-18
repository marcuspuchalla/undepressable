# Self-hosting relays (optional, recommended for organizers)

The app is zero-config by default: discovery rides public BitTorrent/Nostr/MQTT
infrastructure and media flows peer-to-peer. Two situations justify running
your own infrastructure:

1. **Strict NAT on both ends** (common phone↔phone across carriers): a TURN
   relay is required — there is no bundled one (the free public TURN the app
   once shipped is dead; see `RELIABILITY_AUDIT.md` §1).
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
```

```bash
systemctl enable --now coturn
```

### Handing the relay to participants

Three ways, highest precedence first:

- **Share link** (easiest at a scene — no one configures anything):
  append `?turn=` to any collect link you distribute:

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

## Nostr relay (discovery) for censored networks

Any Nostr relay that accepts ephemeral events works (e.g.
[strfry](https://github.com/hoytech/strfry) behind nginx/TLS on 443). Point the
app at it by editing `NOSTR_RELAYS` in `src/types.ts` and rebuilding — for a
group deployment you are building your own PWA anyway. Keep 2–3 public relays
in the list as fallback unless they are what's blocked.

Public infrastructure rots (three separate incidents so far — see audit §6):
if you pin your own relay list, re-verify it before relying on it.
