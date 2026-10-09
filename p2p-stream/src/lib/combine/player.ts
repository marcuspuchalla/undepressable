/**
 * Playing a combined timeline (lib/combine/timeline.ts) through one video
 * element, switching copies where the timeline says — and rendering it into
 * a single video, by drawing it onto a canvas and recording that.
 */

import type { Timeline, Segment } from './timeline'
import { clock } from './timeline'

export interface PlayerEvents {
  /** Common time, as playback moves. */
  onPosition?(ms: number): void
  onSegment?(segment: Segment): void
  onEnd?(): void
}

export interface PlayerOptions extends PlayerEvents {
  /** How long to hold on a gap before moving on (Infinity: its full length, for rendering). */
  gapHoldMs?: number
}

/** One video element, several copies: plays the timeline through. */
export class TimelinePlayer {
  private urls = new Map<string, string>()
  private seg: Segment | null = null
  private gapTimer: number | undefined
  private gapStartedAt = 0
  private stopped = false
  position = 0
  playing = false

  constructor(
    readonly timeline: Timeline,
    private sources: Map<string, Blob>,
    readonly el: HTMLVideoElement,
    private opts: PlayerOptions = {},
  ) {
    el.addEventListener('timeupdate', this.onTime)
    el.addEventListener('ended', this.onEnded)
  }

  private urlFor(id: string): string {
    let u = this.urls.get(id)
    if (!u) {
      u = URL.createObjectURL(this.sources.get(id)!)
      this.urls.set(id, u)
    }
    return u
  }

  private onTime = () => {
    const s = this.seg
    if (!s || !s.copy || this.stopped) return
    this.position = s.from + (this.el.currentTime * 1000 - s.at)
    this.opts.onPosition?.(this.position)
    if (this.position >= s.to - 40) this.advance()
  }
  private onEnded = () => {
    if (this.seg?.copy) this.advance()
  }

  private advance() {
    const s = this.seg
    if (!s) return
    const next = this.timeline.segments[this.timeline.segments.indexOf(s) + 1]
    if (next) this.start(next, next.from)
    else this.finish()
  }

  private finish() {
    this.playing = false
    this.seg = null
    this.el.pause()
    this.position = this.timeline.endMs
    this.opts.onPosition?.(this.position)
    this.opts.onEnd?.()
  }

  private async start(seg: Segment, at: number) {
    clearTimeout(this.gapTimer)
    this.seg = seg
    this.position = at
    this.opts.onSegment?.(seg)
    if (!seg.copy) {
      this.el.pause()
      this.gapStartedAt = performance.now()
      const hold = Math.min(seg.to - at, this.opts.gapHoldMs ?? 1500)
      const tick = () => {
        if (this.stopped || this.seg !== seg) return
        const elapsed = performance.now() - this.gapStartedAt
        this.position = Math.min(seg.to, at + elapsed)
        this.opts.onPosition?.(this.position)
        if (elapsed >= hold) this.advance()
        else this.gapTimer = window.setTimeout(tick, 100)
      }
      tick()
      return
    }
    const url = this.urlFor(seg.copy)
    if (this.el.src !== url) {
      this.el.src = url
      await new Promise<void>((resolve) => {
        if (this.el.readyState >= 1) return resolve()
        this.el.addEventListener('loadedmetadata', () => resolve(), { once: true })
      })
      if (this.stopped || this.seg !== seg) return
    }
    this.el.currentTime = (seg.at + (at - seg.from)) / 1000
    try {
      await this.el.play()
    } catch {
      /* autoplay refused: the caller's gesture will start it */
    }
  }

  /** The segment (and copy) playing now. */
  get segment(): Segment | null {
    return this.seg
  }

  play(fromMs = this.position): void {
    this.stopped = false
    this.playing = true
    const ms = Math.max(this.timeline.startMs, Math.min(fromMs, this.timeline.endMs - 1))
    const seg = this.timeline.segments.find((s) => s.from <= ms && ms < s.to) ?? this.timeline.segments[0]
    void this.start(seg, ms)
  }

  pause(): void {
    this.playing = false
    clearTimeout(this.gapTimer)
    this.el.pause()
  }

  seek(ms: number): void {
    if (this.playing) this.play(ms)
    else {
      this.position = ms
      this.opts.onPosition?.(ms)
    }
  }

