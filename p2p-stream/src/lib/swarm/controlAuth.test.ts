import { describe, it, expect } from "vitest";
import { createControlGate, MAX_HELD_PER_PEER, MAX_HOLDING_PEERS } from "./controlAuth";

describe("createControlGate", () => {
  it("authorizes only peers that announced the streamer role", () => {
    const gate = createControlGate();
    expect(gate.isStreamer("root")).toBe(false);
    gate.noteRole("root", "streamer");
    gate.noteRole("watcher", "collector");
    expect(gate.isStreamer("root")).toBe(true);
    expect(gate.isStreamer("watcher")).toBe(false);
  });

  it("replays instructions that arrived before the sender was identified", () => {
    // The root announces assignments before its first stat lands.
    const gate = createControlGate();
    gate.hold("root", { t: "assign", parent: "ROOT" });
    gate.hold("root", { t: "children", children: ["c1"] });
    const released = gate.noteRole("root", "streamer");
    expect(released).toEqual([
      { t: "assign", parent: "ROOT" },
      { t: "children", children: ["c1"] },
    ]);
  });

  it("keeps trusting the streamer after its stat goes stale on a bad link", () => {
    // Stats expire after ~12s of silence; that must not revoke authority,
    // because re-seating matters most exactly when the link is bad.
    const gate = createControlGate();
    gate.noteRole("root", "streamer");
    expect(gate.isStreamer("root")).toBe(true);
    // …no further stats arrive at all…
    expect(gate.isStreamer("root")).toBe(true);
  });

  it("does not hold messages from an already-authorized peer", () => {
    const gate = createControlGate();
    gate.noteRole("root", "streamer");
    gate.hold("root", { t: "children", children: [] });
    expect(gate.takeHeld("root")).toEqual([]);
  });

  it("drains the buffer exactly once", () => {
    const gate = createControlGate();
    gate.hold("root", { t: "assign", parent: "ROOT" });
    expect(gate.noteRole("root", "streamer")).toHaveLength(1);
    expect(gate.noteRole("root", "streamer")).toEqual([]);
  });

  it("caps how much one unidentified peer can make us buffer", () => {
    const gate = createControlGate();
    for (let i = 0; i < MAX_HELD_PER_PEER + 20; i++) gate.hold("loud", { n: i });
    expect(gate.takeHeld("loud")).toHaveLength(MAX_HELD_PER_PEER);
  });

  it("caps how many unidentified peers can make us buffer at all", () => {
    const gate = createControlGate();
    for (let i = 0; i < MAX_HOLDING_PEERS + 10; i++) gate.hold(`peer${i}`, { n: i });
    // Peers beyond the cap are ignored rather than accumulating.
    expect(gate.takeHeld(`peer${MAX_HOLDING_PEERS + 5}`)).toEqual([]);
    expect(gate.takeHeld("peer0")).toHaveLength(1);
  });

  it("forgets a departed peer, including anything it had queued", () => {
    const gate = createControlGate();
    gate.hold("gone", { t: "assign", parent: "ROOT" });
    gate.noteRole("gone", "streamer");
    gate.forget("gone");
    expect(gate.isStreamer("gone")).toBe(false);
    expect(gate.takeHeld("gone")).toEqual([]);
  });

  it("clears everything on room teardown", () => {
    const gate = createControlGate();
    gate.noteRole("root", "streamer");
    gate.hold("other", { t: "assign", parent: "ROOT" });
    gate.clear();
    expect(gate.isStreamer("root")).toBe(false);
    expect(gate.takeHeld("other")).toEqual([]);
  });
});
