import { describe, expect, it } from "vitest";
import {
  beyondCableRange,
  cableLossDb,
  findCable,
  lossPer100Ft,
  powerDelivered,
  swrAtInput,
  totalLineLossDb,
} from "./coax";
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

describe("mismatch", () => {
  it("adds nothing at 1:1", () => {
    expect(totalLineLossDb(2.5, 1)).toBeCloseTo(2.5, 9);
    expect(swrAtInput(2.5, 1)).toBeCloseTo(1, 9);
  });

  it("adds about half a dB to a 1 dB line at 3:1", () => {
    // Γ = 0.5, a = 1.2589: 10·log10((1.5849 − 0.25) / (1.2589 × 0.75)) = 1.504 dB.
    expect(totalLineLossDb(1, 3)).toBeCloseTo(1.504, 2);
  });

  it("makes a 3:1 antenna look like about 2:1 through 3 dB of coax", () => {
    // Γ at the radio = 0.5 / 10^0.3 ≈ 0.2506, SWR ≈ 1.67.
    expect(swrAtInput(3, 3)).toBeCloseTo(1.669, 2);
  });

  it("rejects an SWR below 1", () => {
    expect(() => totalLineLossDb(1, 0.5)).toThrow(RangeError);
  });

  it("converts loss to delivered power", () => {
    expect(powerDelivered(3)).toBeCloseTo(0.501, 3);
    expect(powerDelivered(0)).toBe(1);
  });
});

describe("beyondCableRange", () => {
  it("flags RG cable above 1 GHz but not LMR-400 at 5.8 GHz", () => {
    expect(beyondCableRange(cable("rg-58"), toHz(2.4, "GHz"))).toBe(true);
    expect(beyondCableRange(cable("lmr-400"), toHz(5.8, "GHz"))).toBe(false);
  });
});