  destroy(): void {
    this.stopped = true
    this.playing = false
    clearTimeout(this.gapTimer)
    this.el.removeEventListener('timeupdate', this.onTime)
    this.el.removeEventListener('ended', this.onEnded)
    this.el.pause()
    this.el.removeAttribute('src')
    this.el.load()
    for (const u of this.urls.values()) URL.revokeObjectURL(u)
    this.urls.clear()
  }
}

export interface RenderOptions {
  fps?: number
  onProgress?(doneMs: number, totalMs: number): void
  signal?: AbortSignal
}

/** The picture size of a copy (its first frame's). */
function probeSize(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    const url = URL.createObjectURL(blob)
    const done = (width: number, height: number) => {
      URL.revokeObjectURL(url)
      v.removeAttribute('src')
      resolve({ width: width || 1280, height: height || 720 })
    }
    v.onloadedmetadata = () => done(v.videoWidth, v.videoHeight)
    v.onerror = () => done(0, 0)
    v.src = url
  })
}

/**
 * Draw the timeline onto a canvas, in real time, and hand the canvas's stream
 * (with the copies' sound) to `record`. Gaps are drawn at their full length,
 * so the rendered video's clock stays the common clock: it can still be
 * checked against the filmer's attestations.
 */
export async function renderTimeline<T>(
  timeline: Timeline,
  sources: Map<string, Blob>,
  record: (stream: MediaStream) => Promise<() => Promise<T>>,
  opts: RenderOptions = {},
): Promise<T> {
  // The canvas takes the first copy's picture size, and every copy is drawn
  // to fill it: a letterboxed picture would no longer match the filmer's
  // fingerprints (which squeeze the whole frame, whatever its shape).
  const first = timeline.segments.find((s) => s.copy)?.copy
  const { width, height } = first ? await probeSize(sources.get(first)!) : { width: 1280, height: 720 }
  const fps = opts.fps ?? 25
  const video = document.createElement('video')
  video.playsInline = true
  video.setAttribute('aria-hidden', 'true')
  video.style.cssText = 'position:fixed;left:-10px;top:-10px;width:2px;height:2px;opacity:0;pointer-events:none'
  document.body.appendChild(video)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  // The copies' sound goes into the recording, not to the speakers.
  const audio = new AudioContext()
  const dest = audio.createMediaStreamDestination()
  audio.createMediaElementSource(video).connect(dest)
  await audio.resume().catch(() => {})
  const stream = new MediaStream([...canvas.captureStream(fps).getVideoTracks(), ...dest.stream.getAudioTracks()])

  let current: Segment | null = null
  let raf = 0
  const draw = () => {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, height)
    if (current?.copy && video.readyState >= 2 && video.videoWidth) {
      ctx.drawImage(video, 0, 0, width, height)
    } else if (current && !current.copy) {
      ctx.fillStyle = '#9ca3af'
      ctx.font = `${Math.round(height / 18)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText('No copy covers this stretch', width / 2, height / 2 - height / 40)
      ctx.font = `${Math.round(height / 26)}px sans-serif`
      ctx.fillText(`${clock(current.from - timeline.startMs)} – ${clock(current.to - timeline.startMs)}`, width / 2, height / 2 + height / 18)
    }
    raf = requestAnimationFrame(draw)
  }
  draw()

  let onEnd = () => {}
  const ended = new Promise<void>((resolve) => (onEnd = resolve))
  const player = new TimelinePlayer(timeline, sources, video, {
    gapHoldMs: Infinity,
    onSegment: (s) => (current = s),
    onPosition: (ms) => opts.onProgress?.(ms - timeline.startMs, timeline.endMs - timeline.startMs),
    onEnd: () => onEnd(),
  })
  const abort = new Promise<never>((_, reject) => opts.signal?.addEventListener('abort', () => reject(new Error('cancelled'))))
  try {
    const stop = await record(stream)
    player.play(timeline.startMs)
    await Promise.race([ended, abort])
    return await stop()
  } finally {
    cancelAnimationFrame(raf)
    player.destroy()
    video.remove()
    stream.getTracks().forEach((t) => t.stop())
    audio.close().catch(() => {})
  }
}
