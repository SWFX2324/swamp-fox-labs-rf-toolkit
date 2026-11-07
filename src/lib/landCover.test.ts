import { describe, expect, it } from "vitest";
import { LandCoverGrid, decodeLandCover, describePoint, environmentForClass, landCoverUrl } from "./landCover";
import { TILE_SIZE, toGlobalPixel } from "./terrainTiles";

describe("landCoverUrl", () => {
  it("asks for a raw-class tile in web-map metres", () => {
    const url = new URL(landCoverUrl({ z: 1, x: 1, y: 0 }));
    expect(url.origin).toBe("https://ic.imagery1.arcgis.com");
    // Zoom 1, tile x1 y0 is the north-east quarter of the world.
    expect(url.searchParams.get("bbox")).toBe("0.00,0.00,20037508.34,20037508.34");
    expect(url.searchParams.get("interpolation")).toBe("RSP_Majority");
    expect(JSON.parse(url.searchParams.get("renderingRule")!)).toEqual({ rasterFunction: "None" });
    expect(url.searchParams.get("size")).toBe("256,256");
  });

  it("is the same every time, so cached tiles are found again", () => {
    expect(landCoverUrl({ z: 12, x: 1133, y: 1625 })).toBe(landCoverUrl({ z: 12, x: 1133, y: 1625 }));
  });
});

describe("decodeLandCover", () => {
  it("reads the grey level, with transparent pixels as no data", () => {
    const rgba = new Uint8Array(TILE_SIZE * TILE_SIZE * 4);
    rgba.set([7, 7, 7, 255], 0);
    rgba.set([2, 2, 2, 0], 4);
    const out = decodeLandCover(rgba);
    expect(out[0]).toBe(7);
    expect(out[1]).toBe(0);
  });
});

describe("environmentForClass", () => {
  it("maps each class to an Environment profile", () => {
    expect(environmentForClass(1)).toBe("water");
    expect(environmentForClass(2)).toBe("dense");
    expect(environmentForClass(5)).toBe("fields");
    expect(environmentForClass(11)).toBe("fields");
    expect(environmentForClass(8)).toBe("desert");
    expect(environmentForClass(0)).toBe("none");
  });

  it("splits built areas by how built-up the neighbourhood is", () => {
    expect(environmentForClass(7, 0.3)).toBe("suburban");
    expect(environmentForClass(7, 0.9)).toBe("urban");
  });
});

describe("LandCoverGrid", () => {
  const p = { lat: 35.2271, lon: -80.8431 };
  const z = 12;
  const { gx, gy } = toGlobalPixel(p, z);
  const tile = { z, x: Math.floor(gx / TILE_SIZE), y: Math.floor(gy / TILE_SIZE) };
  const px = Math.floor(gx) % TILE_SIZE;
  const py = Math.floor(gy) % TILE_SIZE;

  it("finds the class and profile at a point", () => {
    const classes = new Uint8Array(TILE_SIZE * TILE_SIZE).fill(2);
    const grid = new LandCoverGrid(z);
    grid.set(tile, classes);
    expect(grid.classAt(p)).toBe(2);
    expect(grid.at(p).environment.id).toBe("dense");
    expect(describePoint(grid.at(p))).toBe("Trees (Dense Vegetation)");
  });

  it("calls a built pixel urban only when the area around it is built up", () => {
    const town = new Uint8Array(TILE_SIZE * TILE_SIZE).fill(7);
    const grid = new LandCoverGrid(z);
    grid.set(tile, town);
    expect(grid.at(p).environment.id).toBe("urban");

    const village = new Uint8Array(TILE_SIZE * TILE_SIZE).fill(5);
    village[py * TILE_SIZE + px] = 7;
    const grid2 = new LandCoverGrid(z);
    grid2.set(tile, village);
    expect(grid2.at(p).environment.id).toBe("suburban");
  });

  it("returns no data where no tile is loaded", () => {
    expect(new LandCoverGrid(z).at(p).environment.id).toBe("none");
  });
});
