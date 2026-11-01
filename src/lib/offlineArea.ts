// Which tiles to save so an area works offline: terrain for the calculations
// and satellite imagery to see it on. Street maps are left out on purpose, as
// OpenStreetMap's tile policy forbids prefetching and "save for offline".

import { type TileId, TILE_SIZE, tileUrl, toGlobalPixel } from "./terrainTiles";

export const SENTINEL_YEAR = 2024;
export const SENTINEL_URL = `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${SENTINEL_YEAR}_3857/default/g/{z}/{y}/{x}.jpg`;
export const SENTINEL_MAX_ZOOM = 14;
export const USGS_URL = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}";
export const USGS_MAX_ZOOM = 16;

/** Service worker caches, so saved tiles are found the same way as viewed ones. */
export const TERRAIN_CACHE = "elevation-tiles";
export const IMAGERY_CACHE = "imagery-tiles";

// The calculations pick a terrain zoom from a path's or radius's size, so every
// zoom they could ask for has to be saved.
const TERRAIN_ZOOMS = [9, 10, 11, 12];
const IMAGERY_MIN_ZOOM = 6;
// About 110 MB of terrain and 50 MB of imagery at the average sizes below.
export const MAX_TERRAIN_TILES = 1000;
export const MAX_IMAGERY_TILES = 2000;
const TERRAIN_TILE_BYTES = 110_000;
const SENTINEL_TILE_BYTES = 13_000;
const USGS_TILE_BYTES = 26_000;

// Rough outlines of USGS imagery: the lower 48, Alaska, Hawaii and Puerto Rico.
// Its tiles 404 elsewhere, so this avoids asking for them.
const USGS_AREAS: Box[] = [
  { north: 49.5, south: 24.5, west: -125, east: -66.5 },
  { north: 71.5, south: 51, west: -170, east: -129 },
  { north: 22.5, south: 18.5, west: -161, east: -154 },
  { north: 18.7, south: 17.5, west: -68, east: -64 },
];

export interface Box {
  north: number;
  south: number;
  west: number;
  east: number;
}

export interface OfflineTile {
  url: string;
  cache: string;
}

export interface OfflinePlan {
  /** Terrain would exceed MAX_TERRAIN_TILES: the view needs zooming in, and tiles is empty. */
  tooBig: boolean;
  tiles: OfflineTile[];
  estimatedBytes: number;
  /** The closest zoom with saved imagery. */
  imageryMaxZoom: number;
  usgs: boolean;
}

interface TileRange {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function tileRange(box: Box, z: number): TileRange {
  const a = toGlobalPixel({ lat: box.north, lon: box.west }, z);
  const b = toGlobalPixel({ lat: box.south, lon: box.east }, z);
  const span = TILE_SIZE;
  return {
    x0: Math.floor(a.gx / span),
    x1: Math.floor(b.gx / span),
    y0: Math.max(0, Math.floor(a.gy / span)),
    y1: Math.min(2 ** z - 1, Math.floor(b.gy / span)),
  };
}

function tileCount(box: Box, z: number): number {
  const r = tileRange(box, z);
  return Math.min(r.x1 - r.x0 + 1, 2 ** z) * (r.y1 - r.y0 + 1);
}

/** Every tile in a box at zoom z. A box past the date line wraps around. */
export function tilesInBox(box: Box, z: number): TileId[] {
  const r = tileRange(box, z);
  const n = 2 ** z;
  const out: TileId[] = [];
  for (let y = r.y0; y <= r.y1; y++) {
    for (let x = r.x0; x <= Math.min(r.x1, r.x0 + n - 1); x++) {
      out.push({ z, x: ((x % n) + n) % n, y });
    }
  }
  return out;
}

const overlaps = (a: Box, b: Box) => a.north > b.south && a.south < b.north && a.east > b.west && a.west < b.east;

const imageryUrl = (template: string, { z, x, y }: TileId) =>
  template.replace("{z}", String(z)).replace("{y}", String(y)).replace("{x}", String(x));

/** The tiles to save for a box. Imagery goes as close as the tile limit allows. */
export function planOfflineArea(box: Box): OfflinePlan {
  const usgs = USGS_AREAS.some((area) => overlaps(box, area));
  const terrainCount = TERRAIN_ZOOMS.reduce((sum, z) => sum + tileCount(box, z), 0);
  if (terrainCount > MAX_TERRAIN_TILES) return { tooBig: true, tiles: [], estimatedBytes: 0, imageryMaxZoom: 0, usgs };

  const top = usgs ? USGS_MAX_ZOOM : SENTINEL_MAX_ZOOM;
  let imageryCount = 0;
  let imageryMaxZoom = IMAGERY_MIN_ZOOM - 1;
  for (let z = IMAGERY_MIN_ZOOM; z <= top; z++) {
    const count = tileCount(box, z) * ((z <= SENTINEL_MAX_ZOOM ? 1 : 0) + (usgs ? 1 : 0));
    if (imageryCount + count > MAX_IMAGERY_TILES) break;
    imageryCount += count;
    imageryMaxZoom = z;
  }

  const tiles: OfflineTile[] = [];
  let estimatedBytes = 0;
  for (const z of TERRAIN_ZOOMS) {
    for (const t of tilesInBox(box, z)) {
      tiles.push({ url: tileUrl(t), cache: TERRAIN_CACHE });
      estimatedBytes += TERRAIN_TILE_BYTES;
    }
  }
  for (let z = IMAGERY_MIN_ZOOM; z <= imageryMaxZoom; z++) {
    for (const t of tilesInBox(box, z)) {
      if (z <= SENTINEL_MAX_ZOOM) {
        tiles.push({ url: imageryUrl(SENTINEL_URL, t), cache: IMAGERY_CACHE });
        estimatedBytes += SENTINEL_TILE_BYTES;
      }
      if (usgs) {
        tiles.push({ url: imageryUrl(USGS_URL, t), cache: IMAGERY_CACHE });
        estimatedBytes += USGS_TILE_BYTES;
      }
    }
  }
  return { tooBig: false, tiles, estimatedBytes, imageryMaxZoom, usgs };
}
