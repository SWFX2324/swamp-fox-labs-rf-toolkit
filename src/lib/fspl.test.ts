import { describe, expect, it } from "vitest";
import { distanceForLossM, fsplDb, wavelengthM } from "./fspl";
import { toHz, toMetres } from "./units";

// Reference values from the common shorthand
// FSPL = 20·log10(d_km) + 20·log10(f_MHz) + 32.45, which rounds the constant.
describe("fsplDb", () => {
  it.each([
    [2400, 1, 100.05],
    [915, 1, 91.68],
    [146, 10, 95.73],
    [5800, 0.5, 101.70],
  ])("%d MHz over %d km is %d dB", (mhz, km, expected) => {
    expect(fsplDb(toHz(mhz, "MHz"), toMetres(km, "km"))).toBeCloseTo(expected, 1);
  });

  it("adds 6 dB each time the distance doubles", () => {
    const f = toHz(915, "MHz");
    expect(fsplDb(f, 2000) - fsplDb(f, 1000)).toBeCloseTo(6.02, 2);
  });

  it("adds 6 dB each time the frequency doubles", () => {
    expect(fsplDb(2e9, 1000) - fsplDb(1e9, 1000)).toBeCloseTo(6.02, 2);
  });

  it("rejects zero and negative inputs", () => {
    expect(() => fsplDb(0, 1000)).toThrow(RangeError);
    expect(() => fsplDb(1e9, -1)).toThrow(RangeError);
    expect(() => fsplDb(Number.NaN, 1000)).toThrow(RangeError);
  });
});

describe("distanceForLossM", () => {
  it("inverts fsplDb", () => {
    const f = toHz(915, "MHz");
    expect(distanceForLossM(f, fsplDb(f, 12_345))).toBeCloseTo(12_345, 6);
  });
});

describe("wavelengthM", () => {
  it("is about 2.05 m at 146 MHz", () => {
    expect(wavelengthM(toHz(146, "MHz"))).toBeCloseTo(2.053, 3);
  });
});
