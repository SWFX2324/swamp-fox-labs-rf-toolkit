// Ground elevation from Terrain Tiles (Mapzen, hosted on AWS Open Data):
// 256 × 256 PNG web-map tiles whose pixel colours encode height as
//
//   elevation = (R × 256 + G + B / 256) − 32768   metres
//
// Unlike the point API there is no rate limit, so a whole coverage area can
// be loaded in a few dozen tiles.

import type { LatLon } from "./geo";
import { EARTH_RADIUS_M } from "./horizon";

export const TILE_SIZE = 256;
export const TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
/** Highest zoom worth fetching: about 38 m per pixel at the equator. */
export const MAX_ZOOM = 12;

export interface TileId {
  z: number;
  x: number;
  y: number;
}

export function tileUrl({ z, x, y }: TileId): string {
  return TILE_URL.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

/** Web-Mercator position in global pixels at zoom z. */
export function toGlobalPixel(p: LatLon, z: number): { gx: number; gy: number } {
  const n = TILE_SIZE * 2 ** z;
  const lat = Math.max(-85.05112878, Math.min(85.05112878, p.lat));
  const phi = (lat * Math.PI) / 180;
  return {
    gx: ((p.lon + 180) / 360) * n,
    gy: ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n,
  };
}

export function fromGlobalPixel(gx: number, gy: number, z: number): LatLon {
  const n = TILE_SIZE * 2 ** z;
  const lon = (gx / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * gy) / n))) * 180) / Math.PI;
  return { lat, lon };
}

export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Decode a tile's RGBA pixels (as from canvas getImageData) to heights. */
export function decodeTile(rgba: Uint8ClampedArray | Uint8Array): Float32Array {
  const out = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let i = 0; i < out.length; i++) out[i] = decodeTerrarium(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  return out;
}

/** Tiles covering a circle of radiusM around a centre point. */
export function tilesCovering(center: LatLon, radiusM: number, z: number): TileId[] {
  const dLat = (radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLon = dLat / Math.max(0.01, Math.cos((center.lat * Math.PI) / 180));
  const a = toGlobalPixel({ lat: center.lat + dLat, lon: center.lon - dLon }, z);
  const b = toGlobalPixel({ lat: center.lat - dLat, lon: center.lon + dLon }, z);
  const max = 2 ** z - 1;
  const out: TileId[] = [];
  for (let y = Math.max(0, Math.floor(a.gy / TILE_SIZE)); y <= Math.min(max, Math.floor(b.gy / TILE_SIZE)); y++) {
    for (let x = Math.floor(a.gx / TILE_SIZE); x <= Math.floor(b.gx / TILE_SIZE); x++) {
      out.push({ z, x: ((x % (max + 1)) + max + 1) % (max + 1), y });
    }
  }
  return out;
}

/**
 * Tiles needed to sample every point, including the neighbouring pixels
 * bilinear interpolation reads across tile edges.
 */
export function tilesForPoints(points: LatLon[], z: number): TileId[] {
  const n = 2 ** z;
  const seen = new Map<string, TileId>();
  for (const p of points) {
    const { gx, gy } = toGlobalPixel(p, z);
    for (const px of [Math.floor(gx - 0.5), Math.floor(gx + 0.5)]) {
      for (const py of [Math.floor(gy - 0.5), Math.floor(gy + 0.5)]) {
        const x = ((Math.floor(px / TILE_SIZE) % n) + n) % n;
        const y = Math.min(n - 1, Math.max(0, Math.floor(py / TILE_SIZE)));
        seen.set(`${x}/${y}`, { z, x, y });
      }
    }
  }
  return [...seen.values()];
}

/** The sharpest zoom at which these points need no more than maxTiles. */
export function zoomForPoints(points: LatLon[], maxTiles = 40): number {
  for (let z = MAX_ZOOM; z > 1; z--) if (tilesForPoints(points, z).length <= maxTiles) return z;
  return 1;
}

/**
 * Heights for radio paths: sea-floor depths (negative) become sea level,
 * since the signal crosses the water's surface, and gaps take the previous
 * point's height.
 */
export function pathHeights(raw: number[]): number[] {
  const out: number[] = [];
  for (const h of raw) out.push(Number.isFinite(h) ? Math.max(0, h) : (out[out.length - 1] ?? 0));
  return out;
}

/** The sharpest zoom whose tiles for this area stay within maxTiles. */
export function chooseZoom(center: LatLon, radiusM: number, maxTiles = 36): number {
  for (let z = MAX_ZOOM; z > 1; z--) if (tilesCovering(center, radiusM, z).length <= maxTiles) return z;
  return 1;
}

/** Decoded tiles for one zoom, sampled with bilinear interpolation. */
export class ElevationGrid {
  private tiles = new Map<string, Float32Array>();

  constructor(readonly z: number) {}

  set(tile: TileId, heights: Float32Array): void {
    this.tiles.set(`${tile.x}/${tile.y}`, heights);
  }

  has(tile: TileId): boolean {
    return this.tiles.has(`${tile.x}/${tile.y}`);
  }

  private pixel(gx: number, gy: number): number {
    const n = 2 ** this.z;
    const tx = ((Math.floor(gx / TILE_SIZE) % n) + n) % n;
    const ty = Math.floor(gy / TILE_SIZE);
    const t = this.tiles.get(`${tx}/${ty}`);
    if (!t) return Number.NaN;
    const px = ((gx % TILE_SIZE) + TILE_SIZE) % TILE_SIZE;
    const py = ((gy % TILE_SIZE) + TILE_SIZE) % TILE_SIZE;
    return t[py * TILE_SIZE + px];
  }

  /** Height in metres at a point, or NaN where no tile is loaded. */
  sample(p: LatLon): number {
    const { gx, gy } = toGlobalPixel(p, this.z);
    // Pixel values sit at pixel centres.
    const x = gx - 0.5;
    const y = gy - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const h00 = this.pixel(x0, y0);
    const h10 = this.pixel(x0 + 1, y0);
    const h01 = this.pixel(x0, y0 + 1);
    const h11 = this.pixel(x0 + 1, y0 + 1);
    return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
  }
}
