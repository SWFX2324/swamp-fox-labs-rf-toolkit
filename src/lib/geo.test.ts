import { describe, expect, it } from "vitest";
import { bearingDeg, distanceBetweenM, intermediatePoint, parseLatLon, samplePath } from "./geo";

describe("distanceBetweenM", () => {
  it("is about 111.2 km per degree of latitude", () => {
    expect(distanceBetweenM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) / 1000).toBeCloseTo(111.19, 1);
  });

  it("is about 3,936 km from New York to Los Angeles", () => {
    const nyc = { lat: 40.7128, lon: -74.006 };
    const la = { lat: 34.0522, lon: -118.2437 };
    expect(distanceBetweenM(nyc, la) / 1000).toBeCloseTo(3936, -1);
  });

  it("is zero for the same point", () => {
    expect(distanceBetweenM({ lat: 35, lon: -80 }, { lat: 35, lon: -80 })).toBe(0);
  });
});

describe("bearingDeg", () => {
  it("points north, east, south and west", () => {
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 6);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 6);
    expect(bearingDeg({ lat: 1, lon: 0 }, { lat: 0, lon: 0 })).toBeCloseTo(180, 6);
    expect(bearingDeg({ lat: 0, lon: 1 }, { lat: 0, lon: 0 })).toBeCloseTo(270, 6);
  });
});

describe("intermediatePoint and samplePath", () => {
  it("finds the midpoint along the equator", () => {
    const mid = intermediatePoint({ lat: 0, lon: 0 }, { lat: 0, lon: 90 }, 0.5);
    expect(mid.lat).toBeCloseTo(0, 9);
    expect(mid.lon).toBeCloseTo(45, 9);
  });

  it("includes both ends and spaces points evenly", () => {
    const a = { lat: 35.2, lon: -80.8 };
    const b = { lat: 35.6, lon: -82.5 };
    const pts = samplePath(a, b, 11);
    expect(pts).toHaveLength(11);
    expect(pts[0].lat).toBeCloseTo(a.lat, 9);
    expect(pts[10].lon).toBeCloseTo(b.lon, 9);
    const step = distanceBetweenM(a, b) / 10;
    expect(distanceBetweenM(pts[3], pts[4])).toBeCloseTo(step, 0);
  });
});

describe("parseLatLon", () => {
  it("reads comma or space separated decimal degrees", () => {
    expect(parseLatLon("35.2271, -80.8431")).toEqual({ lat: 35.2271, lon: -80.8431 });
    expect(parseLatLon(" 35.2271  -80.8431 ")).toEqual({ lat: 35.2271, lon: -80.8431 });
  });

  it("rejects junk and out-of-range values", () => {
    expect(parseLatLon("")).toBeUndefined();
    expect(parseLatLon("35.2")).toBeUndefined();
    expect(parseLatLon("abc, def")).toBeUndefined();
    expect(parseLatLon("95, 10")).toBeUndefined();
    expect(parseLatLon("10, 190")).toBeUndefined();
  });
});
