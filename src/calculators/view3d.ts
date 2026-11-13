// The 3D view: the area around a link or mesh on real terrain that you can tilt
// and turn, with each link's line of sight drawn in the air between antenna
// tops. Loaded only when someone opens it, since MapLibre is large.
//
// Terrain uses the same Terrain Tiles as the elevation math, and the base maps
// use the same tile addresses as the 2D maps, so areas cached for offline use
// show here too.

import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { distanceBetweenM } from "../lib/geo";
import { linkLineOrder, type LinkLineStyle } from "../lib/linkLines";
import { SENTINEL_MAX_ZOOM, SENTINEL_URL, USGS_MAX_ZOOM, USGS_URL } from "../lib/offlineArea";
import { LINK_SAMPLES, type Scene3D, lineOfSightHeights, linkSamples, viewBearing } from "../lib/scene3d";
import { TILE_URL } from "../lib/terrainTiles";
import { linkLegend } from "./linkLine";
import { OSM_ATTRIBUTION, SENTINEL_ATTRIBUTION, USGS_ATTRIBUTION } from "./mapKit";
import { isDarkTheme } from "./theme";

// The bundler moves the worker, so tell MapLibre where it ended up.
maplibregl.setWorkerUrl(workerUrl);

const BASE_KEY = "rf-toolkit:3d-base";
const EXAGGERATION_KEY = "rf-toolkit:3d-exaggeration";
const EXAGGERATIONS = [1, 1.5, 2, 3];
const TERRAIN_ATTRIBUTION = "Terrain Tiles (Mapzen, AWS Open Data); US data courtesy of the U.S. Geological Survey";
// Roughly the area USGS imagery covers, so the view doesn't ask for tiles that 404 elsewhere.
const USGS_BOUNDS: [number, number, number, number] = [-170, 17, -64, 72];

type Base = "satellite" | "map";

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice lasts until the view closes.
  }
};

/** A colour token from the stylesheet, as premultiplied RGBA for WebGL. */
function tokenRgba(name: string, alpha: number): [number, number, number, number] {
  const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  const n = m ? Number.parseInt(m[1], 16) : 0xffffff;
  return [((n >> 16) & 255) / 255 * alpha, ((n >> 8) & 255) / 255 * alpha, (n & 255) / 255 * alpha, alpha];
}
const tokenHex = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

const styleToken: Record<LinkLineStyle, string> = {
  "good-clear": "--good",
  "good-obstructed": "--good",
  marginal: "--warning",
  fail: "--critical",
};
// Dashes along the line in the air, in samples on / off, echoing the 2D standard.
const styleDash: Record<LinkLineStyle, [number, number] | undefined> = {
  "good-clear": undefined,
  "good-obstructed": [3, 2],
  marginal: [1, 2],
  fail: [1, 3],
};
const styleAlpha: Record<LinkLineStyle, number> = { "good-clear": 1, "good-obstructed": 1, marginal: 1, fail: 0.7 };

