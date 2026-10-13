# Reliability & resilience brief — Undepressable (P2P live streaming)

Standing charter for making the app's peer-to-peer connectivity as **reliable
and convenient as possible on bad networks** — congested, high-latency, lossy,
NAT-restricted, throttled, censored, or hostile. Hand this to an agent to run a
reliability pass; it is self-contained.

## Status (2026-09-25)

**Round 3 is done** — cross-network connection establishment, triggered by a
VPN ↔ German-mobile field failure. See
[`RELIABILITY_AUDIT_3.md`](RELIABILITY_AUDIT_3.md): connection instrumentation
via Trystero's `rtcPolyfill` (fast gathering, rescue of pruned negotiations,
disconnect grace, leak cleanup), diagnostics that tell a NAT block from a
wrong code, in-app relay setup that travels in share links, public share
addresses, re-verified relay lists, and a committed E2E harness that
simulates strict NAT. Open items there supersede the list below where they
overlap; D1 (default relay) is now the only missing piece for zero-config
success in the VPN ↔ mobile case.

## Status (2026-07-24)

**Round 1 is done.** A full audit ran on 2026-07-18 — see
[`RELIABILITY_AUDIT.md`](RELIABILITY_AUDIT.md) for the 11 findings with
file:line evidence and live-repro results. Most Critical/High items are FIXED;
the watcher relay tree (the biggest crowd-scaling win) is partially implemented
(phase 1). **Read that report and the "already done" list below before doing
anything** — do not re-investigate settled items. The open agenda is in
"What's still open". This brief stays in the repo as the charter for the next
rounds and for re-verification as public infrastructure rots.

## Where the code is

- Project root: `/Users/tk/projects/undepressable-kimi/`
- **App (work here): `<repository root>/`**
- Git repo on branch `main`, remote `github.com/marcuspuchalla/undepressable` (private).

⚠️ **Your shell may start in a different project** (`/Users/tk/projects/camCut`).
Always `cd <repository root>` first, and use
absolute paths. A previous session wasted time debugging the wrong app.

## What the app is (and who it's for)

A censorship-resistant, serverless live-streaming tool for activists and
journalists. Someone streams from their phone at a scene; trusted people watch
and **each keeps their own signed copy**, so seizing one device or taking down
one server does not erase the evidence.

Design commitments you must not break:
- **No central server** for streaming or signaling. Discovery rides public
  infrastructure (BitTorrent DHT, Nostr, MQTT). Self-hosting must stay optional.
- **Tamper-evidence**: recordings are chunk-hashed → Merkle tree → Ed25519
  signed, and verifiable offline.
- **Works on hostile/locked-down networks** and offline (local hotspot).
- **FOSS and F-Droid-friendly** — no proprietary SDKs, no Google Play Services,
  no telemetry.
- Must run in mobile browsers (iOS Safari, Android Chrome), as an installed PWA,
  in a Capacitor WebView (Android/iOS), and in a Tauri desktop shell.

## Current architecture (verified — but re-verify anything you rely on)

- Vue 3 + TypeScript + Vite + Pinia + Tailwind.
- **Transport/signaling: Trystero**, wrapped in `src/composables/useTrystero.ts`.
  Three zero-config strategies run in parallel: `torrent` (BitTorrent DHT),
  `nostr`, `mqtt`. `"both"` resolves to all three.
- **WebRTC** media. ICE config is now a module: `src/lib/net/iceConfig.ts`
  (`getRtcConfig()`) — STUN diversity (Google + Cloudflare + Nextcloud), no dead
  default TURN, TURN configurable at runtime (`localStorage`, `?turn=` link
  param) and build time (`VITE_TURN_*`).
- **Media routing**: `src/lib/swarm/streamRouting.ts` — one media copy per
  watcher across all transports (owning connection carries video; handover on
  death). `src/lib/net/senderTuning.ts` — 1.2 Mbps sender cap + motion hint.
- **Relay tree** (crowd fan-out): `src/lib/swarm/tree.ts` (+ design in
  `docs/RELAY_TREE_DESIGN.md`) — phase-1 topology state machine, root
  assignment, seed forwarding, orphan healing.
- Pinned Nostr relays in `src/types.ts` (`NOSTR_RELAYS`).
- **Swarm counts**: `src/lib/swarm/stats.ts` (`computeCounts`, `pruneStale`,
  `isValidStat`, `canTrackStat` — bounded at 500 peers).
- **Recording**: `src/composables/useRecording.ts` — segment-per-interruption,
  each independently signed; `useOPFS.ts` storage; `src/lib/storageGuard.ts`
  quota headroom warnings; `src/composables/useWakeLock.ts` screen-lock survival.
