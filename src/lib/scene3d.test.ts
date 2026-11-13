import { describe, expect, it } from "vitest";
import { earthBulgeM } from "./horizon";
import { distanceBetweenM } from "./geo";
import { LINK_SAMPLES, lineOfSightHeights, linkSamples, ringCoordinates, viewBearing } from "./scene3d";

describe("lineOfSightHeights", () => {
  it("runs from one antenna top to the other", () => {
    const h = lineOfSightHeights(1000, 1200, 20_000);
    expect(h).toHaveLength(LINK_SAMPLES + 1);
    expect(h[0]).toBeCloseTo(1000, 9);
    expect(h[h.length - 1]).toBeCloseTo(1200, 9);
  });

  it("dips by the earth bulge in the middle, so a flat map shows true clearance", () => {
    const h = lineOfSightHeights(500, 500, 30_000, 2);
    expect(h[1]).toBeCloseTo(500 - earthBulgeM(15_000, 15_000), 6);
    // About 13 m at 30 km for k = 4/3.
    expect(500 - h[1]).toBeGreaterThan(12);
    expect(500 - h[1]).toBeLessThan(14);
  });

  it("dips more for a smaller k", () => {
    const standard = lineOfSightHeights(0, 0, 40_000, 2)[1];
    const worst = lineOfSightHeights(0, 0, 40_000, 2, 2 / 3)[1];
    expect(worst).toBeLessThan(standard);
  });
});

describe("linkSamples", () => {
  it("gives one ground point per height, ends included", () => {
    const a = { lat: 39.6, lon: -105.8 };
    const b = { lat: 39.5, lon: -105.6 };
    const s = linkSamples(a, b, 4);
    expect(s).toHaveLength(5);
    expect(s[0].lat).toBeCloseTo(a.lat, 9);
    expect(s[4].lon).toBeCloseTo(b.lon, 9);
  });
});

describe("viewBearing", () => {
  it("looks side-on at a single link, first point on the left", () => {
    // A link running due east: look north, so it runs left to right.
    expect(viewBearing([{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }])).toBeCloseTo(0, 6);
    // Running north: look west.
    expect(viewBearing([{ lat: 0, lon: 0 }, { lat: 1, lon: 0 }])).toBeCloseTo(-90, 6);
  });

  it("keeps north up for anything else", () => {
    expect(viewBearing([])).toBe(0);
    expect(viewBearing([{ lat: 0, lon: 0 }])).toBe(0);
    expect(viewBearing([{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }])).toBe(0);
  });
});

describe("ringCoordinates", () => {
  it("draws a closed circle at the given radius", () => {
    const center = { lat: 35, lon: -80 };
    const ring = ringCoordinates(center, 10_000, 16);
    expect(ring).toHaveLength(17);
    expect(ring[0]).toEqual(ring[16]);
    for (const [lon, lat] of ring) expect(distanceBetweenM(center, { lat, lon })).toBeCloseTo(10_000, -1);
  });
});
