// Coordinates as people type them: decimal lat/lon or MGRS (what TAK uses).
// Every location box accepts both; the display format is a user preference.

import { forward, toPoint } from "mgrs";
import { type LatLon, formatLatLon, parseLatLon } from "./geo";

export type CoordFormat = "latlon" | "mgrs";

const FORMAT_KEY = "rf-toolkit:coord-format";
// Zone 1–60, band letter, two-letter 100 km square, then 0–10 digits in pairs.
const MGRS_PATTERN = /^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z]{2})(\d*)$/;

/** Parse "lat, lon" or an MGRS reference like "17S NU 14277 98239". */
export function parseCoordinates(text: string): LatLon | undefined {
  const latLon = parseLatLon(text);
  if (latLon) return latLon;
  const compact = text.replace(/\s+/g, "").toUpperCase();
  const m = MGRS_PATTERN.exec(compact);
  if (!m || m[4].length % 2 !== 0 || m[4].length > 10 || Number(m[1]) < 1 || Number(m[1]) > 60) return undefined;
  try {
    // Without digits this is the centre of the 100 km square; with them,
    // the centre of the cell they describe.
    const [lon, lat] = toPoint(compact);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined;
  } catch {
    return undefined;
  }
}

/** MGRS to 1 m, spaced like "17S NU 14277 98239"; undefined in polar regions. */
export function toMgrs(p: LatLon): string | undefined {
  try {
    const raw = forward([p.lon, p.lat], 5);
    const m = /^(\d{1,2}[A-Z])([A-Z]{2})(\d{5})(\d{5})$/.exec(raw);
    return m ? `${m[1]} ${m[2]} ${m[3]} ${m[4]}` : raw;
  } catch {
    return undefined;
  }
}

/** Format in the chosen style, falling back to lat/lon where MGRS can't go. */
export function formatCoordinates(p: LatLon, format: CoordFormat = getCoordFormat()): string {
  return (format === "mgrs" && toMgrs(p)) || formatLatLon(p);
}

export function getCoordFormat(): CoordFormat {
  try {
    return localStorage.getItem(FORMAT_KEY) === "mgrs" ? "mgrs" : "latlon";
  } catch {
    return "latlon";
  }
}

export function setCoordFormat(format: CoordFormat): void {
  try {
    localStorage.setItem(FORMAT_KEY, format);
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
}

/** Placeholder text for a location box in the current format. */
export function coordPlaceholder(format: CoordFormat = getCoordFormat()): string {
  return format === "mgrs" ? "MGRS, like 17S NU 14277 98239" : "lat, lon";
}
