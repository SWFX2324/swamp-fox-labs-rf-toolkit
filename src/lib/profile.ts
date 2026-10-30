// Terrain profile analysis. Given ground elevations sampled evenly along the
// path, find how well the straight line between the antenna tops clears the
// terrain and the first Fresnel zone.
//
// The earth's curve is applied by raising each terrain sample by the earth
// bulge at that point, so the line of sight can stay a straight line.

import { earthBulgeM, fresnelRadiusM, STANDARD_K } from "./horizon";

export interface ProfileInputs {
  freqHz: number;
  distanceM: number;
  /** Ground elevation above sea level at evenly spaced points, TX end first. */
  elevationsM: number[];
  txHeightM: number;
  rxHeightM: number;
  k?: number;
}

export interface ProfilePoint {
  distanceM: number;
  /** Ground elevation plus earth bulge, metres. */
  terrainM: number;
  /** Height of the antenna-to-antenna line, metres. */
  losM: number;
  /** Radius of the first Fresnel zone here, metres. */
  fresnelM: number;
  /** losM − terrainM: negative means the terrain blocks the line of sight. */
  clearanceM: number;
  /** clearanceM as a fraction of the first Fresnel zone radius. */
  clearanceRatio: number;
}

export type ProfileStatus = "clear" | "fresnel" | "blocked";

export interface ProfileResult {
  points: ProfilePoint[];
  /** The point with the least clearance relative to its Fresnel zone. */
  worst: ProfilePoint;
  /**
   * clear: 60% of the first Fresnel zone is free everywhere.
   * fresnel: line of sight is clear but terrain eats into the Fresnel zone.
   * blocked: terrain cuts the line of sight.
   */
  status: ProfileStatus;
  txGroundM: number;
  rxGroundM: number;
}

/** 60% of the first Fresnel zone clear is the usual goal for no extra loss. */
export const FRESNEL_CLEAR_RATIO = 0.6;

export function analyzeProfile(i: ProfileInputs): ProfileResult {
  const n = i.elevationsM.length;
  if (n < 2) throw new RangeError("A profile needs at least two elevation samples");
  if (!(i.distanceM > 0) || !(i.freqHz > 0)) throw new RangeError("Distance and frequency must be above zero");
  const k = i.k ?? STANDARD_K;

  const txTop = i.elevationsM[0] + i.txHeightM;
  const rxTop = i.elevationsM[n - 1] + i.rxHeightM;

  const points = i.elevationsM.map((elevation, idx): ProfilePoint => {
    const d1 = (i.distanceM * idx) / (n - 1);
    const d2 = i.distanceM - d1;
    const terrain = elevation + earthBulgeM(d1, d2, k);
    const los = txTop + ((rxTop - txTop) * d1) / i.distanceM;
    const fresnel = d1 > 0 && d2 > 0 ? fresnelRadiusM(i.freqHz, d1, d2) : 0;
    const clearance = los - terrain;
    return {
      distanceM: d1,
      terrainM: terrain,
      losM: los,
      fresnelM: fresnel,
      clearanceM: clearance,
      clearanceRatio: fresnel > 0 ? clearance / fresnel : Number.POSITIVE_INFINITY,
    };
  });

  // The end points sit under the antennas, so judge only the path between them.
  const inner = points.slice(1, -1);
  const worst = inner.reduce((a, b) => (b.clearanceRatio < a.clearanceRatio ? b : a), inner[0] ?? points[0]);
  const status: ProfileStatus = inner.some((p) => p.clearanceM < 0)
    ? "blocked"
    : worst.clearanceRatio < FRESNEL_CLEAR_RATIO
      ? "fresnel"
      : "clear";

  return { points, worst, status, txGroundM: i.elevationsM[0], rxGroundM: i.elevationsM[n - 1] };
}

/** How many samples to take: about one per 90 m of DEM, within sane bounds. */
export function sampleCount(distanceM: number): number {
  return Math.min(200, Math.max(32, Math.ceil(distanceM / 90) + 1));
}
