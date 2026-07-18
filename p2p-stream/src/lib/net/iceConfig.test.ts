import { describe, it, expect } from "vitest";
import {
  STUN_SERVERS,
  parseTurnSpec,
  isValidTurnConfig,
  getRuntimeTurn,
  setRuntimeTurn,
  adoptTurnFromUrl,
  buildIceServers,
} from "./iceConfig";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    dump: () => map,
  };
}

describe("parseTurnSpec", () => {
  it("parses a single turns: url with credentials", () => {
    expect(parseTurnSpec("turns:relay.example.org:443|alice|s3cret")).toEqual({
      urls: ["turns:relay.example.org:443"],
      username: "alice",
      credential: "s3cret",
    });
  });

  it("parses multiple comma-separated urls", () => {
    const c = parseTurnSpec("turn:r.example:3478,turns:r.example:443|u|p");
    expect(c?.urls).toEqual(["turn:r.example:3478", "turns:r.example:443"]);
  });

  it("rejects non-turn urls and malformed specs", () => {
    expect(parseTurnSpec("stun:stun.example|u|p")).toBeNull();
    expect(parseTurnSpec("https://evil.example|u|p")).toBeNull();
    expect(parseTurnSpec("turns:r.example:443|useronly")).toBeNull();
    expect(parseTurnSpec("")).toBeNull();
  });
});

describe("isValidTurnConfig", () => {
  it("accepts a well-formed config", () => {
    expect(isValidTurnConfig({ urls: ["turn:r:3478"], username: "", credential: "" })).toBe(true);
  });

  it("rejects empty urls, wrong schemes, and missing fields", () => {
    expect(isValidTurnConfig({ urls: [], username: "", credential: "" })).toBe(false);
    expect(isValidTurnConfig({ urls: ["wss://x"], username: "", credential: "" })).toBe(false);
    expect(isValidTurnConfig({ urls: ["turn:r"] })).toBe(false);
    expect(isValidTurnConfig(null)).toBe(false);
    expect(isValidTurnConfig("turn:r|u|p")).toBe(false);
  });
});

describe("runtime TURN storage", () => {
  it("round-trips a config and clears it", () => {
    const storage = memoryStorage();
    const config = { urls: ["turns:r:443"], username: "u", credential: "p" };
    expect(setRuntimeTurn(config, storage)).toBe(true);
    expect(getRuntimeTurn(storage)).toEqual(config);
    expect(setRuntimeTurn(null, storage)).toBe(true);
    expect(getRuntimeTurn(storage)).toBeNull();
  });

  it("ignores corrupt or invalid stored values", () => {
    const storage = memoryStorage();
    storage.setItem("undepressable_turn", "not json {");
    expect(getRuntimeTurn(storage)).toBeNull();
    storage.setItem("undepressable_turn", JSON.stringify({ urls: ["https://x"], username: "", credential: "" }));
    expect(getRuntimeTurn(storage)).toBeNull();
  });

  it("refuses to persist an invalid config", () => {
    const storage = memoryStorage();
    expect(setRuntimeTurn({ urls: [], username: "", credential: "" } as any, storage)).toBe(false);
    expect(getRuntimeTurn(storage)).toBeNull();
  });
});

describe("adoptTurnFromUrl", () => {
  it("persists a valid ?turn= param", () => {
    const storage = memoryStorage();
    const adopted = adoptTurnFromUrl("?turn=" + encodeURIComponent("turns:r:443|u|p"), storage);
    expect(adopted?.urls).toEqual(["turns:r:443"]);
    expect(getRuntimeTurn(storage)?.urls).toEqual(["turns:r:443"]);
  });

  it("ignores absent or malformed params without touching storage", () => {
    const storage = memoryStorage();
    expect(adoptTurnFromUrl("?foo=bar", storage)).toBeNull();
    expect(adoptTurnFromUrl("?turn=garbage", storage)).toBeNull();
    expect(getRuntimeTurn(storage)).toBeNull();
  });
});

describe("buildIceServers", () => {
  it("is STUN-only when no TURN is configured (no dead relay defaults)", () => {
    const servers = buildIceServers({}, null);
    expect(servers).toEqual(STUN_SERVERS);
    // The rotted Open Relay TURN must never come back as a silent default.
    expect(JSON.stringify(servers)).not.toContain("openrelay");
  });

  it("uses build-env TURN when set", () => {
    const servers = buildIceServers(
      { VITE_TURN_URL: "turn:a:3478, turns:a:443", VITE_TURN_USERNAME: "u", VITE_TURN_CREDENTIAL: "p" },
      null,
    );
    expect(servers[servers.length - 1]).toEqual({
      urls: ["turn:a:3478", "turns:a:443"],
      username: "u",
      credential: "p",
    });
  });

  it("prefers runtime TURN over build-env TURN", () => {
    const runtime = { urls: ["turns:runtime:443"], username: "ru", credential: "rp" };
    const servers = buildIceServers({ VITE_TURN_URL: "turn:env:3478" }, runtime);
    expect(servers[servers.length - 1]).toEqual({ urls: ["turns:runtime:443"], username: "ru", credential: "rp" });
    expect(JSON.stringify(servers)).not.toContain("turn:env");
  });
});
