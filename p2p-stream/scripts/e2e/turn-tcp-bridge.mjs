// A TCP and TLS front for the UDP-only test TURN server (turn-server.mjs):
// what `turn:…?transport=tcp` and `turns:…:443` talk to in the scenarios.
//
// TURN over a stream (RFC 5766 §11.5): STUN messages are self-delimiting
// (20-byte header, length at bytes 2–3); ChannelData messages (first two bits
// 01) carry their length at bytes 2–3 and are padded to four bytes on a
// stream — not in a datagram. Each connection gets a UDP socket of its own,
// so the TURN server sees one client per connection, as with real clients.
//
//   node scripts/e2e/turn-tcp-bridge.mjs <hostIp> <tlsPort> <tcpPort> <certDir>
//
// The TURN server must listen on 127.0.0.1: the bridge's UDP leg stays on
// loopback so a rule dropping every UDP packet the host sends leaves it alone.

import { createServer as tcpServer } from 'node:net'
import { createServer as tlsServer } from 'node:tls'
import { createSocket } from 'node:dgram'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const [hostIp = '127.0.0.1', tlsPort = '443', tcpPort = '8443', certDir = '/tmp/und-turn-cert'] = process.argv.slice(2)
const TURN = { host: '127.0.0.1', port: 3478 }
const log = process.env.DEBUG ? (...a) => console.log(...a) : () => {}

function ensureCert() {
  const key = join(certDir, 'key.pem')
  const cert = join(certDir, 'cert.pem')
  if (!existsSync(key) || !existsSync(cert)) {
    mkdirSync(certDir, { recursive: true })
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', `/CN=${hostIp}`, '-addext', `subjectAltName=IP:${hostIp}`], { stdio: 'ignore' })
  }
  return { key: readFileSync(key), cert: readFileSync(cert) }
}

/** Length of the message at the start of `buf` as framed on a stream, or 0 if incomplete. */
function framedLength(buf) {
  if (buf.length < 4) return 0
  const b0 = buf[0]
  const len = buf.readUInt16BE(2)
  if ((b0 & 0xc0) === 0x40) return 4 + len + ((4 - (len % 4)) % 4) // ChannelData, padded
  if ((b0 & 0xc0) === 0x00) return 20 + len // STUN
  return -1 // not TURN: drop the connection
}

function bridge(sock) {
  log('connection from', sock.remoteAddress, sock.remotePort, sock.encrypted ? 'tls' : 'tcp')
  sock.on('error', (e) => log('socket error', e.message))
  const udp = createSocket('udp4')
  udp.bind(0, '127.0.0.1')
  let pending = Buffer.alloc(0)
  sock.on('data', (chunk) => {
    pending = Buffer.concat([pending, chunk])
    for (;;) {
      const n = framedLength(pending)
      if (n < 0) return sock.destroy()
      if (n === 0 || pending.length < n) return
      const msg = pending.subarray(0, n)
      pending = pending.subarray(n)
      // Datagrams carry ChannelData unpadded.
      const out = (msg[0] & 0xc0) === 0x40 ? msg.subarray(0, 4 + msg.readUInt16BE(2)) : msg
      log('→ turn', out.length, 'type 0x' + out.readUInt16BE(0).toString(16))
      udp.send(out, TURN.port, TURN.host)
    }
  })
  udp.on('message', (msg) => {
    log('← turn', msg.length, 'type 0x' + msg.readUInt16BE(0).toString(16))
    if ((msg[0] & 0xc0) === 0x40) {
      const pad = (4 - (msg.length % 4)) % 4
      sock.write(pad ? Buffer.concat([msg, Buffer.alloc(pad)]) : msg)
    } else sock.write(msg)
  })
  const close = () => {
    try {
      udp.close()
    } catch {
      /* already closed */
    }
  }
  sock.on('close', close)
  sock.on('error', close)
}

const { key, cert } = ensureCert()
tlsServer({ key, cert }, bridge).listen(Number(tlsPort), hostIp)
tcpServer(bridge).listen(Number(tcpPort), hostIp)
console.log(`TURN over TLS on ${hostIp}:${tlsPort}, over TCP on ${hostIp}:${tcpPort} → UDP ${TURN.host}:${TURN.port}`)
