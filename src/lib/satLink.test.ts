import { describe, expect, it } from "vitest";
import {
  antennaTempWithLossK,
  beamwidthDeg,
  cn0DbHz,
  combineCn0,
  dishGainDbi,
  dvbs2Modcods,
  allModcods,
  bitsPerSymbolNet,
  fadeHeadroomDb,
  starLinkBudget,
  pointingLossDb,
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

describe("legacy DVB-S and BPSK", () => {
  it("covers 7/8 and BPSK, with DVB-S QPSK 1/2 at Eb/N0 4.5 dB", () => {
    const q12 = allModcods.find((m) => m.name === "QPSK 1/2 (DVB-S)")!;
    // Es/N0 = 4.5 + 10 log10(2 × 1/2 × 188/204)
    expect(q12.esn0).toBeCloseTo(4.5 + 10 * Math.log10(188 / 204), 2);
    expect(allModcods.some((m) => m.rate === "7/8")).toBe(true);
    expect(allModcods.some((m) => m.mod === "BPSK")).toBe(true);
  });

  it("gives BPSK half QPSK's bits, 3 dB less Es/N0, at the same Eb/N0", () => {
    const b = allModcods.find((m) => m.name === "BPSK 3/4")!;
    const q = allModcods.find((m) => m.name === "QPSK 3/4 (DVB-S)")!;
    expect(bitsPerSymbolNet(b) * 2).toBeCloseTo(bitsPerSymbolNet(q), 9);
    expect(q.esn0 - b.esn0).toBeCloseTo(3.01, 1);
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

describe("star network: return and forward", () => {
  const qpsk34 = dvbs2Modcods.find((m) => m.name === "QPSK 3/4")!;
  const base = {
    rangeM: 37_500_000, uplinkHz: 14.25e9, downlinkHz: 11.95e9, dishM: 1.2, efficiency: 0.65, txPowerW: 4,
    txFeedLossDb: 0.5, pointingErrorDeg: 0.2, clearSkyAntennaK: 35, rxFeedLossDb: 0.2, lnbK: 60,
    uplinkLossDb: 0.3, downlinkLossDb: 0.3, satGtDbK: 2, fwdEirpDbw: 42, retEirpDbw: 30,
    gatewayGtDbK: 35, gatewayEirpDbw: 70,
    fwd: { symbolRate: 10e6, modcod: qpsk34 }, ret: { symbolRate: 2e6, modcod: qpsk34 }, implementationLossDb: 0.5,
  };

  it("ties the pieces together", () => {
    const s = starLinkBudget(base);
    expect(s.eirpDbw).toBeCloseTo(10 * Math.log10(4) - 0.5 + s.txGainDbi - s.pointingLossUp, 9);
    expect(s.ret.cn0Up).toBeCloseTo(cn0DbHz(s.eirpDbw, s.fsplUp + 0.3, 2), 9);
    expect(s.fwd.cn0Down).toBeCloseTo(cn0DbHz(42, s.fsplDown + 0.3, s.terminalGtDbK), 9);
    expect(s.ret.cn0Total).toBeCloseTo(combineCn0(s.ret.cn0Up, s.ret.cn0Down), 9);
    // 2 Msym/s is 63.01 dB; QPSK 3/4 needs 4.03 dB plus 0.5 dB implementation loss.
    expect(s.ret.esn0).toBeCloseTo(s.ret.cn0Total - 63.01, 2);
    expect(s.ret.marginDb).toBeCloseTo(s.ret.esn0 - 4.53, 9);
    expect(s.ret.infoRateBps).toBeCloseTo(3e6, 0);
  });

  it("lands a typical Ku terminal in a sensible range", () => {
    const s = starLinkBudget(base);
    expect(s.eirpDbw).toBeGreaterThan(45);
    expect(s.eirpDbw).toBeLessThan(50);
    expect(s.terminalGtDbK).toBeGreaterThan(19);
    expect(s.terminalGtDbK).toBeLessThan(23);
  });

  it("loses margin to rain in both directions", () => {
    const clear = starLinkBudget(base);
    const rain = starLinkBudget({ ...base, uplinkLossDb: 5, downlinkLossDb: 4 });
    expect(rain.ret.marginDb).toBeLessThan(clear.ret.marginDb - 3);
    expect(rain.fwd.marginDb).toBeLessThan(clear.fwd.marginDb - 3);
    expect(rain.systemTempK).toBeGreaterThan(clear.systemTempK);
  });

  it("is limited by your terminal in each direction, as a small terminal is", () => {
    const s = starLinkBudget(base);
    expect(s.ret.cn0Up).toBeLessThan(s.ret.cn0Down);
    expect(s.fwd.cn0Down).toBeLessThan(s.fwd.cn0Up);
    // Each direction alone does better than both terminal legs combined.
    const loopback = combineCn0(s.ret.cn0Up, s.fwd.cn0Down) - 10 * Math.log10(2e6) - 4.53;
    expect(s.ret.marginDb).toBeGreaterThan(loopback);
  });

  it("finds the rain each direction can take", () => {
    for (const dir of ["ret", "fwd"] as const) {
      const x = fadeHeadroomDb(base, dir);
      expect(x).toBeGreaterThan(0);
      const at = starLinkBudget(dir === "ret" ? { ...base, uplinkLossDb: 0.3 + x } : { ...base, downlinkLossDb: 0.3 + x });
      expect(at[dir].marginDb).toBeCloseTo(0, 3);
    }
    expect(fadeHeadroomDb({ ...base, txPowerW: 0.001 }, "ret")).toBe(0);
  });
});
