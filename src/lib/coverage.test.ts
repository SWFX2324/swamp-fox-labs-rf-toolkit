import { describe, expect, it } from "vitest";
import { coverageMargins, coveragePathLoss, coveragePatternLoss, coverageStats, marginAt, marginsFromLoss, sampleRadials, sumGrids } from "./coverage";
import { beam } from "./pattern";
import { fsplDb } from "./fspl";
import { bearingDeg, distanceBetweenM } from "./geo";

const site = { lat: 35.2271, lon: -80.8431 };
const radio = { freqHz: 915e6, eirpDbm: 32, rxGainDbi: 2, rxCableLossDb: 0, sensitivityDbm: -100 };
const flat = () => 200;

describe("sampleRadials", () => {
  it("samples every radial from the site outward", () => {
    const s = sampleRadials(site, 5000, 8, 50, flat);
    expect(s.bearings).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
    expect(s.stepM).toBe(100);
    expect(s.elevations).toHaveLength(8);
    expect(s.elevations[0]).toHaveLength(51);
    expect(s.elevations[3][50]).toBe(200);
  });

  it("fills missing data from the previous point", () => {
    let calls = 0;
    const gappy = () => (calls++ % 2 ? Number.NaN : 150);
    const s = sampleRadials(site, 1000, 4, 10, gappy);
    for (const e of s.elevations) for (const h of e) expect(h).toBe(150);
  });
});

describe("coverageMargins", () => {
  it("is pure free-space loss when the antennas tower over flat ground", () => {
    const s = sampleRadials(site, 3000, 4, 30, flat);
    const m = coverageMargins(s, radio, 300, 300);
    const d = 30 * s.stepM;
    // Longley-Rice adds next to nothing when the path clears the ground by far.
    expect(m[0][30]).toBeCloseTo(32 + 2 - 0 + 100 - fsplDb(915e6, d), 2);
    expect(m[0][0]).toBeNaN();
  });

  it("lowers every point by the environment loss", () => {
    const s = sampleRadials(site, 3000, 4, 30, flat);
    const bare = coverageMargins(s, radio, 300, 300);
    const inClutter = coverageMargins(s, { ...radio, clutterLossDb: 25 }, 300, 300);
    expect(bare[2][20] - inClutter[2][20]).toBeCloseTo(25, 3);
  });

  it("falls off with distance over flat ground", () => {
    const s = sampleRadials(site, 10_000, 4, 50, flat);
    const m = coverageMargins(s, radio, 10, 1.5);
    for (let k = 2; k <= 50; k++) expect(m[1][k]).toBeLessThan(m[1][k - 1] + 1e-6);
  });

  it("shadows the ground behind a hill on one bearing only", () => {
    // A 300 m ridge 3 to 3.5 km east of the site.
    const hill = (p: { lat: number; lon: number }) => {
      const d = distanceBetweenM(site, p);
      const b = bearingDeg(site, p);
      return Math.abs(b - 90) < 10 && d > 3000 && d < 3500 ? 500 : 200;
    };
    const s = sampleRadials(site, 8000, 36, 80, hill);
    const m = coverageMargins(s, radio, 10, 1.5);
    const east = marginAt(s, m, 90, 6000);
    const west = marginAt(s, m, 270, 6000);
    expect(west - east).toBeGreaterThan(20);
  });
});

describe("marginAt and coverageStats", () => {
  const s = sampleRadials(site, 10_000, 36, 100, flat);
  const m = coverageMargins(s, radio, 300, 300);

  it("looks up the nearest radial point", () => {
    expect(marginAt(s, m, 0, 5000)).toBe(m[0][50]);
    expect(marginAt(s, m, 359, 5000)).toBe(m[0][50]);
    expect(marginAt(s, m, 12, 5040)).toBe(m[1][50]);
    expect(marginAt(s, m, 0, 20_000)).toBeNaN();
  });

  it("weights shares by area and finds the farthest solid point", () => {
    const all = coverageStats(s, m, 0);
    expect(all.solid).toBeCloseTo(1, 9);
    expect(all.farthestSolidM).toBe(10_000);
    // A fade margin no point can meet.
    const none = coverageStats(s, m, 500);
    expect(none.solid).toBe(0);
    expect(none.marginal).toBeCloseTo(1, 9);
  });
});

describe("per-point receive heights", () => {
  it("uses a height per radial point when given one", () => {
    const s = sampleRadials(site, 5000, 4, 20, flat);
    const same = coveragePathLoss(s, radio.freqHz, 30, 2);
    const grid = coveragePathLoss(s, radio.freqHz, 30, s.elevations.map((e) => new Float32Array(e.length).fill(2)));
    expect(Array.from(grid[1])).toEqual(Array.from(same[1]));
  });
});

describe("antenna pattern on coverage", () => {
  const s = sampleRadials(site, 10_000, 8, 50, flat);

  it("costs nothing on the beam and the front-to-back ratio behind it", () => {
    const loss = coveragePatternLoss(s, beam("sector90", 14, 90), 30, 2);
    // Radial 2 points east, along the beam; radial 6 points west, behind it.
    expect(loss[2][50]).toBeLessThan(1);
    expect(loss[6][50]).toBe(25);
    // 45° off the beam centre is the 3 dB edge, plus a little vertical loss.
    expect(loss[1][50]).toBeGreaterThanOrEqual(3);
    expect(loss[1][50]).toBeLessThan(4);
  });

  it("is taken off the margins", () => {
    const pathLoss = coveragePathLoss(s, radio.freqHz, 30, 2);
    const pattern = coveragePatternLoss(s, beam("sector90", 14, 90), 30, 2);
    const plain = marginsFromLoss(pathLoss, radio);
    const aimed = marginsFromLoss(pathLoss, radio, pattern);
    expect(aimed[6][40]).toBeCloseTo(plain[6][40] - 25, 4);
  });

  it("sums per-point grids, skipping missing ones", () => {
    const a = [new Float32Array([1, 2])];
    const b = [new Float32Array([10, 20])];
    expect(sumGrids(undefined, undefined)).toBeUndefined();
    expect(Array.from(sumGrids(a, undefined, b)![0])).toEqual([11, 22]);
  });
});
