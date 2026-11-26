// Relay (retransmission) siting: where a relay could bridge a weak link
// between two sites. A spot works for a relay when both hops close: site A to
// the relay, and the relay to site B. Coverage from each site, worked out for a
// receiver at the relay's height, gives the margin of each hop at every point;
// the relay's margin at a point is the weaker of the two.

import { type CoverageRadio, type RadialSamples, marginAt } from "./coverage";
import { fsplDb } from "./fspl";
import { type LatLon, bearingDeg, distanceBetweenM } from "./geo";

export interface Box {
  north: number;
  south: number;
  west: number;
  east: number;
}

/** Farthest the finder reaches from either site, metres (the Coverage Analysis's limit). */
export const MAX_RELAY_RADIUS_M = 80_000;

/**
 * The area to search: the box around both sites, widened on every side by 30%
 * of their separation (at least 2 km), since the best relay spot is often a
 * hill a little off the direct line.
 */
export function relaySearchBox(a: LatLon, b: LatLon): Box {
  const pad = Math.max(2000, 0.3 * distanceBetweenM(a, b));
  const dLat = (pad / 6_371_000) * (180 / Math.PI);
  const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dLon = dLat / Math.max(0.1, Math.cos(midLat));
  return {
    north: Math.max(a.lat, b.lat) + dLat,
    south: Math.min(a.lat, b.lat) - dLat,
    west: Math.min(a.lon, b.lon) - dLon,
    east: Math.max(a.lon, b.lon) + dLon,
  };
}

/** Radius from a site that reaches every corner of the box, capped at the finder's limit. */
export function radiusToCover(site: LatLon, box: Box): number {
  const corners = [
    { lat: box.north, lon: box.west },
    { lat: box.north, lon: box.east },
    { lat: box.south, lon: box.west },
    { lat: box.south, lon: box.east },
  ];
  return Math.min(MAX_RELAY_RADIUS_M, Math.max(...corners.map((c) => distanceBetweenM(site, c))));
}

/** One site's coverage: radial samples and the hop margin at every point. */
export interface HopCoverage {
  samples: RadialSamples;
  margins: Float32Array[];
}

export interface RelaySpot extends LatLon {
  /** The weaker hop's margin there, dB. */
  marginDb: number;
  hop1Db: number;
  hop2Db: number;
}

export interface RelaySurface {
  box: Box;
  width: number;
  height: number;
  /** Weaker-hop margin per cell, row by row from the north-west corner; NaN outside either site's reach. */
  values: Float32Array;
  /** The cell with the strongest weaker hop, if any cell is reachable from both sites. */
  best?: RelaySpot;
}

/**
 * The relay margin across the box: at each cell, the weaker of the two hops.
 * hop1 is coverage from site A, hop2 from site B, both for a receiver at the
 * relay's height with the relay's radio.
 */
export function relaySurface(box: Box, width: number, height: number, hop1: HopCoverage, hop2: HopCoverage): RelaySurface {
  const values = new Float32Array(width * height);
  let best: RelaySpot | undefined;
  for (let j = 0; j < height; j++) {
    const lat = box.north - ((j + 0.5) / height) * (box.north - box.south);
    for (let i = 0; i < width; i++) {
      const lon = box.west + ((i + 0.5) / width) * (box.east - box.west);
      const p = { lat, lon };
      const m1 = marginAt(hop1.samples, hop1.margins, bearingDeg(hop1.samples.site, p), distanceBetweenM(hop1.samples.site, p));
      const m2 = marginAt(hop2.samples, hop2.margins, bearingDeg(hop2.samples.site, p), distanceBetweenM(hop2.samples.site, p));
      const v = Math.min(m1, m2);
      values[j * width + i] = Number.isFinite(v) ? v : Number.NaN;
      // Ties go to the more balanced spot, so neither hop is left barely closing.
      if (Number.isFinite(v) && (!best || v > best.marginDb || (v === best.marginDb && Math.abs(m1 - m2) < Math.abs(best.hop1Db - best.hop2Db)))) {
        best = { lat, lon, marginDb: v, hop1Db: m1, hop2Db: m2 };
      }
    }
  }
  return { box, width, height, values, best };
}

/**
 * The strongest few spots on the quick-search surface, at least `minSpacingM`
 * apart, strongest first. The quick search runs on coarse terrain that can
 * smooth over ridges, so its single best cell can be optimistic; these are the
 * spots worth checking on a detailed terrain profile before recommending one.
 */
export function topCandidates(s: RelaySurface, count: number, minSpacingM: number): RelaySpot[] {
  const order: number[] = [];
  for (let k = 0; k < s.values.length; k++) if (Number.isFinite(s.values[k])) order.push(k);
  order.sort((x, y) => s.values[y] - s.values[x]);
  const picked: RelaySpot[] = [];
  for (const k of order) {
    if (picked.length >= count) break;
    const i = k % s.width;
    const j = Math.floor(k / s.width);
    const lat = s.box.north - ((j + 0.5) / s.height) * (s.box.north - s.box.south);
    const lon = s.box.west + ((i + 0.5) / s.width) * (s.box.east - s.box.west);
    if (picked.some((p) => distanceBetweenM(p, { lat, lon }) < minSpacingM)) continue;
    // The per-hop figures aren't kept per cell; the detailed check fills them in.
    picked.push({ lat, lon, marginDb: s.values[k], hop1Db: s.values[k], hop2Db: s.values[k] });
  }
  return picked;
}

/**
 * One hop's margin from a detailed path: the weaker of its two directions,
 * each radio's fixed gains and losses less the free-space loss and the terrain
 * loss beyond it. The same sum the Coverage Analysis does at every point.
 */
export function hopMarginDb(radios: Omit<CoverageRadio, "freqHz">[], freqHz: number, distanceM: number, terrainLossDb: number): number {
  const pathLoss = fsplDb(freqHz, distanceM) + terrainLossDb;
  return Math.min(
    ...radios.map((r) => r.eirpDbm + r.rxGainDbi - r.rxCableLossDb - r.sensitivityDbm - (r.clutterLossDb ?? 0) - pathLoss),
  );
}
