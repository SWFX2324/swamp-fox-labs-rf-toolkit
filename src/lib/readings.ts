// Field readings: signal strengths measured on the ground, kept next to what
// the Coverage Analysis predicted at the same spot. The gap between them (measured
// minus predicted) shows how far the model is off on your terrain, and its
// average can correct the map.

import type { LatLon } from "./geo";
import { distanceBetweenM } from "./geo";
import type { StorageLike } from "./pathStore";

export const READINGS_KEY = "rf-toolkit:readings";
export const MAX_READINGS = 500;
/** Readings taken within this distance of the site belong to it. */
export const SAME_SITE_M = 50;
/** Fewest readings before the average is offered as a correction. */
export const MIN_FOR_CORRECTION = 3;

export interface Reading extends LatLon {
  id: string;
  /** Signal strength the radio reported, dBm. */
  measuredDbm: number;
  /** The site the reading was taken from. */
  site: LatLon;
  /** What surrounds the receiver, an Environment profile name, when known. */
  cover?: string;
  note: string;
  /** ISO time it was logged. */
  takenAt: string;
}

export interface ErrorStats {
  count: number;
  /** Average of measured − predicted, dB: positive means the map is pessimistic. */
  meanDb: number;
  /** Sample standard deviation of the errors, dB (0 for one reading). */
  sdDb: number;
  /** Root mean square error, dB. */
  rmsDb: number;
}

export function errorStats(errors: number[]): ErrorStats {
  const n = errors.length;
  if (!n) return { count: 0, meanDb: 0, sdDb: 0, rmsDb: 0 };
  const mean = errors.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(errors.reduce((a, e) => a + (e - mean) ** 2, 0) / (n - 1)) : 0;
  const rms = Math.sqrt(errors.reduce((a, e) => a + e * e, 0) / n);
  return { count: n, meanDb: mean, sdDb: sd, rmsDb: rms };
}

/** Error stats grouped by what surrounded the receiver, largest group first. */
export function statsByCover(rows: { cover?: string; errorDb: number }[]): { cover: string; stats: ErrorStats }[] {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const key = r.cover || "Not recorded";
    groups.set(key, [...(groups.get(key) ?? []), r.errorDb]);
  }
  return [...groups.entries()]
    .map(([cover, errors]) => ({ cover, stats: errorStats(errors) }))
    .sort((a, b) => b.stats.count - a.stats.count || a.cover.localeCompare(b.cover));
}

export function sameSite(r: Reading, site: LatLon): boolean {
  return distanceBetweenM(r.site, site) <= SAME_SITE_M;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const validPoint = (p: unknown): boolean =>
  typeof p === "object" && p !== null && finite((p as LatLon).lat) && finite((p as LatLon).lon) && Math.abs((p as LatLon).lat) <= 90 && Math.abs((p as LatLon).lon) <= 180;

/** Saved readings, dropping anything malformed. */
export function loadReadings(storage: Pick<StorageLike, "getItem">): Reading[] {
  try {
    const raw = JSON.parse(storage.getItem(READINGS_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((r) => validPoint(r) && validPoint(r.site) && finite(r.measuredDbm))
      .slice(-MAX_READINGS)
      .map((r) => ({
        id: typeof r.id === "string" ? r.id.slice(0, 40) : Math.random().toString(36).slice(2),
        lat: r.lat,
        lon: r.lon,
        measuredDbm: r.measuredDbm,
        site: { lat: r.site.lat, lon: r.site.lon },
        ...(typeof r.cover === "string" ? { cover: r.cover.slice(0, 40) } : {}),
        note: typeof r.note === "string" ? r.note.slice(0, 200) : "",
        takenAt: typeof r.takenAt === "string" ? r.takenAt.slice(0, 40) : "",
      }));
  } catch {
    return [];
  }
}

export function saveReadings(storage: Pick<StorageLike, "setItem">, readings: Reading[]): void {
  storage.setItem(READINGS_KEY, JSON.stringify(readings.slice(-MAX_READINGS)));
}

const csvCell = (v: string | number) => {
  const s = String(v);
  // Quote anything with separators, and defuse cells a spreadsheet would run as a formula.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Readings as CSV, with the prediction and error where there is one. */
export function readingsCsv(rows: { reading: Reading; predictedDbm?: number }[]): string {
  const head = ["time", "latitude", "longitude", "measured_dbm", "predicted_dbm", "error_db", "cover", "site_latitude", "site_longitude", "note"];
  const lines = rows.map(({ reading: r, predictedDbm: p }) =>
    [
      r.takenAt,
      r.lat.toFixed(6),
      r.lon.toFixed(6),
      r.measuredDbm.toFixed(1),
      p === undefined ? "" : p.toFixed(1),
      p === undefined ? "" : (r.measuredDbm - p).toFixed(1),
      r.cover ?? "",
      r.site.lat.toFixed(6),
      r.site.lon.toFixed(6),
      r.note,
    ]
      .map(csvCell)
      .join(","),
  );
  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}
