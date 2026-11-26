// Area coverage from one site: terrain is sampled along evenly spaced
// radials, and every point on a radial gets a link margin from free-space
// loss plus terrain loss (Longley-Rice, see propagation.ts) over the ground
// between it and the site.
// Sampling happens once per site and radius. Path loss reruns when the
// frequency, antenna heights or model settings change; power and gain
// changes only redo the quick margin step.

import { type ModelSettings, defaultModel, terrainLoss } from "./propagation";
import { fsplDb } from "./fspl";
import { type LatLon, bearingDeg, destinationPoint, distanceBetweenM } from "./geo";
import { EARTH_RADIUS_M } from "./horizon";
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

/**
 * Ground heights along evenly spaced lines (radials) running out from a site,
 * like spokes of a wheel: `radials` lines, each sampled at `steps` points out
 * to radiusM. The coverage map is worked out along these lines.
 */
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

/** The height when it is real terrain, or the fallback for a gap (missing data comes back as NaN or a huge negative number). */
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

/** Adds per-point loss grids together; undefined grids are skipped. */
export function sumGrids(...grids: (Float32Array[] | undefined)[]): Float32Array[] | undefined {
  const present = grids.filter((g): g is Float32Array[] => !!g);
  if (!present.length) return undefined;
  return present[0].map((row, r) => row.map((v, k) => present.reduce((sum, g, i) => (i === 0 ? sum : sum + g[r][k]), v)));
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

/**
 * How much of the circle has coverage: the share of its area that meets the
 * fade margin, the share that connects with less, and the farthest point that
 * meets the fade margin with its bearing.
 */
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

// ------------------------------------------------------------ several sites

/** One site's mapped margins, for combining sites. */
export interface SiteMargins {
  samples: RadialSamples;
  margins: Float32Array[];
}

/** Each site's margin at a point (NaN outside its circle or at the site itself). */
export function siteMarginsAt(sites: SiteMargins[], p: LatLon): number[] {
  return sites.map((s) => marginAt(s.samples, s.margins, bearingDeg(s.samples.site, p), distanceBetweenM(s.samples.site, p)));
}

/** The best margin at a point and which site gives it, or undefined if no site reaches it at all. */
export function bestSite(margins: number[]): { index: number; margin: number } | undefined {
  let best: { index: number; margin: number } | undefined;
  margins.forEach((m, index) => {
    if (Number.isFinite(m) && (!best || m > best.margin)) best = { index, margin: m };
  });
  return best;
}

/** The box around every site's circle, in degrees. */
export function unionBounds(sites: RadialSamples[]): { north: number; south: number; east: number; west: number } {
  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;
  for (const s of sites) {
    const dLat = (s.radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
    const dLon = dLat / Math.max(0.01, Math.cos((s.site.lat * Math.PI) / 180));
    north = Math.max(north, s.site.lat + dLat);
    south = Math.min(south, s.site.lat - dLat);
    east = Math.max(east, s.site.lon + dLon);
    west = Math.min(west, s.site.lon - dLon);
  }
  return { north, south, east, west };
}

export interface CombinedStats {
  /** Share of the area inside any site's circle where the best site meets the fade margin, 0–1. */
  solid: number;
  /** Share where the best site connects but is under the fade margin. */
  marginal: number;
  /** Share where two or more sites each meet the fade margin. */
  redundant: number;
}

/**
 * Coverage shares for several sites together, over the area inside any of
 * their circles, sampled on a grid of cells (each weighted by its true area).
 */
export function combinedStats(sites: SiteMargins[], fadeMarginDb: number, cells = 160): CombinedStats {
  const b = unionBounds(sites.map((s) => s.samples));
  let total = 0;
  let solid = 0;
  let marginal = 0;
  let redundant = 0;
  for (let j = 0; j < cells; j++) {
    const lat = b.south + ((j + 0.5) / cells) * (b.north - b.south);
    const w = Math.cos((lat * Math.PI) / 180);
    for (let i = 0; i < cells; i++) {
      const p = { lat, lon: b.west + ((i + 0.5) / cells) * (b.east - b.west) };
      if (!sites.some((s) => distanceBetweenM(s.samples.site, p) <= s.samples.radiusM)) continue;
      total += w;
      const m = siteMarginsAt(sites, p);
      const best = bestSite(m)?.margin ?? Number.NaN;
      if (best >= fadeMarginDb) solid += w;
      else if (best >= 0) marginal += w;
      if (m.filter((v) => v >= fadeMarginDb).length >= 2) redundant += w;
    }
  }
  return total ? { solid: solid / total, marginal: marginal / total, redundant: redundant / total } : { solid: 0, marginal: 0, redundant: 0 };
}
