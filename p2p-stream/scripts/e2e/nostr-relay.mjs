// Minimal in-memory Nostr relay for local E2E tests: EVENT / REQ / CLOSE with
// kinds + #x filters, which is all Trystero's nostr strategy uses.
import { WebSocketServer } from 'ws'
const port = Number(process.argv[2] || 7777)
const wss = new WebSocketServer({ port })
const subs = new Map() // ws -> Map(subId -> filter)
wss.on('connection', (ws) => {
  subs.set(ws, new Map())
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw) } catch { return }
    const [type, a, b] = msg
    if (type === 'REQ') subs.get(ws).set(a, b || {})
    else if (type === 'CLOSE') subs.get(ws).delete(a)
    else if (type === 'EVENT') {
      ws.send(JSON.stringify(['OK', a.id, true, '']))
      for (const [client, m] of subs) for (const [subId, f] of m) {
        if (f.kinds && !f.kinds.includes(a.kind)) continue
        if (f['#x'] && !a.tags.some(t => t[0] === 'x' && f['#x'].includes(t[1]))) continue
        if (client.readyState === 1) client.send(JSON.stringify(['EVENT', subId, a]))
      }
    }
  })
  ws.on('close', () => subs.delete(ws))
})
console.log('nostr relay on', port)
