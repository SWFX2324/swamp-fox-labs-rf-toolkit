import { describe, expect, it } from "vitest";
import { fsplDb } from "./fspl";
import { lineOfSightRangeM } from "./horizon";
import { type LinkInputs, freeSpaceApplies, linkBudget, rateMargin } from "./linkBudget";
import { dbmToWatts, toDbm, wattsToDbm } from "./units";

const inputs: LinkInputs = {
  freqHz: 915e6,
  distanceM: 1000,
  txPowerDbm: 30,
  txCableLossDb: 2,
  txOtherLossDb: 1,
  txGainDbi: 6,
  extraPathLossDb: 0,
  rxGainDbi: 6,
  rxCableLossDb: 2,
  rxOtherLossDb: 1,
  rxSensitivityDbm: -100,
  fadeMarginDb: 10,
  // High enough that the horizon (~260 km) is past the budget range.
  txHeightM: 1000,
  rxHeightM: 1000,
};

describe("linkBudget", () => {
  const r = linkBudget(inputs);

  it("adds up EIRP from the transmit side", () => {
    expect(r.eirpDbm).toBe(33);
  });

  it("carries the signal through the path and receive side", () => {
    expect(r.fsplDb).toBeCloseTo(91.68, 2);
    expect(r.rxIsotropicDbm).toBeCloseTo(33 - 91.68, 2);
    expect(r.rslDbm).toBeCloseTo(-55.68, 2);
    expect(r.marginDb).toBeCloseTo(44.32, 2);
  });

  it("finds the range that leaves exactly the fade margin", () => {
    // 33 + 6 − 2 − 1 + 100 − 10 = 126 dB of free-space loss allowed.
    expect(fsplDb(inputs.freqHz, r.maxRangeM)).toBeCloseTo(126, 6);
    expect(r.maxRangeM / 1000).toBeCloseTo(52.0, 1);
  });

  it("says the budget sets the range when the horizon is farther", () => {
    expect(r.rangeLimit).toBe("budget");
    expect(r.beyondHorizon).toBe(false);
  });

  it("caps the range at the radio horizon for low antennas", () => {
    const low = linkBudget({ ...inputs, txHeightM: 10, rxHeightM: 10 });
    expect(low.rangeLimit).toBe("horizon");
    expect(low.maxRangeM).toBeCloseTo(lineOfSightRangeM(10, 10), 6);
    expect(low.maxRangeM / 1000).toBeCloseTo(26.1, 1);
  });

  it("flags a path longer than the horizon", () => {
    const far = linkBudget({ ...inputs, distanceM: 40_000, txHeightM: 10, rxHeightM: 10 });
    expect(far.beyondHorizon).toBe(true);
  });

  it("subtracts extra path loss one for one", () => {
    const worse = linkBudget({ ...inputs, extraPathLossDb: 15 });
    expect(r.rslDbm - worse.rslDbm).toBeCloseTo(15, 9);
    expect(r.marginDb - worse.marginDb).toBeCloseTo(15, 9);
  });
});

describe("rateMargin", () => {
  it.each([
    [25, "good"],
    [20, "good"],
    [12, "fair"],
    [3, "marginal"],
    [0, "marginal"],
    [-1, "fail"],
  ])("%d dB is %s", (db, rating) => {
    expect(rateMargin(db)).toBe(rating);
  });
});

describe("freeSpaceApplies", () => {
  it("is false on HF and true from 6 m up", () => {
    expect(freeSpaceApplies(7.1e6)).toBe(false);
    expect(freeSpaceApplies(28.4e6)).toBe(false);
    expect(freeSpaceApplies(30e6)).toBe(true);
    expect(freeSpaceApplies(50.1e6)).toBe(true);
  });
});

describe("power units", () => {
  it("converts watts and dBm", () => {
    expect(wattsToDbm(1)).toBeCloseTo(30, 9);
    expect(wattsToDbm(5)).toBeCloseTo(36.99, 2);
    expect(dbmToWatts(40)).toBeCloseTo(10, 9);
    expect(toDbm(100, "mW")).toBeCloseTo(20, 9);
    expect(toDbm(27, "dBm")).toBe(27);
  });
});
