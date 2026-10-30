import { describe, expect, it } from "vitest";
import {
  ElevationGrid,
  TILE_SIZE,
  chooseZoom,
  decodeTerrarium,
  decodeTile,
  fromGlobalPixel,
  pathHeights,
  tileUrl,
  tilesCovering,
  tilesForPoints,
  toGlobalPixel,
  zoomForPoints,
} from "./terrainTiles";

describe("tile maths", () => {
  it("puts 0°, 0° at the corner of the four central tiles", () => {
    expect(toGlobalPixel({ lat: 0, lon: 0 }, 1)).toEqual({ gx: 256, gy: 256 });
  });

  it("round-trips global pixels", () => {
    const p = { lat: 35.2271, lon: -80.8431 };
    const { gx, gy } = toGlobalPixel(p, 12);
    const back = fromGlobalPixel(gx, gy, 12);
    expect(back.lat).toBeCloseTo(p.lat, 9);
    expect(back.lon).toBeCloseTo(p.lon, 9);
  });

  it("builds the terrarium URL", () => {
    expect(tileUrl({ z: 11, x: 564, y: 806 })).toBe(
      "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/11/564/806.png",
    );
  });
});

describe("decoding", () => {
  it("decodes terrarium colours", () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(128, 1, 128)).toBe(1.5);
    expect(decodeTerrarium(127, 255, 0)).toBe(-1);
  });

  it("decodes a whole tile's RGBA", () => {
    const rgba = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
    rgba.set([130, 44, 0, 255], 0); // 512 + 44 = 556 m
    expect(decodeTile(rgba)[0]).toBe(556);
    expect(decodeTile(rgba)[1]).toBe(-32768);
  });
});

describe("tilesCovering and chooseZoom", () => {
  const charlotte = { lat: 35.2271, lon: -80.8431 };

  it("covers more tiles at higher zoom and for larger areas", () => {
    expect(tilesCovering(charlotte, 10_000, 12).length).toBeGreaterThan(tilesCovering(charlotte, 10_000, 10).length);
    expect(tilesCovering(charlotte, 40_000, 11).length).toBeGreaterThan(tilesCovering(charlotte, 10_000, 11).length);
  });

  it("includes the tile under the centre", () => {
    const { gx, gy } = toGlobalPixel(charlotte, 11);
    const centre = { z: 11, x: Math.floor(gx / TILE_SIZE), y: Math.floor(gy / TILE_SIZE) };
    expect(tilesCovering(charlotte, 5_000, 11)).toContainEqual(centre);
  });

  it("picks the sharpest zoom that fits the tile budget", () => {
    const z = chooseZoom(charlotte, 15_000, 36);
    expect(tilesCovering(charlotte, 15_000, z).length).toBeLessThanOrEqual(36);
    expect(z === 12 || tilesCovering(charlotte, 15_000, z + 1).length > 36).toBe(true);
    expect(chooseZoom(charlotte, 80_000)).toBeLessThan(chooseZoom(charlotte, 5_000));
  });
});

describe("tilesForPoints and zoomForPoints", () => {
  const a = { lat: 35.5951, lon: -82.5515 };
  const b = { lat: 35.7454, lon: -81.6848 };
  const path = Array.from({ length: 50 }, (_, i) => ({
    lat: a.lat + ((b.lat - a.lat) * i) / 49,
    lon: a.lon + ((b.lon - a.lon) * i) / 49,
  }));

  it("covers only the tiles along a path, not its whole bounding box", () => {
    const z = 12;
    const along = tilesForPoints(path, z);
    const box = tilesCovering({ lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 }, 45_000, z);
    expect(along.length).toBeLessThan(box.length);
    expect(new Set(along.map((t) => `${t.x}/${t.y}`)).size).toBe(along.length);
  });

  it("includes the neighbour tile when a point sits on a tile edge", () => {
    const edge = fromGlobalPixel(256 * 1000, 256 * 500 + 100, 12);
    const tiles = tilesForPoints([edge], 12);
    expect(tiles.map((t) => t.x).sort((p, q) => p - q)).toEqual([999, 1000]);
  });

  it("stays within the tile budget", () => {
    expect(tilesForPoints(path, zoomForPoints(path, 10)).length).toBeLessThanOrEqual(10);
  });
});

describe("pathHeights", () => {
  it("floors sea-floor depths at sea level and fills gaps", () => {
    expect(pathHeights([12, -40, Number.NaN, 30])).toEqual([12, 0, 0, 30]);
    expect(pathHeights([Number.NaN, 5])).toEqual([0, 5]);
  });
});

describe("ElevationGrid", () => {
  // One tile at zoom 2 whose height rises 1 m per pixel to the east.
  const grid = new ElevationGrid(2);
  const heights = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let y = 0; y < TILE_SIZE; y++) for (let x = 0; x < TILE_SIZE; x++) heights[y * TILE_SIZE + x] = x;
  grid.set({ z: 2, x: 1, y: 1 }, heights);

  it("interpolates between pixel centres", () => {
    const at = (px: number, py: number) => fromGlobalPixel(256 + px, 256 + py, 2);
    expect(grid.sample(at(10.5, 10.5))).toBeCloseTo(10, 6);
    expect(grid.sample(at(11, 10.5))).toBeCloseTo(10.5, 6);
  });

  it("is NaN outside loaded tiles", () => {
    expect(grid.sample({ lat: 0, lon: 0.5 })).toBeNaN();
    expect(grid.has({ z: 2, x: 1, y: 1 })).toBe(true);
  });
});
