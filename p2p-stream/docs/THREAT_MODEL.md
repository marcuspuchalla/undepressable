# Threat model

Who might try to stop a live stream or erase its record, what the app does
about each of them, and what it does **not** protect against. Written to be
relied on, so where something is weak it says so.

Status as of 2026-09 (round 5). Verification: `docs/TEST_PLAN.md`,
`docs/RELIABILITY_AUDIT_3.md`.

---

## 1. A network censor (ISP, national firewall)

| They block… | What still works | What remains |
|---|---|---|
| **The app's website** | Installed copies run offline (verified with the server gone). The **single-file app** runs from disk on a computer (Chrome/Edge) and as a **mirror under any path** — IPFS, a subfolder, anyone's website — and passes from person to person (Home → *Pass the app on*). The **browser extension** carries its own copy. | Someone who never had the app needs one of these copies. iPhones cannot run the file from disk; they need an installed copy or a reachable mirror. |
| **The discovery servers** (Nostr relays, BitTorrent trackers, MQTT brokers) | Your own Nostr relay on port 443, handed out inside share links. **Pair by messenger**: two short codes over Signal, SMS, e-mail — no discovery server at all; the status card offers it when discovery is blocked. | Codes need some channel between the two people, and are good for a few minutes. |
| **Direct peer-to-peer traffic** (UDP, strict NAT, VPNs) | A TURN relay, ideally `turns:` on port 443 (looks like HTTPS), carried inside share links; volunteer public relays as an opt-in stopgap. | Someone has to run a relay somewhere reachable. WebRTC and TURN traffic can be recognised by deep packet inspection; the app does no traffic obfuscation (nothing like Tor's pluggable transports). |
| **A broadcast server** | Amplify from anyone who can reach it — e.g. a viewer abroad; any number of servers. | The server itself is a single point: run more than one. |
| **The whole internet** (shutdown, jamming) | Face-to-face pairing over one hotspot; chains (*Share onward*); *Hand over my recordings*; evidence files over AirDrop / Quick Share / Bluetooth. | Devices must share a hotspot. Finding nearby devices by radio, and Wi-Fi Direct without a hotspot, need native apps (`NATIVE_MESH.md`). |

## 2. Whoever takes over the website (domain seizure, hacked hosting)

A web app belongs to its website: the owner can publish new code, and
browsers install it. That is the most dangerous single point, because an
attacker's version could quietly collect footage or unmask users.

- **No silent updates.** A new version waits; the installed copy checks it
  first. It must be signed (`release.sig`, Ed25519) by a key the installed
  copy already carries. A signed update is offered. An unsigned one, or one
  signed by any other key, triggers a warning: the site may have been taken
  over, save your recordings, keep a copy from a trusted source — and there
  is no install button. Verified end to end (`scripts/e2e/updates.mjs`).
- **What browsers still allow:** a waiting update is applied once every
  window of the app has been closed. No page can veto that. The warning is
  there so people act before closing — and so a takeover is noticed at all.
- **New users** who open a seized site get whatever it serves. Copies that do
  not depend on the site — the single file, the extension, mirrors — avoid
  that. A file you received can be checked: its SHA-256 must match the
  `undepressable.html` entry of a signed `release.json`.

**Signed releases are not switched on yet.** No developer key is compiled in
(`src/lib/update/trustedKeys.ts` is empty), so today every update reads "this
copy cannot check who made it". To turn it on, maintainers:

1. Run `npm run release:keygen` on an offline machine. Keep the private key
   offline (encrypted, or on a hardware token); whoever holds it can make
   every installed copy accept an update.
2. Add the public key to `BUILT_IN` in `src/lib/update/trustedKeys.ts` and
   ship that release. Only copies installed from then on can check updates.
3. Build every release on a trusted machine with `UNDEPRESSABLE_RELEASE_KEY`
   set; publish `release.json` and `release.sig` with it (the build does both).
4. Publish each release's fingerprint somewhere independent of the website.
5. To rotate, ship the new public key alongside the old one in a release
   signed with the old key, before switching.

## 3. Someone who takes the phone

| Risk | What the app does | What remains |
|---|---|---|
| The footage is lost with the phone | Every viewer records its own copy; a paired home archive records what a phone watches, and later receives what the phone recorded on its own (store and forward); *Hand over my recordings*; evidence files | Nothing leaves the phone that was never connected to anyone |
| The footage is deleted or altered | Other copies exist; every recording is hashed chunk by chunk and signed, so any change is detectable; copies arriving from elsewhere are verified chunk by chunk | — |
| **The footage is watched** — to identify people in it | **Nothing.** Recordings are not encrypted at rest; whoever unlocks the phone and opens the app can watch them | Planned: recordings sealed to the home archive's key, so the phone can record but not replay them |
| The phone reveals who else was involved | No accounts, no contact list. Stored: pairing keys (home archive), relay credentials, discovery settings | A paired home-archive key lets its holder join that archive room |

## 4. People in the room, and on the path

- **Anyone with the room code can watch.** There is no access control beyond
  keeping the code to the right people. Discovery servers see a hash of it.
- **Participants see each other's IP addresses** (that is what peer-to-peer
  means) unless *Always connect through the relay* is on.
- **A relaying viewer passes on a re-encoded picture.** Every copy is signed by
  the device that recorded it: the signature proves that *this device* recorded
  *these bytes* and nothing changed since — not that the picture is what the
  person filming saw. Only the filming phone's own recording carries its
  signature. Linking a viewer's copy back to the source is not solved.
- In transit, video is encrypted end to end (DTLS-SRTP) on every hop; relays
  (TURN) and discovery servers cannot see it. A **broadcast server** (Amplify)
  necessarily can.

## 5. Infrastructure operators

| Operator | Sees | Cannot |
|---|---|---|
| Discovery (Nostr, trackers, MQTT) | Hashed room names, IP addresses, timing | Video, room codes in the clear |
| TURN relay (own or public) | Which addresses talk to each other, traffic volume | Video |
| Messenger carrying pairing codes | The codes: your network addresses, key fingerprints. Changing both codes could insert a man in the middle | Video, if the codes arrive unchanged — use an end-to-end encrypted messenger |
| Broadcast server (WHIP) | Everything it receives, by design | — |
| Website host | Who downloads the app | Anything after that, unless its update is accepted (§2) |

## 6. Disputes about the evidence

- **"The video was edited."** Each recording carries a Merkle root over its
  chunk hashes, signed by the recording device's anonymous Ed25519 key. The
  evidence file's README explains how to check it without the app.
- **What a signature does not show:** who held the device, where, or when.
  There is no trusted timestamp yet (planned: anchoring Merkle roots in a
  public timestamping service whenever online).

---

## If you are about to rely on it

- Install the app while you have internet, and keep the single file or the
  extension as a second copy.
- Set up a relay you trust (Network page) — or know where the public ones are.
- Pair a home archive, and rehearse face-to-face pairing and pairing by
  messenger once.
- Share room codes only with people who should watch.
- After an unsigned-update warning: save recordings, don't reopen that copy,
  get a clean one.
