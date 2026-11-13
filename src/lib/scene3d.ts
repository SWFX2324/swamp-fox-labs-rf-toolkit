// Geometry for the 3D view: where a link's line of sight runs in the air, and
// which way to look at it. Kept free of any map library so it can be tested.

import { type LatLon, bearingDeg, destinationPoint, distanceBetweenM, samplePath } from "./geo";
import { STANDARD_K, earthBulgeM } from "./horizon";
import type { LinkLineStyle } from "./linkLines";

/** A value the 3D view lets you change at a site, by clicking its label. */
export interface EditField {
  key: string;
  label: string;
  value: string;
  unit?: string;
  type: "text" | "number";
}

/** An antenna: where it stands, what to call it, and how high it is off the ground. */
export interface Point3D extends LatLon {
  label: string;
  heightM: number;
  /** What its pop-up editor shows, if it has one. */
  fields?: EditField[];
}

/** A link between two of the scene's points, by index. */
export interface Link3D {
  a: number;
  b: number;
  style: LinkLineStyle;
}

export interface Scene3D {
  /** Shown in the view's title, e.g. "Link Analysis". */
  title: string;
  points: Point3D[];
  links: Link3D[];
  /** A coverage image to drape on the terrain, with its corners in degrees. */
  overlay?: { url: string; bounds: { north: number; south: number; east: number; west: number } };
  /** A circle to outline on the ground, such as the coverage radius. */
  ring?: { center: LatLon; radiusM: number };
  /** Called with the values changed in a site's pop-up editor. */
  onEdit?: (index: number, values: Record<string, string>) => void;
  /** Called when a point is dragged to a new spot in the 3D view. */
  onMove?: (index: number, p: LatLon) => void;
  /** Effective earth radius factor, so the line dips by the same bulge the 2D checks use. */
  k: number;
  /** Where to look when there are no points: the 2D map's view. */
  center: LatLon;
  zoom: number;
}

/** Points along a link for drawing it in the air. */
export const LINK_SAMPLES = 48;

/**
 * Height of the line of sight above sea level at each of `samples + 1` evenly
 * spaced points from one antenna top to the other, lowered by the earth bulge
 * so that terrain clearance in the 3D view (drawn on a flat map) matches the
 * curved-earth check in the 2D profile.
 */
export function lineOfSightHeights(fromTopM: number, toTopM: number, distanceM: number, samples = LINK_SAMPLES, k = STANDARD_K): number[] {
  const out: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const d1 = distanceM * t;
    out.push(fromTopM + (toTopM - fromTopM) * t - earthBulgeM(d1, distanceM - d1, k));
  }
  return out;
}

/** The ground points under a link, matching lineOfSightHeights. */
export function linkSamples(a: LatLon, b: LatLon, samples = LINK_SAMPLES): LatLon[] {
  return samplePath(a, b, samples + 1);
}

/**
 * Map bearing for a first look at the scene: side-on to a single link, so it
 * runs left to right with the first point on the left; north up otherwise.
 */
export function viewBearing(points: LatLon[]): number {
  if (points.length !== 2 || distanceBetweenM(points[0], points[1]) < 1) return 0;
  const b = bearingDeg(points[0], points[1]) - 90;
  return ((b % 360) + 540) % 360 - 180;
}

/** A closed outline of a circle on the ground, as [lon, lat] pairs. */
export function ringCoordinates(center: LatLon, radiusM: number, steps = 128): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const p = destinationPoint(center, (i / steps) * 360, radiusM);
    out.push([p.lon, p.lat]);
  }
  return out;
}
