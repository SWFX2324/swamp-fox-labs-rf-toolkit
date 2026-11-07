import { describe, expect, it } from "vitest";
import { STANDARD_K, earthBulgeM, fresnelRadiusM, lineOfSightRangeM, midpointClearance, parseKFactor, radioHorizonM } from "./horizon";
import { fromMetres, toMetres } from "./units";

describe("radioHorizonM", () => {
  // Rule of thumb: d_km ≈ 4.12·√h_m with k = 4/3.
  it("is about 13 km for a 10 m mast", () => {
    expect(radioHorizonM(10) / 1000).toBeCloseTo(4.12 * Math.sqrt(10), 1);
  });

  it("is zero at ground level and for negative heights", () => {
    expect(radioHorizonM(0)).toBe(0);
    expect(radioHorizonM(-5)).toBe(0);
  });
});

describe("lineOfSightRangeM", () => {
  // Rule of thumb: d_mi ≈ √(2·h_ft) per end.
  it("is about 15.5 mi for two antennas at 30 ft", () => {
    const h = toMetres(30, "ft");
    expect(fromMetres(lineOfSightRangeM(h, h), "mi")).toBeCloseTo(2 * Math.sqrt(60), 1);
  });
});

describe("earthBulgeM", () => {
  it("is about 1.47 m at the middle of a 10 km path", () => {
    expect(earthBulgeM(5000, 5000)).toBeCloseTo(1.47, 2);
  });
});

describe("fresnelRadiusM", () => {
  // Rule of thumb: r_m = 17.32·√(d_km / (4·f_GHz)) at the midpoint.
  it("is about 5.6 m at the middle of a 1 km 2.4 GHz path", () => {
    expect(fresnelRadiusM(2.4e9, 500, 500)).toBeCloseTo(17.32 * Math.sqrt(1 / (4 * 2.4)), 1);
  });
});

describe("midpointClearance", () => {
  it("subtracts the bulge from the average antenna height", () => {
    const c = midpointClearance(915e6, 10_000, 10, 20);
    expect(c.clearanceM).toBeCloseTo(15 - earthBulgeM(5000, 5000), 9);
    expect(c.neededM).toBeCloseTo(0.6 * fresnelRadiusM(915e6, 5000, 5000), 9);
  });
});

describe("k-factor choices", () => {
  it("reads the choice ids, standard for anything else", () => {
    expect(parseKFactor("4/3")).toBeCloseTo(4 / 3, 12);
    expect(parseKFactor("1")).toBe(1);
    expect(parseKFactor("2/3")).toBeCloseTo(2 / 3, 12);
    expect(parseKFactor("5")).toBe(STANDARD_K);
    expect(parseKFactor(undefined)).toBe(STANDARD_K);
  });

  it("raises the bulge and shortens the horizon in the worst case", () => {
    expect(earthBulgeM(20_000, 20_000, 2 / 3)).toBeCloseTo(2 * earthBulgeM(20_000, 20_000), 9);
    expect(lineOfSightRangeM(30, 30, 2 / 3)).toBeLessThan(lineOfSightRangeM(30, 30));
    const worst = midpointClearance(5.8e9, 40_000, 30, 30, 2 / 3);
    const standard = midpointClearance(5.8e9, 40_000, 30, 30);
    expect(standard.clearanceM - worst.clearanceM).toBeCloseTo(worst.bulgeM - standard.bulgeM, 9);
  });
});
