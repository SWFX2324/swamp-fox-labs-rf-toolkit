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
  /** Modulation and FEC rate on their own, for filtering: "QPSK", "3/4". */
  mod: string;
  rate: string;
  family: "DVB-S2" | "DVB-S";
  bitsPerSymbol: number;
  codeRate: number;
  /** Outer code rate on top of the FEC (DVB-S's Reed-Solomon, 188/204); 1 when there's none. */
  outerRate: number;
  /** Ideal Es/N0 for quasi-error-free operation: ETSI EN 302 307-1 (DVB-S2) or EN 300 421 (DVB-S). */
  esn0: number;
}

const mc = (mod: string, bits: number, rate: string, esn0: number): Modcod => {
  const [n, d] = rate.split("/").map(Number);
  return { name: `${mod} ${rate}`, mod, rate, family: "DVB-S2", bitsPerSymbol: bits, codeRate: n / d, outerRate: 1, esn0 };
};

/** Information bits per symbol: modulation × FEC × any outer code. */
export const bitsPerSymbolNet = (m: Modcod) => m.bitsPerSymbol * m.codeRate * m.outerRate;

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

/**
 * DVB-S (EN 300 421): Viterbi inner code with Reed-Solomon (204,188) outer code,
 * quasi-error-free at these Eb/N0. BPSK with the same coding needs the same Eb/N0
 * as QPSK and carries half the bits. These cover 7/8 and BPSK, which DVB-S2 lacks.
 */
const DVBS_EBN0: [string, number][] = [["1/2", 4.5], ["2/3", 5.0], ["3/4", 5.5], ["5/6", 6.0], ["7/8", 6.4]];
const RS = 188 / 204;
const legacy = (mod: "BPSK" | "QPSK", bits: number): Modcod[] =>
  DVBS_EBN0.map(([rate, ebn0]) => {
    const [n, d] = rate.split("/").map(Number);
    const r = n / d;
    return {
      name: mod === "QPSK" ? `QPSK ${rate} (DVB-S)` : `BPSK ${rate}`,
      mod,
      rate,
      family: "DVB-S",
      bitsPerSymbol: bits,
      codeRate: r,
      outerRate: RS,
      // Es/N0 = Eb/N0 + 10 log10(information bits per symbol).
      esn0: Math.round((ebn0 + 10 * Math.log10(bits * r * RS)) * 100) / 100,
    };
  });
export const legacyModcods: Modcod[] = [...legacy("BPSK", 1), ...legacy("QPSK", 2)];

/** Every modulation and FEC the page offers: DVB-S2 first, then DVB-S and BPSK. */
export const allModcods: Modcod[] = [...dvbs2Modcods, ...legacyModcods];

/**
 * A small terminal in a star network: it talks through the satellite to a
 * gateway, where the network lives, in two directions with their own carriers.
 *
 * - Return: terminal → satellite → gateway. The terminal's uplink nearly always
 *   limits it; the gateway's large dish hears well.
 * - Forward: gateway → satellite → terminal. The terminal's downlink nearly
 *   always limits it; the gateway transmits strongly.
 *
 * The gateway is taken at the same range as the terminal, in clear sky: its
 * own weather and location aren't modelled.
 */
export interface StarLinkInputs {
  rangeM: number;
  uplinkHz: number;
  downlinkHz: number;
  dishM: number;
  efficiency: number;
  txPowerW: number;
  txFeedLossDb: number;
  pointingErrorDeg: number;
  clearSkyAntennaK: number;
  rxFeedLossDb: number;
  lnbK: number;
  /** Atmosphere and rain at your site, each way. */
  uplinkLossDb: number;
  downlinkLossDb: number;
  /** The satellite's receive G/T toward your site. */
  satGtDbK: number;
  /** Satellite downlink EIRP for the forward carrier toward you, and for your return carrier toward the gateway. */
  fwdEirpDbw: number;
  retEirpDbw: number;
  gatewayGtDbK: number;
  gatewayEirpDbw: number;
  fwd: { symbolRate: number; modcod: Modcod };
  ret: { symbolRate: number; modcod: Modcod };
  implementationLossDb: number;
}

export interface DirectionResult {
  cn0Up: number;
  cn0Down: number;
  cn0Total: number;
  esn0: number;
  requiredEsn0: number;
  marginDb: number;
  infoRateBps: number;
}

