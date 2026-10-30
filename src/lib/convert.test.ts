import { describe, expect, it } from "vitest";
import {
  dbToPowerRatio,
  dbToVoltageRatio,
  dbdToDbi,
  dbiToDbd,
  dbmToDbw,
  dbmToMicrovolts,
  gammaToReturnLoss,
  gammaToSwr,
  microvoltsToDbm,
  mismatchLossDb,
  returnLossToGamma,
  sMeter,
  swrToGamma,
} from "./convert";

describe("power", () => {
  it("puts 1 µV at −107 dBm and 50 µV at −73 dBm into 50 Ω", () => {
    expect(microvoltsToDbm(1)).toBeCloseTo(-107.0, 1);
    expect(microvoltsToDbm(50)).toBeCloseTo(-73.0, 1);
    expect(dbmToMicrovolts(-93)).toBeCloseTo(5.0, 1);
  });

  it("round-trips microvolts", () => {
    expect(dbmToMicrovolts(microvoltsToDbm(0.25))).toBeCloseTo(0.25, 9);
  });

  it("converts dBm to dBW", () => {
    expect(dbmToDbw(30)).toBe(0);
  });
});

describe("sMeter", () => {
  it("follows the IARU S9 points and 6 dB per unit", () => {
    expect(sMeter(-73, "hf")).toBe("S9");
    expect(sMeter(-79, "hf")).toBe("S8");
    expect(sMeter(-53, "hf")).toBe("S9+20 dB");
    expect(sMeter(-93, "vhf")).toBe("S9");
    expect(sMeter(-141, "vhf")).toBe("S1");
    expect(sMeter(-150, "vhf")).toBe("below S1");
  });
});

describe("gain", () => {
  it("puts a dipole at 2.15 dBi", () => {
    expect(dbdToDbi(0)).toBe(2.15);
    expect(dbiToDbd(2.15)).toBe(0);
  });
});

describe("mismatch", () => {
  it("gives the usual figures for 2:1", () => {
    const g = swrToGamma(2);
    expect(g).toBeCloseTo(1 / 3, 9);
    expect(gammaToReturnLoss(g)).toBeCloseTo(9.54, 2);
    expect(mismatchLossDb(g)).toBeCloseTo(0.51, 2);
    expect(g * g).toBeCloseTo(0.111, 3);
  });

  it("gives 14 dB return loss for 1.5:1", () => {
    expect(gammaToReturnLoss(swrToGamma(1.5))).toBeCloseTo(13.98, 2);
  });

  it("round-trips through return loss", () => {
    expect(gammaToSwr(returnLossToGamma(gammaToReturnLoss(swrToGamma(3))))).toBeCloseTo(3, 9);
  });

  it("treats a total reflection as infinite SWR", () => {
    expect(gammaToSwr(1)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("ratios", () => {
  it("doubles power at 3 dB and voltage at 6 dB", () => {
    expect(dbToPowerRatio(3)).toBeCloseTo(1.995, 3);
    expect(dbToVoltageRatio(6)).toBeCloseTo(1.995, 3);
  });
});
