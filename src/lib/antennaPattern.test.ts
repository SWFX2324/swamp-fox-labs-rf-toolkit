import { describe, expect, it } from "vitest";
import { pattern3d, toDb, wireField } from "./antennaPattern";

describe("wire patterns", () => {
  it("a half-wave dipole peaks broadside with nulls off its ends", () => {
    expect(wireField(0.5, 90)).toBeCloseTo(1, 6);
    expect(wireField(0.5, 0)).toBe(0);
    // Half-power beamwidth of a half-wave dipole is about 78°: −3 dB near 51° from the axis.
    expect(toDb(wireField(0.5, 51))).toBeCloseTo(-3, 0);
  });

  it("a full-wave dipole has a narrower broadside lobe", () => {
    const half = wireField(0.5, 60) / wireField(0.5, 90);
    const full = wireField(1, 60) / wireField(1, 90);
    expect(full).toBeLessThan(half);
  });
});

describe("pattern3d", () => {
  it("matches the plotted views", () => {
    const d = pattern3d("dipole")!;
    // Broadside to the wire (along y) is the peak; off the end (along x) is a null.
    expect(d(90, 90)).toBeCloseTo(1, 6);
    expect(d(90, 0)).toBeCloseTo(0, 6);
    // Straight up from a horizontal wire is broadside too.
    expect(d(0, 0)).toBeCloseTo(1, 6);
    const gp = pattern3d("groundplane")!;
    expect(gp(90, 37)).toBeCloseTo(gp(90, 200), 9);
    expect(gp(120, 0)).toBe(0);
    const loop = pattern3d("loop")!;
    expect(loop(90, 90)).toBeGreaterThan(loop(0, 90));
    expect(pattern3d("coaxstub")).toBeUndefined();
  });
});

describe("every design", () => {
  it("has a 3D pattern except the coax stub", () => {
    for (const id of ["dipole", "fullwave", "efhw", "groundplane", "fiveeighths", "loop", "jpole"]) {
      const f = pattern3d(id)!;
      let peak = 0;
      for (let t = 0; t <= 180; t += 5) for (let p = 0; p < 360; p += 10) peak = Math.max(peak, f(t, p));
      expect(peak).toBeGreaterThan(0);
    }
  });
});