export interface StarLinkResult {
  txGainDbi: number;
  rxGainDbi: number;
  beamwidthUp: number;
  beamwidthDown: number;
  pointingLossUp: number;
  pointingLossDown: number;
  /** Your terminal's EIRP and G/T. */
  eirpDbw: number;
  terminalGtDbK: number;
  systemTempK: number;
  fsplUp: number;
  fsplDown: number;
  ret: DirectionResult;
  fwd: DirectionResult;
}

function direction(cn0Up: number, cn0Down: number, carrier: { symbolRate: number; modcod: Modcod }, implLossDb: number): DirectionResult {
  const cn0Total = combineCn0(cn0Up, cn0Down);
  const esn0 = cn0Total - 10 * Math.log10(carrier.symbolRate);
  const requiredEsn0 = carrier.modcod.esn0 + implLossDb;
  return {
    cn0Up,
    cn0Down,
    cn0Total,
    esn0,
    requiredEsn0,
    marginDb: esn0 - requiredEsn0,
    infoRateBps: carrier.symbolRate * bitsPerSymbolNet(carrier.modcod),
  };
}

export function starLinkBudget(i: StarLinkInputs): StarLinkResult {
  const txGain = dishGainDbi(i.dishM, i.uplinkHz, i.efficiency);
  const rxGain = dishGainDbi(i.dishM, i.downlinkHz, i.efficiency);
  const bwUp = beamwidthDeg(i.dishM, i.uplinkHz);
  const bwDown = beamwidthDeg(i.dishM, i.downlinkHz);
  const plUp = pointingLossDb(i.pointingErrorDeg, bwUp);
  const plDown = pointingLossDb(i.pointingErrorDeg, bwDown);
  const fsplUp = fsplDb(i.uplinkHz, i.rangeM);
  const fsplDown = fsplDb(i.downlinkHz, i.rangeM);

  // Your terminal: what it sends, and how well it hears (rain adds sky noise).
  const eirp = 10 * Math.log10(i.txPowerW) - i.txFeedLossDb + txGain - plUp;
  const tsys = systemNoiseTempK(antennaTempWithLossK(i.clearSkyAntennaK, i.downlinkLossDb), i.rxFeedLossDb, i.lnbK);
  const gt = rxGain - plDown - 10 * Math.log10(tsys);

  // Return: your uplink, then the satellite down to the gateway.
  const retUp = cn0DbHz(eirp, fsplUp + i.uplinkLossDb, i.satGtDbK);
  const retDown = cn0DbHz(i.retEirpDbw, fsplDown, i.gatewayGtDbK);
  // Forward: the gateway's uplink, then the satellite down to you.
  const fwdUp = cn0DbHz(i.gatewayEirpDbw, fsplUp, i.satGtDbK);
  const fwdDown = cn0DbHz(i.fwdEirpDbw, fsplDown + i.downlinkLossDb, gt);

  return {
    txGainDbi: txGain,
    rxGainDbi: rxGain,
    beamwidthUp: bwUp,
    beamwidthDown: bwDown,
    pointingLossUp: plUp,
    pointingLossDown: plDown,
    eirpDbw: eirp,
    terminalGtDbK: gt,
    systemTempK: tsys,
    fsplUp,
    fsplDown,
    ret: direction(retUp, retDown, i.ret, i.implementationLossDb),
    fwd: direction(fwdUp, fwdDown, i.fwd, i.implementationLossDb),
  };
}

/** Margin at or above which a link rates Good; below it, down to 0 dB, Marginal. */
export const GOOD_MARGIN_DB = 3;

/**
 * Extra rain loss at your site a direction can take before its margin reaches
 * zero, dB: on your uplink for the return, on your downlink for the forward
 * (where rain also adds sky noise, which counts). 0 when it's already short.
 */
export function fadeHeadroomDb(i: StarLinkInputs, dir: "ret" | "fwd"): number {
  const marginWith = (extra: number) =>
    starLinkBudget(dir === "ret" ? { ...i, uplinkLossDb: i.uplinkLossDb + extra } : { ...i, downlinkLossDb: i.downlinkLossDb + extra })[dir].marginDb;
  if (marginWith(0) <= 0) return 0;
  let lo = 0;
  let hi = 60;
  if (marginWith(hi) > 0) return hi;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (marginWith(mid) > 0) lo = mid;
    else hi = mid;
  }
  return lo;
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
