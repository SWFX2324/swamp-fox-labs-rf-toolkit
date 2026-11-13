// Shared Leaflet setup: a Streets, Dark or Satellite base map and a recenter
// button that frames whatever the page cares about. The base map starts as Dark
// in dark mode and Streets in light mode; a choice is remembered for that theme
// across every map in the app.

import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { SENTINEL_MAX_ZOOM, SENTINEL_URL, SENTINEL_YEAR, USGS_MAX_ZOOM, USGS_URL } from "../lib/offlineArea";
import { addOfflineControl } from "./offlineControl";
import { THEME_EVENT, isDarkTheme } from "./theme";
import type { Scene3D } from "../lib/scene3d";

const LAYER_KEY = "rf-toolkit:map-layer";
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export const SENTINEL_ATTRIBUTION = `<a href="https://cloudless.eox.at">EOxCloudless</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data ${SENTINEL_YEAR})`;
export const USGS_ATTRIBUTION = '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>';

type LayerName = "Streets" | "Dark" | "Satellite";

const themeKey = (dark: boolean) => `${LAYER_KEY}:${dark ? "dark" : "light"}`;
const isLayerName = (v: string | null): v is LayerName => v === "Streets" || v === "Dark" || v === "Satellite";

function readLayer(dark: boolean): LayerName {
  try {
    const saved = localStorage.getItem(themeKey(dark));
    if (isLayerName(saved)) return saved;
    // Before choices were kept per theme there was one for both. Only carry
    // over Satellite, so the Streets and Dark defaults follow the theme.
    if (localStorage.getItem(LAYER_KEY) === "Satellite") return "Satellite";
  } catch {
    // Storage blocked: use the theme's default.
  }
  return dark ? "Dark" : "Streets";
}

