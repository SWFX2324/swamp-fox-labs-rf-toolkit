import { describe, expect, it } from "vitest";
import p2pCases from "./fixtures/itm_p2p.csv?raw";
import pflRows from "./fixtures/itm_pfls.csv?raw";
import { Climate, ItmError, Mdvar, PropMode, inverseCcdf, itmP2P, lossAtPercentages } from "./itm";

// NTIA's own test cases for ITM_P2P_TLS (p2p.csv, pfls.csv from github.com/NTIA/itm).
const header = p2pCases.trim().split(/\r?\n/)[0].split(",");
const cases = p2pCases
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map((line) => Object.fromEntries(line.split(",").map((v, k) => [header[k], Number(v)])));
const profiles = pflRows
  .trim()
  .split(/\r?\n/)
  .map((line) => line.split(",").map(Number));

describe("ITM point-to-point against NTIA's test cases", () => {
  cases.forEach((c, n) => {
    it(`case ${n + 1}: ${c.f__mhz} MHz, climate ${c.climate}`, () => {
      const pfl = profiles[n];
      const r = itmP2P({
        txHeightM: c.h_tx__meter,
        rxHeightM: c.h_rx__meter,
        elevationsM: pfl.slice(2),
        distanceM: pfl[0] * pfl[1],
        freqMhz: c.f__mhz,
        climate: c.climate,
        refractivityN: c.N_0,
        polarization: c.pol === 1 ? "vertical" : "horizontal",
        permittivity: c.epsilon,
        conductivity: c.sigma,
        mdvar: c.mdvar,
        time: c.time,
        location: c.location,
        situation: c.situation,
      });
      expect(r.lossDb).toBeCloseTo(c.A__db, 2);
    });
  });
});

// NTIA's command-line example (cmd_examples/i_p2ptls.txt, pfl.txt, o_p2ptls.txt).
const examplePfl = [142,25.6,1692,1692,1693,1693,1693,1693,1693,1693,1694,1694,1694,1694,1694,1694,1694,1694,1694,1695,1695,1695,1695,1695,1695,1695,1695,1696,1696,1696,1696,1696,1696,1697,1697,1697,1697,1697,1697,1697,1697,1697,1697,1698,1698,1698,1698,1698,1698,1698,1698,1698,1698,1699,1699,1699,1699,1699,1699,1700,1700,1700,1700,1700,1700,1700,1701,1701,1701,1701,1701,1701,1702,1702,1702,1702,1702,1702,1702,1702,1703,1703,1703,1703,1703,1703,1703,1703,1703,1704,1704,1704,1704,1704,1704,1704,1704,1705,1705,1705,1705,1705,1705,1705,1705,1705,1705,1706,1706,1706,1706,1706,1706,1706,1706,1706,1707,1707,1707,1707,1707,1707,1707,1708,1708,1708,1708,1708,1708,1708,1708,1709,1709,1709,1709,1709,1710,1710,1710,1710,1710,1710,1710,1710,1709];

describe("ITM intermediate values against NTIA's worked example", () => {
  const r = itmP2P({
    txHeightM: 15,
    rxHeightM: 3,
    elevationsM: examplePfl.slice(2),
    distanceM: examplePfl[0] * examplePfl[1],
    freqMhz: 3500,
    climate: Climate.ContinentalTemperate,
    refractivityN: 301,
    polarization: "vertical",
    permittivity: 15,
    conductivity: 0.005,
    mdvar: Mdvar.Accidental,
    time: 50,
    location: 50,
    situation: 50,
  });

  it("matches the published results", () => {
    expect(r.lossDb).toBeCloseTo(114.5, 1);
    expect(r.freeSpaceDb).toBeCloseTo(114.5, 1);
    expect(r.referenceDb).toBeCloseTo(0, 1);
    expect(r.mode).toBe(PropMode.LineOfSight);
    expect(r.warnings).toBe(0);
    expect(r.horizonAnglesRad[0] * 1000).toBeCloseTo(-1.949, 3);
    expect(r.horizonAnglesRad[1] * 1000).toBeCloseTo(-0.856, 3);
    expect(Math.round(r.horizonDistancesM[0])).toBe(14868);
    expect(Math.round(r.horizonDistancesM[1])).toBe(6494);
    expect(r.effectiveHeightsM[0]).toBeCloseTo(15.0, 1);
    expect(r.effectiveHeightsM[1]).toBeCloseTo(3.0, 1);
    expect(r.surfaceRefractivityN).toBeCloseTo(251.5, 1);
    expect(r.deltaHM).toBeCloseTo(3.2, 1);
  });

  it("gives the same loss again from lossAtPercentages", () => {
    expect(lossAtPercentages(r, 50, 50, 50)).toBeCloseTo(r.lossDb, 9);
  });

  it("needs more loss allowance for higher reliability", () => {
    expect(lossAtPercentages(r, 90, 50, 50)).toBeGreaterThan(lossAtPercentages(r, 50, 50, 50));
    expect(lossAtPercentages(r, 50, 50, 90)).toBeGreaterThan(lossAtPercentages(r, 50, 50, 50));
  });
});

describe("ITM helpers and input checks", () => {
  it("inverts the complementary normal distribution", () => {
    expect(inverseCcdf(0.5)).toBeCloseTo(0, 3);
    expect(inverseCcdf(0.1)).toBeCloseTo(1.2816, 3);
    expect(inverseCcdf(0.9)).toBeCloseTo(-1.2816, 3);
  });

  const base = {
    txHeightM: 10,
    rxHeightM: 2,
    elevationsM: [100, 120, 110, 105, 100],
    distanceM: 4000,
    freqMhz: 450,
    climate: Climate.ContinentalTemperate,
    refractivityN: 301,
    polarization: "vertical" as const,
    permittivity: 15,
    conductivity: 0.005,
    mdvar: 12,
    time: 50,
    location: 50,
    situation: 50,
  };

  it("rejects inputs outside ITM's range", () => {
    expect(() => itmP2P({ ...base, freqMhz: 10 })).toThrow(ItmError);
    expect(() => itmP2P({ ...base, txHeightM: 0.2 })).toThrow(ItmError);
    expect(() => itmP2P({ ...base, time: 100 })).toThrow(ItmError);
    expect(() => itmP2P({ ...base, elevationsM: [1, 2] })).toThrow(ItmError);
  });

  it("runs on a short profile", () => {
    const r = itmP2P(base);
    expect(r.lossDb).toBeGreaterThan(r.freeSpaceDb - 10);
    expect(Number.isFinite(r.lossDb)).toBe(true);
  });
});
