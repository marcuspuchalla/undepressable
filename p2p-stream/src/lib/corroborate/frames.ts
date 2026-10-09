/**
 * The browser half of corroboration: turning live camera frames and recorded
 * video into fingerprints (the maths is in fingerprint.ts).
 */

import { fingerprint, THUMB } from './fingerprint'
import { signAttestation, newStreamId, type Attestation } from './attest'
import type { Identity } from '../integrity/identity'
import { toHex } from '../integrity/hashing'
import type { FrameSample } from './match'

function thumbCanvas(): CanvasRenderingContext2D | null {
  const canvas = document.createElement('canvas')
  canvas.width = THUMB
  canvas.height = THUMB
  return canvas.getContext('2d', { willReadFrequently: true })
}

/** Fingerprint of the frame a video element shows right now (null before it has one). */
function grab(video: HTMLVideoElement, ctx: CanvasRenderingContext2D): string | null {
  if (video.readyState < 2 || !video.videoWidth) return null
  // The whole frame squeezed to 64×64: the aspect ratio does not matter, as
  // long as both ends do the same.
  ctx.drawImage(video, 0, 0, THUMB, THUMB)
  return fingerprint(ctx.getImageData(0, 0, THUMB, THUMB).data)
}

/** A video element that plays without being seen (some browsers only decode attached ones). */
function hiddenVideo(): HTMLVideoElement {
  const v = document.createElement('video')
  v.muted = true
  v.playsInline = true
  v.setAttribute('aria-hidden', 'true')
  v.style.cssText = 'position:fixed;left:-10px;top:-10px;width:2px;height:2px;opacity:0;pointer-events:none'
  document.body.appendChild(v)
  return v
}

/** Two signed moments a second: an edit between two has at most half a second to hide in. */
export const ATTEST_EVERY_MS = 500

export interface Attestor {
  /** The key attestations are signed with (hex): goes into the share link. */
  readonly publicKey: string
  readonly streamId: string
  /** Follow a replacement camera stream (same stream, same key, same clock). */
  setStream(stream: MediaStream): void
  stop(): void
}

/**
 * Twice a second, fingerprint what the camera shows and sign it. The key is
 * made for this stream alone and never stored: nothing links two streams of
 * the same phone, or a stream to the phone's own recordings.
 */
export function startAttestor(stream: MediaStream, key: Identity, emit: (a: Attestation) => void, everyMs = ATTEST_EVERY_MS): Attestor {
  const ctx = thumbCanvas()
  const video = hiddenVideo()
  const streamId = newStreamId()
  const started = performance.now()
  let n = 0
  const play = (s: MediaStream) => {
    video.srcObject = s
    video.play().catch(() => {})
  }
  play(stream)
  const timer = window.setInterval(() => {
    const f = ctx ? grab(video, ctx) : null
    if (!f) return
    try {
      emit(signAttestation({ s: streamId, n: n++, t: Math.round(performance.now() - started), f }, key))
    } catch (err) {
      console.warn('[attest] emit failed:', err)
    }
  }, everyMs)
  const publicKey = toHex(key.publicKey)
  return {
    publicKey,
    streamId,
    setStream: play,
    stop() {
      clearInterval(timer)
      video.srcObject = null
      video.remove()
    },
  }
}

export interface SampledVideo {
  frames: FrameSample[]
  durationMs: number
}

/**
 * Play a recording through, fast and unseen, fingerprinting a frame every
 * `stepMs` of video time. Recordings from MediaRecorder carry no index, so
 * seeking is unreliable; playing straight through always works.
 */
export function sampleRecording(
  video: Blob,
  opts: { stepMs?: number; rate?: number; onProgress?: (ms: number) => void; signal?: AbortSignal } = {},
): Promise<SampledVideo> {
  const stepMs = opts.stepMs ?? 200
  const ctx = thumbCanvas()
  const el = hiddenVideo()
  const url = URL.createObjectURL(video)
  const frames: FrameSample[] = []
  let last = -Infinity
  let maxMs = 0

  return new Promise<SampledVideo>((resolve, reject) => {
    let stall: number | undefined
    let done = false
    const finish = (err?: Error) => {
      if (done) return
      done = true
      clearTimeout(stall)
      el.pause()
      el.removeAttribute('src')
      el.load()
      el.remove()
      URL.revokeObjectURL(url)
      if (err) reject(err)
      else resolve({ frames, durationMs: maxMs })
    }
    // Ends when the video does — or when nothing moves for a while (a broken file).
    const armStall = () => {
      clearTimeout(stall)
      stall = window.setTimeout(() => finish(frames.length ? undefined : new Error('The video could not be played back here.')), 15_000)
    }
    const take = (ms: number) => {
      maxMs = Math.max(maxMs, ms)
      if (ms - last < stepMs || !ctx) return
      const f = grab(el, ctx)
      if (!f) return
      last = ms
      frames.push({ m: Math.round(ms), f })
      opts.onProgress?.(ms)
      armStall()
    }
    opts.signal?.addEventListener('abort', () => finish(new Error('cancelled')))
    el.onended = () => finish()
    el.onerror = () => finish(new Error('The video could not be played back here.'))

    const rvfc = (el as any).requestVideoFrameCallback?.bind(el) as
      | ((cb: (now: number, meta: { mediaTime: number }) => void) => number)
      | undefined
    if (rvfc) {
      const onFrame = (_now: number, meta: { mediaTime: number }) => {
        take(meta.mediaTime * 1000)
        if (!done) rvfc(onFrame)
      }
      rvfc(onFrame)
    } else {
      el.ontimeupdate = () => take(el.currentTime * 1000)
    }

    el.src = url
    el.defaultPlaybackRate = el.playbackRate = opts.rate ?? 8
    armStall()
    el.play().catch((e) => finish(e instanceof Error ? e : new Error(String(e))))
  })
}
