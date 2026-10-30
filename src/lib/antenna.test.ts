import { describe, expect, it } from "vitest";
import { designs, elementLengths, findDesign } from "./antenna";
import { findCable } from "./coax";
import { formatFeetInches, fromMetres, toHz } from "./units";

const design = (id: string) => findDesign(id)!;
const feet = (m: number) => fromMetres(m, "ft");
// The ARRL constants correspond to these factors exactly.
const ARRL_WIRE = 468 / 491.8;
const ARRL_LOOP = 1005 / 983.6;

describe("elementLengths", () => {
  it("matches 468/f for a half-wave dipole", () => {
    const [leg, total] = elementLengths(design("dipole"), toHz(14.2, "MHz"), ARRL_WIRE);
    expect(feet(total.lengthM)).toBeCloseTo(468 / 14.2, 1);
    expect(leg.lengthM).toBeCloseTo(total.lengthM / 2, 9);
    expect(leg.count).toBe(2);
  });

  it("makes a full-wave dipole twice a half-wave one", () => {
    const f = toHz(14.2, "MHz");
    const [, half] = elementLengths(design("dipole"), f, 0.95);
    const [leg, total] = elementLengths(design("fullwave"), f, 0.95);
    expect(total.lengthM).toBeCloseTo(2 * half.lengthM, 9);
    expect(leg.lengthM).toBeCloseTo(half.lengthM, 9);
    expect(leg.count).toBe(2);
  });

  it("matches 234/f radiator and 246/f radials for a ground plane", () => {
    const [radiator, radials] = elementLengths(design("groundplane"), toHz(146, "MHz"), ARRL_WIRE);
    expect(feet(radiator.lengthM)).toBeCloseTo(234 / 146, 2);
    expect(feet(radials.lengthM)).toBeCloseTo(246 / 146, 2);
    expect(radials.count).toBe(4);
  });

  it("matches 1005/f for a full-wave loop, split into sides", () => {
    const [total, square, delta] = elementLengths(design("loop"), toHz(14.2, "MHz"), ARRL_LOOP);
    expect(feet(total.lengthM)).toBeCloseTo(1005 / 14.2, 1);
    expect(square.lengthM * 4).toBeCloseTo(total.lengthM, 9);
    expect(delta.lengthM * 3).toBeCloseTo(total.lengthM, 9);
  });

  it("makes a 5/8-wave radiator 2.5 times a quarter-wave one", () => {
    const f = toHz(146.52, "MHz");
    const [fiveEighths] = elementLengths(design("fiveeighths"), f, 0.95);
    const [quarter] = elementLengths(design("groundplane"), f, 0.95);
    expect(fiveEighths.lengthM / quarter.lengthM).toBeCloseTo(2.5, 9);
  });

  it("uses the coax velocity factor for a stub", () => {
    const vf = findCable("rg-58")!.vf;
    const [quarter] = elementLengths(design("coaxstub"), toHz(146, "MHz"), vf);
    expect(quarter.lengthM).toBeCloseTo(0.25 * (299_792_458 / 146e6) * 0.66, 9);
  });

  it("rejects a zero frequency or factor", () => {
    expect(() => elementLengths(design("dipole"), 0, 0.95)).toThrow(RangeError);
    expect(() => elementLengths(design("dipole"), 1e6, 0)).toThrow(RangeError);
  });

  it("gives every design at least one element and a sane default factor", () => {
    for (const d of designs) {
      expect(d.elements.length).toBeGreaterThan(0);
      expect(d.defaultFactor).toBeGreaterThan(0.5);
      expect(d.defaultFactor).toBeLessThan(1.1);
    }
  });
});

describe("formatFeetInches", () => {
  it("rounds to the nearest eighth of an inch", () => {
    expect(formatFeetInches(0.3048)).toBe("1′ 0″");
    expect(formatFeetInches(0.0254 * 7.5)).toBe("7½″");
    expect(formatFeetInches(0.0254 * (32 * 12 + 10.76))).toBe("32′ 10¾″");
    expect(formatFeetInches(0.0254 * 11.97)).toBe("1′ 0″");
  });
});