- **Integrity**: `src/lib/integrity/`. **Home archive/relay**:
  `src/lib/archive.ts`, `ArchiveView.vue`, `PairHomeView.vue`.
- Views: `Home`, `Stream`, `Collect`, `Recordings`, `Guide`, `Archive`,
  `PairHome`.
- Docs: `RELIABILITY_AUDIT.md`, `RELAY_TREE_DESIGN.md`, `SELF_HOSTING.md`,
  `TEST_PLAN.md`, `FEASIBILITY.md`, `ON_DEVICE_TESTING.md`, `DECISIONS.md`,
  `ANDROID_FDROID.md`, `IOS_CAPACITOR.md`.

## Already found and fixed — do NOT redo

Full detail in `RELIABILITY_AUDIT.md`. Summary of what's already done:

- **Dead default TURN removed**, STUN diversified, TURN made runtime/link/build
  configurable (§1, `30a3a7d`). The dead TURN was also adding ~10 s to every
  connect via Trystero's ICE-gathering wait.
- **One media copy per watcher**, not one per transport (was up to 3×), with
  media handover on owner death (§2, `ce9e42e`).
- **Recording survives reconnect**; auto-stopped recordings are now finalized &
  signed; stop/start is re-entrant; segment-rolls on stream replacement (§3,
  `c6d3b8b`, `a478213`).
- **Screen-lock / backgrounding recovery**: wake lock + camera recovery (§4,
  `c6d3b8b`) — native build still needed for true background capture.
- **Uplink bitrate capped** at 1.2 Mbps + motion hint (§5, `2ec59b1`).
- **Relay-list rot pruned** (`offchain.pub` dropped) and documented as recurring
  (§6, `03365e0`).
- **Swarm-stat flooding bounded** at 500 peers (§8, `5a36073`).
- **Storage-exhaustion warnings** before footage stops persisting (§9,
  `5a36073`).
- **Earlier round** (pre-audit): pinned Nostr relays; MQTT transport; auto-retry;
  muted-autoplay + sound toggle; QR nextTick fix.
- **Relay tree phase 1**: pure topology state machine + tests, root assignment,
  seed forwarding, orphan healing, idempotent/retried tree sends
  (`8ce5961`, `b85c35a`, `17cfc6e`).

Take these as evidence of the *class* of bug that hides here: silent promise
rejections, ref/render ordering, per-transport duplication, and rotted public
infrastructure.

## What's still open (the live agenda)

From `RELIABILITY_AUDIT.md` — ranked by real-world impact, not ease:

1. **Complete the watcher relay tree (D3).** Phase 1 is topology + healing; the
   remaining work is the media plane (seed watchers actually re-forwarding to
   assigned children under real congestion), depth/'fan-out tuning, latency-per-hop
   measurement, and honest failure behavior when a relay watcher drops. This is
   the biggest remaining win for crowds on a phone uplink. Needs design sign-off
   on trust model (forwarders already hold the footage).
2. **Relay health monitoring (§6, OPEN).** Public relays decay in *weeks*
   (three incidents so far). Add a startup/periodic relay health check surfacing
   per-relay status in the debug modal (`getRelaySockets()` exists on every
   strategy), plus a documented re-verification cadence.
3. **On-device verification still owed.** Much was verified in two isolated
   browser tabs (E2). The real-network numbers — strict-NAT pairs, cellular↔Wi-Fi,
   TURN-over-`turns:443` under DPI, relay-tree under load, screen-lock recovery,
   full archive scenario — need genuinely separate devices/networks
   (TEST_PLAN E3/E4/E5). Do not report discovery-reliability claims that were
   only exercised on one machine.
4. **Connection-path latency (§10, OPEN, upstream-constrained).** Trystero strips
   trickle ICE, uses a 5.3 s announce cadence, and destroys peers on
   `disconnected` with no ICE-restart grace. Recovery is re-discovery (works,
   costs seconds). An upstream Trystero issue/PR (trickle ICE; a `leave()` that
   closes sockets; ICE restart) would benefit every Trystero app — scope it.
5. **Retry leaks relay sockets (§11, Low).** Each auto-retry re-runs strategy
   `init` and never closes old nostr sockets. Bounded by MAX_AUTO_RETRIES=2;
   an upstream `leave()` fix is the real answer.
