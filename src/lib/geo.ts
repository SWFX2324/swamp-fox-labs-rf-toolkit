// Great-circle geometry on a spherical earth, good to well under 0.5% for
// radio paths. Coordinates are decimal degrees, WGS84.

import { EARTH_RADIUS_M } from "./horizon";

export interface LatLon {
  lat: number;
  lon: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in metres (haversine). */
export function distanceBetweenM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees true (0–360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const dLon = rad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** The point a fraction t (0–1) of the way along the great circle from a to b. */
export function intermediatePoint(a: LatLon, b: LatLon, t: number): LatLon {
  const d = distanceBetweenM(a, b) / EARTH_RADIUS_M;
  if (d === 0) return { ...a };
  const sa = Math.sin((1 - t) * d) / Math.sin(d);
  const sb = Math.sin(t * d) / Math.sin(d);
  const [la1, lo1, la2, lo2] = [rad(a.lat), rad(a.lon), rad(b.lat), rad(b.lon)];
  const x = sa * Math.cos(la1) * Math.cos(lo1) + sb * Math.cos(la2) * Math.cos(lo2);
  const y = sa * Math.cos(la1) * Math.sin(lo1) + sb * Math.cos(la2) * Math.sin(lo2);
  const z = sa * Math.sin(la1) + sb * Math.sin(la2);
  return { lat: deg(Math.atan2(z, Math.hypot(x, y))), lon: deg(Math.atan2(y, x)) };
}

/** count evenly spaced points from a to b, both ends included. */
export function samplePath(a: LatLon, b: LatLon, count: number): LatLon[] {
  return Array.from({ length: count }, (_, i) => intermediatePoint(a, b, i / (count - 1)));
}

/** Parse "lat, lon" in decimal degrees. Returns undefined if it isn't valid. */
export function parseLatLon(text: string): LatLon | undefined {
  const parts = text.split(/[,\s]+/).filter(Boolean).map(Number);
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return undefined;
  const [lat, lon] = parts;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { lat, lon };
}

export function formatLatLon(p: LatLon): string {
  return `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
}
