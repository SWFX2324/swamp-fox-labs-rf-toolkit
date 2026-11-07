// Land cover from a map instead of one Environment for everything: the
// Sentinel-2 10 m land use/land cover map by Impact Observatory, Microsoft and
// Esri (CC BY 4.0), served by Esri's public image service. Each pixel holds a
// class code; the class at each antenna picks the Environment profile (and so
// the ITU-R P.2108 clutter loss) used at that end of the path.
//
// Tiles are requested on the same web-map grid as the terrain, as raw class
// codes in a greyscale PNG, resampled by majority so a coarse pixel takes its
// most common class.

import { type Environment, findEnvironment } from "./environment";
import type { LatLon } from "./geo";
import { TILE_SIZE, type TileId, toGlobalPixel } from "./terrainTiles";

/** The Environment option that reads the land-cover map. */
export const AUTO_ENVIRONMENT = "auto";
export const LAND_COVER_YEAR = 2025;
export const LAND_COVER_HOST = "https://ic.imagery1.arcgis.com";
const SERVICE = `${LAND_COVER_HOST}/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer/exportImage`;
export const LAND_COVER_CREDIT = "Land cover: Impact Observatory, Microsoft and Esri (CC BY 4.0)";
/** Pixels at zoom 12 are about 38 m at the equator, 30 m in the mid-latitudes. */
export const LAND_COVER_POINT_ZOOM = 12;

export type LandCoverClass = 0 | 1 | 2 | 4 | 5 | 7 | 8 | 9 | 10 | 11;

export const landCoverNames: Record<number, string> = {
  0: "No data",
  1: "Water",
  2: "Trees",
  4: "Flooded vegetation",
  5: "Crops",
  7: "Built area",
  8: "Bare ground",
  9: "Snow or ice",
  10: "Clouds",
  11: "Rangeland",
};

const EARTH_HALF_M = 20037508.342789244;
const START = Date.UTC(LAND_COVER_YEAR, 0, 1);
const END = Date.UTC(LAND_COVER_YEAR + 1, 0, 1) - 1;

/** The request for one web-map tile of class codes. */
export function landCoverUrl({ z, x, y }: TileId): string {
  const size = (2 * EARTH_HALF_M) / 2 ** z;
  const bbox = [-EARTH_HALF_M + x * size, EARTH_HALF_M - (y + 1) * size, -EARTH_HALF_M + (x + 1) * size, EARTH_HALF_M - y * size];
  const params = new URLSearchParams({
    bbox: bbox.map((v) => v.toFixed(2)).join(","),
    bboxSR: "3857",
    imageSR: "3857",
    size: `${TILE_SIZE},${TILE_SIZE}`,
    format: "png",
    pixelType: "U8",
    interpolation: "RSP_Majority",
    renderingRule: JSON.stringify({ rasterFunction: "None" }),
    time: `${START},${END}`,
    f: "image",
  });
  return `${SERVICE}?${params}`;
}

/** Class codes from a tile's RGBA pixels: the grey level, 0 where transparent. */
export function decodeLandCover(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const out = new Uint8Array(TILE_SIZE * TILE_SIZE);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4 + 3] === 0 ? 0 : rgba[i * 4];
  return out;
}

/**
 * Built-up share above which a built pixel counts as Urban rather than
 * Suburban, over the window around it.
 */
const URBAN_SHARE = 0.7;
/** Half-width of that window, pixels: 5 × 5, about 150 m at zoom 12. */
const WINDOW = 2;

/** The Environment profile for a class, given how built-up the area around it is. */
export function environmentForClass(cls: number, builtShare = 0): string {
  switch (cls) {
    case 1:
      return "water";
    case 2:
      return "dense";
    case 4:
      return "light";
    case 5:
    case 9:
    case 11:
      return "fields";
    case 7:
      return builtShare >= URBAN_SHARE ? "urban" : "suburban";
    case 8:
      return "desert";
    case 10:
      // Cloud-covered in the source imagery: no better guess than light cover.
      return "light";
    default:
      return "none";
  }
}

export interface LandCoverPoint {
  cls: number;
  environment: Environment;
}

/** Decoded class tiles for one zoom. */
export class LandCoverGrid {
  private tiles = new Map<string, Uint8Array>();

  constructor(readonly z: number) {}

  set(tile: TileId, classes: Uint8Array): void {
    this.tiles.set(`${tile.x}/${tile.y}`, classes);
  }

  get size(): number {
    return this.tiles.size;
  }

  private pixel(px: number, py: number): number {
    const n = 2 ** this.z;
    const tx = ((Math.floor(px / TILE_SIZE) % n) + n) % n;
    const t = this.tiles.get(`${tx}/${Math.floor(py / TILE_SIZE)}`);
    if (!t) return 0;
    const x = ((px % TILE_SIZE) + TILE_SIZE) % TILE_SIZE;
    const y = ((py % TILE_SIZE) + TILE_SIZE) % TILE_SIZE;
    return t[y * TILE_SIZE + x];
  }

  /** The class at a point, 0 where there's no tile or no data. */
  classAt(p: LatLon): number {
    const { gx, gy } = toGlobalPixel(p, this.z);
    return this.pixel(Math.floor(gx), Math.floor(gy));
  }

  /** The class and Environment profile at a point. */
  at(p: LatLon): LandCoverPoint {
    const { gx, gy } = toGlobalPixel(p, this.z);
    const px = Math.floor(gx);
    const py = Math.floor(gy);
    const cls = this.pixel(px, py);
    let share = 0;
    if (cls === 7) {
      let built = 0;
      let total = 0;
      for (let dy = -WINDOW; dy <= WINDOW; dy++) {
        for (let dx = -WINDOW; dx <= WINDOW; dx++) {
          const c = this.pixel(px + dx, py + dy);
          if (c === 0) continue;
          total++;
          if (c === 7) built++;
        }
      }
      share = total ? built / total : 1;
    }
    return { cls, environment: findEnvironment(environmentForClass(cls, share)) };
  }
}

/** A plain-language name for what's at a point, for notes and the ledger. */
export function describePoint(p: LandCoverPoint): string {
  const name = landCoverNames[p.cls] ?? "Unknown";
  return p.environment.id === "none" ? name : `${name} (${p.environment.name})`;
}