const VERTEX_SHADER = `#version 300 es
uniform mat4 u_matrix;
in vec3 a_pos;
in vec4 a_color;
out vec4 v_color;
void main() {
  gl_Position = u_matrix * vec4(a_pos, 1.0);
  v_color = a_color;
}`;
const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 fragColor;
void main() {
  fragColor = v_color;
}`;

/**
 * Draws the links in the air: for each, a solid band along the line of sight
 * with a faint curtain hanging from it to the ground, and a mast at each
 * antenna. Where terrain rises through the line, the ground hides it.
 */
function airLayer(scene: Scene3D, getExaggeration: () => number): maplibregl.CustomLayerInterface & { rebuild(): void } {
  let map: maplibregl.Map;
  let gl: WebGL2RenderingContext;
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let count = 0;
  let origin = { x: 0, y: 0, z: 0 };
  let lastKey = "";

  // Size bands and masts to the scene, so they read at any scale.
  const extentM = Math.max(
    200,
    ...scene.links.map((l) => distanceBetweenM(scene.points[l.a], scene.points[l.b])),
  );
  const bandM = Math.min(120, Math.max(4, extentM * 0.004));
  const mastM = bandM * 0.8;

  const build = (): Float32Array | undefined => {
    const ex = getExaggeration();
    const ground = (p: { lat: number; lon: number }) => map.queryTerrainElevation([p.lon, p.lat]);
    const data: number[] = [];
    const center = maplibregl.MercatorCoordinate.fromLngLat(map.getCenter(), 0);
    origin = { x: center.x, y: center.y, z: 0 };
    const at = (p: { lat: number; lon: number }, altM: number) => {
      const c = maplibregl.MercatorCoordinate.fromLngLat([p.lon, p.lat], altM);
      return [c.x - origin.x, c.y - origin.y, c.z];
    };
    const quad = (a: number[], b: number[], c: number[], d: number[], rgba: number[]) => {
      // Two triangles: a-b-c and c-b-d (a, b along the bottom edge; c, d on top).
      for (const v of [a, b, c, c, b, d]) data.push(v[0], v[1], v[2], ...rgba);
    };

    for (const link of scene.links) {
      const A = scene.points[link.a];
      const B = scene.points[link.b];
      const distanceM = distanceBetweenM(A, B);
      if (distanceM < 1) continue;
      const samples = linkSamples(A, B, LINK_SAMPLES);
      const groundEx = samples.map(ground);
      if (groundEx.some((g) => g === null)) return undefined; // terrain still loading
      const g = groundEx as number[];
      // queryTerrainElevation is already exaggerated; the line is worked out in
      // real metres, then scaled the same way so clearances stay true.
      const los = lineOfSightHeights(g[0] / ex + A.heightM, g[g.length - 1] / ex + B.heightM, distanceM, LINK_SAMPLES, scene.k).map((h) => h * ex);
      const alpha = styleAlpha[link.style];
      const band = tokenRgba(styleToken[link.style], alpha);
      const curtain = tokenRgba(styleToken[link.style], 0.18 * alpha);
      const dash = styleDash[link.style];
      const half = bandM / 2;
      for (let i = 0; i < LINK_SAMPLES; i++) {
        const p0 = samples[i];
        const p1 = samples[i + 1];
        // Curtain from the ground up to the line, only where the line is above ground.
        const top0 = Math.max(los[i] - half, g[i]);
        const top1 = Math.max(los[i + 1] - half, g[i + 1]);
        if (top0 > g[i] || top1 > g[i + 1]) quad(at(p0, g[i]), at(p1, g[i + 1]), at(p0, top0), at(p1, top1), curtain);
        if (dash && i % (dash[0] + dash[1]) >= dash[0]) continue;
        quad(at(p0, los[i] - half), at(p1, los[i + 1] - half), at(p0, los[i] + half), at(p1, los[i + 1] + half), band);
      }
    }

    // A mast at each antenna: two crossed thin panels from the ground to its top.
    const mast = tokenRgba("--text", 0.9);
    for (const p of scene.points) {
      const gEx = ground(p);
      if (gEx === null) return undefined;
      const top = gEx + Math.max(p.heightM, 1) * ex;
      const c = maplibregl.MercatorCoordinate.fromLngLat([p.lon, p.lat], 0);
      const w = (mastM / 2) * c.meterInMercatorCoordinateUnits();
      const z0 = maplibregl.MercatorCoordinate.fromLngLat([p.lon, p.lat], gEx).z;
      const z1 = maplibregl.MercatorCoordinate.fromLngLat([p.lon, p.lat], top).z;
      const x = c.x - origin.x;
      const y = c.y - origin.y;
      quad([x - w, y, z0], [x + w, y, z0], [x - w, y, z1], [x + w, y, z1], mast);
      quad([x, y - w, z0], [x, y + w, z0], [x, y - w, z1], [x, y + w, z1], mast);
    }
    return new Float32Array(data);
  };

  return {
    id: "rf-air",
    type: "custom",
    renderingMode: "3d",
    onAdd(m, context) {
      map = m;
      gl = context;
      const compile = (type: number, source: string) => {
        const shader = gl.createShader(type)!;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        return shader;
      };
      program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
      gl.linkProgram(program);
      buffer = gl.createBuffer();
    },
    rebuild() {
      if (!map || !buffer) return;
      const data = build();
      if (!data) return;
      // Only redraw when something moved, or each redraw would set off another.
      const key = `${data.length}:${data[2] ?? 0}:${data[data.length - 5] ?? 0}:${origin.x}:${origin.y}`;
      if (key === lastKey) return;
      lastKey = key;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      count = data.length / 7;
      map.triggerRepaint();
    },
    render(_gl, options) {
      if (!program || !buffer || !count) return;
      // Shift the matrix to the scene's origin, so vertices stay small enough
      // for 32-bit floats to place them to the metre.
      const m = options.defaultProjectionData.mainMatrix;
      const t = new Float32Array(16);
      for (let i = 0; i < 12; i++) t[i] = m[i];
      for (let r = 0; r < 4; r++) t[12 + r] = m[r] * origin.x + m[4 + r] * origin.y + m[8 + r] * origin.z + m[12 + r];
      gl.useProgram(program);
      gl.uniformMatrix4fv(gl.getUniformLocation(program, "u_matrix"), false, t);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const pos = gl.getAttribLocation(program, "a_pos");
      const color = gl.getAttribLocation(program, "a_color");
      gl.enableVertexAttribArray(pos);
      gl.enableVertexAttribArray(color);
      gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, 28, 0);
      gl.vertexAttribPointer(color, 4, gl.FLOAT, false, 28, 12);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, count);
    },
  };
}

/** Link ground tracks, draped on the terrain, for orientation under the lines in the air. */
function groundTracks(scene: Scene3D): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: scene.links.map((l) => ({
      type: "Feature",
      properties: { style: l.style },
      geometry: {
        type: "LineString",
        coordinates: [
          [scene.points[l.a].lon, scene.points[l.a].lat],
          [scene.points[l.b].lon, scene.points[l.b].lat],
        ],
      },
    })),
  };
}

const template = (title: string) => `
  <div class="view3d-bar">
    <h2>3D view <span class="meta">${title}</span></h2>
    <div class="seg" role="group" aria-label="Base map">
      <button type="button" data-base="satellite">Satellite</button>
      <button type="button" data-base="map">Map</button>
    </div>
    <label class="view3d-ex">Height
      <select data-v="ex" aria-label="Terrain height exaggeration">${EXAGGERATIONS.map((e) => `<option value="${e}">${e}×</option>`).join("")}</select>
    </label>
    <button type="button" class="secondary" data-v="close">Close</button>
  </div>
  <div class="view3d-map" data-v="map"><p class="view3d-loading" data-v="loading" role="status">Loading terrain…</p></div>
  <div class="view3d-foot">
    <span data-v="legend"></span>
    <span class="note" data-v="hint">Drag to move. Right-drag or Ctrl-drag to tilt and turn; two fingers on a phone. Lines in the air are lowered for the earth's curve, so clearance matches the 2D check.</span>
  </div>
