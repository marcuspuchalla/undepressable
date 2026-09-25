import { describe, it, expect } from "vitest";
import {
  classifyOrigin,
  normalizePublicUrl,
  resolveShareBase,
  buildCollectUrl,
  extractRoomCode,
  getConfiguredPublicUrl,
  setConfiguredPublicUrl,
  buildPairHomeUrl,
  extractHomeKey,
} from "./shareLink";

describe("classifyOrigin", () => {
  it("app shells and localhost are device-only", () => {
    for (const o of ["tauri://localhost", "http://tauri.localhost", "capacitor://localhost", "https://localhost", "http://127.0.0.1:4400", "file:///x"]) {
      expect(classifyOrigin(o)).toBe("device");
    }
  });

  it("private addresses and local names are LAN-only", () => {
    for (const o of ["http://192.168.1.5:4400", "http://10.8.0.2", "http://100.72.1.1", "http://mac.local:4400", "http://[fd00::1]:4400", "http://devbox"]) {
      expect(classifyOrigin(o)).toBe("lan");
    }
  });

  it("real domains and public IPs are public", () => {
    for (const o of ["https://undepressable.example", "https://203.0.113.9", "https://abc.trycloudflare.com"]) {
      expect(classifyOrigin(o)).toBe("public");
    }
  });

  it("garbage is treated as device-only", () => {
    expect(classifyOrigin("not a url")).toBe("device");
  });
});

describe("normalizePublicUrl", () => {
  it("adds https and strips trailing slashes, keeping a sub-path", () => {
    expect(normalizePublicUrl("example.org")).toBe("https://example.org");
    expect(normalizePublicUrl(" https://example.org/app/ ")).toBe("https://example.org/app");
    expect(normalizePublicUrl("http://192.168.1.5:4400/")).toBe("http://192.168.1.5:4400");
  });

  it("rejects non-web schemes and empties", () => {
    expect(normalizePublicUrl("")).toBeNull();
    expect(normalizePublicUrl("javascript://alert(1)")).toBeNull();
    expect(normalizePublicUrl("tauri://localhost")).toBeNull();
  });
});

describe("resolveShareBase", () => {
  it("prefers the address configured on the device, then the build's", () => {
    expect(resolveShareBase({ origin: "tauri://localhost", configured: "app.example", envPublicUrl: "https://env.example" })).toEqual({
      base: "https://app.example",
      reachability: "public",
      source: "configured",
      secure: true,
    });
    expect(resolveShareBase({ origin: "tauri://localhost", envPublicUrl: "https://env.example" }).source).toBe("build");
  });

  it("uses a public origin as-is", () => {
    expect(resolveShareBase({ origin: "https://app.example" })).toEqual({
      base: "https://app.example",
      reachability: "public",
      source: "origin",
      secure: true,
    });
  });

  it("rewrites a localhost dev server to its LAN address", () => {
    expect(resolveShareBase({ origin: "http://localhost:4400", lanIp: "192.168.1.5" })).toEqual({
      base: "http://192.168.1.5:4400",
      reachability: "lan",
      source: "lan-ip",
      secure: false, // the phone would get no camera and no WebCrypto
    });
  });

  it("never builds a LAN link for an app shell, and flags it device-only", () => {
    expect(resolveShareBase({ origin: "tauri://localhost", lanIp: "192.168.1.5" })).toEqual({
      base: "tauri://localhost",
      reachability: "device",
      source: "origin",
      secure: true,
    });
  });

  it("ignores a detected address that is not private (e.g. a leaked public one)", () => {
    expect(resolveShareBase({ origin: "http://localhost:4400", lanIp: "203.0.113.7" }).reachability).toBe("device");
  });
});

describe("buildCollectUrl / extractRoomCode", () => {
  it("builds a collect link with relay params and reads the code back", () => {
    const url = buildCollectUrl("https://app.example/", "A1B2C3", { turn: "turns:r:443|u|p" });
    expect(url).toBe("https://app.example/collect/A1B2C3?turn=turns%3Ar%3A443%7Cu%7Cp");
    expect(extractRoomCode(url)).toBe("A1B2C3");
  });

  it("reads codes from bare text and app-shell links, rejects anything else", () => {
    expect(extractRoomCode(" a1b2c3 ")).toBe("A1B2C3");
    expect(extractRoomCode("tauri://localhost/collect/ZZ99XX")).toBe("ZZ99XX");
    expect(extractRoomCode("https://x/collect/TOOLONG1")).toBeNull();
    expect(extractRoomCode("hello")).toBeNull();
    expect(extractRoomCode(undefined as any)).toBeNull();
  });
});

describe("configured public URL storage", () => {
  it("round-trips and clears", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
    expect(setConfiguredPublicUrl("app.example/", storage)).toBe(true);
    expect(getConfiguredPublicUrl(storage)).toBe("https://app.example");
    expect(setConfiguredPublicUrl("javascript://x", storage)).toBe(false);
    expect(setConfiguredPublicUrl("", storage)).toBe(true);
    expect(getConfiguredPublicUrl(storage)).toBeNull();
  });
});

describe("home-archive pairing links", () => {
  it("builds a pairing link carrying the relay, and reads the key back", () => {
    const url = buildPairHomeUrl("https://app.example", "ABCD2345", { turn: "turns:r:443|u|p" });
    expect(url).toBe("https://app.example/pair-home/ABCD2345?turn=turns%3Ar%3A443%7Cu%7Cp");
    expect(extractHomeKey(url)).toBe("ABCD2345");
    expect(extractHomeKey("tauri://localhost/pair-home/abcd2345")).toBe("ABCD2345");
  });

  it("does not mistake a room link for a pairing link", () => {
    expect(extractHomeKey("https://app.example/collect/A1B2C3")).toBeNull();
    expect(extractHomeKey("")).toBeNull();
  });
});
