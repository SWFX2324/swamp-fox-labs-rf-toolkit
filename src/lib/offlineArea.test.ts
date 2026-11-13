import { describe, expect, it } from "vitest";
import { IMAGERY_CACHE, MAX_IMAGERY_TILES, SENTINEL_MAX_ZOOM, TERRAIN_CACHE, USGS_MAX_ZOOM, planOfflineArea, tileBox, tileInUsgsArea, tilesInBox } from "./offlineArea";
import { chooseZoom, tilesCovering, tileUrl } from "./terrainTiles";

// About 30 km across, at Camp Lejeune and in Germany.
const lejeune = { north: 34.8, south: 34.53, west: -77.5, east: -77.17 };
const germany = { north: 49.6, south: 49.33, west: 8.5, east: 8.9 };

const imagery = (plan: ReturnType<typeof planOfflineArea>) => plan.tiles.filter((t) => t.cache === IMAGERY_CACHE);

describe("tilesInBox", () => {
  it("covers the box", () => {
    expect(tilesInBox({ north: 0.01, south: -0.01, west: -0.01, east: 0.01 }, 2)).toEqual([
      { z: 2, x: 1, y: 1 },
      { z: 2, x: 2, y: 1 },
      { z: 2, x: 1, y: 2 },
      { z: 2, x: 2, y: 2 },
    ]);
  });

  it("wraps past the date line", () => {
    const xs = tilesInBox({ north: 1, south: 0.5, west: 179, east: 181 }, 4).map((t) => t.x);
    expect(xs).toEqual([15, 0]);
  });

  it("never repeats a column on a view wider than the world", () => {
    expect(tilesInBox({ north: 1, south: 0.5, west: -400, east: 400 }, 2)).toHaveLength(4);
  });
});

describe("planOfflineArea", () => {
  it("never asks for a street map", () => {
    expect(planOfflineArea(lejeune).tiles.some((t) => t.url.includes("openstreetmap"))).toBe(false);
  });

  it("saves the terrain tile a coverage run would ask for, at any radius in the view", () => {
    const urls = new Set(planOfflineArea(lejeune).tiles.map((t) => t.url));
    const center = { lat: 34.665, lon: -77.335 };
    for (const radius of [2_000, 5_000, 12_000]) {
      const z = chooseZoom(center, radius, 36);
      for (const t of tilesCovering(center, radius, z)) expect(urls).toContain(tileUrl(t));
    }
  });

  it("adds USGS imagery in the US, down to its native zoom if the limit allows", () => {
    const small = { north: 34.68, south: 34.66, west: -77.35, east: -77.33 };
    const plan = planOfflineArea(small);
    expect(plan.usgs).toBe(true);
    expect(plan.imageryMaxZoom).toBe(USGS_MAX_ZOOM);
    expect(imagery(plan).some((t) => t.url.includes("nationalmap") && t.url.includes(`/tile/${USGS_MAX_ZOOM}/`))).toBe(true);
    expect(imagery(plan).some((t) => t.url.includes("s2cloudless") && t.url.includes(`/g/${USGS_MAX_ZOOM}/`))).toBe(false);
    // In the US the USGS hybrid has the labels, so the EOX overlay stays out.
    expect(imagery(plan).some((t) => t.url.includes("USGSImageryTopo"))).toBe(true);
    expect(imagery(plan).some((t) => t.url.includes("overlay_bright"))).toBe(false);
  });

  it("uses Sentinel alone outside the US", () => {
    const plan = planOfflineArea(germany);
    expect(plan.usgs).toBe(false);
    expect(imagery(plan).every((t) => t.url.includes("eox.at"))).toBe(true);
    expect(plan.imageryMaxZoom).toBeLessThanOrEqual(SENTINEL_MAX_ZOOM);
  });

  it("stops imagery at the tile limit", () => {
    const plan = planOfflineArea(lejeune);
    expect(imagery(plan).length).toBeLessThanOrEqual(MAX_IMAGERY_TILES);
    expect(plan.imageryMaxZoom).toBeLessThan(USGS_MAX_ZOOM);
    expect(imagery(plan).length).toBeGreaterThan(0);
  });

  it("files terrain under the terrain cache with the same URLs the app loads", () => {
    const terrain = planOfflineArea(lejeune).tiles.filter((t) => t.cache === TERRAIN_CACHE);
    expect(terrain.length).toBeGreaterThan(0);
    expect(terrain.every((t) => t.url.startsWith("https://s3.amazonaws.com/elevation-tiles-prod/terrarium/"))).toBe(true);
  });

  it("allows an 80 km coverage radius but refuses a whole region", () => {
    expect(planOfflineArea({ north: 35.4, south: 33.95, west: -78.2, east: -76.45 }).tooBig).toBe(false);
    const huge = planOfflineArea({ north: 40, south: 30, west: -85, east: -70 });
    expect(huge.tooBig).toBe(true);
    expect(huge.tiles).toHaveLength(0);
  });

  it("estimates a size in megabytes", () => {
    const { estimatedBytes } = planOfflineArea(lejeune);
    expect(estimatedBytes).toBeGreaterThan(1e6);
    expect(estimatedBytes).toBeLessThan(200e6);
  });
});

describe("tileInUsgsArea", () => {
  const tileAt = (lat: number, lon: number, z: number) => {
    const n = 2 ** z;
    const r = (lat * Math.PI) / 180;
    return { z, x: Math.floor(((lon + 180) / 360) * n), y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n) };
  };

  it("finds tiles inside the USGS hybrid's areas, so EOX labels skip them", () => {
    expect(tileInUsgsArea(tileAt(34.75, -77.43, 12))).toBe(true); // coastal North Carolina
    expect(tileInUsgsArea(tileAt(48.86, 2.35, 12))).toBe(false); // Paris
  });

  it("keeps labels on tiles that only partly overlap the US", () => {
    // A zoom-3 tile spans far beyond the lower 48.
    expect(tileInUsgsArea(tileAt(40, -100, 3))).toBe(false);
  });

  it("gives a tile's corners in degrees", () => {
    const b = tileBox({ z: 1, x: 1, y: 0 });
    expect(b.west).toBe(0);
    expect(b.east).toBe(180);
    expect(b.north).toBeCloseTo(85.0511, 3);
    expect(b.south).toBeCloseTo(0, 9);
  });
});
