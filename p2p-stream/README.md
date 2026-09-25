# Undepressable

**Live truth that can't be erased.**

Censorship-resistant, peer-to-peer live streaming for human-rights documentation
and citizen journalism. A streamer goes live from their phone; trusted people
scan a QR code to watch and keep their own signed copy. Even if the streamer's
phone is seized, the footage already lives on other devices — there is nothing
to delete in one place.

> Built for public-interest documentation. Designed to reduce censorship and data
> loss, not to incite harm. Know your local laws and prioritise safety.

## What it does

- **Go live with no central server.** Signaling rides Trystero over the
  BitTorrent DHT and Nostr relays; media flows directly between peers over
  WebRTC (DTLS/SRTP encrypted). There is no media server to block or subpoena.
- **Join by QR or code.** A short room code and QR are generated ahead of time;
  collectors scan or type it. Late joiners still receive the live stream.
- **Everyone keeps a copy.** The streamer and every collector record locally in
  1-second chunks to the Origin Private File System (OPFS).
- **Live watching / recording counts.** Every peer broadcasts a tiny stat over a
  data channel, so all peers see how many are watching and how many are
  recording — in real time.
- **Tamper-evident recordings.** Each recording's chunks are SHA-256 hashed into
  a Merkle tree; the root is signed with an anonymous Ed25519 key. Anyone can
  later verify the footage is unaltered.
- **Works offline / installable.** A PWA that runs from cache with no network;
  two phones on one hotspot can connect with no internet at all.
- **Cross-network.** A TURN relay (shared via a `?turn=` link, or self-hosted)
  lets peers connect across strict/carrier NAT, not just the same network. See
  [docs/SELF_HOSTING.md](./docs/SELF_HOSTING.md).

## Architecture

```
Streamer ──WebRTC──▶ Collector A  (watches + records)
    │                Collector B  (watches + records)
    │                Collector C  (watches + records)
    └── signaling: Trystero (BitTorrent DHT + Nostr) — no server
        counts:    Trystero data-channel "stat" action
        media:     RTCPeerConnection, STUN + TURN for NAT traversal
```

Key modules:

| Path | Responsibility |
|------|----------------|
| `src/composables/useTrystero.ts` | Room lifecycle, media, and the swarm-stat channel |
| `src/lib/swarm/stats.ts` | Pure reducer for watching/recording counts |
| `src/composables/useRecording.ts` | MediaRecorder → OPFS + integrity proof |
| `src/lib/integrity/` | SHA-256 + Merkle + Ed25519 tamper-evidence (framework-agnostic) |
| `src/composables/useQRScanner.ts` | Native BarcodeDetector with a jsQR fallback |
| `src/views/{Stream,Collect,Recordings}View.vue` | The three screens |

Stack: Vue 3 + TypeScript + Vite + Pinia + Tailwind, Trystero for P2P, optional
Tauri desktop shell.

## Quick start

```bash
npm install
npm run dev -- --host      # open the printed LAN URL on your phone
```

- **Go live:** open **Stream**, allow the camera, share the code/QR.
- **Watch & keep a copy:** open **Collect**, scan the QR or type the code.
- **Verify later:** open **Recordings** → **Verify integrity**.

```bash
npm run build          # production PWA build
npm run test:unit      # 251 unit tests (integrity, counts, routing, ICE/NAT, diagnosis)
npm run tauri:build    # optional native desktop app
```

See [TESTING.md](./TESTING.md) for the test map and the two-peer / two-phone
verification procedure.

## Configuration

**Can't connect across networks?** Open **Network** in the app (tap the
*Online* pill). It checks what kind of network this device is on, and lets you
add and test a relay. Two devices that are both behind strict NAT — a VPN on
one side and a mobile carrier on the other is the classic case — cannot
connect directly at all; the Stream/Collect status card says when that is what
is happening. See [docs/RELIABILITY_AUDIT_3.md](./docs/RELIABILITY_AUDIT_3.md).

There is deliberately **no default TURN relay** — the free public one this app
once bundled died and was silently slowing every connection (see
[docs/RELIABILITY_AUDIT.md](./docs/RELIABILITY_AUDIT.md) §1). When both peers
sit behind strict NAT, supply a relay one of three ways (highest precedence
first — full guide in [docs/SELF_HOSTING.md](./docs/SELF_HOSTING.md)):

1. On the device: the **Network** page (server + credentials, or a provider's
   credentials link). The stream's share link then carries it automatically.
2. Share link param, persisted on the device:
   `/collect/CODE?turn=turns%3Ayour-relay%3A443|user|pass` or `?ice=<https credentials link>`
3. Build-time env vars:

   ```
   VITE_TURN_URL=turns:your-relay:443
   VITE_TURN_USERNAME=user
   VITE_TURN_CREDENTIAL=pass
   # or short-lived credentials from an HTTPS endpoint:
   VITE_ICE_SERVERS_URL=https://…
   # where share links should point (needed when running from localhost/app shells):
   VITE_PUBLIC_URL=https://app.example.org
   ```

Prefer `turns:` on port 443 — it survives networks that block UDP/plain TURN.

## Notes & honest limitations

- **Privacy-first fonts.** The UI does **not** load web fonts from a CDN (that
  would leak every viewer's IP and break offline); it uses a system font stack.
  Self-hosted Fraunces/Archivo woff2 can be dropped into `tailwind.config.js`.
- **TURN is a relay.** A direct P2P path is preferred; TURN only relays
  (still end-to-end encrypted) when strict NAT blocks a direct connection. It is
  the one optional "central" component and can be self-hosted.
- **Not yet built** (see `../PROJECT_PLAN.md`): hierarchical relay for very large
  swarms, at-rest encryption of recordings, and cross-collector aggregation.

## Provenance

This is the consolidation of several prototype attempts; see
[docs/DECISIONS.md](./docs/DECISIONS.md) for why this base was chosen and what
was ported in.
