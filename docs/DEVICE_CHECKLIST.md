# What still has to be tried on real devices and networks

Everything in this project is verified end to end — in Chromium, on one
machine, with the network simulated (strict NAT, policers, dead discovery,
stand-in calendars and broadcast servers). What that cannot prove is listed
here, in one place, so a pass with real phones can go down the list. Each
line says what to do and what counts as a pass. Mark the table as you go.

Status: ⬜ not tried · ✅ passed · ❌ failed (open an issue) · 🟡 partly.

## Things only you can switch on

| | What | How | Pass |
|---|---|---|---|
| ⬜ | **Signed releases** | `npm run release:keygen` on an offline machine; put the public key in `src/lib/update/trustedKeys.ts`; build with `UNDEPRESSABLE_RELEASE_KEY` | Network → *This copy of the app* reads "signed by the developers"; an update signed by another key is refused (THREAT_MODEL §2) |
| ⬜ | **A relay you run** | coturn with `turns:` on 443 (`SELF_HOSTING.md`); add it on the Network page; *Include in share links* | Network → *Check* shows the relay answering over TLS |
| ⬜ | **A relay in the published site** | Repository secrets `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL` (or `VITE_ICE_SERVERS_URL`); push to `main` (`SELF_HOSTING.md`, "A relay for the published site") | Network → *Relay* on the live site reads "This build ships a relay"; the VPN ↔ mobile pair below connects with nothing set up on either device |
| ⬜ | **Your own discovery relay** | strfry behind TLS on 443; add it under *Discovery relays* | Two devices find each other with *Only use my relays* on |

## Connecting across real networks (the field report, rounds 3–5)

| | What | How | Pass |
|---|---|---|---|
| 🟡 | VPN ↔ mobile data, no relay | Laptop on a VPN (exit abroad) streams; phone on mobile data scans the QR | Both say "your networks block a direct connection" within ~30 s, with *Set up a relay* — not endless "connecting". **Seen 2026-10-13** (Iceland VPN ↔ German carrier): the message came; the public relays did not answer, and STUN was offered as a remedy — round 9 (`RELIABILITY_AUDIT_3.md`, part 9) changed both |
| ⬜ | Same, after round 9 | The same pair, no relay | *Set up a relay* → *Test public relays* lists each relay with its reason; *More STUN servers* reads "will not help here" and its test, if run, says STUN works and a relay is needed; close the panel, re-open it: the results are still there with "Tested … ago" |
| ⬜ | Same, with the built-in relay | After the secrets above are set | Connects with nothing set up on either device; status `RELAY` |
| ⬜ | STUN test twice in a row | On the VPN side: *Test more STUN servers*, close, let the app reconnect, test again | The second test answers too; if it does not, the note says the servers answered a minute ago and blames throttling, not a blocked network |
| ⬜ | The relay as the only STUN server | Set a relay with a `turn:…:3478` address; Network → *Check*; a packet capture (Wireshark, `udp.port == 3478 \|\| udp.port == 19302`) during a stream | The relay card reads "Public address: learned from your relay"; the capture shows STUN only to the relay — nothing to Google, Cloudflare, Telnyx or Epygi; the check still gives a verdict |
| ⬜ | Two devices with IPv6 | Two phones on carriers with IPv6 (Telekom, Vodafone), no relay | Network → *Check* shows "Global IPv6"; the stream connects `direct` |
| ⬜ | The one shared public relay | *Set up a relay* → *Test public relays* from a strict network | The Open Relay pool answers (or says why not); a stream works through it |
| ⬜ | Same, relay on the streamer only | Add `turns:…:443` on the laptop; the phone re-scans | Connects without touching the phone; status `RELAY` |
| ⬜ | Share link from the camera app | Phone opens the QR with its camera app, not the in-app scanner | Joins (relay and discovery relays carried in the link) |
| ⬜ | Wi-Fi ↔ mobile handover mid-stream | Walk the viewer out of Wi-Fi range | Short blip: same recording segment; long: reconnects, new segment |
| ⬜ | Network → *Check* on each device | VPN, carrier, home Wi-Fi | Verdicts read as expected (strict / standard) |
| ⬜ | Pair by messenger over a real messenger | Codes over Signal or WhatsApp, both devices on strict networks | Connects within the code's lifetime; also when the reply comes 90 s late |
| ⬜ | Public relays | Network → *Test public relays* on a strict network | Only answering ones offered; a stream works through one |
| ⬜ | Public discovery from the published site | `LIVE=1 node scripts/e2e/scenarios.mjs` from an ordinary network (the sandbox the suite was run in could not carry WSS to the public relays: `RELIABILITY_AUDIT_3.md`, part 8) | Every scenario passes with the real Nostr relays, trackers and brokers doing the introductions |

## One phone to many, and face to face (rounds 2–4)

