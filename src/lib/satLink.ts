// Satellite link budget for a terminal working a geostationary transponder:
// uplink and downlink carrier-to-noise density, combined, against the Es/N0
// a DVB-S2 MODCOD needs. Interference (C/I) and transponder intermodulation
// are not modelled; the satellite's G/T and the carrier's downlink EIRP come
// from the access documents.

import { fsplDb, wavelengthM } from "./fspl";
import { SPEED_OF_LIGHT } from "./units";

/** Boltzmann's constant, dBW/K/Hz. */
export const BOLTZMANN_DBW = -228.6;
/** Mean temperature of the absorbing medium (rain, gas) for sky noise, K. */
const MEDIUM_TEMP_K = 275;
const T0 = 290;

/** Parabolic dish gain, dBi: η · (π D f / c)². */
export function dishGainDbi(diameterM: number, freqHz: number, efficiency: number): number {
  return 10 * Math.log10(efficiency * ((Math.PI * diameterM * freqHz) / SPEED_OF_LIGHT) ** 2);
}

/** Half-power beamwidth, degrees (≈ 70 λ / D). */
export function beamwidthDeg(diameterM: number, freqHz: number): number {
  return (70 * wavelengthM(freqHz)) / diameterM;
}

/** Gain lost to a pointing error, dB: 12 (error / beamwidth)². */
export function pointingLossDb(errorDeg: number, beamwidth: number): number {
  return 12 * (errorDeg / beamwidth) ** 2;
}

/** Antenna noise temperature after rain or gas loss adds its own noise. */
export function antennaTempWithLossK(clearSkyK: number, lossDb: number): number {
  const t = 10 ** (-lossDb / 10);
  return clearSkyK * t + MEDIUM_TEMP_K * (1 - t);
}

/** System noise temperature at the LNB input, with feed loss ahead of it. */
export function systemNoiseTempK(antennaK: number, feedLossDb: number, lnbK: number): number {
  const l = 10 ** (feedLossDb / 10);
  return antennaK / l + T0 * (1 - 1 / l) + lnbK;
}

/** Carrier-to-noise density, dB-Hz. */
export function cn0DbHz(eirpDbw: number, pathLossDb: number, gtDbK: number): number {
  return eirpDbw - pathLossDb + gtDbK - BOLTZMANN_DBW;
}

/** Combine link C/N0 values the way their noise adds. */
export function combineCn0(...dbHz: number[]): number {
  return -10 * Math.log10(dbHz.reduce((sum, x) => sum + 10 ** (-x / 10), 0));
}

export interface Modcod {
  name: string;
  bitsPerSymbol: number;
  codeRate: number;
  /** Ideal Es/N0 for quasi-error-free operation (ETSI EN 302 307-1, normal frames). */
  esn0: number;
}

const mc = (mod: string, bits: number, rate: string, esn0: number): Modcod => {
  const [n, d] = rate.split("/").map(Number);
  return { name: `${mod} ${rate}`, bitsPerSymbol: bits, codeRate: n / d, esn0 };
};

export const dvbs2Modcods: Modcod[] = [
  mc("QPSK", 2, "1/4", -2.35),
  mc("QPSK", 2, "1/3", -1.24),
  mc("QPSK", 2, "2/5", -0.3),
  mc("QPSK", 2, "1/2", 1.0),
  mc("QPSK", 2, "3/5", 2.23),
  mc("QPSK", 2, "2/3", 3.1),
  mc("QPSK", 2, "3/4", 4.03),
  mc("QPSK", 2, "4/5", 4.68),
  mc("QPSK", 2, "5/6", 5.18),
  mc("QPSK", 2, "8/9", 6.2),
  mc("QPSK", 2, "9/10", 6.42),
  mc("8PSK", 3, "3/5", 5.5),
  mc("8PSK", 3, "2/3", 6.62),
  mc("8PSK", 3, "3/4", 7.91),
  mc("8PSK", 3, "5/6", 9.35),
  mc("8PSK", 3, "8/9", 10.69),
  mc("8PSK", 3, "9/10", 10.98),
  mc("16APSK", 4, "2/3", 8.97),
  mc("16APSK", 4, "3/4", 10.21),
  mc("16APSK", 4, "4/5", 11.03),
  mc("16APSK", 4, "5/6", 11.61),
  mc("16APSK", 4, "8/9", 12.89),
  mc("16APSK", 4, "9/10", 13.13),
  mc("32APSK", 5, "3/4", 12.73),
  mc("32APSK", 5, "4/5", 13.64),
  mc("32APSK", 5, "5/6", 14.28),
  mc("32APSK", 5, "8/9", 15.69),
  mc("32APSK", 5, "9/10", 16.05),
];

