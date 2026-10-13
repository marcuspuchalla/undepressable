# What the app's traffic looks like on the wire

For anyone whose network is watched: what a censor or an employer's firewall
can see of this app, by component, and what the *Blend in* setting changes.
Honest where it is weak. Companion to [`THREAT_MODEL.md`](THREAT_MODEL.md) §1.

Everything below is about **metadata** — who talks to whom, how, how much.
Video and data are encrypted end to end on every path (DTLS-SRTP); nothing
here lets anyone watch the stream.

## By component

| Component | Goes to | On the wire | A watcher sees |
|---|---|---|---|
| **The website** (first visit, updates) | the app's host | HTTPS 443 | TLS to that hostname (SNI). Installed copies, the single file and the extension make no such request. |
| **Discovery: Nostr** | public relays, or your own | WSS 443 | TLS to well-known relay hostnames — a short list a censor can block, which is why your own relay on 443 behind a boring domain exists. Inside: nothing readable. |
| **Discovery: BitTorrent trackers** | public trackers | WSS 443 | TLS to tracker hostnames (`tracker.webtorrent.dev`, …): recognisable as WebTorrent. |
| **Discovery: MQTT** | public brokers | WSS 443 | TLS to broker hostnames. |
| **STUN** (finding your public address) | Google, Cloudflare, Nextcloud | UDP 19302 / 3478 / 443 | STUN binding requests in the clear: unmistakably WebRTC, to hosts every WebRTC app uses. |
| **Direct peer-to-peer media** | the other device | UDP, random ports | A DTLS handshake (its ClientHello is a known fingerprint) then SRTP: unmistakably WebRTC. Both devices' addresses are visible to each other and to the path. |
| **TURN relay, `turn:` UDP or TCP** | your relay | UDP/TCP 3478 (or any) | TURN messages in the clear around encrypted payloads: recognisable as TURN, to your relay's address. |
| **TURN relay, `turns:` on 443** | your relay | TLS 443 | TLS to your relay's hostname, like HTTPS — see *Blend in* below for what still differs. |
| **Pair by messenger** | your messenger | whatever it uses | Nothing from the app: the codes go through the messenger. The connection then looks like direct media or TURN, as above. |
| **Face to face** (hotspot) | the other device | UDP on the local network | Nothing leaves the hotspot. |
| **Amplify** (WHIP) | the broadcast server | HTTPS 443 + WebRTC | HTTPS to the server, then media as DTLS-SRTP to it. |
| **Timestamps** (OpenTimestamps) | public calendars | HTTPS 443 | HTTPS to `*.calendar.opentimestamps.org`: a known hostname. Off unless asked for. |
| **Home archive** | your home device | discovery + media as above | Same as any stream: a room per home key. |

## Blend in

With *Blend in with ordinary web traffic* on (Network page), the app sends
nothing but TLS to port 443:

- media and data only through a `turns:…:443` relay — no STUN, no direct
  connection, no UDP at all (verified: not one UDP packet leaves the
  browser, `scripts/e2e/scenarios.mjs blend-in`);
- discovery only through Nostr relays over WSS — your own, if you have one;
- no NAT probe.

It needs a `turns:` relay on port 443 ([`SELF_HOSTING.md`](SELF_HOSTING.md)).
Without one, the setting is on but cannot apply, and the Network page says so.

**What still shows.** A watcher looking at TLS alone can still tell:

- *The hostnames.* TLS carries the server name (SNI) in the clear. Your relay
  and your discovery relay should sit behind names that mean nothing.
- *The shape.* A live stream is a long-lived connection sending steadily
  upward (filmer) or downward (viewer) at a few hundred kbit/s for minutes.
  HTTPS browsing is bursty. Heuristics on volume and timing can flag it.
- *TLS details.* TURN-over-TLS from a browser does not offer ALPN (`h2`,
  `http/1.1`); HTTPS from the same browser does. A watcher fingerprinting TLS
  handshakes can tell the two apart.
- *Who.* Nothing hides which network you are on; a VPN or Tor would — and Tor
  Browser switches WebRTC off, so the app cannot stream through it.

The app does no traffic obfuscation beyond this: no pluggable transports, no
padding, no timing shaping. Those exist (obfs4, Snowflake's own pipeline)
but are out of a web page's reach; they need a native app or a system VPN.

## Not on the wire, but on the record

Discovery relays, trackers and brokers see hashed room names and your
address. TURN relays see which addresses talk and how much. A broadcast
server sees everything it is sent. Calendars see a random-looking hash.
`THREAT_MODEL.md` §5 lists who sees what.
