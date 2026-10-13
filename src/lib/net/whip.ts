/**
 * WHIP (RFC 9725): push a live stream to a broadcast server over plain HTTPS.
 *
 * Peer-to-peer reaches the people who have the app and the room code. A WHIP
 * ingest — a self-hosted MediaMTX, Owncast, Cloudflare Stream and others —
 * turns one incoming stream into HLS/RTMP/WebRTC for anyone with a browser or
 * a video player, at any scale. Any device can do the pushing: the phone
 * filming, or a viewer somewhere the server is reachable ("amplify").
 *
 * The exchange is one HTTP request: POST the SDP offer (with every candidate,
 * no trickle), receive the SDP answer and a resource URL; DELETE that URL to
 * stop. Nothing here is specific to one server product.
 */

export interface WhipTarget {
  /** The server's WHIP endpoint, e.g. https://live.example.org/mystream/whip */
  url: string
  /** Bearer token, if the endpoint requires one. */
  token?: string
}

export type WhipState = 'connecting' | 'live' | 'reconnecting' | 'failed' | 'stopped'

export class WhipError extends Error {
  constructor(
    message: string,
    readonly kind: 'unreachable' | 'rejected' | 'refused' | 'bad-answer',
    readonly status?: number,
  ) {
    super(message)
  }
}

const STORAGE_KEY = 'undepressable_whip'

export function getWhipTarget(storage: Pick<Storage, 'getItem'> | null = safeStorage()): WhipTarget | null {
  try {
    const t = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null')
    return t && typeof t.url === 'string' && isValidWhipUrl(t.url) ? { url: t.url, ...(t.token ? { token: String(t.token) } : {}) } : null
  } catch {
    return null
  }
}

export function setWhipTarget(target: WhipTarget | null, storage: Pick<Storage, 'setItem' | 'removeItem'> | null = safeStorage()) {
  try {
    if (!target) storage?.removeItem(STORAGE_KEY)
    else storage?.setItem(STORAGE_KEY, JSON.stringify(target))
  } catch {
    /* storage blocked: the target lasts for this session */
  }
}

export function isValidWhipUrl(url: string): boolean {
  try {
    const u = new URL(url)
    // Plain http only for local test servers: a token would travel in clear text.
    return u.protocol === 'https:' || (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname))
  } catch {
    return false
  }
}

/** Broadcast servers usually repackage without transcoding: H.264 plays everywhere. */
export function preferH264(transceiver: RTCRtpTransceiver) {
  const caps =
    (typeof RTCRtpReceiver !== 'undefined' ? RTCRtpReceiver.getCapabilities?.('video') : null) ??
    (typeof RTCRtpSender !== 'undefined' ? RTCRtpSender.getCapabilities?.('video') : null)
  if (!caps || typeof transceiver.setCodecPreferences !== 'function') return
  const h264 = caps.codecs.filter((c) => /h264/i.test(c.mimeType))
  if (!h264.length) return
  const rest = caps.codecs.filter((c) => !/h264/i.test(c.mimeType))
  try {
    transceiver.setCodecPreferences([...h264, ...rest])
  } catch {
    /* keep the browser's order */
  }
}

function waitForGathering(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      pc.removeEventListener('icegatheringstatechange', check)
      resolve()
    }
    const check = () => pc.iceGatheringState === 'complete' && done()
    const timer = setTimeout(done, timeoutMs)
    pc.addEventListener('icegatheringstatechange', check)
  })
}

export interface WhipSession {
  pc: RTCPeerConnection
  /** Resource URL to DELETE when stopping (null if the server gave none). */
  resource: string | null
  /** Send a different stream (e.g. after the source reconnected) without renegotiating. */
  replaceStream(stream: MediaStream): Promise<void>
  stop(): Promise<void>
}

/** Publish `stream` to a WHIP endpoint. Resolves once the server has answered. */
export async function publishWhip(
  stream: MediaStream,
  target: WhipTarget,
  opts: { rtcConfig?: RTCConfiguration; gatherTimeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<WhipSession> {
  const doFetch = opts.fetchImpl ?? fetch
  const pc = new RTCPeerConnection({ ...(opts.rtcConfig ?? {}), bundlePolicy: 'max-bundle' })
  const senders: RTCRtpSender[] = []
  for (const track of stream.getTracks()) {
    const t = pc.addTransceiver(track, { direction: 'sendonly', streams: [stream] })
    if (track.kind === 'video') preferH264(t)
    senders.push(t.sender)
  }
  try {
    await pc.setLocalDescription(await pc.createOffer())
    await waitForGathering(pc, opts.gatherTimeoutMs ?? 3000)
    const headers: Record<string, string> = { 'Content-Type': 'application/sdp' }
    if (target.token) headers.Authorization = `Bearer ${target.token}`
    let res: Response
    try {
      res = await doFetch(target.url, { method: 'POST', headers, body: pc.localDescription?.sdp ?? '', credentials: 'omit' })
    } catch {
      throw new WhipError('Could not reach the broadcast server (blocked, offline, or it does not allow requests from this app).', 'unreachable')
    }
    if (res.status === 401 || res.status === 403) throw new WhipError('The broadcast server rejected the token.', 'rejected', res.status)
    if (res.status !== 201 && res.status !== 200) {
      throw new WhipError(`The broadcast server refused the stream (HTTP ${res.status}).`, 'refused', res.status)
    }
    const answer = await res.text()
    if (!/^v=0/m.test(answer)) throw new WhipError('The broadcast server sent something that is not a session answer.', 'bad-answer', res.status)
    const location = res.headers.get('Location')
    const resource = location ? new URL(location, target.url).href : null
    await pc.setRemoteDescription({ type: 'answer', sdp: answer })
    return {
      pc,
      resource,
      async replaceStream(next) {
        for (const sender of senders) {
          const track = next.getTracks().find((t) => t.kind === sender.track?.kind)
          if (track) await sender.replaceTrack(track).catch(() => {})
        }
      },
      async stop() {
        pc.close()
        if (!resource) return
        const h: Record<string, string> = {}
        if (target.token) h.Authorization = `Bearer ${target.token}`
        await doFetch(resource, { method: 'DELETE', headers: h, credentials: 'omit' }).catch(() => {})
      },
    }
  } catch (err) {
    pc.close()
    throw err
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}
