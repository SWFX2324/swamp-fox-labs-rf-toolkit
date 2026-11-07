import { describe, expect, it } from "vitest";
import { angleOff, beam, elevationAngleDeg, findPattern, patternLossDb } from "./pattern";

describe("beam", () => {
  it("narrows the vertical beam as gain rises", () => {
    // Kraus: 32 400 / (360 × G). 9 dBi (7.94×) gives about 11°.
    expect(beam("omni", 9).vBeamwidthDeg).toBeCloseTo(32400 / (360 * 10 ** 0.9), 6);
    expect(beam("omni", 2).vBeamwidthDeg).toBeGreaterThan(beam("omni", 6).vBeamwidthDeg);
    expect(beam("omni", 0).vBeamwidthDeg).toBe(90);
  });

  it("gives a directional antenna a round beam from its gain", () => {
    const b = beam("directional", 12);
    expect(b.hBeamwidthDeg).toBeCloseTo(Math.sqrt(32400 / 10 ** 1.2), 6);
    expect(b.vBeamwidthDeg).toBe(b.hBeamwidthDeg);
    expect(b.hBeamwidthDeg).toBeGreaterThan(40);
    expect(b.hBeamwidthDeg).toBeLessThan(50);
  });

  it("falls back to omni for an unknown pattern", () => {
    expect(findPattern("nope").id).toBe("omni");
  });
});

describe("patternLossDb", () => {
  it("is zero on the main beam", () => {
    expect(patternLossDb(beam("sector90", 14, 45), 45, 0)).toBe(0);
    expect(patternLossDb(beam("omni", 6), 200, 0)).toBe(0);
  });

  it("is 3 dB at the half-power beamwidth edge", () => {
    expect(patternLossDb(beam("sector90", 14, 0), 45, 0)).toBeCloseTo(3, 9);
    expect(patternLossDb(beam("sector90", 14, 350), 35, 0)).toBeCloseTo(3, 9);
  });

  it("stops at the front-to-back ratio behind the antenna", () => {
    expect(patternLossDb(beam("sector60", 16, 90), 270, 0)).toBe(25);
    expect(patternLossDb(beam("directional", 12, 0), 180, 0)).toBe(20);
  });

  it("drops off above and below the beam, and follows downtilt", () => {
    const b = beam("omni", 9);
    const half = b.vBeamwidthDeg / 2;
    expect(patternLossDb(b, 0, -half)).toBeCloseTo(3, 9);
    const tilted = beam("omni", 9, 0, 4);
    expect(patternLossDb(tilted, 0, -4)).toBe(0);
    expect(patternLossDb(tilted, 0, 0)).toBeGreaterThan(0);
    // Omni antennas still have a vertical floor.
    expect(patternLossDb(b, 0, -80)).toBe(20);
  });
});

describe("angleOff", () => {
  it("wraps across north", () => {
    expect(angleOff(350, 10)).toBe(20);
    expect(angleOff(10, 350)).toBe(-20);
    expect(Math.abs(angleOff(0, 180))).toBe(180);
  });
});

describe("elevationAngleDeg", () => {
  it("looks down from a mast, and further over the earth's curve", () => {
    // 30 m above the target, 1 km away: about −1.72°.
    expect(elevationAngleDeg(130, 100, 1000)).toBeCloseTo((Math.atan2(-30, 1000) * 180) / Math.PI - (1000 / (2 * (4 / 3) * 6371000)) * (180 / Math.PI), 9);
    expect(elevationAngleDeg(100, 100, 20000)).toBeLessThan(0);
    expect(elevationAngleDeg(100, 100, 0)).toBe(0);
  });
});
