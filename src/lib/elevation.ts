// Ground elevations from the Open-Meteo Elevation API (Copernicus DEM GLO-90,
// 90 m). Free for non-commercial use with attribution; no key needed.
// https://open-meteo.com/en/docs/elevation-api

import type { LatLon } from "./geo";

const ENDPOINT = "https://api.open-meteo.com/v1/elevation";
/** The API takes at most this many coordinates per request. */
export const MAX_PER_REQUEST = 100;

export type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

/** Elevations in metres above sea level, in the same order as points. */
export async function fetchElevations(
  points: LatLon[],
  { signal, fetcher = fetch }: { signal?: AbortSignal; fetcher?: Fetcher } = {},
): Promise<number[]> {
  const out: number[] = [];
  for (let start = 0; start < points.length; start += MAX_PER_REQUEST) {
    const batch = points.slice(start, start + MAX_PER_REQUEST);
    const url =
      `${ENDPOINT}?latitude=${batch.map((p) => p.lat.toFixed(5)).join(",")}` +
      `&longitude=${batch.map((p) => p.lon.toFixed(5)).join(",")}`;
    const res = await fetcher(url, { signal });
    const body = (await res.json().catch(() => ({}))) as { elevation?: unknown; reason?: string };
    if (!res.ok) throw new Error(body.reason ?? `Elevation service returned ${res.status}`);
    const elevation = body.elevation;
    if (!Array.isArray(elevation) || elevation.length !== batch.length || !elevation.every(Number.isFinite)) {
      throw new Error("Elevation service returned an unexpected response");
    }
    out.push(...(elevation as number[]));
  }
  return out;
}
