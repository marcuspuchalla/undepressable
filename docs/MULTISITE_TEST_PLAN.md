# Multi-site test plan — real machines, real internet

The E2 harness (`scripts/e2e/scenarios.mjs`) proves the app's logic on one
machine with simulated NAT. This plan runs the same app across **five real
machines on four networks**, so discovery, NAT traversal, VPN paths and relays
are exercised over the actual internet. Results:
[`MULTISITE_RESULTS.md`](MULTISITE_RESULTS.md).

## Sites

| Key | Machine | Network | What it stands for |
|-----|---------|---------|--------------------|
| `mac` | This Mac, native Chromium | Home router NAT (`192.168.10.0/24`), NetBird VPN | A participant at home |
| `nas` | Synology DS1817+ (DSM 7.1, Atom CPU), container | A **different** home NAT (`192.168.1.0/24`), NetBird | The always-on home archive; a second home |
| `is` | `mailserver`, Iceland, container | Public IP, default-drop inbound firewall | A participant abroad |
| `log` | `logserver`, container | Public IP, default-drop inbound firewall; hosts the test TURN relay | A second foreign network |
| `fmp` | `fmp` (Coolify production host), container | Public IP, default-drop inbound firewall | A third foreign network |

Each server container can run in one of two network modes:

- **`nat`** (default): behind Docker's NAT, behind the host firewall. Realistic
  for a phone behind a carrier or home router, and the only mode where network
  profiles are allowed.
- **`host`**: shares the host's network, so it has the public IP and, on
  NetBird hosts, the `100.113.x.x` VPN address. Used for the VPN-path cases.

## Connection types covered