`;

export function open3DView(scene: Scene3D): void {
  const dialog = document.createElement("dialog");
  dialog.className = "view3d";
  dialog.setAttribute("aria-label", `3D view, ${scene.title}`);
  dialog.innerHTML = template(scene.title);
  const el = <T extends HTMLElement = HTMLElement>(name: string) => dialog.querySelector<T>(`[data-v="${name}"]`)!;
  const styles = [...new Set(scene.links.map((l) => l.style))];
  if (styles.length) el("legend").replaceWith(linkLegend(linkLineOrder.filter((s) => styles.includes(s))));
  else el("legend").remove();
  document.body.append(dialog);
  dialog.showModal();

  let base: Base = read(BASE_KEY) === "map" ? "map" : "satellite";
  const savedEx = Number(read(EXAGGERATION_KEY));
  let exaggeration = EXAGGERATIONS.includes(savedEx) ? savedEx : 1.5;
  const exSelect = el<HTMLSelectElement>("ex");
  exSelect.value = String(exaggeration);

  let map: maplibregl.Map | undefined;
  const close = () => {
    map?.remove();
    map = undefined;
    dialog.close();
    dialog.remove();
  };
  el("close").addEventListener("click", close);
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });

  const dark = isDarkTheme();
  const visible = (on: boolean) => (on ? "visible" : "none") as "visible" | "none";
  const trackLayers: maplibregl.LineLayerSpecification[] = linkLineOrder.map((s) => ({
    id: `track-${s}`,
    type: "line",
    source: "tracks",
    filter: ["==", ["get", "style"], s],
    layout: { "line-cap": "round" },
    paint: {
      "line-color": tokenHex(styleToken[s], "#888888"),
      "line-width": 2,
      "line-opacity": 0.55 * styleAlpha[s],
      ...(s === "good-clear" ? {} : { "line-dasharray": s === "good-obstructed" ? [3, 2.5] : s === "marginal" ? [0.8, 2.2] : [0.1, 2] }),
    },
  }));

  try {
    map = new maplibregl.Map({
      container: el("map"),
      center: [scene.center.lon, scene.center.lat],
      // Leaflet's zoom levels are one step finer than MapLibre's.
      zoom: Math.max(0, scene.zoom - 1),
      pitch: 60,
      maxPitch: 80,
      attributionControl: { compact: true },
      style: {
        version: 8,
        sources: {
          dem: { type: "raster-dem", tiles: [TILE_URL], tileSize: 256, maxzoom: 15, encoding: "terrarium", attribution: TERRAIN_ATTRIBUTION },
          shade: { type: "raster-dem", tiles: [TILE_URL], tileSize: 256, maxzoom: 15, encoding: "terrarium" },
          osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: OSM_ATTRIBUTION },
          sentinel: { type: "raster", tiles: [SENTINEL_URL], tileSize: 256, maxzoom: SENTINEL_MAX_ZOOM, attribution: SENTINEL_ATTRIBUTION },
          usgs: { type: "raster", tiles: [USGS_URL], tileSize: 256, maxzoom: USGS_MAX_ZOOM, bounds: USGS_BOUNDS, attribution: USGS_ATTRIBUTION },
          tracks: { type: "geojson", data: groundTracks(scene) },
        },
        layers: [
          { id: "background", type: "background", paint: { "background-color": tokenHex("--card-2", "#232321") } },
          {
            id: "osm",
            type: "raster",
            source: "osm",
            layout: { visibility: visible(base === "map") },
            paint: dark ? { "raster-brightness-max": 0.55, "raster-saturation": -0.4 } : {},
          },
          { id: "sentinel", type: "raster", source: "sentinel", layout: { visibility: visible(base === "satellite") } },
          { id: "usgs", type: "raster", source: "usgs", layout: { visibility: visible(base === "satellite") } },
          {
            id: "shade",
            type: "hillshade",
            source: "shade",
            layout: { visibility: visible(base === "map") },
            paint: { "hillshade-exaggeration": 0.45 },
          },
          ...trackLayers,
        ],
        terrain: { source: "dem", exaggeration },
      },
    });
  } catch {
    el("map").innerHTML = '<p class="note view3d-error">The 3D view needs WebGL, which this browser or device doesn\'t offer. The 2D map still works.</p>';
    return;
  }

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  // Missing tiles (no imagery for a spot, or offline) shouldn't fill the console.
  map.on("error", () => {});

  const air = airLayer(scene, () => exaggeration);
  map.on("load", () => {
    if (!map) return;
    // Start the credits folded to their (i) button; MapLibre opens them on load.
    el("map").querySelector(".maplibregl-compact-show")?.classList.remove("maplibregl-compact-show");
    map.addLayer(air);
    for (const p of scene.points) {
      const pin = document.createElement("div");
      pin.className = "view3d-pin";
      pin.textContent = p.label; // user text: set as text, not markup
      new maplibregl.Marker({ element: pin, anchor: "bottom", offset: [0, -6] }).setLngLat([p.lon, p.lat]).addTo(map);
    }
    // First look: frame the points, side-on to a single link.
    if (scene.points.length >= 2) {
      const bounds = new maplibregl.LngLatBounds();
      for (const p of scene.points) bounds.extend([p.lon, p.lat]);
      map.fitBounds(bounds, { padding: 90, maxZoom: 14, bearing: viewBearing(scene.points), pitch: 62, duration: 0 });
      // Tilted, the far side of a spread-out mesh falls off the top: step back a little.
      if (scene.points.length > 2) map.setZoom(map.getZoom() - 0.7);
    } else if (scene.points.length === 1) {
      map.jumpTo({ center: [scene.points[0].lon, scene.points[0].lat], zoom: 12.5, pitch: 62 });
    }
  });
  // Terrain arrives tile by tile: place the lines again once it settles.
  map.on("idle", () => {
    dialog.querySelector("[data-v=loading]")?.remove();
    air.rebuild();
  });

  const setBase = (next: Base) => {
    base = next;
    write(BASE_KEY, next);
    for (const b of dialog.querySelectorAll<HTMLButtonElement>("[data-base]")) b.setAttribute("aria-pressed", String(b.dataset.base === next));
    if (!map?.isStyleLoaded()) return;
    map.setLayoutProperty("osm", "visibility", visible(next === "map"));
    map.setLayoutProperty("shade", "visibility", visible(next === "map"));
    map.setLayoutProperty("sentinel", "visibility", visible(next === "satellite"));
    map.setLayoutProperty("usgs", "visibility", visible(next === "satellite"));
  };
  for (const b of dialog.querySelectorAll<HTMLButtonElement>("[data-base]")) b.addEventListener("click", () => setBase(b.dataset.base as Base));
  setBase(base);

  exSelect.addEventListener("change", () => {
    exaggeration = Number(exSelect.value);
    write(EXAGGERATION_KEY, String(exaggeration));
    map?.setTerrain({ source: "dem", exaggeration });
  });
}
