import { describe, expect, it } from "vitest";
import {
  antennaTempWithLossK,
  beamwidthDeg,
  cn0DbHz,
  combineCn0,
  dishGainDbi,
  dvbs2Modcods,
  pointingLossDb,
  satLinkBudget,
  systemNoiseTempK,
} from "./satLink";

describe("dish", () => {
  it("gives about 41.7 dBi for a 1.2 m dish at 12 GHz, 65% efficient", () => {
    expect(dishGainDbi(1.2, 12e9, 0.65)).toBeCloseTo(41.7, 1);
  });

  it("adds 6 dB per doubling of diameter", () => {
    expect(dishGainDbi(2.4, 12e9, 0.65) - dishGainDbi(1.2, 12e9, 0.65)).toBeCloseTo(6.02, 2);
  });

  it("gives about a 1.46° beam for 1.2 m at 12 GHz", () => {
    expect(beamwidthDeg(1.2, 12e9)).toBeCloseTo(1.46, 2);
  });

  it("loses 3 dB at half the beamwidth off axis", () => {
    expect(pointingLossDb(0.73, 1.46)).toBeCloseTo(3, 9);
  });
});

describe("noise", () => {
  it("adds feed loss noise ahead of the LNB", () => {
    expect(systemNoiseTempK(35, 0, 60)).toBe(95);
    expect(systemNoiseTempK(35, 0.5, 60)).toBeCloseTo(122.7, 1);
  });

  it("raises sky noise in rain", () => {
    expect(antennaTempWithLossK(0, 3)).toBeCloseTo(137.2, 1);
    expect(antennaTempWithLossK(35, 0)).toBe(35);
  });
});

describe("C/N0", () => {
  it("adds EIRP, path loss, G/T and Boltzmann", () => {
    expect(cn0DbHz(50, 205.6, 2)).toBeCloseTo(75, 9);
  });

  it("combines two equal links 3 dB down", () => {
    expect(combineCn0(80, 80)).toBeCloseTo(76.99, 2);
  });

  it("is dominated by the weaker link", () => {
    expect(combineCn0(90, 70)).toBeCloseTo(69.96, 2);
  });
});

describe("dvbs2Modcods", () => {
  it("has the 28 DVB-S2 MODCODs with QPSK 3/4 at 4.03 dB", () => {
    expect(dvbs2Modcods).toHaveLength(28);
    expect(dvbs2Modcods.find((m) => m.name === "QPSK 3/4")!.esn0).toBe(4.03);
  });

  it("needs more Es/N0 for higher rates within a modulation", () => {
    for (const mod of ["QPSK", "8PSK", "16APSK", "32APSK"]) {
      const list = dvbs2Modcods.filter((m) => m.name.startsWith(`${mod} `));
      for (let j = 1; j < list.length; j++) expect(list[j].esn0).toBeGreaterThan(list[j - 1].esn0);
    }
  });
});

describe("satLinkBudget", () => {
  const qpsk34 = dvbs2Modcods.find((m) => m.name === "QPSK 3/4")!;
  const base = {
    rangeM: 37_500_000,
    uplinkHz: 14.25e9,
    downlinkHz: 11.95e9,
    dishM: 1.2,
    efficiency: 0.65,
    txPowerW: 4,
    txFeedLossDb: 0.5,
    pointingErrorDeg: 0.2,
    uplinkLossDb: 0.3,
    satGtDbK: 2,
    satEirpDbw: 42,
    downlinkLossDb: 0.3,
    clearSkyAntennaK: 35,
    rxFeedLossDb: 0.2,
    lnbK: 60,
    symbolRate: 2e6,
    modcod: qpsk34,
    implementationLossDb: 0.5,
  };

  it("ties the pieces together", () => {
    const r = satLinkBudget(base);
    expect(r.eirpDbw).toBeCloseTo(10 * Math.log10(4) - 0.5 + r.txGainDbi - r.pointingLossUp, 9);
    expect(r.cn0Total).toBeCloseTo(combineCn0(r.cn0Up, r.cn0Down), 9);
    expect(r.esn0).toBeCloseTo(r.cn0Total - 63.01, 2);
    expect(r.marginDb).toBeCloseTo(r.esn0 - 4.53, 9);
    expect(r.infoRateBps).toBeCloseTo(3e6, 0);
  });

  it("lands a typical Ku VSAT in a sensible range", () => {
    const r = satLinkBudget(base);
    expect(r.eirpDbw).toBeGreaterThan(45);
    expect(r.eirpDbw).toBeLessThan(50);
    expect(r.terminalGtDbK).toBeGreaterThan(19);
    expect(r.terminalGtDbK).toBeLessThan(23);
  });

  it("loses margin to rain on both links", () => {
    const clear = satLinkBudget(base);
    const rain = satLinkBudget({ ...base, uplinkLossDb: 5, downlinkLossDb: 4 });
    expect(rain.marginDb).toBeLessThan(clear.marginDb - 3);
    expect(rain.systemTempK).toBeGreaterThan(clear.systemTempK);
  });
});
