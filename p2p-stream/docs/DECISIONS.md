# Architecture Decision Record — Undepressable consolidation

_Date: 2026-07. Status: accepted._

## Context

"Undepressable" existed as **four parallel prototypes**, each built by a
different model against the same brief (P2P censorship-resistant streaming with
QR join, community recording, and live watching/recording counts). None was
under real version control.

| Variant | Signaling | QR join | Recording | Notes |
|---------|-----------|---------|-----------|-------|
| **undepressable-kimi** | Trystero (BitTorrent DHT + Nostr) — serverless | ✅ generate + scan + deep link | ✅ OPFS, 1s chunks | Most complete; best plans |
| undepressable-codex | Nostr (3rd-party relays) | ❌ none (typed code) | ✅ OPFS | 813-line monolith, broken button, mocked auth |
| undepressable (React) | **PeerJS public cloud broker** | ❌ none | ✅ IndexedDB | Best integrity (Merkle) but centralized signaling |
| undepressable-page | — | — | — | Landing page + brand system + whitepaper (`info.md`) |

## Decision

**Build on `undepressable-kimi`.** It was the only variant that already had both
QR-based joining *and* genuinely serverless signaling (Trystero), which are the
two hardest and most load-bearing requirements. Its `PROJECT_PLAN.md` was also
the clearest statement of intent.

Rather than rewrite, we **git-initialised the kimi tree in place** (committing
the as-found state as a baseline first, since nothing was under version control)
and improved on top.

## What was ported in from the other variants

- **Integrity / tamper-evidence** — the idea came from the React variant's
  Merkle tree, re-implemented cleanly as a framework-agnostic module
  (`src/lib/integrity/`) using **Ed25519** (simpler than the original
  secp256k1/schnorr) with 33 unit tests.
- **Brand + copy** — the `undepressable-page` design system (ink/glow/moss/ember
  palette, glass panels, "Live truth that can't be erased") and its whitepaper
  voice (`info.md`) were applied to the app UI.
- **Resilience patterns** (from a sibling "camCut" baby-monitor project built the
  same week): native `BarcodeDetector` with jsQR fallback for reliable iPhone
  scanning, TURN relays for cross-network reach, and honest "couldn't reach"
  reachability feedback.

## What was fixed / removed

- **Late-joiner streaming bug**: the streamer used `joinRoom` + a one-shot
  `updateStream` that only reached already-present peers; switched to
  `createRoom(role=streamer)` so `onPeerJoin` forwards the stream to every
  newcomer.
- **Recorder count never existed** in any variant. Added a Trystero
  data-channel `stat` broadcast + a pure `computeCounts` reducer so watching and
  recording counts are live and swarm-wide.
- Removed dead code: `useCamera.ts`, a shadow `types/index.ts`, the `simple-peer`
  dep, the duplicate MediaRecorder lifecycle in `stores/recording.ts`, and a
  no-op `data:`-URL `sendBeacon`.
- Corrected stale docs (`QUICKSTART.md`, `IMPLEMENTATION_PLAN.md`) that still
  described a deleted WebSocket signaling server.

## Consequences

- The other three variant directories are left untouched as reference; this is
  now the canonical tree.
- The one remaining "central" dependency is the optional TURN relay (encrypted
  relay only, self-hostable) — an accepted trade-off for cross-network reach,
  consistent with the whitepaper's "hybrid relay" deployment mode.
- P2P transport is not automated in CI (it needs live DHT/relay networks); it is
  covered by unit tests on the pure logic plus a documented manual E2E.
