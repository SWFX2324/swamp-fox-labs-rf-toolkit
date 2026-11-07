// Area coverage from one site: terrain is sampled along evenly spaced
// radials, and every point on a radial gets a link margin from free-space
// loss plus terrain loss (Longley-Rice, see propagation.ts) over the ground
// between it and the site.
// Sampling happens once per site and radius. Path loss reruns when the
// frequency, antenna heights or model settings change; power and gain
// changes only redo the quick margin step.

import { type ModelSettings, defaultModel, terrainLoss } from "./propagation";
import { fsplDb } from "./fspl";
import { type LatLon, destinationPoint } from "./geo";
import { type Beam, elevationAngleDeg, patternLossDb } from "./pattern";

export interface RadialSamples {
  site: LatLon;
  radiusM: number;
  stepM: number;
  /** Degrees clockwise from true north, one per radial. */
  bearings: number[];
  /** Ground height per radial, index 0 at the site, then every stepM. */
  elevations: Float32Array[];
}

export function sampleRadials(
  site: LatLon,
  radiusM: number,
  radials: number,
  steps: number,
  sample: (p: LatLon) => number,
): RadialSamples {
  const stepM = radiusM / steps;
  const bearings = Array.from({ length: radials }, (_, i) => (360 * i) / radials);
  const siteHeight = finiteOr(sample(site), 0);
  const elevations = bearings.map((b) => {
    const e = new Float32Array(steps + 1);
    e[0] = siteHeight;
    for (let k = 1; k <= steps; k++) {
      // Fill gaps (missing tile, sea "no data") from the previous point.
      e[k] = finiteOr(sample(destinationPoint(site, b, k * stepM)), e[k - 1]);
    }
    return e;
  });
  return { site, radiusM, stepM, bearings, elevations };
}

const finiteOr = (v: number, fallback: number) => (Number.isFinite(v) && v > -1000 ? v : fallback);

export interface CoverageRadio {
  freqHz: number;
  /** TX power − TX cable loss + TX antenna gain, dBm. */
  eirpDbm: number;
  rxGainDbi: number;
  rxCableLossDb: number;
  sensitivityDbm: number;
  /** Environment (clutter) loss at both ends, dB. */
  clutterLossDb?: number;
}

/**
 * Path loss in dB, free space plus terrain, at every radial point (index 0,
 * the site itself, is NaN). This is the slow part, and it depends only on the
 * frequency, the antenna heights and the model, not on power or gains.
 */
export function coveragePathLoss(
  s: RadialSamples,
  freqHz: number,
  txHeightM: number,
  /** One height for everywhere, or one per radial point (clutter tops from a land-cover map). */
  rxHeightM: number | Float32Array[],
  model: ModelSettings = defaultModel,
): Float32Array[] {
  return s.elevations.map((e, r) => {
    const out = new Float32Array(e.length);
    out[0] = Number.NaN;
    for (let k = 1; k < e.length; k++) {
      const d = k * s.stepM;
      const rxH = typeof rxHeightM === "number" ? rxHeightM : rxHeightM[r][k];
      const terrain = k >= 2 ? terrainLoss({ freqHz, distanceM: d, elevationsM: e.subarray(0, k + 1), txHeightM, rxHeightM: rxH }, model).lossDb : 0;
      out[k] = fsplDb(freqHz, d) + terrain;
    }
    return out;
  });
}

/**
 * Margin in dB at every radial point from the path loss there. extraLossDb,
 * if given, is more loss per point on the same grid (antenna pattern, clutter
 * that changes from point to point).
 */
export function marginsFromLoss(loss: Float32Array[], radio: Omit<CoverageRadio, "freqHz">, extraLossDb?: Float32Array[]): Float32Array[] {
  const fixed = radio.eirpDbm + radio.rxGainDbi - radio.rxCableLossDb - radio.sensitivityDbm - (radio.clutterLossDb ?? 0);
  return loss.map((row, r) => row.map((l, k) => fixed - l - (extraLossDb ? extraLossDb[r][k] : 0)));
}

/**
 * Loss below the TX antenna's peak gain toward every radial point, from its
 * pattern, pointing and downtilt. The elevation angle runs from the TX antenna
 * top to the RX antenna top over the earth's curve.
 */
export function coveragePatternLoss(s: RadialSamples, b: Beam, txHeightM: number, rxHeightM: number): Float32Array[] {
  return s.elevations.map((e, r) => {
    const out = new Float32Array(e.length);
    const txTop = e[0] + txHeightM;
    for (let k = 1; k < e.length; k++) {
      out[k] = patternLossDb(b, s.bearings[r], elevationAngleDeg(txTop, e[k] + rxHeightM, k * s.stepM));
    }
    return out;
  });
}

/** A value for every radial point (index 0, the site, included), as a grid. */
export function radialGrid(s: RadialSamples, value: (p: LatLon, r: number, k: number) => number): Float32Array[] {
  return s.bearings.map((b, r) => {
    const out = new Float32Array(s.elevations[r].length);
    for (let k = 0; k < out.length; k++) out[k] = value(k === 0 ? s.site : destinationPoint(s.site, b, k * s.stepM), r, k);
    return out;
  });
}

/** Adds per-point loss grids together; undefined grids are skipped. */
export function sumGrids(...grids: (Float32Array[] | undefined)[]): Float32Array[] | undefined {
  const present = grids.filter((g): g is Float32Array[] => !!g);
  if (!present.length) return undefined;
  return present[0].map((row, r) => row.map((v, k) => present.reduce((sum, g, i) => (i === 0 ? sum : sum + g[r][k]), v)));
}

/** Margin in dB at every radial point (index 0, the site itself, is NaN). */
export function coverageMargins(s: RadialSamples, radio: CoverageRadio, txHeightM: number, rxHeightM: number, model: ModelSettings = defaultModel): Float32Array[] {
  return marginsFromLoss(coveragePathLoss(s, radio.freqHz, txHeightM, rxHeightM, model), radio);
}

/** Margin at a bearing and distance from the nearest radial point, or NaN. */
export function marginAt(s: RadialSamples, margins: Float32Array[], bearing: number, distanceM: number): number {
  const steps = s.elevations[0].length - 1;
  const k = Math.round(distanceM / s.stepM);
  if (k < 1 || k > steps) return Number.NaN;
  const n = s.bearings.length;
  const r = Math.round((((bearing % 360) + 360) % 360) / (360 / n)) % n;
  return margins[r][k];
}

export interface CoverageStats {
  /** Share of the circle's area meeting the fade margin, 0–1. */
  solid: number;
  /** Share with positive margin but less than the fade margin. */
  marginal: number;
  /** Farthest point that meets the fade margin, metres, and its bearing. */
  farthestSolidM: number;
  farthestSolidBearing: number;
}

export function coverageStats(s: RadialSamples, margins: Float32Array[], fadeMarginDb: number): CoverageStats {
  let total = 0;
  let solid = 0;
  let marginal = 0;
  let farthest = 0;
  let farthestBearing = 0;
  margins.forEach((m, r) => {
    for (let k = 1; k < m.length; k++) {
      // Each point stands for a ring sector whose area grows with distance.
      const area = k;
      total += area;
      if (m[k] >= fadeMarginDb) {
        solid += area;
        if (k * s.stepM > farthest) {
          farthest = k * s.stepM;
          farthestBearing = s.bearings[r];
        }
      } else if (m[k] >= 0) {
        marginal += area;
      }
    }
  });
  return {
    solid: total ? solid / total : 0,
    marginal: total ? marginal / total : 0,
    farthestSolidM: farthest,
    farthestSolidBearing: farthestBearing,
  };
}
