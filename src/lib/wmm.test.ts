import { describe, expect, it } from "vitest";
import testValues from "./fixtures/WMM2025_TestValues.txt?raw";
import { decimalYear, magneticField, modelIsCurrent } from "./wmm";

// NOAA's official WMM2025 test values (from the WMM2025COF release):
// year, altitude km, lat, lon, D, I, H, X, Y, Z, F, ...
const cases = testValues
  .split("\n")
  .filter((line) => line.trim() && !line.startsWith("#"))
  .map((line) => line.trim().split(/\s+/).map(Number));

describe("magneticField against NOAA's WMM2025 test values", () => {
  it("has all 100 reference points", () => {
    expect(cases).toHaveLength(100);
  });

  it.each(cases.map((c) => [c[0], c[1], c[2], c[3], c] as const))(
    "%d at %d km, %d°, %d°",
    (year, alt, lat, lon, c) => {
      const f = magneticField(lat, lon, alt, year);
      expect(f.declination).toBeCloseTo(c[4], 2);
      expect(f.inclination).toBeCloseTo(c[5], 2);
      expect(Math.abs(f.x - c[7])).toBeLessThan(0.5);
      expect(Math.abs(f.y - c[8])).toBeLessThan(0.5);
      expect(Math.abs(f.z - c[9])).toBeLessThan(0.5);
    },
  );
});

describe("decimalYear and modelIsCurrent", () => {
  it("converts dates", () => {
    expect(decimalYear(new Date(Date.UTC(2025, 0, 1)))).toBe(2025);
    expect(decimalYear(new Date(Date.UTC(2026, 6, 2, 12)))).toBeCloseTo(2026.5, 2);
  });

  it("covers 2025 through 2030", () => {
    expect(modelIsCurrent(2026.8)).toBe(true);
    expect(modelIsCurrent(2031)).toBe(false);
  });
});
