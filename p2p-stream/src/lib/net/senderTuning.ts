// Sender-side media tuning for weak uplinks.
//
// Without an explicit cap, WebRTC will happily try to push whatever the camera
// produces (2.5+ Mbps at 720p). On a congested phone uplink the queues grow,
// latency balloons and the stream stalls for every watcher. Capping the video
// bitrate keeps the encoder inside what a bad cellular uplink can actually
// sustain; WebRTC's built-in bandwidth estimation then adapts *below* the cap.

/** ~1.2 Mbps: 720p stays watchable, and a weak LTE/3G uplink can sustain it. */
export const DEFAULT_VIDEO_MAX_BPS = 1_200_000;

/** Minimal structural types so the logic is unit-testable without real WebRTC. */
export interface EncodingLike {
  maxBitrate?: number;
}
export interface SenderLike {
  track: { kind: string } | null;
  getParameters(): { encodings?: EncodingLike[] };
  setParameters(params: any): Promise<void>;
}
export interface PeerConnectionLike {
  getSenders(): SenderLike[];
}

/**
 * Return encodings with the bitrate cap applied. Preserves an existing lower
 * cap, fabricates a single encoding when none exist yet.
 */
export function capEncodings<T extends EncodingLike>(
  encodings: T[] | undefined,
  maxBitrate: number,
): EncodingLike[] {
  const list: EncodingLike[] = encodings && encodings.length > 0 ? encodings : [{}];
  return list.map((e) => ({
    ...e,
    maxBitrate: e.maxBitrate !== undefined && e.maxBitrate < maxBitrate ? e.maxBitrate : maxBitrate,
  }));
}

/**
 * Cap every video sender on a connection. Returns how many senders were tuned.
 * Encodings can be empty until negotiation completes, so callers should retry.
 */
export async function capVideoSenders(
  pc: PeerConnectionLike,
  maxBitrate: number = DEFAULT_VIDEO_MAX_BPS,
): Promise<number> {
  let tuned = 0;
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== "video") continue;
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) continue;
      params.encodings = capEncodings(params.encodings, maxBitrate);
      await sender.setParameters(params);
      tuned++;
    } catch {
      /* sender not negotiated yet or transceiver gone; caller retries */
    }
  }
  return tuned;
}

/**
 * Keep retrying until at least one video sender accepted the cap (encodings
 * only exist after negotiation). Fire-and-forget from the connection path.
 */
export function capVideoSendersWithRetry(
  pc: PeerConnectionLike,
  maxBitrate: number = DEFAULT_VIDEO_MAX_BPS,
  delaysMs: number[] = [0, 1000, 3000, 8000],
): void {
  const attempt = (i: number) => {
    if (i >= delaysMs.length) return;
    setTimeout(async () => {
      const tuned = await capVideoSenders(pc, maxBitrate).catch(() => 0);
      if (tuned === 0) attempt(i + 1);
    }, delaysMs[i]);
  };
  attempt(0);
}

/**
 * Hint encoders that this is live motion footage: under pressure, degrade
 * resolution before frame rate — a choppy protest video loses evidentiary
 * value faster than a soft one.
 */
export function markMotionContent(stream: MediaStream): void {
  for (const track of stream.getVideoTracks()) {
    try {
      (track as MediaStreamTrack & { contentHint?: string }).contentHint = "motion";
    } catch {
      /* older browsers: hint unsupported, harmless */
    }
  }
}
