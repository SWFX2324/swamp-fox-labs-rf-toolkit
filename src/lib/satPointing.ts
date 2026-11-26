// Look angles from a ground site to a geostationary satellite. The site is a
// WGS84 geodetic position and the satellite sits on the equator at the GEO
// radius, at its orbital slot longitude. Everything is done with earth-
// centred vectors, so the same code covers every hemisphere and quadrant.

import { SPEED_OF_LIGHT } from "./units";

const WGS84_A = 6378137; // m
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
/** Geostationary orbit radius from the earth's centre, metres. */
export const GEO_RADIUS_M = 42_164_170;

// A position or direction as x, y and z in earth-centred coordinates (metres for
// a position): x points to 0° latitude 0° longitude, y to 0° latitude 90° east,
// and z to the North Pole.
type Vec = [number, number, number];
// Small vector helpers for the geometry below.
const rad = (d: number) => (d * Math.PI) / 180; // Degrees to radians.
const deg = (r: number) => (r * 180) / Math.PI; // Radians to degrees.
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; // How far two vectors point the same way.
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; // The vector from b to a.
const scale = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s]; // A vector stretched by a number.
const norm = (a: Vec) => Math.sqrt(dot(a, a)); // A vector's length.
// The vector at right angles to both a and b, by the right-hand rule.
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export interface GroundSite {
  lat: number;
  lon: number;
  /** Height above the WGS84 ellipsoid, metres. */
  heightM?: number;
}

export interface LookAngles {
  /** Degrees clockwise from true north. */
  azimuthTrue: number;
  /** Degrees above the horizon (negative: below it). */
  elevation: number;
  /**
   * Feed rotation for linear polarization, degrees. Positive means turn the
   * feed clockwise as seen from behind the dish, looking toward the satellite.
   */
  skew: number;
  /** Distance to the satellite, metres. */
  rangeM: number;
}

/**
 * Converts a site's latitude, longitude and height to earth-centred x, y and z
 * in metres, on the WGS84 ellipsoid that GPS uses. The earth is slightly
 * flattened at the poles, which is what the WGS84_E2 terms account for.
 */
function siteEcef({ lat, lon, heightM = 0 }: GroundSite): Vec {
  const phi = rad(lat);
  const lambda = rad(lon);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(phi) ** 2);
  return [
    (n + heightM) * Math.cos(phi) * Math.cos(lambda),
    (n + heightM) * Math.cos(phi) * Math.sin(lambda),
    (n * (1 - WGS84_E2) + heightM) * Math.sin(phi),
  ];
}

/**
 * Where to point a dish at a geostationary satellite from a ground site: the
 * azimuth from true north, the elevation above the horizon, the feed skew for
 * linear polarization, and the distance to the satellite.
 */
export function lookAngles(site: GroundSite, satLonDeg: number): LookAngles {
  const phi = rad(site.lat);
  const lambda = rad(site.lon);
  const ground = siteEcef(site);
  const sat: Vec = [GEO_RADIUS_M * Math.cos(rad(satLonDeg)), GEO_RADIUS_M * Math.sin(rad(satLonDeg)), 0];

  // Local east, north and up at the site.
  const east: Vec = [-Math.sin(lambda), Math.cos(lambda), 0];
  const north: Vec = [-Math.sin(phi) * Math.cos(lambda), -Math.sin(phi) * Math.sin(lambda), Math.cos(phi)];
  const up: Vec = [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];

  const d = sub(sat, ground);
  const range = norm(d);
  const los = scale(d, 1 / range);
  const azimuth = (deg(Math.atan2(dot(d, east), dot(d, north))) + 360) % 360;
  const elevation = deg(Math.asin(dot(los, up)));

  // A GEO satellite's "vertical" polarization is parallel to the earth's
  // axis. Skew is the angle, seen along the line of sight, from the dish's
  // own vertical (local up) to that axis. By the right-hand rule a positive
  // angle about the line of sight is clockwise to someone looking along it.
  const axis: Vec = [0, 0, 1];
  // A vector with its part along the line of sight removed, as seen looking along it.
  const project = (v: Vec) => sub(v, scale(los, dot(v, los)));
  const upP = project(up);
  const axisP = project(axis);
  let skew = deg(Math.atan2(dot(cross(upP, axisP), los), dot(upP, axisP)));
  // Polarization is a line, not an arrow, so an angle and the same angle plus 180°
  // mean the same thing. Fold the skew into the range above −90° and up to 90°. South of the
  // equator the axis points "down" the view, which this turns around.
  if (skew > 90) skew -= 180;
  else if (skew <= -90) skew += 180;

  return { azimuthTrue: azimuth, elevation, skew, rangeM: range };
}

/** One-way propagation delay between the site and the satellite, seconds. */
export function oneWayDelayS(rangeM: number): number {
  return rangeM / SPEED_OF_LIGHT;
}

/**
 * Tilt of an offset-fed reflector's face back from vertical. A prime-focus
 * dish (offset 0) tilts back by the elevation; an offset dish looks higher
 * than its face points, so it tilts back less.
 */
export function reflectorTiltDeg(elevation: number, offsetDeg: number): number {
  return elevation - offsetDeg;
}

/**
 * Parse an orbital slot the way access documents write it: "101W",
 * "101.0° W", "W101", "-101" or "28.2E". Returns degrees east (west negative).
 */
export function parseOrbitalSlot(text: string): number | undefined {
  const m = /^\s*([EW])?\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([EW])?\s*$/i.exec(text);
  if (!m) return undefined;
  const [, before, num, after] = m;
  if (before && after) return undefined;
  const hemi = (before ?? after)?.toUpperCase();
  let lon = Number(num);
  if (hemi && lon < 0) return undefined; // "-101W" is ambiguous
  if (hemi === "W") lon = -lon;
  if (!Number.isFinite(lon) || Math.abs(lon) > 180) return undefined;
  return lon;
}

/** An orbital slot as people write it, like "101.0° W", from degrees east (west negative). */
export function formatOrbitalSlot(lonEast: number): string {
  const v = Math.abs(lonEast).toFixed(1);
  return lonEast === 0 ? "0.0°" : `${v}° ${lonEast < 0 ? "W" : "E"}`;
}

/** 16-point compass name for a bearing, like "SSW". */
export function compassPoint(bearing: number): string {
  const names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return names[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16];
}
