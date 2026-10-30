import { describe, expect, it } from "vitest";
import { earthBulgeM, fresnelRadiusM } from "./horizon";
import { analyzeProfile, sampleCount } from "./profile";

// 10 km at 915 MHz, 11 samples on flat ground at 100 m, 50 m masts. The line
// of sight sits at 150 m; the midpoint Fresnel radius is about 28.6 m.
const base = {
  freqHz: 915e6,
  distanceM: 10_000,
  txHeightM: 50,
  rxHeightM: 50,
};
const flat = () => Array.from({ length: 11 }, () => 100);
const withMidpoint = (extra: number) => {
  const e = flat();
  e[5] += extra;
  return e;
};

describe("analyzeProfile", () => {
  it("adds the earth bulge to the terrain", () => {
    const r = analyzeProfile({ ...base, elevationsM: flat() });
    expect(r.points[5].terrainM).toBeCloseTo(100 + earthBulgeM(5000, 5000), 9);
    expect(r.points[0].terrainM).toBe(100);
  });

  it("calls flat ground with tall masts clear", () => {
    const r = analyzeProfile({ ...base, elevationsM: flat() });
    expect(r.status).toBe("clear");
    expect(r.worst.distanceM).toBe(5000);
    expect(r.worst.fresnelM).toBeCloseTo(fresnelRadiusM(915e6, 5000, 5000), 9);
  });

  it("calls a hill into the Fresnel zone a Fresnel obstruction", () => {
    // 150 − (135 + 1.47) = 13.5 m clear, under 60% of 28.6 m.
    const r = analyzeProfile({ ...base, elevationsM: withMidpoint(35) });
    expect(r.status).toBe("fresnel");
    expect(r.worst.clearanceM).toBeCloseTo(13.53, 1);
  });

  it("calls a hill above the line of sight blocked", () => {
    const r = analyzeProfile({ ...base, elevationsM: withMidpoint(60) });
    expect(r.status).toBe("blocked");
    expect(r.worst.clearanceM).toBeLessThan(0);
  });

  it("slopes the line of sight between different ground heights", () => {
    const e = flat();
    e[10] = 300;
    const r = analyzeProfile({ ...base, elevationsM: e });
    expect(r.points[0].losM).toBe(150);
    expect(r.points[10].losM).toBe(350);
    expect(r.points[5].losM).toBe(250);
  });

  it("rejects too few samples", () => {
    expect(() => analyzeProfile({ ...base, elevationsM: [100] })).toThrow(RangeError);
  });
});

describe("sampleCount", () => {
  it("takes about one sample per 90 m, between 32 and 200", () => {
    expect(sampleCount(500)).toBe(32);
    expect(sampleCount(9000)).toBe(101);
    expect(sampleCount(100_000)).toBe(200);
  });
});
