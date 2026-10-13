import { describe, it, expect } from "vitest";
import { usesHashRoutes, appBase, linkSearch } from "./appLocation";

describe("appLocation", () => {
  it("uses hash routes only where the server cannot answer app paths", () => {
    expect(usesHashRoutes({ protocol: "https:" })).toBe(false);
    expect(usesHashRoutes({ protocol: "file:" })).toBe(true);
    expect(usesHashRoutes({ protocol: "chrome-extension:" })).toBe(true);
    expect(usesHashRoutes({ protocol: "moz-extension:" })).toBe(true);
  });

  it("links point at this very copy, wherever it lives", () => {
    expect(appBase({ protocol: "https:", origin: "https://app.example", pathname: "/collect/ABC123" })).toBe("https://app.example");
    expect(appBase({ protocol: "file:", origin: "null", pathname: "/media/usb/undepressable.html" })).toBe("file:///media/usb/undepressable.html");
  });

  it("reads link parameters from the search part and from inside the hash", () => {
    expect(linkSearch({ search: "?turn=a", hash: "" })).toBe("?turn=a");
    expect(linkSearch({ search: "", hash: "#/collect/ABC123?turn=t%7Cu%7Cp&relays=wss%3A%2F%2Fr" })).toBe("?turn=t%7Cu%7Cp&relays=wss%3A%2F%2Fr");
    expect(linkSearch({ search: "?turn=outer", hash: "#/x?turn=inner&ice=i" })).toBe("?turn=outer&ice=i");
    expect(linkSearch({ search: "", hash: "#/collect/ABC123" })).toBe("");
  });
});
