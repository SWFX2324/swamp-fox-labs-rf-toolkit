// Terrain diffraction loss by the Bullington method of Recommendation ITU-R
// P.526-16, §4.5.1 (equations 49–57). The whole profile is reduced to one
// equivalent knife edge (the "Bullington point") and its loss is tapered up
// for the extra loss of real, rounded terrain.
//
// Bullington tends to under-estimate loss on rough paths with several ridges;
// P.526's complete method (§4.5.2) adds a smooth-earth term not done here.
//
// Units follow the Recommendation: distances in km, heights in m, slopes in
// m/km, wavelength in m.

import { wavelengthM } from "./fspl";
import { EARTH_RADIUS_M, STANDARD_K } from "./horizon";

/** Knife-edge loss J(ν), equation 31; zero for ν ≤ −0.78. */
export function knifeEdgeLossDb(nu: number): number {
  if (nu <= -0.78) return 0;
  return 6.9 + 20 * Math.log10(Math.sqrt((nu - 0.1) ** 2 + 1) + nu - 0.1);
}

export interface DiffractionInputs {
  freqHz: number;
  distanceM: number;
  /** Ground elevation above sea level at evenly spaced points, TX end first. */
  elevationsM: number[];
  txHeightM: number;
  rxHeightM: number;
  k?: number;
}

export interface DiffractionResult {
  /** Bullington diffraction loss for the path, Lb (equation 57). */
  lossDb: number;
  /** Knife-edge loss at the Bullington point before tapering, Luc. */
  knifeEdgeDb: number;
  /** Diffraction parameter at the Bullington point. */
  nu: number;
  /** Distance of the Bullington point from TX, metres. */
  pointM: number;
  /** True when terrain cuts the line of sight (Stim ≥ Str). */
  transHorizon: boolean;
}

export function bullingtonLoss(i: DiffractionInputs): DiffractionResult {
  const n = i.elevationsM.length;
  if (n < 3) throw new RangeError("A profile needs at least three elevation samples");
  if (!(i.distanceM > 0) || !(i.freqHz > 0)) throw new RangeError("Distance and frequency must be above zero");

  const d = i.distanceM / 1000;
  const lambda = wavelengthM(i.freqHz);
  const ce = 1 / (((i.k ?? STANDARD_K) * EARTH_RADIUS_M) / 1000);
  const hts = i.elevationsM[0] + i.txHeightM;
  const hrs = i.elevationsM[n - 1] + i.rxHeightM;

  // Intermediate points only (i = 2 … n−1), with the earth bulge added.
  const pts = i.elevationsM.slice(1, -1).map((h, idx) => {
    const di = (d * (idx + 1)) / (n - 1);
    return { di, h: h + 500 * ce * di * (d - di) };
  });

  const nuAt = (height: number, di: number) =>
    (height - (hts * (d - di) + hrs * di) / d) * Math.sqrt((0.002 * d) / (lambda * di * (d - di)));

  const stim = Math.max(...pts.map((p) => (p.h - hts) / p.di)); // (49)
  const str = (hrs - hts) / d; // (50)

  let nu: number;
  let db: number;
  if (stim < str) {
    // Case 1, line of sight: the point with the largest ν. (51)
    const best = pts.reduce((a, p) => (nuAt(p.h, p.di) > nuAt(a.h, a.di) ? p : a));
    nu = nuAt(best.h, best.di);
    db = best.di;
  } else {
    // Case 2, trans-horizon: where the steepest rays from each end meet.
    const srim = Math.max(...pts.map((p) => (p.h - hrs) / (d - p.di))); // (53)
    db = (hrs - hts + srim * d) / (stim + srim); // (54)
    nu = nuAt(hts + stim * db, db); // (55)
  }

  const luc = knifeEdgeLossDb(nu); // (52) / (56)
  const lb = luc + (1 - Math.exp(-luc / 6)) * (10 + 0.02 * d); // (57)
  return { lossDb: lb, knifeEdgeDb: luc, nu, pointM: db * 1000, transHorizon: stim >= str };
}
