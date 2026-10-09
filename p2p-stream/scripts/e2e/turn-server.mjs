// Local TURN relay for the E2E scenarios (long-term credentials test/test).
// Relay ports sit below Linux's ephemeral range (32768+) so the firewall rule
// that simulates strict NAT can allow them without also allowing the
// browsers' own random host ports.
import Turn from 'node-turn'

const ip = process.argv[2] || '127.0.0.1'
const server = new Turn({
  listeningPort: 3478,
  // Also on loopback: the TCP/TLS bridge (turn-tcp-bridge.mjs) talks to it there.
  listeningIps: [ip, '127.0.0.1'],
  relayIps: [ip],
  externalIps: ip,
  minPort: 20000,
  maxPort: 24000,
  authMech: 'long-term',
  credentials: { test: 'test' },
  realm: 'undepressable.test',
  debugLevel: 'OFF',
})
server.start()
console.log(`TURN on ${ip}:3478 (relay ports 20000-24000)`)
