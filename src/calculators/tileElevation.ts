// Browser side of Terrain Tiles: download, decode with a canvas and cache
// tiles, then sample heights along a path. Shared by the terrain profile,
// Mesh Planner and Coverage Map. The service worker also keeps the PNGs, so
// areas seen before work offline.

import type { LatLon } from "../lib/geo";
import { ElevationGrid, type TileId, decodeTile, pathHeights, tileUrl, tilesForPoints, zoomForPoints } from "../lib/terrainTiles";

// Decoded tiles, kept for this page load.
const decoded = new Map<string, Float32Array>();

export async function loadTile(tile: TileId, signal?: AbortSignal): Promise<Float32Array> {
  const key = `${tile.z}/${tile.x}/${tile.y}`;
  const cached = decoded.get(key);
  if (cached) return cached;
  const res = await fetch(tileUrl(tile), { signal });
  if (!res.ok) throw new Error(`Terrain tile returned ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const heights = decodeTile(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  decoded.set(key, heights);
  return heights;
}

/** Load tiles a few at a time, reporting progress. */
export async function loadTiles(
  tiles: TileId[],
  grid: ElevationGrid,
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

/** Ground heights in metres at each point, ready for a terrain profile. */
export async function fetchPathElevations(points: LatLon[], signal?: AbortSignal): Promise<number[]> {
  const z = zoomForPoints(points, 40);
  const grid = new ElevationGrid(z);
  await loadTiles(tilesForPoints(points, z), grid, { signal });
  return pathHeights(points.map((p) => grid.sample(p)));
}
