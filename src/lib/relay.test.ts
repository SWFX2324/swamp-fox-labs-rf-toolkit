import { describe, expect, it } from "vitest";
import type { RadialSamples } from "./coverage";
import { distanceBetweenM } from "./geo";
import { MAX_RELAY_RADIUS_M, radiusToCover, relaySearchBox, relaySurface } from "./relay";

const a = { lat: 35, lon: -78 };
const b = { lat: 35, lon: -77.8 };

/** Flat samples around a site, with a margin that falls off with distance. */
function hop(site: { lat: number; lon: number }, radiusM: number, marginAtSite: number, dbPerKm: number) {
  const radials = 72;
  const steps = 100;
  const stepM = radiusM / steps;
  const samples: RadialSamples = {
    site,
    radiusM,
    stepM,
    bearings: Array.from({ length: radials }, (_, i) => (360 * i) / radials),
    elevations: Array.from({ length: radials }, () => new Float32Array(steps + 1)),
  };
  const margins = samples.elevations.map((e) => e.map((_, k) => (k === 0 ? Number.NaN : marginAtSite - (k * stepM * dbPerKm) / 1000)));
  return { samples, margins };
}

describe("relaySearchBox", () => {
  it("covers both sites with room around them", () => {
    const box = relaySearchBox(a, b);
    expect(box.west).toBeLessThan(-78);
    expect(box.east).toBeGreaterThan(-77.8);
    expect(box.north).toBeGreaterThan(35);
    expect(box.south).toBeLessThan(35);
    // 30% of ~18 km is ~5.5 km of padding to the north.
    expect(distanceBetweenM({ lat: 35, lon: -77.9 }, { lat: box.north, lon: -77.9 })).toBeCloseTo(0.3 * distanceBetweenM(a, b), -2);
  });

  it("pads at least 2 km for close sites", () => {
    const box = relaySearchBox(a, { lat: 35.001, lon: -78 });
    expect(distanceBetweenM({ lat: 35.001, lon: -78 }, { lat: box.north, lon: -78 })).toBeCloseTo(2000, -1);
  });
});

describe("radiusToCover", () => {
  it("reaches the farthest corner, capped at the limit", () => {
    const box = relaySearchBox(a, b);
    const r = radiusToCover(a, box);
    expect(r).toBeGreaterThan(distanceBetweenM(a, b));
    expect(radiusToCover(a, { north: 60, south: 10, west: -120, east: -40 })).toBe(MAX_RELAY_RADIUS_M);
  });
});

describe("relaySurface", () => {
  it("takes the weaker hop, and finds the balanced spot between equal sites", () => {
    const box = relaySearchBox(a, b);
    const r = Math.max(radiusToCover(a, box), radiusToCover(b, box));
    const s = relaySurface(box, 60, 40, hop(a, r, 40, 3), hop(b, r, 40, 3));
    expect(s.values).toHaveLength(60 * 40);
    expect(s.best).toBeDefined();
    // Both hops fade the same way, so the best spot is near the midpoint.
    expect(s.best!.lon).toBeCloseTo(-77.9, 1);
    expect(s.best!.lat).toBeCloseTo(35, 1);
    expect(s.best!.marginDb).toBeCloseTo(Math.min(s.best!.hop1Db, s.best!.hop2Db), 9);
  });

  it("leans toward the weaker site", () => {
    const box = relaySearchBox(a, b);
    const r = Math.max(radiusToCover(a, box), radiusToCover(b, box));
    // Site b's hop fades three times faster, so the relay should sit nearer b.
    const s = relaySurface(box, 80, 40, hop(a, r, 40, 2), hop(b, r, 40, 6));
    expect(distanceBetweenM(s.best!, b)).toBeLessThan(distanceBetweenM(s.best!, a));
  });

  it("marks cells beyond either site's reach as NaN", () => {
    const box = relaySearchBox(a, b);
    const s = relaySurface(box, 20, 20, hop(a, 1000, 40, 3), hop(b, 1000, 40, 3));
    expect([...s.values].every((v) => Number.isNaN(v))).toBe(true);
    expect(s.best).toBeUndefined();
  });
});