| | What | How | Pass |
|---|---|---|---|
| ⬜ | Three real phones, one filming | Two viewers on different networks | Counts (watching / recording) agree on every screen; late joiner gets video |
| ⬜ | Personal hotspot, internet cut | Three phones on one phone's hotspot; then switch off the hotspot's mobile data | Picture keeps flowing with the internet gone |
| ⬜ | Face to face by QR | Codes scanned at arm's length with real cameras, no internet | Connects first try; two viewers; the filmer sees each one's recording status |
| ⬜ | Chain A → B → C on a hotspot | B shares onward | C sees A's live picture; A shows 1 watching |
| ⬜ | iPhone hotspot guest isolation | Three phones on an iPhone hotspot | If guests cannot see each other, make the filmer the hotspot |
| ⬜ | Wake lock and screen lock | Lock the filming phone's screen for a minute | Camera recovers, stream resumes, new verifiable segment |
| ⬜ | A frozen stream is noticed | Put the viewer's phone in a dead zone | "Stream interrupted" within ~10 s, recording banked |

## Getting footage to safety (rounds 4–6)

| | What | How | Pass |
|---|---|---|---|
| ⬜ | Home archive on a computer | Pair a phone by QR; stream from elsewhere | Home records what the phone watches; *Send to home now* later delivers what the phone recorded alone |
| ⬜ | Evidence files over real share sheets | AirDrop iPhone → Mac, Quick Share Android → Android, Bluetooth | The .zip opens in the OS's own unzip; Import on the other device says "Verified" |
| ⬜ | Hand over face to face | Two phones paired by code | Recordings arrive and verify; an interrupted hand-over resumes |
| ⬜ | Sealed recording at a scene | Seal to home; record; lock the phone (or hand it to someone) before sending home | The phone shows nothing playable; at home it opens and verifies |
| ⬜ | Passphrase on a real phone | Lock with a passphrase; reload | Locked until unlocked; wrong passphrase refused |
| ⬜ | Real OpenTimestamps | ⏱ Timestamp; wait a few hours; *Check now* | "Existed by Bitcoin block #…"; `ots verify root.txt.ots` passes on the bundle |

## Evidence that holds up (rounds 7–8)

| | What | How | Pass |
|---|---|---|---|
| ⬜ | Check a copy against the filmer, real phones | A viewer on mobile data records 2 minutes; Recordings → *Check against the filmer* | "Shows what the filming phone's camera showed", most moments matched |
| ⬜ | A copy re-encoded by a messenger | Send the .webm through WhatsApp or Signal; import it with its evidence.json on another device | Import refuses it (bytes changed) — but `verify.html` / the check against the filmer still reports the picture matches |
| ⬜ | A real cut | Cut 10 s out of a copy with any video editor; check it | The removed stretch is named |
| ⬜ | Combined record from real copies | Two phones record different stretches; bring both to a computer; Combine copies → render | One video, gaps named, "rendered from 2 copies", checks out against the filmer |
| ⬜ | `verify.html` on each platform | Open it from the bundle on Windows, macOS, Linux, Android (Files), iOS (Files → Safari) | Picks the video and evidence.json, reports "Unaltered"; iOS: say whether file inputs work from Files |
| ⬜ | Attestations' cost on a phone | Stream 20 minutes with and without a viewer | Battery and heat no worse than the stream itself; the share sheet shows the key |

## Throttled and watched networks (rounds 7–8)

| | What | How | Pass |
|---|---|---|---|
| ⬜ | Throttled mobile data | A viewer on a carrier's post-cap speed (64–128 kbit/s), or a phone set to 2G only | Small picture or "Sound only", still recording, no false "interrupted"; picture back when the limit lifts |
| ⬜ | Several viewers, one throttled | Three viewers, one on 2G | The others keep the full picture |
| ⬜ | Blend in on a real network | A `turns:…:443` relay (coturn); *Blend in* on; stream from a network that blocks UDP or WebRTC (corporate, hotel, a country that does) | Connects; Network page shows "A TLS relay on port 443"; nothing but TLS in the firewall's logs (`TRAFFIC.md` says what still shows) |

## Platforms (round 5)

| | What | How | Pass |
|---|---|---|---|
| ⬜ | iOS Safari install | Add to Home Screen; airplane mode; open | Opens full-screen, works offline; camera allowed after the prompt |
| ⬜ | Android Chrome install | *Install app*; airplane mode; open | Same |
| ⬜ | Single-file app on a computer | Open `undepressable.html` from disk in Chrome, Edge; and in Firefox, Safari | Chrome/Edge: streams; others: report what works |
| ⬜ | Browser extension in Firefox | Load the Firefox zip | All routes; streams online and face to face |
| ⬜ | Amplify against real servers | MediaMTX (WHIP → HLS), Cloudflare Stream | Live on the open web; *Stop* ends it |
