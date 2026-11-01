// Environment profiles: a planning estimate of the loss from what surrounds
// each antenna, by the height gain terminal correction model of Recommendation
// ITU-R P.2108-1, §3.1 (equations 1–2g). It applies at each end of a path, for
// 30 MHz to 3 GHz, and is zero once an antenna clears the clutter. The path
// itself must then be calculated from the top of the clutter (see
// effectiveHeightM), which keeps terrain diffraction from counting ground
// effects twice.

import { knifeEdgeLossDb } from "./diffraction";

export interface Environment {
  id: string;
  name: string;
  /** Representative clutter height R, metres. */
  clutterHeightM: number;
  /**
   * "diffraction": signal comes down over buildings or trees (equation 2a).
   * "ground": open ground, height-gain from reflections (equation 2b).
   * "none": no correction at all.
   */
  model: "diffraction" | "ground" | "none";
}

// R and the model are P.2108's Table 3 defaults, mapped to these names: water
// to Water/sea, fields and desert to Open/rural, light vegetation and suburban
// to Suburban, urban to Urban/trees/forest. Dense vegetation uses the Dense
// urban height of 20 m, which sits closest to the forest measurements in
// ITU-R P.833-10 Table 1 and suits tall canopy.
export const environments: Environment[] = [
  { id: "none", name: "None (bare terrain)", clutterHeightM: 0, model: "none" },
  { id: "water", name: "Open Water", clutterHeightM: 10, model: "ground" },
  { id: "fields", name: "Open Fields", clutterHeightM: 10, model: "ground" },
  { id: "desert", name: "Desert", clutterHeightM: 10, model: "ground" },
  { id: "light", name: "Light Vegetation", clutterHeightM: 10, model: "diffraction" },
  { id: "suburban", name: "Suburban", clutterHeightM: 10, model: "diffraction" },
  { id: "urban", name: "Urban", clutterHeightM: 15, model: "diffraction" },
  { id: "dense", name: "Dense Vegetation", clutterHeightM: 20, model: "diffraction" },
];

export function findEnvironment(id: string): Environment {
  return environments.find((e) => e.id === id) ?? environments[0];
}

const MIN_GHZ = 0.03;
const MAX_GHZ = 3;
/** Street width default, metres (P.2108 Table 2). */
const STREET_WIDTH_M = 27;
/** Keeps the ground model finite for an antenna height of zero. */
const MIN_ANTENNA_M = 0.5;

/** True below 30 MHz, where the model doesn't apply and no loss is added. */
export function belowModelRange(freqHz: number): boolean {
  return freqHz / 1e9 < MIN_GHZ;
}

/** True above 3 GHz, where the 3 GHz figure is used as a rough stand-in. */
export function aboveModelRange(freqHz: number): boolean {
  return freqHz / 1e9 > MAX_GHZ;
}

/** Loss in dB at one end of a path for an antenna heightM above the ground. */
export function clutterLossDb(env: Environment, freqHz: number, heightM: number): number {
  if (env.model === "none" || belowModelRange(freqHz) || !(freqHz > 0)) return 0;
  const R = env.clutterHeightM;
  const h = Math.max(MIN_ANTENNA_M, heightM);
  if (h >= R) return 0;
  const f = Math.min(MAX_GHZ, freqHz / 1e9);
  if (env.model === "ground") {
    const kh2 = 21.8 + 6.2 * Math.log10(f); // (2f)
    return -kh2 * Math.log10(h / R); // (2b)
  }
  const hDif = R - h; // (2d)
  const thetaClut = (Math.atan(hDif / STREET_WIDTH_M) * 180) / Math.PI; // (2e)
  const nu = 0.342 * Math.sqrt(f) * Math.sqrt(hDif * thetaClut); // (2c), (2g)
  return Math.max(0, knifeEdgeLossDb(nu) - 6.03); // (2a)
}

/** Height to use for the path itself: the antenna, or the clutter top if higher. */
export function effectiveHeightM(env: Environment, heightM: number): number {
  return env.model === "none" ? heightM : Math.max(heightM, env.clutterHeightM);
}
