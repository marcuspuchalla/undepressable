import { describe, it, expect } from "vitest";
import { createStallMonitor, DEFAULT_STALL_MS } from "./streamHealth";

describe("createStallMonitor", () => {
  it("reports flowing while bytes keep arriving", () => {
    const m = createStallMonitor(8000);
    expect(m.observe({ bytesReceived: 1000, framesDecoded: 10, at: 0 })).toBe("flowing");
    expect(m.observe({ bytesReceived: 5000, framesDecoded: 40, at: 2000 })).toBe("flowing");
    expect(m.observe({ bytesReceived: 9000, framesDecoded: 70, at: 4000 })).toBe("flowing");
  });

  it("declares a stall when counters freeze past the window", () => {
    const m = createStallMonitor(8000);
    m.observe({ bytesReceived: 1000, framesDecoded: 10, at: 0 });
    // Frozen: the track is still 'live' but nothing is arriving.
    expect(m.observe({ bytesReceived: 1000, framesDecoded: 10, at: 5000 })).toBe("flowing");
    expect(m.observe({ bytesReceived: 1000, framesDecoded: 10, at: 9000 })).toBe("stalled");
  });

  it("treats decoded frames as progress even when bytes plateau", () => {
    // A near-static scene can encode to almost nothing; frames still advance.
    const m = createStallMonitor(8000);
    m.observe({ bytesReceived: 1000, framesDecoded: 10, at: 0 });
    expect(m.observe({ bytesReceived: 1000, framesDecoded: 25, at: 9000 })).toBe("flowing");
  });

  it("recovers to flowing once media resumes", () => {
    const m = createStallMonitor(8000);
    m.observe({ bytesReceived: 1000, framesDecoded: 10, at: 0 });
    expect(m.observe({ bytesReceived: 1000, framesDecoded: 10, at: 9000 })).toBe("stalled");
    expect(m.observe({ bytesReceived: 2000, framesDecoded: 20, at: 10000 })).toBe("flowing");
  });

  it("says starting — not stalled — before the first byte lands", () => {
    const m = createStallMonitor(8000);
    expect(m.observe({ bytesReceived: 0, framesDecoded: 0, at: 0 })).toBe("starting");
    expect(m.observe({ bytesReceived: 0, framesDecoded: 0, at: 3000 })).toBe("starting");
  });

  it("eventually stalls a connection that never delivers anything", () => {
    const m = createStallMonitor(8000);
    m.observe({ bytesReceived: 0, framesDecoded: 0, at: 0 });
    expect(m.observe({ bytesReceived: 0, framesDecoded: 0, at: 9000 })).toBe("stalled");
  });

  it("does not trip on counters that reset lower after a track swap", () => {
    // A replaced track restarts counters; that must not read as 'no progress'
    // forever once the new track starts moving.
    const m = createStallMonitor(8000);
    m.observe({ bytesReceived: 50_000, framesDecoded: 500, at: 0 });
    m.observe({ bytesReceived: 100, framesDecoded: 2, at: 1000 });
    expect(m.observe({ bytesReceived: 50_001, framesDecoded: 501, at: 2000 })).toBe("flowing");
  });

  it("starts clean after reset", () => {
    const m = createStallMonitor(8000);
    m.observe({ bytesReceived: 1000, framesDecoded: 10, at: 0 });
    expect(m.observe({ bytesReceived: 1000, framesDecoded: 10, at: 9000 })).toBe("stalled");
    m.reset();
    expect(m.observe({ bytesReceived: 0, framesDecoded: 0, at: 20000 })).toBe("starting");
  });

  it("tells sound-only (video switched off on a slow link) from a dead stream", () => {
    const m = createStallMonitor(8000);
    expect(m.observe({ bytesReceived: 100, framesDecoded: 5, audioBytesReceived: 10, at: 0 })).toBe("flowing");
    // The picture stops; the sound keeps coming.
    for (let t = 2000; t <= 10000; t += 2000) m.observe({ bytesReceived: 100, framesDecoded: 5, audioBytesReceived: 10 + t, at: t });
    expect(m.observe({ bytesReceived: 100, framesDecoded: 5, audioBytesReceived: 20000, at: 12000 })).toBe("audio-only");
    // Then the sound stops too.
    expect(m.observe({ bytesReceived: 100, framesDecoded: 5, audioBytesReceived: 20000, at: 21000 })).toBe("stalled");
    // And the picture returns.
    expect(m.observe({ bytesReceived: 200, framesDecoded: 9, audioBytesReceived: 21000, at: 23000 })).toBe("flowing");
  });

  it("never calls a connection that only ever carried sound 'audio-only' before any video", () => {
    const m = createStallMonitor(8000);
    m.observe({ bytesReceived: 0, framesDecoded: 0, audioBytesReceived: 100, at: 0 });
    expect(m.observe({ bytesReceived: 0, framesDecoded: 0, audioBytesReceived: 5000, at: 9000 })).toBe("stalled");
  });

  it("ships a stall window tuned for bad mobile links, not instant hair-triggers", () => {
    expect(DEFAULT_STALL_MS).toBeGreaterThanOrEqual(5000);
    expect(DEFAULT_STALL_MS).toBeLessThanOrEqual(15000);
  });
});
