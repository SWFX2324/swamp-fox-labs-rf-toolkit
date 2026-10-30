import { describe, expect, it } from "vitest";
import { fsplDb } from "./fspl";
import { connectedGroups, hopCounts, meshLink, pairs } from "./mesh";

const radio = {
  freqHz: 915e6,
  txPowerDbm: 30,
  gainDbi: 3,
  cableLossDb: 1,
  sensitivityDbm: -100,
  fadeMarginDb: 10,
};

describe("meshLink", () => {
  it("adds up a free-space link when there's no terrain", () => {
    const l = meshLink(radio, 5000, 10, 10);
    expect(l.fsplDb).toBeCloseTo(fsplDb(915e6, 5000), 9);
    expect(l.terrainLossDb).toBe(0);
    expect(l.rslDbm).toBeCloseTo(30 - 1 + 3 - l.fsplDb + 3 - 1, 9);
    expect(l.marginDb).toBeCloseTo(l.rslDbm + 100, 9);
    expect(l.profile).toBeUndefined();
  });

  it("rates against the fade margin", () => {
    // 34 dB of gains and power against −100 dBm allows 134 dB of free-space
    // loss: about 131 km at 915 MHz, or 41 km keeping the 10 dB fade margin.
    expect(meshLink(radio, 30_000, 10, 10).status).toBe("good");
    expect(meshLink(radio, 80_000, 10, 10).status).toBe("marginal");
    expect(meshLink(radio, 200_000, 10, 10).status).toBe("fail");
  });

  it("charges terrain diffraction when a profile is given", () => {
    const ridge = Array.from({ length: 101 }, () => 100);
    ridge[50] = 200;
    const clear = meshLink(radio, 10_000, 10, 10, Array.from({ length: 101 }, () => 100));
    const blocked = meshLink(radio, 10_000, 10, 10, ridge);
    expect(blocked.profile).toBe("blocked");
    expect(blocked.terrainLossDb).toBeGreaterThan(20);
    expect(blocked.marginDb).toBeCloseTo(clear.marginDb - blocked.terrainLossDb + clear.terrainLossDb, 6);
  });
});

describe("pairs", () => {
  it("lists n(n−1)/2 unordered pairs", () => {
    expect(pairs(4)).toEqual([[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]);
    expect(pairs(10)).toHaveLength(45);
    expect(pairs(1)).toEqual([]);
  });
});

describe("connectedGroups", () => {
  it("finds islands, largest first", () => {
    expect(connectedGroups(5, [[0, 1], [1, 2], [3, 4]])).toEqual([[0, 1, 2], [3, 4]]);
    expect(connectedGroups(3, [])).toEqual([[0], [1], [2]]);
    expect(connectedGroups(3, [[0, 1], [1, 2]])).toEqual([[0, 1, 2]]);
  });
});

describe("hopCounts", () => {
  it("counts hops through relays", () => {
    const h = hopCounts(4, [[0, 1], [1, 2]]);
    expect(h[0][2]).toBe(2);
    expect(h[2][0]).toBe(2);
    expect(h[0][3]).toBe(Number.POSITIVE_INFINITY);
  });
});
