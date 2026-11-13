// Environment profiles: a planning estimate of the loss from what surrounds
// each antenna, applied at each end of a path for 30 MHz to 3 GHz, and zero
// once an antenna clears the clutter.
//
// Most profiles use the height gain terminal correction model of
// Recommendation ITU-R P.2108-1, §3.1 (equations 1–2g). The path itself is
// then calculated from the top of the clutter (see effectiveHeightM), which
// keeps terrain diffraction from counting ground effects twice.
//
// Dense Vegetation uses the woodland model of ITU-R P.833-10, §2.1 instead:
// an antenna below the canopy loses Am, the measured maximum excess loss for a
// terminal in woodland, on top of the path worked out from its real height.
// Lifting it to the treetops, as P.2108 does, treats a radio on the forest
// floor as if it stood on the canopy, which reads far too kindly for manpacks
// and handhelds under tall trees.

import { knifeEdgeLossDb } from "./diffraction";

export interface Environment {
  id: string;
  name: string;
  /** Representative clutter height R, metres. */
  clutterHeightM: number;
  /**
   * "diffraction": signal comes down over buildings or trees (equation 2a).
   * "ground": open ground, height-gain from reflections (equation 2b).
   * "forest": an antenna inside woodland (ITU-R P.833-10, equations 1–2).
   * "none": no correction at all.
   */
  model: "diffraction" | "ground" | "forest" | "none";
}

// R and the model are P.2108's Table 3 defaults, mapped to these names: water
// to Water/sea, fields and desert to Open/rural, light vegetation and suburban
// to Suburban, urban to Urban/trees/forest. Dense vegetation is woodland
// (P.833) with a default canopy of 20 m; the tree height setting overrides it.
export const environments: Environment[] = [
  { id: "none", name: "None (bare terrain)", clutterHeightM: 0, model: "none" },
  { id: "water", name: "Open Water", clutterHeightM: 10, model: "ground" },
  { id: "fields", name: "Open Fields", clutterHeightM: 10, model: "ground" },
  { id: "desert", name: "Desert", clutterHeightM: 10, model: "ground" },
  { id: "light", name: "Light Vegetation", clutterHeightM: 10, model: "diffraction" },
  { id: "suburban", name: "Suburban", clutterHeightM: 10, model: "diffraction" },
  { id: "urban", name: "Urban", clutterHeightM: 15, model: "diffraction" },
  { id: "dense", name: "Dense Vegetation", clutterHeightM: 20, model: "forest" },
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

/** Default canopy height for woodland, metres. */
export const DEFAULT_TREE_HEIGHT_M = 20;

/**
 * Maximum excess loss for one terminal in woodland, dB: Am = A1·f^α with f in
 * MHz (ITU-R P.833-10, equation 2), using A1 = 1.15 dB and α = 0.43 measured
 * in forest near Mulhouse (France), trees about 15 m, paths to 6 km, a 1.6 m
 * vehicle antenna. P.833's St Petersburg mixed-forest data (Table 1, 106 MHz
 * to 2.1 GHz, paths to 7 km) fall on nearly the same curve. The forest is taken
 * as extensive, so the full Am applies: equation 1 approaches it within a few
 * hundred metres at VHF.
 */
export function woodlandLossDb(freqHz: number): number {
  const mhz = Math.min(MAX_GHZ, Math.max(MIN_GHZ, freqHz / 1e9)) * 1000;
  return 1.15 * Math.pow(mhz, 0.43);
}

/** The profile with a canopy height set by the user, for woodland; others unchanged. */
export function withTreeHeight(env: Environment, treeHeightM: number | undefined): Environment {
  return env.model === "forest" && treeHeightM !== undefined && treeHeightM > 0 ? { ...env, clutterHeightM: treeHeightM } : env;
}

/** Loss in dB at one end of a path for an antenna heightM above the ground. */
export function clutterLossDb(env: Environment, freqHz: number, heightM: number): number {
  if (env.model === "none" || belowModelRange(freqHz) || !(freqHz > 0)) return 0;
  const R = env.clutterHeightM;
  const h = Math.max(MIN_ANTENNA_M, heightM);
  if (h >= R) return 0;
  if (env.model === "forest") return woodlandLossDb(freqHz);
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

/**
 * Height to use for the path itself: the antenna, or the clutter top if higher.
 * In woodland it's always the antenna's own height (P.833 measures its loss in
 * excess of the path from there).
 */
export function effectiveHeightM(env: Environment, heightM: number): number {
  return env.model === "none" || env.model === "forest" ? heightM : Math.max(heightM, env.clutterHeightM);
}
