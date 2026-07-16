# Testing

For the full scenario-by-scenario field test plan (all five use cases, per
platform, with pass criteria), see [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md).
This file covers the automated unit tests and the low-level 2-peer transport
check they build on.

## Unit tests (`npm run test:unit`)

Fast, deterministic vitest suites covering the pure logic — no network, no DOM.

| Area | File | What it proves |
|------|------|----------------|
| Swarm counts | `src/lib/swarm/stats.test.ts` | `computeCounts` folds peers into watching/recording totals; `pruneStale` drops silent peers; `isValidStat` rejects hostile wire input |
| Room codes | `src/utils/roomId.test.ts` | 6-char code generation, prefix round-trip, format validation |
| Integrity — hashing | `src/lib/integrity/hashing.test.ts` | SHA-256 known vectors, hex round-trip |
| Integrity — Merkle | `src/lib/integrity/merkle.test.ts` | Deterministic root, odd-leaf handling, proof verification, tamper detection |
| Integrity — identity | `src/lib/integrity/identity.test.ts` | Ed25519 sign/verify, wrong-key rejection |
| Integrity — proof | `src/lib/integrity/recordingProof.test.ts` | `buildProof → verifyProof` happy path + tamper paths |

```bash
npm run test:unit          # watch mode
npm run test:coverage      # one-shot with coverage
```

49 tests as of this writing.

## Manual 2-peer end-to-end

The transport (WebRTC over Trystero's BitTorrent-DHT + Nostr signaling) needs a
live network and two real peers, so it is verified manually rather than in CI —
an automated harness would depend on public DHT/relay availability and be flaky.

The counts protocol has been verified live between two browser tabs by importing
the real `useTrystero` composable in each and driving it:

```js
// Tab A (streamer)
const { useTrystero } = await import('/src/composables/useTrystero.ts')
const t = useTrystero(); window.__t = t
await t.init(['nostr'])
await t.createRoom('e2e-room-1', ['nostr'])
t.counts.value            // { streaming:1, watching:0, recording:0, total:1 }

// Tab B (collector)
const { useTrystero } = await import('/src/composables/useTrystero.ts')
const t = useTrystero(); window.__t = t
await t.init(['nostr'])
await t.joinRoom('e2e-room-1', ['nostr'])

// After ~1–3s the peers discover each other:
//   both tabs → { streaming:1, watching:1, total:2 }
// Tab B: t.setRecording(true)  → both tabs → recording:1  (propagates in ~1s)
// Tab B: t.setRecording(false) → both tabs → recording:0
// Tab B: t.leaveRoom()         → Tab A → total:1, watching:0
```

Observed results (2026-07): join → `watching 0→1`; record → `recording 0→1`
propagated to the streamer in ~1s; stop → `0`; leave → `total 2→1`. All correct.

### Full field test on two phones

1. `npm run dev -- --host`, open the printed LAN URL on phone A.
2. Phone A → **Go live**, allow camera; note the room code / show the QR.
3. Phone B → **Scan & collect**, scan the QR (or type the code).
4. Expect: B shows A's video and auto-records; both show
   `👁 watching · ⏺ recording` counts; A sees B appear.
5. Stop B's recording, open **Recordings**, tap **Verify integrity** → *Unaltered*.
6. Cross-network: put the phones on different networks (e.g. B on cellular).
   With the bundled TURN relay it should still connect; if a strict network
   blocks it, B shows "Couldn't reach the stream yet".