| Type | What ICE reports | Scenarios |
|------|------------------|-----------|
| Direct, NAT-mapped | `srflx`/`prflx` over UDP | `home-to-home`, `server-to-home`, `home-to-server`, `server-to-server` |
| Through the VPN mesh | `host` candidate on a `100.113.x.x` address | `vpn-home-to-home`, `vpn-server-to-server` |
| No direct path, no relay | No media; the app must say so | `blocked-no-relay` |
| Relayed, UDP | `relay/udp` | `relay-via-link`, `relay-one-side` |
| Relayed, TCP (UDP blocked) | `relay/…/tcp` | `relay-tcp-udp-blocked` |
| Relayed, TLS (only 443 + the relay's TLS port open) | `relay/…/tls` | `relay-tls-hostile` |
| Forced relay (hide your IP) | Every remote address is the relay | `force-relay-privacy` |
| Forwarded by another viewer (relay tree) | Video from a seed, not the streamer | `crowd`, `crowd-seed-dies` |
| Forwarded to a home archive | Video at the NAS via the phone | `home-archive` |

## Network profiles (applied inside a `nat` container only)

| Profile | Effect | Real-world analogue |
|---------|--------|---------------------|
| `open` | None | Whatever the site really is |
| `no-direct` | No UDP to the other participants' public IPs (STUN and the relay still work) | Two strict/symmetric NATs, e.g. VPN exit + carrier |
| `udp-blocked` | No UDP at all (+DNS) | Hotel, corporate or school firewalls; QUIC blocked |
| `hostile` | TCP only to port 443 and the relay's TLS port; no UDP | DPI-style censorship networks |
| `lossy` | 150±50 ms, 3 % loss, 2 Mbit/s | Congested event Wi-Fi |
| `bad-mobile` | 350±100 ms, 8 % loss, 600 kbit/s | One bar of 3G |

`lossy` and `bad-mobile` use `tc netem`, which shapes **outgoing** traffic only.
On a streamer that degrades the video path; on a viewer, only its uplink
(acknowledgements, feedback). Shaping a viewer's downlink would need an IFB
device on the host, which this harness deliberately doesn't touch.

## Scenarios by use case

| Use case | Scenario | Pass when |
|----------|----------|-----------|
| 01 One to one | `home-to-home` (mac→nas), `server-to-home` (is→mac), `home-to-server` (nas→fmp), `server-to-server` (log→is) | Viewer plays video |
| 01 over VPN | `vpn-home-to-home` (nas host-mode→mac), `vpn-server-to-server` (log→is, both host-mode) | Viewer plays video; path recorded |
| Hard networks | `blocked-no-relay` | No video **and** the viewer is told "your networks block a direct connection" |
| | `relay-via-link` | Video via `relay`; the viewer configured nothing (relay came in the share link) |
| | `relay-one-side` | Video, although only the streamer has a relay and doesn't share it |
| | `relay-tcp-udp-blocked` | Video via TURN over TCP |
| | `relay-tls-hostile`, `relay-tls-hostile-remote` (viewer on log / on fmp) | Video via TURN over TLS; discovery survives with only port 443 |
| Privacy | `force-relay-privacy` | The viewer only ever sees the relay's address |
| Bad links | `bad-mobile-viewer` (viewer uplink), `lossy-streamer-uplink` (the video path) | Video arrives; quality numbers recorded |
| 03 Internet drops | `internet-drops` | After all TCP (every discovery relay) is cut mid-stream, video keeps arriving |
| 02 One to many | `crowd` (mac streams to 6 viewers on 4 sites) | Everyone gets video; streamer uploads ≤ 2 copies; seeds serve the rest |
| | `crowd-seed-dies` | A seed is killed; every survivor gets fresh frames within a minute |
| 04 Home archive | `home-archive` (mac streams, phone in Iceland forwards, NAS records) | The NAS shows "Recording a forwarded stream" |

Each viewer reports time to first frame (measured from opening the link), the
selected ICE candidate pair (type/protocol/relay protocol, remote address,
RTT), and inbound video stats (resolution, fps, loss, freezes, jitter).

## Running it

```bash
npm run build                                   # the exact build under test
npm i --no-save playwright@1.65.1 && npx playwright install chromium   # for the Mac agent
# Build the agent image on each host (context: Dockerfile, agent.mjs, netprofile.sh, dist/):
#   tar -c … | ssh HOST "sudo docker build --network host -t undep-agent:$(git rev-parse --short HEAD) -"
openssl rand -hex 16 > /path/to/turn.secret
scripts/multisite/turn.sh up logserver 159.195.108.239 /path/to/turn.secret   # test relay
TURN_SECRET_FILE=/path/to/turn.secret node scripts/multisite/run.mjs [scenario …]
scripts/multisite/turn.sh down logserver                                      # always tear down
```

Files: `scripts/multisite/agent.mjs` (one participant), `netprofile.sh`
(network shaping, refuses to run in the host's namespace), `Dockerfile`,
`run.mjs` (orchestration over SSH; results as JSONL plus every agent's raw
reports), `turn.sh` (test relay up/down).

## Safety rules on production machines

- Containers are CPU- and memory-capped (mailserver: 1 CPU / 1.2 GB; fmp: 1 CPU
  / 1.5 GB) and removed after each scenario.
- Network profiles only ever run in a container's own namespace;
  `netprofile.sh` refuses when it sees `docker0`/`wt0` (the host's).
- Containers get public DNS (`--dns 1.1.1.1`): on `fmp` and the NAS the host's
  resolver is NetBird's, which containers can't reach.
- The test TURN relay (`logserver`, coturn, ports 3479/5349 + 49160–50159/udp)
  uses a random password and refuses to relay to private, loopback, link-local
  and NetBird (`100.64.0.0/10`) addresses. Its firewall rules are labelled
  `undep-test-turn`. `turn.sh down` removes the container, the rules and the
  certificate directory. It was taken down after the 2026-11-19 run.

## Not covered (yet), and why

- **Real phones on mobile data** (TEST_PLAN E3/E4): carrier CGNAT is stricter
  than anything here. `no-direct` simulates its effect on ICE, not its timing.
- **Mullvad (commercial VPN exit)**: the Mullvad daemon isn't running on the
  Mac; starting it is your call. Expected to behave like `no-direct`.
- **`mailstorage`**: SSH host-key verification failed (key changed). Not touched
  until the new key is confirmed.
- **Parents' network**: no access configured. If the NAS *is* there, it already
  plays this role.
- **TURN over TLS**: 443 is taken on every server (nginx, Traefik), so the
  relay's TLS listener is on 5349 with a self-signed certificate, which Chrome
  rejects. The `relay-tls-hostile*` scenarios therefore can't pass here; they
  need a relay with a CA-signed certificate for a hostname.
- **Camera**: Chrome's fake device (320×180 test pattern), not a real camera.