function saveLayer(name: string): void {
  try {
    localStorage.setItem(themeKey(isDarkTheme()), name);
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
}

export interface ClearControl {
  /** Show the button only while the map has something to clear. */
  setVisible(visible: boolean): void;
}

/**
 * A labelled "Clear map" button in the same corner of every map, for removing
 * the page's pins, nodes or coverage. what names them for screen readers.
 */
export function addClearControl(map: L.Map, what: string, onClear: () => void): ClearControl {
  let button: HTMLButtonElement | undefined;
  const Control = L.Control.extend({
    onAdd() {
      button = L.DomUtil.create("button", "map-clear");
      button.type = "button";
      button.hidden = true;
      button.setAttribute("aria-label", `Clear ${what} from the map`);
      button.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>Clear map';
      L.DomEvent.disableClickPropagation(button);
      L.DomEvent.on(button, "click", (e) => {
        L.DomEvent.preventDefault(e);
        onClear();
      });
      return button;
    },
  });
  new Control({ position: "bottomleft" }).addTo(map);
  return {
    setVisible(visible) {
      if (button) button.hidden = !visible;
    },
  };
}

/** Default view when a page has nothing to show yet: the contiguous US. */
export function showDefaultView(map: L.Map): void {
  map.setView([37.5, -96], 4);
}

/**
 * A map with base-layer choice and a recenter button. recenter() should frame
 * the page's pins, nodes or area; it is also what the page calls on load.
 */
export function createMap(container: HTMLElement, recenter: (map: L.Map) => void): L.Map {
  const map = L.map(container);
  // Dark is the same OpenStreetMap tiles recoloured in CSS (see .map-dark),
  // so it needs no API key, no extra provider and shares the offline cache.
  const osm = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const layers: Record<LayerName, L.Layer> = {
    // CORS here too, because browsers count a cached no-CORS tile as several MB.
    Streets: L.tileLayer(osm, { maxZoom: 19, crossOrigin: true, attribution: OSM_ATTRIBUTION }),
    Dark: L.tileLayer(osm, { maxZoom: 19, crossOrigin: true, attribution: OSM_ATTRIBUTION, className: "map-dark" }),
    // Sentinel-2 covers the world at about 10 m. USGS aerial imagery sits on top
    // at about 1 m but only covers the US; elsewhere its tiles 404 and Sentinel
    // shows through. Both are keyless, and CORS keeps those 404s out of the cache.
    Satellite: L.layerGroup([
      L.tileLayer(SENTINEL_URL, {
        maxZoom: 19,
        maxNativeZoom: SENTINEL_MAX_ZOOM,
        crossOrigin: true,
        attribution: SENTINEL_ATTRIBUTION,
      }),
      L.tileLayer(USGS_URL, {
        maxZoom: 19,
        maxNativeZoom: USGS_MAX_ZOOM,
        crossOrigin: true,
        attribution: USGS_ATTRIBUTION,
      }),
    ]),
  };
  let current = readLayer(isDarkTheme());
  layers[current].addTo(map);
  L.control.layers(layers, undefined, { position: "topright" }).addTo(map);
  // The layer control also fires this when the code adds a layer: the first one
  // once the map has a view, and theme swaps. Only a different layer is a choice.
  map.on("baselayerchange", (e: L.LayersControlEvent) => {
    if (!isLayerName(e.name) || e.name === current) return;
    current = e.name;
    saveLayer(e.name);
  });
  // Switch to the new theme's map when the theme changes.
  const onTheme = () => {
    if (!container.isConnected) {
      window.removeEventListener(THEME_EVENT, onTheme);
      return;
    }
    const next = readLayer(isDarkTheme());
    if (next === current) return;
    const previous = current;
    current = next;
    map.removeLayer(layers[previous]);
    layers[next].addTo(map);
  };
  window.addEventListener(THEME_EVENT, onTheme);

  const Recenter = L.Control.extend({
    onAdd() {
      const bar = L.DomUtil.create("div", "leaflet-bar recenter-control");
      const button = L.DomUtil.create("a", "", bar);
      button.href = "#";
      button.title = "Recenter";
      button.setAttribute("role", "button");
      button.setAttribute("aria-label", "Recenter the map");
      button.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></svg>';
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(button, "click", (e) => {
        L.DomEvent.preventDefault(e);
        recenter(map);
      });
      return bar;
    },
  });
  new Recenter({ position: "topleft" }).addTo(map);
  addOfflineControl(map);

  // A page opened out of sight has no width yet, and Leaflet's fit jumps to full
  // zoom without one. Frame the page again once the map has a real size.
  const hasSize = () => container.clientWidth > 0 && container.clientHeight > 0;
  let sized = hasSize();
  new ResizeObserver(() => {
    map.invalidateSize();
    if (sized || !hasSize()) return;
    sized = true;
    recenter(map);
  }).observe(container);
  recenter(map);
  return map;
}

/**
 * A "3D" button under the recenter button. scene() describes what to show; the
 * 2D map's view is used when there are no points. The 3D view (and MapLibre)
 * loads only when pressed.
 */
export function add3DControl(map: L.Map, scene: () => Omit<Scene3D, "center" | "zoom">): void {
  const Control = L.Control.extend({
    onAdd() {
      const bar = L.DomUtil.create("div", "leaflet-bar view3d-control");
      const button = L.DomUtil.create("a", "", bar);
      button.href = "#";
      button.title = "3D view";
      button.textContent = "3D";
      button.setAttribute("role", "button");
      button.setAttribute("aria-label", "Open a 3D view of this area");
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(button, "click", (e) => {
        L.DomEvent.preventDefault(e);
        const c = map.getCenter();
        const full: Scene3D = { ...scene(), center: { lat: c.lat, lon: c.lng }, zoom: map.getZoom() };
        import("./view3d")
          .then((m) => m.open3DView(full))
          .catch(() => alert("The 3D view couldn't load. It needs a connection the first time it's used."));
      });
      return bar;
    },
  });
  new Control({ position: "topleft" }).addTo(map);
}
