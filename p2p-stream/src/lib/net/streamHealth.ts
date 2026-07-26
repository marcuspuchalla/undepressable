// Is the picture actually still arriving?
//
// The collector used to decide this purely from track `ended`/`mute` events.
// Those fire when a track is torn down cleanly, but a congested or silently
// broken path — the normal failure on a jammed mobile network — leaves the
// track `live` and unmuted while no bytes arrive at all. The watcher sees a
// frozen frame, believes it is still recording the scene, and records nothing.
//
// So judge health by whether the bytes actually move, not by what the track
// claims. Kept pure and free of WebRTC types so the thresholds are testable.

export interface MediaSample {
  /** Cumulative inbound bytes for the video track. */
  bytesReceived: number;
  /** Cumulative decoded frames — moves even if bytes plateau on a still scene. */
  framesDecoded: number;
  /** Sample time (ms). */
  at: number;
}

export type MediaHealth =
  /** Connected, but the first frame has not landed yet. */
  | "starting"
  /** Bytes/frames are moving. */
  | "flowing"
  /** Nothing has arrived for longer than the stall window. */
  | "stalled";

/**
 * Default stall window. Long enough to ride out ordinary congestion and
 * keyframe gaps on a bad mobile link, short enough that a watcher is not
 * staring at a frozen frame believing it is live.
 */
export const DEFAULT_STALL_MS = 8000;

/**
 * Watch successive samples and report whether media is genuinely flowing.
 *
 * `starting` is reported (rather than `stalled`) until the first byte arrives,
 * so a connection still negotiating is never mistaken for a dead one.
 */
export function createStallMonitor(stallMs: number = DEFAULT_STALL_MS) {
  // High-water marks, so a track swap that restarts counters low is not
  // mistaken for a stall (nor its later catch-up for progress).
  let lastBytes = 0;
  let lastFrames = 0;
  // `null` until the first observation. A plain 0 would be ambiguous with a
  // legitimate t=0 sample and would let the stall clock re-anchor forever.
  let lastProgressAt: number | null = null;
  let seenAnyMedia = false;

  function reset(): void {
    lastBytes = 0;
    lastFrames = 0;
    lastProgressAt = null;
    seenAnyMedia = false;
  }

  function observe(sample: MediaSample): MediaHealth {
    const progressed = sample.bytesReceived > lastBytes || sample.framesDecoded > lastFrames;

    if (progressed) {
      lastBytes = Math.max(lastBytes, sample.bytesReceived);
      lastFrames = Math.max(lastFrames, sample.framesDecoded);
      lastProgressAt = sample.at;
      // Counters only move once real media lands; a connection that negotiated
      // but delivered nothing reports 0/0 and stays "starting".
      if (sample.bytesReceived > 0) seenAnyMedia = true;
    }

    // Anchor once, so a connection that never delivers anything still times out.
    if (lastProgressAt === null) lastProgressAt = sample.at;

    const idleMs = sample.at - lastProgressAt;
    if (idleMs > stallMs) return "stalled";
    return seenAnyMedia ? "flowing" : "starting";
  }

  return { observe, reset };
}
