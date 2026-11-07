// Browser side of the land-cover map: download and decode class tiles, then
// look up the Environment profile at points or across a coverage area. The
// service worker keeps the tiles, so areas seen before work offline.

import type { LatLon } from "../lib/geo";
import { LAND_COVER_POINT_ZOOM, LandCoverGrid, type LandCoverPoint, decodeLandCover, landCoverUrl } from "../lib/landCover";
import { type TileId, tilesForPoints } from "../lib/terrainTiles";

const decoded = new Map<string, Uint8Array>();

async function loadTile(tile: TileId, signal?: AbortSignal): Promise<Uint8Array> {
  const key = `${tile.z}/${tile.x}/${tile.y}`;
  const cached = decoded.get(key);
  if (cached) return cached;
  const res = await fetch(landCoverUrl(tile), { signal });
  if (!res.ok) throw new Error(`Land-cover map returned ${res.status}`);
  const blob = await res.blob();
  // The service answers some errors with JSON and a 200.
  if (!blob.type.startsWith("image/")) throw new Error("Land-cover map sent no image");
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const classes = decodeLandCover(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  decoded.set(key, classes);
  return classes;
}

/** Load tiles into a grid a few at a time, reporting progress. */
export async function loadLandCover(
  tiles: TileId[],
  grid: LandCoverGrid,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<void> {
  const queue = [...tiles];
  let done = 0;
  const worker = async () => {
    while (queue.length) {
      const t = queue.shift()!;
      grid.set(t, await loadTile(t, signal));
      onProgress?.(++done, tiles.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

const pointCache = new Map<string, LandCoverPoint>();
const pointKey = (p: LatLon) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;

/** The land cover at each point, from cache where it's been looked up before. */
export async function landCoverAt(points: LatLon[], signal?: AbortSignal): Promise<LandCoverPoint[]> {
  const missing = points.filter((p) => !pointCache.has(pointKey(p)));
  if (missing.length) {
    const grid = new LandCoverGrid(LAND_COVER_POINT_ZOOM);
    await loadLandCover(tilesForPoints(missing, LAND_COVER_POINT_ZOOM), grid, { signal });
    for (const p of missing) pointCache.set(pointKey(p), grid.at(p));
  }
  return points.map((p) => pointCache.get(pointKey(p))!);
}

/** The land cover at a point if it's already been looked up, without loading. */
export function cachedLandCover(p: LatLon): LandCoverPoint | undefined {
  return pointCache.get(pointKey(p));
}
