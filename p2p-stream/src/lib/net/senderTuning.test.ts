import { describe, it, expect, vi } from "vitest";
import {
  capEncodings,
  capVideoSenders,
  DEFAULT_VIDEO_MAX_BPS,
  type SenderLike,
} from "./senderTuning";

function fakeSender(kind: string | null, encodings?: any[]): SenderLike & { applied: any[] } {
  const state = { encodings };
  const applied: any[] = [];
  return {
    applied,
    track: kind ? { kind } : null,
    getParameters: () => ({ encodings: state.encodings }),
    setParameters: async (p: any) => {
      applied.push(p);
      state.encodings = p.encodings;
    },
  };
}

describe("capEncodings", () => {
  it("fabricates a single capped encoding when none exist", () => {
    expect(capEncodings(undefined, 1000)).toEqual([{ maxBitrate: 1000 }]);
    expect(capEncodings([], 1000)).toEqual([{ maxBitrate: 1000 }]);
  });

  it("caps every encoding and preserves other fields", () => {
    const out = capEncodings([{ active: true }, { rid: "b", maxBitrate: 5_000_000 }], 1_200_000);
    expect(out).toEqual([
      { active: true, maxBitrate: 1_200_000 },
      { rid: "b", maxBitrate: 1_200_000 },
    ]);
  });

  it("keeps an existing cap that is already lower", () => {
    expect(capEncodings([{ maxBitrate: 300_000 }], 1_200_000)).toEqual([{ maxBitrate: 300_000 }]);
  });
});

describe("capVideoSenders", () => {
  it("tunes only negotiated video senders", async () => {
    const video = fakeSender("video", [{}]);
    const audio = fakeSender("audio", [{}]);
    const trackless = fakeSender(null, [{}]);
    const unnegotiated = fakeSender("video", []);
    const pc = { getSenders: () => [video, audio, trackless, unnegotiated] };

    const tuned = await capVideoSenders(pc);
    expect(tuned).toBe(1);
    expect(video.applied[0].encodings).toEqual([{ maxBitrate: DEFAULT_VIDEO_MAX_BPS }]);
    expect(audio.applied).toHaveLength(0);
    expect(unnegotiated.applied).toHaveLength(0);
  });

  it("survives a sender whose setParameters rejects", async () => {
    const bad: SenderLike = {
      track: { kind: "video" },
      getParameters: () => ({ encodings: [{}] }),
      setParameters: vi.fn().mockRejectedValue(new Error("InvalidStateError")),
    };
    const good = fakeSender("video", [{}]);
    const tuned = await capVideoSenders({ getSenders: () => [bad, good] });
    expect(tuned).toBe(1);
  });
});
