// Blend in: make the app's traffic look like ordinary web traffic.
//
// Deep packet inspection recognises WebRTC — STUN requests to public servers,
// the DTLS handshake between peers, TURN messages in the clear — before it
// knows what the app is. What it cannot pick out of a stream of HTTPS is TLS
// to port 443. So with this on, everything the app sends goes:
//
//   media and data   → only through a TURN relay over TLS on 443 (turns:…:443);
//                      no STUN, no direct connection, nothing over UDP
//   discovery        → only Nostr relays over WSS (443): no BitTorrent
//                      trackers, no MQTT brokers
//   checks           → no NAT probe (that is STUN too)
//
// It needs a turns: relay; without one the setting is on but cannot apply,
// and the Network page says so. docs/TRAFFIC.md says what still shows.

import type { RelaySetup } from "./iceConfig";

const KEY = "undepressable_blend_in";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function safeStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function isBlendIn(storage: Pick<Storage, "getItem"> | null = safeStorage()): boolean {
  try {
    return storage?.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setBlendIn(on: boolean, storage: StorageLike | null = safeStorage()): void {
  try {
    if (on) storage?.setItem(KEY, "1");
    else storage?.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
}

const urlsOf = (s: RTCIceServer) => (Array.isArray(s.urls) ? s.urls : [s.urls]);

/** TURN over TLS (`turns:`): the only relay transport that passes as HTTPS. */
export function isTlsRelayUrl(url: string): boolean {
  return /^turns:/i.test(url.trim());
}

/** …and on port 443 it also sits where HTTPS sits. (turns: without a port means 5349.) */
export function isOn443(url: string): boolean {
  const m = /^turns:(?:\[[^\]]+\]|[^:?]+)(?::(\d+))?/i.exec(url.trim());
  return !!m && m[1] === "443";
}

/** Keep only TLS relays, and allow relay candidates only. Empty servers: nothing qualifies. */
export function blendInConfig(config: RTCConfiguration): RTCConfiguration {
  const iceServers = (config.iceServers ?? [])
    .map((s) => ({ ...s, urls: urlsOf(s).filter(isTlsRelayUrl) }))
    .filter((s) => s.urls.length > 0);
  return { ...config, iceServers, iceTransportPolicy: "relay" };
}

export type BlendInLevel =
  /** A TLS relay on 443: traffic passes as HTTPS. */
  | "ready"
  /** A TLS relay, but not on 443: encrypted, on a port HTTPS does not use. */
  | "tls-other-port"
  /** No TLS relay: the setting cannot apply. */
  | "none";

export interface BlendInReadiness {
  level: BlendInLevel;
  tlsRelays: string[];
  /** Discovery goes to the device's own relays only (else to public Nostr relays, still over WSS). */
  ownDiscoveryOnly: boolean;
}

export function blendInReadiness(setup: RelaySetup, fetched: RTCIceServer[] = [], onlyOwnDiscovery = false): BlendInReadiness {
  const urls = [...(setup.turn?.urls ?? []), ...setup.publicServers.flatMap(urlsOf), ...fetched.flatMap(urlsOf)];
  const tlsRelays = urls.filter(isTlsRelayUrl);
  const level: BlendInLevel = tlsRelays.some(isOn443) ? "ready" : tlsRelays.length ? "tls-other-port" : "none";
  return { level, tlsRelays, ownDiscoveryOnly: onlyOwnDiscovery };
}

/** Does the resolved configuration let blend-in apply (a TLS relay to go through)? */
export function blendInApplies(config: RTCConfiguration): boolean {
  return blendInConfig(config).iceServers!.length > 0;
}
