import { describe, it, expect } from "vitest";
import { generateShortRoomId, getFullRoomId, getShortRoomId, isValidShortRoomId } from "./roomId";

describe("generateShortRoomId", () => {
  it("produces a valid 6-char alphanumeric code", () => {
    for (let i = 0; i < 50; i++) {
      const id = generateShortRoomId();
      expect(id).toHaveLength(6);
      expect(isValidShortRoomId(id)).toBe(true);
    }
  });
});

describe("getFullRoomId / getShortRoomId round-trip", () => {
  it("prefixes and upper-cases the short id", () => {
    expect(getFullRoomId("a1b2c3")).toBe("p2pstream-v1-A1B2C3");
  });

  it("strips the prefix back to the short id", () => {
    expect(getShortRoomId("p2pstream-v1-A1B2C3")).toBe("A1B2C3");
  });

  it("returns the input unchanged when there is no prefix", () => {
    expect(getShortRoomId("A1B2C3")).toBe("A1B2C3");
  });

  it("round-trips generated ids", () => {
    const id = generateShortRoomId();
    expect(getShortRoomId(getFullRoomId(id))).toBe(id);
  });
});

describe("isValidShortRoomId", () => {
  it("accepts exactly 6 alphanumerics (case-insensitive)", () => {
    expect(isValidShortRoomId("A1B2C3")).toBe(true);
    expect(isValidShortRoomId("a1b2c3")).toBe(true);
    expect(isValidShortRoomId("ZZZZZZ")).toBe(true);
    expect(isValidShortRoomId("000000")).toBe(true);
  });

  it("rejects wrong length or illegal characters", () => {
    expect(isValidShortRoomId("A1B2C")).toBe(false); // too short
    expect(isValidShortRoomId("A1B2C3D")).toBe(false); // too long
    expect(isValidShortRoomId("A1B2C-")).toBe(false); // symbol
    expect(isValidShortRoomId("A1 B2C")).toBe(false); // space
    expect(isValidShortRoomId("")).toBe(false);
  });
});
