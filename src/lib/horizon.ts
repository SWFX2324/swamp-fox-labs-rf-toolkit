// Line-of-sight geometry over a smooth earth. The atmosphere bends VHF and up
// slightly back toward the ground, which is modelled by using an "effective"
// earth radius k times the real one. k = 4/3 is the standard planning value.

import { wavelengthM } from "./fspl";

export const EARTH_RADIUS_M = 6_371_000;
export const STANDARD_K = 4 / 3;

/**
 * k-factor choices for clearance checks. 4/3 is the usual atmosphere; 2/3 is
 * the bad case microwave planners also check, when the air bends signals up
 * and away and the earth effectively bulges higher.
 */
export const kFactors = [
  { id: "4/3", k: 4 / 3, name: "4/3 (standard)" },
  { id: "1", k: 1, name: "1 (no bending)" },
  { id: "2/3", k: 2 / 3, name: "2/3 (worst case)" },
] as const;

/** The k-factor for a choice id, standard for anything unknown. */
export function parseKFactor(id: string | undefined): number {
  return kFactors.find((f) => f.id === id)?.k ?? STANDARD_K;
}

/** Distance from an antenna at heightM to its radio horizon, in metres. */
export function radioHorizonM(heightM: number, k = STANDARD_K): number {
  return Math.sqrt(2 * k * EARTH_RADIUS_M * Math.max(0, heightM));
}

/** Longest smooth-earth path between two antennas that still has line of sight. */
export function lineOfSightRangeM(txHeightM: number, rxHeightM: number, k = STANDARD_K): number {
  return radioHorizonM(txHeightM, k) + radioHorizonM(rxHeightM, k);
}

/** How far the earth rises above a straight chord, d1 and d2 metres from each end. */
export function earthBulgeM(d1: number, d2: number, k = STANDARD_K): number {
  return (d1 * d2) / (2 * k * EARTH_RADIUS_M);
}

/** Radius of the nth Fresnel zone at a point d1 and d2 metres from each end. */
export function fresnelRadiusM(freqHz: number, d1: number, d2: number, n = 1): number {
  return Math.sqrt((n * wavelengthM(freqHz) * d1 * d2) / (d1 + d2));
}

export interface MidpointClearance {
  /** Height of the straight antenna-to-antenna line above the bulging earth. */
  clearanceM: number;
  /** 60% of the first Fresnel zone, the usual minimum to avoid extra loss. */
  neededM: number;
  bulgeM: number;
}

/** Clearance over smooth earth at the middle of the path, ignoring terrain. */
export function midpointClearance(
  freqHz: number,
  distanceM: number,
  txHeightM: number,
  rxHeightM: number,
  k = STANDARD_K,
): MidpointClearance {
  const half = distanceM / 2;
  const bulge = earthBulgeM(half, half, k);
  return {
    clearanceM: (txHeightM + rxHeightM) / 2 - bulge,
    neededM: 0.6 * fresnelRadiusM(freqHz, half, half),
    bulgeM: bulge,
  };
}