6. **Product decisions (do not decide unilaterally — surface the trade-off):**
   - **D1 — a default relay for strict-NAT users.** Out of the box, strict-NAT ↔
     strict-NAT still cannot connect (physics). Ship-nothing vs. funded project
     TURN vs. rotated partner relays. Values-and-money call.
   - **D2 — invite keys / room passwords.** Trystero's `password` config encrypts
     signaling separately from the room id; an invite key would stop
     code-guessers/observers joining or decrypting — but changes the share UX and
     doesn't help against a betrayed invite. Worth doing before promoting for
     hostile use.
   - Room codes are capabilities; the app is censorship-*resistant*, not
     anonymous (relay operators and on-path observers see IPs + room metadata,
     §7). Any change here is a threat-model decision.

## Method & evidence standards

- **Read the code before asserting anything.** Do not conclude from `grep`
  alone. Mark each finding ✓ VERIFIED (read/ran) or ? INFERRED (needs checking),
  and resolve the INFERRED ones before reporting. The existing audit holds this
  bar — match it.
- Prefer measurement over intuition: instrument and time the connection path.
- For each finding give: what's wrong, the concrete failure scenario (inputs →
  bad outcome), file:line evidence, severity, and a proposed fix.

## How to test in this environment (learned the hard way)

```bash
cd <repository root>
npm run test:unit      # vitest (81+ tests)
npm run type-check     # vue-tsc --noEmit
npm run build          # typecheck + vite build
npm run dev            # dev server on :4400 (host + tunnel hosts allowed)
```

- **No camera in headless/automated Chrome.** `getUserMedia` yields nothing.
  Drive the transport with a synthetic canvas stream instead:
  ```js
  const { useTrystero } = await import('/src/composables/useTrystero.ts')
  const c = document.createElement('canvas'); c.width=320; c.height=240
  const ctx = c.getContext('2d'); let t=0
  setInterval(()=>{t++;ctx.fillStyle=`hsl(${t%360},70%,45%)`;ctx.fillRect(0,0,320,240)},100)
  const s = useTrystero(); await s.init(['both'])
  await s.createRoom('p2pstream-v1-TESTCODE', ['both'], c.captureStream(10))
  // then load /collect/TESTCODE in another tab; kill individual peer
  // connections via s to reproduce reconnect/handover.
  ```
- **Chrome caches ES modules per origin.** After editing, a localhost tab can
  execute stale modules and mislead you. Verify what the dev server actually
  serves (`curl http://localhost:4400/src/...`), and test from a *different*
  origin (a cloudflared tunnel) to get a clean module cache.
- The dev service worker is deliberately **off** (`devOptions.enabled: false` in
  `vite.config.ts`) because it repeatedly served stale code. Production builds
  still get the full PWA.
- Camera access on phones requires a **secure context** — use an HTTPS tunnel
  (`cloudflared tunnel --url http://localhost:4400`) or the native APK.
- **Single-machine tests hide relay/NAT failures.** Anything you claim about
  discovery or NAT traversal must be exercised across genuinely separate
  devices/networks, or clearly labelled as unverified.
- See `docs/ON_DEVICE_TESTING.md` and `docs/TEST_PLAN.md` for the scenario
  matrix; update them with what you verify.

## Constraints

- Don't regress what works: counts, integrity/verification, single-copy media
  routing, media handover, segment recording, archive-mode forwarding, QR flows,
  offline/hotspot use.
- No new required backend. Optional self-hosting is fine and encouraged.
- Keep it FOSS/F-Droid-clean. Match existing code style; comments about
  constraints, not narration.

## Deliverables

1. Update `docs/RELIABILITY_AUDIT.md` (or a dated round-2 successor) with new
   findings — severity, failure scenario, file:line, fix. Rank by real-world
   impact for a user on a degraded network.
2. Implemented fixes for the top items, in small reviewable commits each
   explaining *why*. Typecheck, unit tests, and build must pass.
3. Tests for anything testable without live network (backoff/retry, relay
   selection/health, adaptive-bitrate decisions, tree topology, stat validation,
   recovery state machines). Extend `TEST_PLAN.md` for what needs real devices.
4. An honest "known limits" update — what still fails, under what conditions,
   and what needs a server or native build. Do not overstate resilience;
   activists may rely on this.
5. For anything needing a product decision (D1/D2/D3 above, or new ones),
   **stop and surface the trade-off** rather than deciding unilaterally.

Start by reading `RELIABILITY_AUDIT.md`, then `useTrystero.ts`,
`lib/net/iceConfig.ts`, `lib/swarm/streamRouting.ts`, `lib/swarm/tree.ts`,
`lib/net/senderTuning.ts`, and `docs/TEST_PLAN.md` — and measure before you
change anything.
