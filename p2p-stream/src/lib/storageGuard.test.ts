import { describe, it, expect } from "vitest";
import { assessStorage, LOW_BYTES, CRITICAL_BYTES } from "./storageGuard";

const GB = 1024 * 1024 * 1024;

describe("assessStorage", () => {
  it("reports ok with plenty of headroom", () => {
    const a = assessStorage(1 * GB, 10 * GB);
    expect(a.level).toBe("ok");
    expect(a.remainingBytes).toBe(9 * GB);
    expect(a.minutesLeft).toBeGreaterThan(60);
  });

  it("reports low under the low watermark", () => {
    const a = assessStorage(10 * GB - LOW_BYTES + 1, 10 * GB);
    expect(a.level).toBe("low");
  });

  it("reports critical under the critical watermark", () => {
    const a = assessStorage(10 * GB - CRITICAL_BYTES + 1, 10 * GB);
    expect(a.level).toBe("critical");
  });

  it("never returns negative remaining bytes", () => {
    const a = assessStorage(11 * GB, 10 * GB);
    expect(a.remainingBytes).toBe(0);
    expect(a.level).toBe("critical");
  });

  it("is unknown without a quota", () => {
    expect(assessStorage(undefined, undefined).level).toBe("unknown");
    expect(assessStorage(5, 0).level).toBe("unknown");
  });

  it("scales minutes to the bitrate", () => {
    const a = assessStorage(0, GB, 8_000_000); // 1 MB/s
    expect(a.minutesLeft).toBe(Math.floor(GB / 1_000_000 / 60));
  });
});