export interface SatLinkInputs {
  rangeM: number;
  uplinkHz: number;
  downlinkHz: number;
  dishM: number;
  efficiency: number;
  txPowerW: number;
  txFeedLossDb: number;
  pointingErrorDeg: number;
  uplinkLossDb: number;
  satGtDbK: number;
  satEirpDbw: number;
  downlinkLossDb: number;
  clearSkyAntennaK: number;
  rxFeedLossDb: number;
  lnbK: number;
  symbolRate: number;
  modcod: Modcod;
  implementationLossDb: number;
}

export interface SatLinkResult {
  txGainDbi: number;
  rxGainDbi: number;
  beamwidthUp: number;
  beamwidthDown: number;
  pointingLossUp: number;
  pointingLossDown: number;
  eirpDbw: number;
  fsplUp: number;
  fsplDown: number;
  systemTempK: number;
  terminalGtDbK: number;
  cn0Up: number;
  cn0Down: number;
  cn0Total: number;
  esn0: number;
  requiredEsn0: number;
  marginDb: number;
  infoRateBps: number;
}

export function satLinkBudget(i: SatLinkInputs): SatLinkResult {
  const txGain = dishGainDbi(i.dishM, i.uplinkHz, i.efficiency);
  const rxGain = dishGainDbi(i.dishM, i.downlinkHz, i.efficiency);
  const bwUp = beamwidthDeg(i.dishM, i.uplinkHz);
  const bwDown = beamwidthDeg(i.dishM, i.downlinkHz);
  const plUp = pointingLossDb(i.pointingErrorDeg, bwUp);
  const plDown = pointingLossDb(i.pointingErrorDeg, bwDown);

  const eirp = 10 * Math.log10(i.txPowerW) - i.txFeedLossDb + txGain - plUp;
  const fsplUp = fsplDb(i.uplinkHz, i.rangeM);
  const cn0Up = cn0DbHz(eirp, fsplUp + i.uplinkLossDb, i.satGtDbK);

  const tsys = systemNoiseTempK(antennaTempWithLossK(i.clearSkyAntennaK, i.downlinkLossDb), i.rxFeedLossDb, i.lnbK);
  const gt = rxGain - plDown - 10 * Math.log10(tsys);
  const fsplDown = fsplDb(i.downlinkHz, i.rangeM);
  const cn0Down = cn0DbHz(i.satEirpDbw, fsplDown + i.downlinkLossDb, gt);

  const cn0Total = combineCn0(cn0Up, cn0Down);
  const esn0 = cn0Total - 10 * Math.log10(i.symbolRate);
  const required = i.modcod.esn0 + i.implementationLossDb;
  return {
    txGainDbi: txGain,
    rxGainDbi: rxGain,
    beamwidthUp: bwUp,
    beamwidthDown: bwDown,
    pointingLossUp: plUp,
    pointingLossDown: plDown,
    eirpDbw: eirp,
    fsplUp,
    fsplDown,
    systemTempK: tsys,
    terminalGtDbK: gt,
    cn0Up,
    cn0Down,
    cn0Total,
    esn0,
    requiredEsn0: required,
    marginDb: esn0 - required,
    infoRateBps: i.symbolRate * i.modcod.bitsPerSymbol * i.modcod.codeRate,
  };
}

export interface SatBand {
  label: string;
  uplinkGHz: number;
  downlinkGHz: number;
  /** Typical clear-sky gas and cloud loss each way at moderate elevation, dB. */
  clearSkyLossDb: number;
}

export const satBands: SatBand[] = [
  { label: "C", uplinkGHz: 6.175, downlinkGHz: 3.95, clearSkyLossDb: 0.1 },
  { label: "X", uplinkGHz: 8.0, downlinkGHz: 7.5, clearSkyLossDb: 0.15 },
  { label: "Ku", uplinkGHz: 14.25, downlinkGHz: 11.95, clearSkyLossDb: 0.3 },
  { label: "Ka", uplinkGHz: 29.75, downlinkGHz: 19.95, clearSkyLossDb: 0.7 },
];
