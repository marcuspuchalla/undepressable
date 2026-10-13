# Relay tree design (D3) — peer-assisted forwarding for crowds

_Status: design accepted 2026-07-18 (DECISIONS.md D3); implementation phased below._

## Problem

One streamer → N watchers costs N uplink copies. Even with the 1.2 Mbps cap,
a phone uplink saturates at ~2–3 watchers. Crowds are the point of the app.

## Shape of the solution

```
            ┌──▶ Seed 1 ──▶ Leaf ──▶ (depth 2, later)
Streamer ───┤        └────▶ Leaf
 (root)     └──▶ Seed 2 ──▶ Leaf
                     └────▶ Leaf
```

- Root uploads a **fixed ~2 copies** regardless of crowd size.
- Seeds re-broadcast what they receive; leaves only download.
- Depth 1 in v1 (root→seed→leaf). Depth 2 raises capacity ~4× more but adds
  another hop of latency and fragility — deferred until depth 1 is proven.

**Feasibility is already proven in this codebase**: archive mode receives a
remote `MediaStream` and re-broadcasts it into another room
(`CollectView.startForwarding`). Receiving and forwarding simultaneously is
normal WebRTC — a remote track can be fed into other RTCPeerConnections. Two
physical facts to design around:

1. **Each hop re-encodes.** The forwarder's browser decodes and re-encodes the
   video (~100–500 ms added latency + generational quality loss per hop).
   Acceptable at depth 1–2; this is why depth is capped, and why recordings by
   leaves are recordings *of what the leaf received* (see Trust).
2. **A seed's uplink carries `children × 1.2 Mbps`** — significant on metered
   cellular. **Decided (2026-07-18): hybrid** — watchers are relay-capable by
   default (zero-friction crowds) with a visible "Help relay" opt-out toggle
   on the Collect screen; opting out while seeding re-seats the children.

## Mechanism: same room, directed media

No sub-rooms (archive-style) — everyone stays in the ONE existing room, because
Trystero's `addStream(stream, targetPeerId)` already supports directed sends
and the existing media-ownership map (`streamRouting.ts`) already answers "who
carries media to this peer" per transport. The tree only changes *who* calls
`sendStreamTo` for whom:

- Today: root claims media ownership of every peer.
- Tree: root sends to seeds; each seed calls the same `sendStreamTo` path
  (with the same sender bitrate caps) toward its assigned children.

A new Trystero action `"tree"` carries coordination messages (tiny JSON, any
transport):

| msg | from → to | meaning |
|---|---|---|
| `{t:'hello', relay:bool}` | joiner → root | capability announcement (relay opt-in) |
| `{t:'assign', parent}` | root → peer | your video comes from `parent`; seeds also get `{children:[…]}` |
| `{t:'orphan'}` | peer → root | my parent's stream died; re-seat me |
| `{t:'status', children:n}` | seed → root | load report (piggybacks the 4 s heartbeat) |

## Coordination: the root is the coordinator — no consensus protocol

Blockchain-style leader election is unnecessary here, and that's a feature:

- The root (streamer) is **definitionally** the source of truth: if the root is
  gone, there is no stream to route — the "leader" can never need replacing
  while the system has a purpose. Seed failure is the only failure that needs
  healing, and a single live coordinator handles that with plain messages.
- What consensus would buy — agreement despite a *partitioned or dead* leader —
  buys nothing when the leader IS the payload source.

Degraded-coordinator case (root's data channel unreachable but media still
flowing): peers keep the last topology. Orphans that can't reach the root fall
back to **direct-connect** (below), which needs no coordination.

## Healing (the part Marcus specified)

Failure detection reuses what's already built and live-verified: per-track
death detection (`watchStreamHealth` — `ended`/`mute`) and Trystero's
peer-leave + re-announce loop.

1. **Seed dies** → each of its leaves detects track death → sends `orphan` to
   root → root re-seats them: surviving seed with capacity first, else root
   takes them directly, else promotes a relay-capable orphan to seed and seats
   the rest under it.
2. **Root data-channel unreachable for >8 s while orphaned** → leaf requests
   the stream directly from the root via the media path (the existing
   ownership map handles a direct `sendStreamTo` claim). The tree degrades
   toward a star exactly as gracefully as the star works today.
3. **Seed overload** (status reports children > cap) → root re-seats the
   excess on the next assignment round.
4. **Everyone at once** (the "first seed, then second" cascade): orphan storms
   converge because re-seating is idempotent and root-serialized — the root
   processes orphan messages one at a time against its single topology map; a
   watcher that was mid-re-seat when its new parent also died just orphans
   again. Recording on every leaf rolls segments across the gap (already
   built + verified), so healing costs a gap, never footage.

Watchdog note: the collector's existing no-stream watchdog (12 s → auto-retry)
stays as the outermost safety net under the tree logic.

## Trust & integrity (honest limits)

- A seed **can alter frames in transit**. Leaf recordings prove what the leaf
  received, not what the camera saw. Cross-checking multiple independent
  recordings (root-connected vs seed-connected) detects tampering after the
  fact. True provenance (streamer-signed frame hashes broadcast on a data
  channel) is possible later — explicitly out of scope for v1.
- A malicious seed can also *withhold* (targets orphan → heal path covers it).
- Seeds learn nothing they don't already have: they're watchers with the
  stream and everyone's IPs are already mutually visible in-room.

## Capacity math (v1 defaults)

| Param | v1 value | Effect |
|---|---|---|
| Root fan-out | 2 seeds (+ direct leaves until seeds exist) | 2.4 Mbps root uplink |
| Seed cap | 4 children | ≈4.8 Mbps seed uplink (Wi-Fi territory) |
| Depth | 1 | capacity ≈ 2 + 2×4 = 10 watchers per phone stream |
| Tree activation | when a seed exists AND root fan-out would exceed 2 | small rooms unchanged |

## Implementation phases

- **P1** — protocol + topology map as a pure, unit-tested module
  (`lib/swarm/tree.ts`: assignment, orphan re-seating, promotion — pure state
  machine, same style as `streamRouting.ts`), relay opt-in toggle on the
  Collect screen, root assignment loop, orphan healing, E2 multi-tab
  kill-the-seed verification.
- **P2** — smarter seed choice (passively observed uplink/RTT stats), seed
  auto-demotion on battery/thermal signals where exposed.
- **P3** — depth 2, capacity ~40+; only if field testing demands it.

## Test plan hooks

- Pure: assignment determinism, cap enforcement, orphan storms (random kill
  sequences never lose a peer or create cycles), promotion correctness.
- E2 (multi-tab, synthetic stream): build tree with 1 root + 1 seed + 2
  leaves; kill seed's PC → leaves re-seat; kill root's data channel only →
  leaves direct-connect; verify single-copy accounting throughout.
- Field: seed on Wi-Fi, leaves on cellular; measure leaf latency vs direct.
