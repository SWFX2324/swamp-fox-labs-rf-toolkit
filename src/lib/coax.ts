// Coax attenuation. Matched-line loss per 100 ft follows
//
//   loss = k1·√f + k2·f   (f in MHz)
//
// where k1 is conductor loss and k2 is dielectric loss. This ignores the extra
// loss from a high SWR, so it is the best case for a well-matched antenna.

import { toMetres } from "./units";

export interface Cable {
  id: string;
  name: string;
  /** dB per 100 ft per √MHz. */
  k1: number;
  /** dB per 100 ft per MHz. */
  k2: number;
  /** Highest frequency the coefficients are good for, MHz. */
  maxMHz: number;
  /** Velocity factor: signal speed in the cable as a fraction of c. */
  vf: number;
}

// LMR coefficients are as published in the Times Microwave Communications Coax
// Selection Guide. The RG figures are least-squares fits to the typical
// attenuation in that guide's table from 30 to 900 MHz (within ~0.3 dB).
// Actual RG cable varies a lot by manufacturer. LMR velocity factors are from
// the same guide; RG-58 and RG-213 are solid PE (0.66) and RG-8X is a typical
// foam figure.
export const cables: Cable[] = [
  { id: "lmr-100a", name: "LMR-100A", k1: 0.70914, k2: 0.00174, maxMHz: 6000, vf: 0.66 },
  { id: "lmr-195", name: "LMR-195", k1: 0.35686, k2: 0.00047, maxMHz: 6000, vf: 0.8 },
  { id: "lmr-200", name: "LMR-200", k1: 0.3209, k2: 0.00033, maxMHz: 6000, vf: 0.83 },
  { id: "lmr-240", name: "LMR-240", k1: 0.24208, k2: 0.00033, maxMHz: 6000, vf: 0.84 },
  { id: "lmr-300", name: "LMR-300", k1: 0.19193, k2: 0.00033, maxMHz: 6000, vf: 0.85 },
  { id: "lmr-400", name: "LMR-400", k1: 0.12229, k2: 0.00026, maxMHz: 6000, vf: 0.85 },
  { id: "lmr-500", name: "LMR-500", k1: 0.09659, k2: 0.00026, maxMHz: 6000, vf: 0.86 },
  { id: "lmr-600", name: "LMR-600", k1: 0.07555, k2: 0.00026, maxMHz: 6000, vf: 0.87 },
  { id: "lmr-900", name: "LMR-900", k1: 0.05177, k2: 0.00016, maxMHz: 5000, vf: 0.87 },
  { id: "lmr-1200", name: "LMR-1200", k1: 0.03737, k2: 0.00016, maxMHz: 3000, vf: 0.88 },
  { id: "lmr-1700", name: "LMR-1700", k1: 0.02646, k2: 0.00016, maxMHz: 2500, vf: 0.89 },
  { id: "rg-58", name: "RG-58 (typical)", k1: 0.43741, k2: 0.00365, maxMHz: 1000, vf: 0.66 },
  { id: "rg-8x", name: "RG-8X (typical)", k1: 0.35817, k2: 0.0023, maxMHz: 1000, vf: 0.78 },
  { id: "rg-213", name: "RG-213 (typical)", k1: 0.20474, k2: 0.00204, maxMHz: 1000, vf: 0.66 },
];

export function findCable(id: string): Cable | undefined {
  return cables.find((c) => c.id === id);
}

/** Matched loss in dB per 100 ft at freqHz. */
export function lossPer100Ft(cable: Cable, freqHz: number): number {
  const mhz = freqHz / 1e6;
  return cable.k1 * Math.sqrt(mhz) + cable.k2 * mhz;
}

/** Matched loss in dB for a run of lengthM metres at freqHz. */
export function cableLossDb(cable: Cable, freqHz: number, lengthM: number): number {
  if (!(freqHz > 0) || !(lengthM >= 0)) {
    throw new RangeError("Frequency must be above zero and length zero or more");
  }
  return (lossPer100Ft(cable, freqHz) * lengthM) / toMetres(100, "ft");
}

/**
 * Total line loss with a mismatched load (ARRL Antenna Book):
 *
 *   loss = 10·log10[(a² − |Γ|²) / (a·(1 − |Γ|²))],  a = 10^(matched/10)
 *
 * where Γ is the reflection coefficient at the antenna end. Reflected power
 * crosses the line twice, so a high SWR costs more in lossy coax.
 */
export function totalLineLossDb(matchedLossDb: number, swrAtLoad: number): number {
  const gamma = reflectionCoefficient(swrAtLoad);
  const a = 10 ** (matchedLossDb / 10);
  return 10 * Math.log10((a * a - gamma * gamma) / (a * (1 - gamma * gamma)));
}

/**
 * SWR seen at the radio end. Line loss soaks up some of the reflection on
 * the way back, so a lossy line makes a bad antenna look better than it is.
 */
export function swrAtInput(matchedLossDb: number, swrAtLoad: number): number {
  const gamma = reflectionCoefficient(swrAtLoad) * 10 ** (-matchedLossDb / 10);
  return (1 + gamma) / (1 - gamma);
}

function reflectionCoefficient(swr: number): number {
  if (!(swr >= 1)) throw new RangeError("SWR must be 1 or more");
  return Number.isFinite(swr) ? (swr - 1) / (swr + 1) : 1;
}

/** Fraction of input power that reaches the far end for a loss in dB. */
export function powerDelivered(lossDb: number): number {
  return 10 ** (-lossDb / 10);
}

/** True when freqHz is above the range the cable's coefficients cover. */
export function beyondCableRange(cable: Cable, freqHz: number): boolean {
  return freqHz / 1e6 > cable.maxMHz;
}
