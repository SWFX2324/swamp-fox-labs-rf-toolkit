import { describe, expect, it } from "vitest";
import { bullingtonLoss, knifeEdgeLossDb } from "./diffraction";
import { wavelengthM } from "./fspl";
import { earthBulgeM } from "./horizon";

describe("knifeEdgeLossDb", () => {
  // Textbook values of the knife-edge curve.
  it("is about 6 dB at grazing and 13.9 dB at ν = 1", () => {
    expect(knifeEdgeLossDb(0)).toBeCloseTo(6.03, 2);
    expect(knifeEdgeLossDb(1)).toBeCloseTo(13.93, 1);
  });

  it("is zero at and below ν = −0.78", () => {
    expect(knifeEdgeLossDb(-0.78)).toBe(0);
    expect(knifeEdgeLossDb(-2)).toBe(0);
    expect(knifeEdgeLossDb(-0.7)).toBeGreaterThan(0);
  });
});

// 10 km at 915 MHz over flat ground at 100 m with 50 m masts, 101 samples so
// the midpoint is a sample. The line of sight sits at 150 m.
const base = { freqHz: 915e6, distanceM: 10_000, txHeightM: 50, rxHeightM: 50 };
const flat = () => Array.from({ length: 101 }, () => 100);
const ridge = (top: number) => {
  const e = flat();
  e[50] = top;
  return e;
};
// ν for an edge h metres above the line of sight at the midpoint.
const nuFor = (h: number) => h * Math.sqrt((2 / wavelengthM(915e6)) * (10_000 / (5000 * 5000)));

describe("bullingtonLoss", () => {
  it("has no loss for a well-cleared path", () => {
    const r = bullingtonLoss({ ...base, elevationsM: flat() });
    expect(r.transHorizon).toBe(false);
    expect(r.lossDb).toBe(0);
  });

  it("matches a single knife edge poking above the line of sight", () => {
    const top = 170;
    const r = bullingtonLoss({ ...base, elevationsM: ridge(top) });
    const h = top + earthBulgeM(5000, 5000) - 150;
    expect(r.transHorizon).toBe(true);
    expect(r.pointM).toBeCloseTo(5000, 6);
    expect(r.nu).toBeCloseTo(nuFor(h), 6);
    expect(r.knifeEdgeDb).toBeCloseTo(knifeEdgeLossDb(nuFor(h)), 6);
  });

  it("tapers the knife-edge loss up for real terrain (equation 57)", () => {
    const r = bullingtonLoss({ ...base, elevationsM: ridge(170) });
    const expected = r.knifeEdgeDb + (1 - Math.exp(-r.knifeEdgeDb / 6)) * (10 + 0.02 * 10);
    expect(r.lossDb).toBeCloseTo(expected, 9);
    expect(r.lossDb).toBeGreaterThan(r.knifeEdgeDb);
  });

  it("gives some loss for a ridge inside the Fresnel zone but below the line of sight", () => {
    const r = bullingtonLoss({ ...base, elevationsM: ridge(140) });
    expect(r.transHorizon).toBe(false);
    expect(r.lossDb).toBeGreaterThan(0);
    expect(r.knifeEdgeDb).toBeLessThan(6);
  });

  it("loses more as the ridge gets taller", () => {
    const losses = [140, 150, 170, 200].map((t) => bullingtonLoss({ ...base, elevationsM: ridge(t) }).lossDb);
    for (let j = 1; j < losses.length; j++) expect(losses[j]).toBeGreaterThan(losses[j - 1]);
  });

  it("rejects too few samples", () => {
    expect(() => bullingtonLoss({ ...base, elevationsM: [100, 100] })).toThrow(RangeError);
  });
});
