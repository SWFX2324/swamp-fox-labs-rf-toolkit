import { describe, expect, it } from "vitest";
import { beyondCableRange, cableLossDb, findCable, lossPer100Ft } from "./coax";
import { toHz, toMetres } from "./units";

const cable = (id: string) => findCable(id)!;

describe("lossPer100Ft", () => {
  // Published Times Microwave figures, dB per 100 ft.
  it.each([
    ["lmr-400", 150, 1.5],
    ["lmr-400", 900, 3.9],
    ["lmr-400", 2400, 6.6],
    ["lmr-240", 900, 7.6],
    ["lmr-195", 900, 11.1],
    ["lmr-100a", 900, 22.8],
  ])("%s at %d MHz is about %d dB", (id, mhz, expected) => {
    expect(lossPer100Ft(cable(id), toHz(mhz, "MHz"))).toBeCloseTo(expected, 0);
  });

  it("puts the RG fits close to the guide's table", () => {
    expect(lossPer100Ft(cable("rg-58"), toHz(450, "MHz"))).toBeCloseTo(10.6, 0);
    expect(lossPer100Ft(cable("rg-8x"), toHz(150, "MHz"))).toBeCloseTo(4.7, 0);
    expect(lossPer100Ft(cable("rg-213"), toHz(900, "MHz"))).toBeCloseTo(8.0, 0);
  });
});

describe("cableLossDb", () => {
  it("scales with length", () => {
    const f = toHz(915, "MHz");
    const per100 = lossPer100Ft(cable("lmr-400"), f);
    expect(cableLossDb(cable("lmr-400"), f, toMetres(100, "ft"))).toBeCloseTo(per100, 9);
    expect(cableLossDb(cable("lmr-400"), f, toMetres(25, "ft"))).toBeCloseTo(per100 / 4, 9);
  });

  it("is zero for a zero-length run", () => {
    expect(cableLossDb(cable("rg-58"), 1e8, 0)).toBe(0);
  });

  it("rejects bad inputs", () => {
    expect(() => cableLossDb(cable("rg-58"), 0, 10)).toThrow(RangeError);
    expect(() => cableLossDb(cable("rg-58"), 1e8, -1)).toThrow(RangeError);
  });
});

describe("beyondCableRange", () => {
  it("flags RG cable above 1 GHz but not LMR-400 at 5.8 GHz", () => {
    expect(beyondCableRange(cable("rg-58"), toHz(2.4, "GHz"))).toBe(true);
    expect(beyondCableRange(cable("lmr-400"), toHz(5.8, "GHz"))).toBe(false);
  });
});
