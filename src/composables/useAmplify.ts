import { ref, shallowRef, watch, onUnmounted, type Ref } from 'vue'
import { publishWhip, getWhipTarget, setWhipTarget, isValidWhipUrl, WhipError, type WhipSession, type WhipState } from '../lib/net/whip'
import { resolveRtcConfig } from '../lib/net/iceConfig'

const RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 30000]

/**
 * Push the stream this device has — its camera, or the picture it is
 * watching — to a WHIP broadcast server, and keep it there: reconnect when
 * the connection drops, follow the source when it is replaced.
 */
export function useAmplify(source: Ref<MediaStream | null>) {
  const saved = getWhipTarget()
  const url = ref(saved?.url ?? '')
  const token = ref(saved?.token ?? '')
  const state = ref<WhipState>('stopped')
  const error = ref<string | null>(null)
  const liveSince = ref<number | null>(null)
  const session = shallowRef<WhipSession | null>(null)
  let wanted = false
  let attempt = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  async function connect() {
    const stream = source.value
    if (!wanted || !stream) return
    state.value = attempt === 0 ? 'connecting' : 'reconnecting'
    try {
      // The device's STUN/relay settings apply: "always use the relay" also
      // hides this device's address from the broadcast server.
      const s = await publishWhip(stream, { url: url.value.trim(), ...(token.value ? { token: token.value } : {}) }, { rtcConfig: await resolveRtcConfig() })
      if (!wanted) return void s.stop()
      session.value = s
      s.pc.addEventListener('connectionstatechange', () => {
        if (session.value !== s) return
        if (s.pc.connectionState === 'connected') {
          state.value = 'live'
          error.value = null
          liveSince.value ??= Date.now()
          attempt = 0
        } else if (s.pc.connectionState === 'failed') {
          void s.stop()
          session.value = null
          scheduleRetry('The connection to the broadcast server dropped.')
        }
      })
    } catch (e) {
      const err = e as WhipError
      // A wrong token or a refusal will not fix itself; everything else may.
      if (err?.kind === 'rejected' || err?.kind === 'bad-answer') {
        wanted = false
        state.value = 'failed'
        error.value = err.message
        return
      }
      scheduleRetry(err?.message ?? String(e))
    }
  }

  function scheduleRetry(reason: string) {
    error.value = reason
    if (!wanted) return
    if (attempt >= RETRY_DELAYS_MS.length) {
      wanted = false
      state.value = 'failed'
      return
    }
    state.value = 'reconnecting'
    retryTimer = setTimeout(() => void connect(), RETRY_DELAYS_MS[attempt++])
  }

  async function start(): Promise<boolean> {
    error.value = null
    if (!isValidWhipUrl(url.value.trim())) {
      error.value = 'Enter the server\'s WHIP address — it starts with https://'
      return false
    }
    setWhipTarget({ url: url.value.trim(), ...(token.value ? { token: token.value } : {}) })
    wanted = true
    attempt = 0
    liveSince.value = null
    await connect()
    return true
  }

  async function stop() {
    wanted = false
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
    const s = session.value
    session.value = null
    state.value = 'stopped'
    liveSince.value = null
    await s?.stop()
  }

  // A reconnected source brings a new stream: carry on with it.
  watch(source, (next) => {
    if (next && session.value) void session.value.replaceStream(next)
    else if (next && wanted && !session.value) void connect()
  })

  onUnmounted(() => void stop())

  return { url, token, state, error, liveSince, start, stop }
}

export type Amplify = ReturnType<typeof useAmplify>
