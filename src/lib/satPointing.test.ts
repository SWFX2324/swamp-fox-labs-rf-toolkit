import { describe, expect, it } from "vitest";
import {
  GEO_RADIUS_M,
  compassPoint,
  formatOrbitalSlot,
  lookAngles,
  oneWayDelayS,
  parseOrbitalSlot,
  reflectorTiltDeg,
} from "./satPointing";

// The textbook spherical-earth formulas, as an independent cross-check.
function spherical(lat: number, lon: number, sat: number) {
  const d = ((sat - lon) * Math.PI) / 180;
  const p = (lat * Math.PI) / 180;
  const k = 6378.137 / 42164.17;
  const cosG = Math.cos(p) * Math.cos(d);
  const el = (Math.atan((cosG - k) / Math.sqrt(1 - cosG ** 2)) * 180) / Math.PI;
  const az = ((Math.atan2(Math.sin(d), -Math.sin(p) * Math.cos(d)) * 180) / Math.PI + 360) % 360;
  const skewMag = Math.abs((Math.atan(Math.sin(d) / Math.tan(p)) * 180) / Math.PI);
  return { el, az, skewMag };
}

const sites = [
  { name: "London to 28.2° E", lat: 51.5, lon: -0.1, sat: 28.2 },
  { name: "Charlotte to 101° W", lat: 35.2271, lon: -80.8431, sat: -101 },
  { name: "Charlotte to 61.5° W", lat: 35.2271, lon: -80.8431, sat: -61.5 },
  { name: "Anchorage to 129° W", lat: 61.22, lon: -149.9, sat: -129 },
  { name: "Sydney to 156° E", lat: -33.87, lon: 151.21, sat: 156 },
  { name: "Sydney to 140° E", lat: -33.87, lon: 151.21, sat: 140 },
  { name: "Nairobi to 7° E", lat: -1.29, lon: 36.82, sat: 7 },
];

describe("lookAngles", () => {
  it.each(sites)("matches the spherical formulas for $name", ({ lat, lon, sat }) => {
    const r = lookAngles({ lat, lon }, sat);
    const s = spherical(lat, lon, sat);
    // The ellipsoid shifts things by hundredths of a degree.
    expect(Math.abs(r.azimuthTrue - s.az)).toBeLessThan(0.15);
    expect(Math.abs(r.elevation - s.el)).toBeLessThan(0.15);
    expect(Math.abs(Math.abs(r.skew) - s.skewMag)).toBeLessThan(0.4);
  });

  it("turns the feed counter-clockwise (from behind) for a satellite east of a northern site", () => {
    expect(lookAngles({ lat: 51.5, lon: -0.1 }, 28.2).skew).toBeLessThan(0);
    expect(lookAngles({ lat: 35.2271, lon: -80.8431 }, -61.5).skew).toBeLessThan(0);
  });

  it("turns it clockwise for a satellite west of a northern site", () => {
    expect(lookAngles({ lat: 35.2271, lon: -80.8431 }, -101).skew).toBeGreaterThan(0);
  });

  it("mirrors the direction south of the equator", () => {
    expect(lookAngles({ lat: -33.87, lon: 151.21 }, 156).skew).toBeGreaterThan(0);
    expect(lookAngles({ lat: -33.87, lon: 151.21 }, 140).skew).toBeLessThan(0);
  });

  it("points due south with no skew when the slot matches the site longitude", () => {
    const r = lookAngles({ lat: 40, lon: -100 }, -100);
    expect(r.azimuthTrue).toBeCloseTo(180, 6);
    expect(r.skew).toBeCloseTo(0, 6);
  });

  it("points due north from the southern hemisphere", () => {
    expect(lookAngles({ lat: -30, lon: 20 }, 20).azimuthTrue).toBeCloseTo(0, 6);
  });

  it("looks straight up from the sub-satellite point at 35,786 km", () => {
    const r = lookAngles({ lat: 0, lon: -101 }, -101);
    expect(r.elevation).toBeCloseTo(90, 6);
    expect(r.rangeM / 1000).toBeCloseTo((GEO_RADIUS_M - 6378137) / 1000, 3);
  });

  it("reports a satellite over the horizon as negative elevation", () => {
    expect(lookAngles({ lat: 60, lon: 0 }, 100).elevation).toBeLessThan(0);
  });
});

describe("helpers", () => {
  it("gives about 120 ms one way to the sub-satellite point", () => {
    expect(oneWayDelayS(35_786_000) * 1000).toBeCloseTo(119.4, 1);
  });

  it("tilts an offset dish back by elevation minus offset", () => {
    expect(reflectorTiltDeg(40, 22)).toBe(18);
    expect(reflectorTiltDeg(40, 0)).toBe(40);
  });

  it.each([
    ["101W", -101],
    ["101.0° W", -101],
    ["W101", -101],
    [" 101 w ", -101],
    ["-101", -101],
    ["28.2E", 28.2],
    ["28.2°E", 28.2],
    ["0", 0],
  ])("parses %s", (text, lon) => {
    expect(parseOrbitalSlot(text)).toBe(lon);
  });

  it.each(["", "abc", "E101W", "-101W", "200W", "101 X"])("rejects %s", (text) => {
    expect(parseOrbitalSlot(text)).toBeUndefined();
  });

  it("formats slots and compass points", () => {
    expect(formatOrbitalSlot(-101)).toBe("101.0° W");
    expect(formatOrbitalSlot(28.2)).toBe("28.2° E");
    expect(compassPoint(212.5)).toBe("SSW");
    expect(compassPoint(148.6)).toBe("SSE");
    expect(compassPoint(359)).toBe("N");
  });
});
