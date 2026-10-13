/**
 * One record out of several copies.
 *
 * Every viewer records on its own, so when one phone drops out, the others'
 * copies have their gaps at different moments. Laid on one clock — the
 * filmer's, when the copies carry its attestations — they cover more of the
 * stream than any single copy, and no single seizure takes the record away.
 *
 * Pure: the clock alignment comes from elsewhere (lib/combine/align.ts), and
 * playback and rendering are the view's concern.
 */

export type Alignment =
  /** The copy's pictures matched against the filmer's attestations (lib/corroborate). */
  | 'picture'
  /** When the filmer's attestations arrived during recording (less exact: network delay). */
  | 'signals'
  /** The devices' own clocks (seconds apart at worst). */
  | 'clock'

export interface Copy {
  id: string
  /** Media length of the copy, ms. */
  durationMs: number
  /** Common time of the copy's first frame, ms. */
  startMs: number
  alignment: Alignment
}

export interface Segment {
  /** Common time, ms. */
  from: number
  to: number
  /** The copy playing here, or null for a gap no copy covers. */
  copy: string | null
  /** Media time in that copy at `from`, ms. */
  at: number
}

export interface Timeline {
  segments: Segment[]
  /** Common time of the first and last covered moment. */
  startMs: number
  endMs: number
  coveredMs: number
  gapMs: number
  /** The weakest alignment among the copies used — what the whole timeline is worth. */
  alignment: Alignment
}

const RANK: Record<Alignment, number> = { picture: 0, signals: 1, clock: 2 }
export const weakest = (a: Alignment, b: Alignment) => (RANK[a] >= RANK[b] ? a : b)

/**
 * Cover the common timeline with the fewest switches: wherever a copy ends,
 * continue with the best-aligned copy that reaches furthest.
 */
export function buildTimeline(copies: Copy[]): Timeline | null {
  const list = copies.filter((c) => c.durationMs > 0).sort((a, b) => a.startMs - b.startMs)
  if (!list.length) return null
  const end = (c: Copy) => c.startMs + c.durationMs
  const segments: Segment[] = []
  let t = list[0].startMs
  for (;;) {
    const covering = list.filter((c) => c.startMs <= t && end(c) > t)
    if (!covering.length) {
      const next = list.find((c) => c.startMs > t)
      if (!next) break
      segments.push({ from: t, to: next.startMs, copy: null, at: 0 })
      t = next.startMs
      continue
    }
    const c = covering.sort((a, b) => RANK[a.alignment] - RANK[b.alignment] || end(b) - end(a))[0]
    segments.push({ from: t, to: end(c), copy: c.id, at: t - c.startMs })
    t = end(c)
  }
  const covered = segments.filter((s) => s.copy).reduce((n, s) => n + (s.to - s.from), 0)
  const gaps = segments.filter((s) => !s.copy).reduce((n, s) => n + (s.to - s.from), 0)
  const used = new Set(segments.map((s) => s.copy))
  const alignment = list.filter((c) => used.has(c.id)).map((c) => c.alignment).reduce(weakest, 'picture')
  return { segments, startMs: segments[0].from, endMs: segments[segments.length - 1].to, coveredMs: covered, gapMs: gaps, alignment }
}

/** "0:04" */
export const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(Math.max(0, ms) / 1000) % 60).padStart(2, '0')}`

/** The segment playing at a common time, if any. */
export function segmentAt(timeline: Timeline, ms: number): Segment | null {
  return timeline.segments.find((s) => s.from <= ms && ms < s.to) ?? null
}
