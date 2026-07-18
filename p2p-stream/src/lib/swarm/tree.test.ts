import { describe, it, expect } from "vitest";
import {
  ROOT,
  createTree,
  peerJoined,
  peerLeft,
  setRelay,
  reseatOrphan,
  parentOf,
  childrenOf,
  isSeed,
  isConsistent,
  DEFAULT_TREE_CONFIG,
  type TreeState,
} from "./tree";

const cfg = DEFAULT_TREE_CONFIG; // rootFanout 2, seedCap 4

function join(t: TreeState, id: string, relay = true) {
  return peerJoined(t, id, relay, cfg);
}

describe("placement", () => {
  it("fills the root's fan-out first — small rooms stay a plain star", () => {
    const t = createTree();
    expect(join(t, "a")).toEqual([{ peer: "a", parent: ROOT }]);
    expect(join(t, "b")).toEqual([{ peer: "b", parent: ROOT }]);
    expect(isConsistent(t)).toBe(true);
  });

  it("seats the third watcher under a relay-willing direct child", () => {
    const t = createTree();
    join(t, "a");
    join(t, "b");
    expect(join(t, "c")).toEqual([{ peer: "c", parent: "a" }]); // lexicographic tie-break
    expect(isSeed(t, "a")).toBe(true);
    expect(isConsistent(t)).toBe(true);
  });

  it("balances across seeds by load", () => {
    const t = createTree();
    join(t, "a");
    join(t, "b");
    join(t, "c"); // -> a
    expect(join(t, "d")).toEqual([{ peer: "d", parent: "b" }]); // b has 0 < a's 1
    expect(join(t, "e")).toEqual([{ peer: "e", parent: "a" }]);
    expect(isConsistent(t)).toBe(true);
  });

  it("skips relay-unwilling children and overflows to the root when nobody can seed", () => {
    const t = createTree();
    join(t, "a", false);
    join(t, "b", false);
    expect(join(t, "c")).toEqual([{ peer: "c", parent: ROOT }]); // overflow, no seeds available
    expect(isConsistent(t)).toBe(true);
  });

  it("respects the seed cap", () => {
    const t = createTree();
    join(t, "s1");
    join(t, "x", false);
    for (const id of ["l1", "l2", "l3", "l4"]) join(t, id, false); // fill s1 to cap 4
    expect(childrenOf(t, "s1")).toHaveLength(4);
    expect(join(t, "l5", false)).toEqual([{ peer: "l5", parent: ROOT }]); // cap hit -> overflow
    expect(isConsistent(t)).toBe(true);
  });

  it("re-announcing an already-placed peer changes nothing", () => {
    const t = createTree();
    join(t, "a");
    expect(join(t, "a")).toEqual([]);
  });
});

describe("healing", () => {
  function crowd(): TreeState {
    // root -> s1, s2 (seeds); s1 -> l1, l2 ; s2 -> l3
    const t = createTree();
    join(t, "s1");
    join(t, "s2");
    join(t, "l1", false);
    join(t, "l2", false);
    join(t, "l3", false);
    return t;
  }

  it("re-seats a dead seed's children on survivors", () => {
    const t = crowd();
    const before = [...t.parent.keys()].filter((p) => p !== "s1");
    const moves = peerLeft(t, "s1", cfg);
    // every orphan got a new live parent
    for (const m of moves) expect([ROOT, ...childrenOf(t, ROOT)]).toContain(m.parent);
    for (const p of before) expect(parentOf(t, p)).toBeDefined();
    expect(isConsistent(t)).toBe(true);
  });

  it("promotes a relay-willing orphan into the freed root slot first", () => {
    const t = createTree();
    join(t, "s1");
    join(t, "x", false);
    join(t, "r1"); // relay-willing, lands under s1
    join(t, "l1", false); // under s1
    const moves = peerLeft(t, "s1", cfg);
    // r1 (relay) is seated first and takes the freed root slot…
    expect(moves[0]).toEqual({ peer: "r1", parent: ROOT });
    // …and the plain leaf lands under the new seed r1 (root is full again).
    expect(moves[1]).toEqual({ peer: "l1", parent: "r1" });
    expect(isSeed(t, "r1")).toBe(true);
    expect(isConsistent(t)).toBe(true);
  });

  it("survives a cascade: both seeds die back-to-back, nobody is lost", () => {
    const t = crowd();
    peerLeft(t, "s1", cfg);
    peerLeft(t, "s2", cfg);
    const alive = ["l1", "l2", "l3"];
    for (const id of alive) expect(parentOf(t, id)).toBeDefined();
    expect(isConsistent(t)).toBe(true);
  });

  it("random kill sequences never strand a surviving peer (fuzz)", () => {
    // Deterministic PRNG so failures are reproducible.
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let round = 0; round < 25; round++) {
      const t = createTree();
      const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
      for (const id of ids) join(t, id, rand() > 0.4);
      const order = [...ids].sort(() => rand() - 0.5);
      const dead = new Set<string>();
      for (const victim of order.slice(0, 8)) {
        peerLeft(t, victim, cfg);
        dead.add(victim);
        for (const id of ids) {
          if (dead.has(id)) continue;
          const parent = parentOf(t, id);
          expect(parent).toBeDefined();
          expect(parent === ROOT || !dead.has(parent!)).toBe(true);
        }
        expect(isConsistent(t)).toBe(true);
      }
    }
  });
});

describe("relay opt-out (hybrid model)", () => {
  it("opting out while seeding re-seats the children", () => {
    const t = createTree();
    join(t, "s1");
    join(t, "s2");
    join(t, "l1", false); // under s1
    const moves = setRelay(t, "s1", false, cfg);
    expect(moves).toEqual([{ peer: "l1", parent: "s2" }]);
    expect(childrenOf(t, "s1")).toEqual([]);
    expect(isConsistent(t)).toBe(true);
  });

  it("opting out as a leaf just records the capability", () => {
    const t = createTree();
    join(t, "a");
    expect(setRelay(t, "a", false, cfg)).toEqual([]);
    expect(parentOf(t, "a")).toBe(ROOT);
  });
});

describe("reseatOrphan", () => {
  it("moves a starving leaf away from its current parent", () => {
    const t = createTree();
    join(t, "s1");
    join(t, "s2");
    join(t, "l1", false); // under s1
    const moves = reseatOrphan(t, "l1", cfg);
    expect(moves).toEqual([{ peer: "l1", parent: "s2" }]);
    expect(isConsistent(t)).toBe(true);
  });

  it("falls back to the root when the failed parent is the only seed", () => {
    const t = createTree();
    join(t, "s1");
    join(t, "x", false);
    join(t, "l1", false); // under s1
    const moves = reseatOrphan(t, "l1", cfg);
    expect(moves).toEqual([{ peer: "l1", parent: ROOT }]);
    expect(isConsistent(t)).toBe(true);
  });

  it("is a no-op for unknown peers", () => {
    const t = createTree();
    expect(reseatOrphan(t, "ghost", cfg)).toEqual([]);
  });
});
