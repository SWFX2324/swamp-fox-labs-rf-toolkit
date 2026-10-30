// Area coverage from one site: terrain is sampled along evenly spaced
// radials, and every point on a radial gets a link margin from free-space
// loss plus Bullington diffraction over the ground between it and the site.
// Sampling happens once per site and radius; margins recompute quickly when
// only the radio settings or antenna heights change.

import { bullingtonLoss } from "./diffraction";
import { fsplDb } from "./fspl";
import { type LatLon, destinationPoint } from "./geo";

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
}

/** Margin in dB at every radial point (index 0, the site itself, is NaN). */
export function coverageMargins(s: RadialSamples, radio: CoverageRadio, txHeightM: number, rxHeightM: number): Float32Array[] {
  const fixed = radio.eirpDbm + radio.rxGainDbi - radio.rxCableLossDb - radio.sensitivityDbm;
  return s.elevations.map((e) => {
    const out = new Float32Array(e.length);
    out[0] = Number.NaN;
    const heights = Array.from(e);
    for (let k = 1; k < e.length; k++) {
      const d = k * s.stepM;
      const diffraction =
        k >= 2
          ? bullingtonLoss({ freqHz: radio.freqHz, distanceM: d, elevationsM: heights.slice(0, k + 1), txHeightM, rxHeightM }).lossDb
          : 0;
      out[k] = fixed - fsplDb(radio.freqHz, d) - diffraction;
    }
    return out;
  });
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
