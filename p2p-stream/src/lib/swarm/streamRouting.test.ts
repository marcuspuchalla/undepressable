import { describe, it, expect } from "vitest";
import {
  createRoutes,
  addMember,
  removeMember,
  claimOwner,
  ownerOf,
  allPeers,
  roomsWithPeer,
  clearRoutes,
} from "./streamRouting";

describe("streamRouting", () => {
  it("first join on any room is 'new', later transports are not", () => {
    const r = createRoutes();
    expect(addMember(r, "torrent", "p1")).toBe(true);
    expect(addMember(r, "nostr", "p1")).toBe(false);
    expect(addMember(r, "mqtt", "p1")).toBe(false);
    expect(roomsWithPeer(r, "p1").sort()).toEqual(["mqtt", "nostr", "torrent"]);
  });

  it("only the first room claims media ownership — one uplink copy per peer", () => {
    const r = createRoutes();
    addMember(r, "torrent", "p1");
    expect(claimOwner(r, "torrent", "p1")).toBe(true);
    addMember(r, "nostr", "p1");
    expect(claimOwner(r, "nostr", "p1")).toBe(false);
    addMember(r, "mqtt", "p1");
    expect(claimOwner(r, "mqtt", "p1")).toBe(false);
    expect(ownerOf(r, "p1")).toBe("torrent");
  });

  it("losing a non-owner connection changes nothing for media", () => {
    const r = createRoutes();
    addMember(r, "torrent", "p1");
    claimOwner(r, "torrent", "p1");
    addMember(r, "nostr", "p1");
    expect(removeMember(r, "nostr", "p1")).toEqual({ gone: false, reassignTo: null });
    expect(ownerOf(r, "p1")).toBe("torrent");
  });

  it("losing the owning connection hands media to a surviving room", () => {
    const r = createRoutes();
    addMember(r, "torrent", "p1");
    claimOwner(r, "torrent", "p1");
    addMember(r, "nostr", "p1");
    const res = removeMember(r, "torrent", "p1");
    expect(res.gone).toBe(false);
    expect(res.reassignTo).toBe("nostr");
    expect(ownerOf(r, "p1")).toBe("nostr");
  });

  it("peer is 'gone' only after leaving every room, and ownership is cleared", () => {
    const r = createRoutes();
    addMember(r, "torrent", "p1");
    claimOwner(r, "torrent", "p1");
    addMember(r, "nostr", "p1");
    expect(removeMember(r, "torrent", "p1").gone).toBe(false);
    expect(removeMember(r, "nostr", "p1")).toEqual({ gone: true, reassignTo: null });
    expect(ownerOf(r, "p1")).toBeUndefined();
    // A fresh rejoin can claim ownership again.
    addMember(r, "mqtt", "p1");
    expect(claimOwner(r, "mqtt", "p1")).toBe(true);
  });

  it("tracks multiple peers independently", () => {
    const r = createRoutes();
    addMember(r, "torrent", "p1");
    claimOwner(r, "torrent", "p1");
    addMember(r, "nostr", "p2");
    claimOwner(r, "nostr", "p2");
    expect([...allPeers(r)].sort()).toEqual(["p1", "p2"]);
    removeMember(r, "torrent", "p1");
    expect([...allPeers(r)]).toEqual(["p2"]);
    expect(ownerOf(r, "p2")).toBe("nostr");
  });

  it("clearRoutes drops all state", () => {
    const r = createRoutes();
    addMember(r, "torrent", "p1");
    claimOwner(r, "torrent", "p1");
    clearRoutes(r);
    expect(allPeers(r).size).toBe(0);
    expect(ownerOf(r, "p1")).toBeUndefined();
  });
});
