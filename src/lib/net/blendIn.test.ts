import { describe, it, expect } from "vitest";
import { blendInConfig, blendInReadiness, blendInApplies, isBlendIn, setBlendIn, isOn443, isTlsRelayUrl } from "./blendIn";
import type { RelaySetup } from "./iceConfig";

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

const setup = (turnUrls: string[] | null, publicServers: RTCIceServer[] = []): RelaySetup => ({
  source: turnUrls ? "runtime" : "none",
  origin: turnUrls ? "settings" : null,
  turn: turnUrls ? { urls: turnUrls, username: "u", credential: "p" } : null,
  iceUrl: null,
  publicServers,
});

describe("blend in", () => {
  it("is a device setting, off by default", () => {
    const s = memStorage();
    expect(isBlendIn(s)).toBe(false);
    setBlendIn(true, s);
    expect(isBlendIn(s)).toBe(true);
    setBlendIn(false, s);
    expect(isBlendIn(s)).toBe(false);
  });

  it("recognises TLS relays, and whether they sit on 443", () => {
    expect(isTlsRelayUrl("turns:relay.example.org:443")).toBe(true);
    expect(isTlsRelayUrl("turn:relay.example.org:443?transport=tcp")).toBe(false);
    expect(isTlsRelayUrl("stun:stun.l.google.com:19302")).toBe(false);
    expect(isOn443("turns:relay.example.org:443")).toBe(true);
    expect(isOn443("turns:relay.example.org:443?transport=tcp")).toBe(true);
    expect(isOn443("turns:[2001:db8::1]:443")).toBe(true);
    expect(isOn443("turns:relay.example.org")).toBe(false); // 5349 by default
    expect(isOn443("turns:relay.example.org:5349")).toBe(false);
  });

  it("keeps only TLS relays and forbids everything but relay candidates", () => {
    const config: RTCConfiguration = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: ["turn:r.example.org:3478", "turns:r.example.org:443"], username: "u", credential: "p" },
        { urls: "turn:other.example.org:3478?transport=tcp", username: "u", credential: "p" },
      ],
      bundlePolicy: "max-bundle",
    };
    const out = blendInConfig(config);
    expect(out.iceServers).toEqual([{ urls: ["turns:r.example.org:443"], username: "u", credential: "p" }]);
    expect(out.iceTransportPolicy).toBe("relay");
    expect(out.bundlePolicy).toBe("max-bundle");
    expect(blendInApplies(config)).toBe(true);
    expect(blendInApplies({ iceServers: [{ urls: "stun:x" }, { urls: "turn:y:3478" }] })).toBe(false);
  });

  it("reports readiness from the relay setup, public relays and fetched credentials", () => {
    expect(blendInReadiness(setup(null)).level).toBe("none");
    expect(blendInReadiness(setup(["turn:r:3478"])).level).toBe("none");
    expect(blendInReadiness(setup(["turns:r:5349"])).level).toBe("tls-other-port");
    expect(blendInReadiness(setup(["turn:r:3478", "turns:r:443"]))).toMatchObject({ level: "ready", tlsRelays: ["turns:r:443"] });
    expect(blendInReadiness(setup(null, [{ urls: ["turns:public.example:443"] }])).level).toBe("ready");
    expect(blendInReadiness(setup(null), [{ urls: "turns:fetched.example:443" }], true)).toMatchObject({ level: "ready", ownDiscoveryOnly: true });
  });
});
