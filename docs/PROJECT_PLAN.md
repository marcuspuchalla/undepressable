# Project plan

One document for where this project came from, what it set out to do, what
is built, and what is next. It replaces the earlier `IMPLEMENTATION_PLAN.md`,
`PROJECT_PLAN.md` and `QUICKSTART.md`, whose still-relevant content is folded
in here; their week-by-week schedule and the custom signaling server they
planned were overtaken by what was actually built.

## Goal

A censorship-resistant, peer-to-peer live streaming app in which **video
evidence survives the confiscation of the phone that filmed it**, the
blocking of the website that served the app, and the throttling of the
network it travels over — and in which every copy can later be shown to be
unaltered, made by a known device, and (through the filmer's own signatures)
a faithful picture of what the camera saw.

Who it is for: people filming at protests and emergencies, the friends and
strangers watching them, and the journalists, lawyers and archives who
receive the footage afterwards.

## What the research settled (2026-01)

Five internal review rounds before the first line of code:

1. **WebRTC is the only real-time peer-to-peer media technology browsers
   have**; everything else (IPFS, WebTorrent) is too slow for live video.
2. **A full mesh fails at 4–6 viewers** on a phone's upload: a filming phone
   must send to a few viewers, who relay to the rest.
3. **IPFS is unsuitable for signaling** (latency in seconds).
4. **Chunked recording** (`MediaRecorder`, 1-second slices, persisted at once)
   is what makes a seized phone's last seconds survive on other devices.
5. **No single discovery path works under every censor**: several
   independent ones, and ways that need none at all.

The original plan called for a custom WebSocket signaling server
(`ws://localhost:3001`). It was replaced in 2026-01 by **Trystero**:
serverless discovery over public Nostr relays, BitTorrent trackers and MQTT
brokers, plus the app's own relays and paths that use no server at all.

## Architecture in brief

```
filming phone ──WebRTC──▶ direct viewers ──WebRTC──▶ further viewers   (relay tree, round 2)
      │                        │                          │
   records                  record                     record            (1-second signed chunks)
      │                        │
      └── signs a fingerprint of its picture twice a second ──▶ kept with every copy (round 7)

discovery: Nostr / trackers / MQTT, or your own relay, or two codes over a messenger, or face to face
media:     direct, or through a TURN relay (turns: on 443 — "blend in")
copies:    home archive, hand-over, evidence files (video + proof + verify.html)
```

The code lives at the repository root: a Vue 3 + TypeScript PWA built with
Vite; Trystero for discovery; WebRTC for media; OPFS/IndexedDB for storage;
Ed25519, SHA-256 Merkle trees, AES-GCM, X25519 and OpenTimestamps for the
evidence chain. `README.md` documents what is built; `docs/THREAT_MODEL.md`
what it resists and what it does not.

## Phases and status

The original six phases, with what each became.

| Phase (planned) | Status | What was built instead or on top |
|---|---|---|
| 1 Foundation: Vue, PWA, camera, basic WebRTC | ✅ | Installable PWA that works with the website gone; camera recovery after screen lock |
| 2 Recording and storage: chunks, OPFS, export | ✅ | 1-second chunks, SHA-256 per chunk, Merkle root signed per recording; evidence files (`.zip`, or video + evidence text) |
| 3 Multi-peer and hierarchy | ✅ | A relay tree the filming phone controls; viewers relay onward; six-viewer crowd test; per-link quality ladder down to sound only (round 7) |
| 4 Campaign management, QR, quick join | ✅ (reshaped) | Short room codes and QR; share links that carry relay and discovery settings; no accounts, no campaigns beyond a room |
| 5 Censorship resistance: decentralized signaling, serverless connection, deployment diversification | ✅ | Trystero over Nostr/trackers/MQTT; own discovery relay; pair by messenger; face-to-face pairing and chains; single-file app that runs from any path; browser extension; signed releases; GitHub Pages deploy; *blend in* (round 8) |
| 6 Polish and security | ✅ in part | Sealed (encrypted) recordings; OpenTimestamps; corroborated copies; combined records; self-checking bundles; threat model and traffic analysis. Owed: the real-device pass (`DEVICE_CHECKLIST.md`), a developer signing key, a security audit by someone else |

### Rounds, as delivered

| Round | Theme | Verification record |
|---|---|---|
| 1–2 | Reliability audit of the prototype; relay tree; recording integrity | `docs/RELIABILITY_AUDIT.md`, `_2.md` |
| 3 | Connecting across networks (the Iceland-VPN ↔ German-mobile report): ICE, TURN, NAT probe, share links, diagnostics | `docs/RELIABILITY_AUDIT_3.md` parts 1–2 |
| 4 | Offline: face-to-face pairing, hotspot, home archive, evidence files, hand-over, chains, PWA offline, extension, public relays | part 3 |
| 5 | Pair by messenger, signed updates, the self-distributing single file, Amplify (WHIP) | part 4 |
| 6 | Sealed recordings, trusted timestamps | part 5 |
| 7 | Corroborated copies (filmer-signed fingerprints), throttled links | part 6 |
| 8 | Combined records, blend in, self-checking bundles | part 7 |
| 8, live | The whole suite against the published site; the use cases as a document | part 8 |

## Success metrics (from the original plan), with where they stand

| Metric | Target | Now |
|---|---|---|
| End-to-end latency | < 3 s | Direct: first frame typically in 1–2 s in tests; relay adds little |
| Simultaneous viewers | 15+ | 6 verified in one run (relay tree); more is a question of the viewers' uplinks, not the code |
| Chunk persistence | 99 %+ | Every chunk written before the next; storage warnings before footage is lost |
| Chunk write time | < 100 ms | Not measured separately; a second's chunk writes well inside the next second |
| Browsers | Chrome, Firefox, Safari, Edge | Verified in Chromium end to end; others owed (`DEVICE_CHECKLIST.md`) |
| Join via QR | < 10 s | Yes in tests; real-camera scanning owed |
| First frame | < 5 s | Yes |
| Export | < 2× duration | Evidence files are a copy, not a re-encode: seconds |
| Battery: 2 h continuous | — | Owed on real phones |
| No unencrypted video on the wire | Yes | DTLS-SRTP everywhere; a broadcast server (Amplify) sees what it is sent, by design |
| No PII required | Yes | No accounts; anonymous keys |
| Security audit | — | Internal threat model and traffic analysis; an external audit is owed |

## Running it

```bash
npm ci
npm run dev             # http://localhost:4400 (camera needs localhost or HTTPS)
npm run test:unit       # unit tests
npm run build           # dist/, the single-file app, the evidence checker, release.json
sudo node scripts/e2e/scenarios.mjs            # end-to-end scenarios in Chromium (needs a dev server)
sudo LIVE=1 node scripts/e2e/scenarios.mjs     # the same against the published site
```

Phones need HTTPS: use the published site, or an HTTPS tunnel to the dev
server (`docs/ON_DEVICE_TESTING.md`). `docs/SELF_HOSTING.md` covers a relay
and a discovery relay of your own; `docs/STANDALONE.md` the single-file app.

## Risks, revisited

| Risk | Then | Now |
|---|---|---|
| WebRTC incompatibility | low / high | Chromium verified; Safari and Firefox owed; Tor Browser cannot stream (WebRTC off) |
| Storage quota | medium | Storage checked before and during recording; warnings; persistent storage requested |
| Mobile battery | high | Unmeasured; wake lock held while live; attestations add little |
| Censorship escalation | medium / high | Many paths (see the threat model); DPI can still recognise a live stream's shape; no pluggable transports in a web page |
| Legal and regulatory | low / high | Not addressed in the code; a question for whoever deploys it |

## What is next

In the order the project would take them:

1. **The real-device pass** — `docs/DEVICE_CHECKLIST.md`, every line.
2. **Switch on signed releases** — a developer key compiled in
   (`docs/THREAT_MODEL.md` §2); a relay and a discovery relay of the
   project's own.
3. **An external security review** of the evidence chain and the sealing.
4. **Native app** for radio-based meshing (Bluetooth, Wi-Fi Direct) where no
   hotspot exists — `docs/NATIVE_MESH.md`, `docs/ANDROID_FDROID.md`,
   `docs/IOS_CAPACITOR.md`.
5. From the original post-MVP list, still open: federation between
   independent groups, hardware-key signing, transcription. Blockchain
   anchoring is done (OpenTimestamps); at-rest encryption is done (sealed
   recordings).
