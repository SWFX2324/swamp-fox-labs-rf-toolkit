// Shared Leaflet setup: a Streets, Dark or Satellite base map and a recenter
// button that frames whatever the page cares about. The base map starts as Dark
// in dark mode and Streets in light mode; a choice is remembered for that theme
// across every map in the app.

import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { OVERLAY_MAX_ZOOM, OVERLAY_URL, SENTINEL_MAX_ZOOM, SENTINEL_URL, SENTINEL_YEAR, USGS_MAX_ZOOM, USGS_URL, tileInUsgsArea } from "../lib/offlineArea";
import { addOfflineControl } from "./offlineControl";
import { THEME_EVENT, isDarkTheme } from "./theme";
import type { Scene3D } from "../lib/scene3d";
import type { View3D } from "./view3d";

const LAYER_KEY = "rf-toolkit:map-layer";
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export const SENTINEL_ATTRIBUTION = `<a href="https://cloudless.eox.at">EOxCloudless</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data ${SENTINEL_YEAR})`;
export const OVERLAY_ATTRIBUTION =
  'Labels: data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, rendering &copy; <a href="https://maps.eox.at">EOX::Maps</a> and <a href="https://github.com/mapserver/basemaps">MapServer</a>';
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

/** Map options. */
export interface MapOptions {
  /**
   * Put Map layers, Download map, Clear map and 3D mode in a labelled bar
   * floating at the bottom centre of the map, instead of corner buttons.
   */
  taskbar?: boolean;
}

const taskbars = new WeakMap<L.Map, HTMLElement>();
/** The taskbar's place for one tool, when the map has a taskbar. */
export const taskbarSlot = (map: L.Map, name: "zoom" | "recenter" | "layers" | "download" | "clear" | "view3d"): HTMLElement | undefined =>
  taskbars.get(map)?.querySelector<HTMLElement>(`[data-slot="${name}"]`) ?? undefined;

const svg = (paths: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
export const TASK_ICONS = {
  layers: svg('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'),
  download: svg('<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>'),
  clear: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  zoomIn: svg('<path d="M12 5v14M5 12h14"/>'),
  zoomOut: svg('<path d="M5 12h14"/>'),
  recenter: svg('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>'),
  view3d: svg('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>'),
};

/** A labelled taskbar button. */
export function taskButton(label: string, icon: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "taskbar-btn";
  // Names it on hover when the bar is down to icons.
  if (label) b.title = label;
  b.innerHTML = `${icon}<span>${label}</span>`;
  return b;
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
  const slot = taskbarSlot(map, "clear");
  if (slot) {
    // In the taskbar it stays put, greyed out while there's nothing to clear.
    const b = taskButton("Clear map", TASK_ICONS.clear);
    b.setAttribute("aria-label", `Clear ${what} from the map`);
    b.disabled = true;
    b.addEventListener("click", onClear);
    slot.append(b);
    return {
      setVisible(visible) {
        b.disabled = !visible;
      },
    };
  }
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

const BLANK_TILE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** EOX's labels, left blank over the US, where the USGS hybrid already prints names. */
const LabelsOutsideUs = L.TileLayer.extend({
  getTileUrl(this: L.TileLayer, coords: L.Coords) {
    return tileInUsgsArea(coords) ? BLANK_TILE : L.TileLayer.prototype.getTileUrl.call(this, coords);
  },
}) as unknown as new (url: string, options?: L.TileLayerOptions) => L.TileLayer;

/** Default view when a page has nothing to show yet: the contiguous US. */
export function showDefaultView(map: L.Map): void {
  map.setView([37.5, -96], 4);
}

/**
 * A map with base-layer choice and a recenter button. recenter() should frame
 * the page's pins, nodes or area; it is also what the page calls on load.
 */
export function createMap(container: HTMLElement, recenter: (map: L.Map) => void, options: MapOptions = {}): L.Map {
  // With a taskbar, zoom lives there instead of the corner.
  const map = L.map(container, { zoomControl: !options.taskbar });
  if (options.taskbar) {
    const bar = L.DomUtil.create("div", "map-taskbar", container);
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Map tools");
    bar.innerHTML = '<span data-slot="zoom" class="taskbar-group"></span><span data-slot="recenter"></span><span class="taskbar-sep" aria-hidden="true"></span><span data-slot="layers"></span><span data-slot="download"></span><span data-slot="clear"></span><span data-slot="view3d"></span>';
    L.DomEvent.disableClickPropagation(bar);
    L.DomEvent.disableScrollPropagation(bar);
    taskbars.set(map, bar);
  }
  // Dark is the same OpenStreetMap tiles recoloured in CSS (see .map-dark),
  // so it needs no API key, no extra provider and shares the offline cache.
  const osm = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const layers: Record<LayerName, L.Layer> = {
    // CORS here too, because browsers count a cached no-CORS tile as several MB.
    Streets: L.tileLayer(osm, { maxZoom: 19, crossOrigin: true, attribution: OSM_ATTRIBUTION }),
    Dark: L.tileLayer(osm, { maxZoom: 19, crossOrigin: true, attribution: OSM_ATTRIBUTION, className: "map-dark" }),
    // Sentinel-2 covers the world at about 10 m. USGS aerial imagery, with roads
    // and names (a hybrid), sits on top at about 1 m but only covers the US; elsewhere its tiles 404 and Sentinel
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
      // Place and road names on top elsewhere, so it reads as a hybrid map.
      new LabelsOutsideUs(OVERLAY_URL, {
        maxZoom: 19,
        maxNativeZoom: OVERLAY_MAX_ZOOM,
        crossOrigin: true,
        attribution: OVERLAY_ATTRIBUTION,
      }),
    ]),
  };
  let current = readLayer(isDarkTheme());
  layers[current].addTo(map);
  // The taskbar's Map layers menu, when there is one; marks the base map in use.
  let syncLayerMenu = () => {};
  const layerSlot = taskbarSlot(map, "layers");
  if (layerSlot) {
    const button = taskButton("Map layers", TASK_ICONS.layers);
    button.setAttribute("aria-haspopup", "true");
    button.setAttribute("aria-expanded", "false");
    const menu = document.createElement("div");
    menu.className = "map-layers-menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    const names: LayerName[] = ["Streets", "Dark", "Satellite"];
    menu.innerHTML = names.map((n) => `<button type="button" role="menuitemradio" data-layer="${n}">${n}</button>`).join("");
    const open = (show: boolean) => {
      menu.hidden = !show;
      button.setAttribute("aria-expanded", String(show));
    };
    syncLayerMenu = () => {
      for (const b of menu.querySelectorAll<HTMLButtonElement>("[data-layer]")) b.setAttribute("aria-checked", String(b.dataset.layer === current));
    };
    button.addEventListener("click", () => open(menu.hidden !== false));
    menu.addEventListener("click", (e) => {
      const name = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-layer]")?.dataset.layer ?? null;
      if (!isLayerName(name)) return;
      if (name !== current) {
        map.removeLayer(layers[current]);
        layers[name].addTo(map);
        current = name;
        saveLayer(name);
      }
      syncLayerMenu();
      open(false);
    });
    // A tap elsewhere closes it.
    document.addEventListener("pointerdown", (e) => {
      if (!menu.hidden && !layerSlot.contains(e.target as Node)) open(false);
    });
    layerSlot.append(button, menu);
    syncLayerMenu();
  } else {
    L.control.layers(layers, undefined, { position: "topright" }).addTo(map);
  }
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
    syncLayerMenu();
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
  const zoomSlot = taskbarSlot(map, "zoom");
  const recenterSlot = taskbarSlot(map, "recenter");
  if (zoomSlot && recenterSlot) {
    const zoomIn = taskButton("", TASK_ICONS.zoomIn);
    zoomIn.classList.add("icon-only");
    zoomIn.setAttribute("aria-label", "Zoom in");
    zoomIn.title = "Zoom in";
    zoomIn.addEventListener("click", () => map.zoomIn());
    const zoomOut = taskButton("", TASK_ICONS.zoomOut);
    zoomOut.classList.add("icon-only");
    zoomOut.setAttribute("aria-label", "Zoom out");
    zoomOut.title = "Zoom out";
    zoomOut.addEventListener("click", () => map.zoomOut());
    zoomSlot.append(zoomIn, zoomOut);
    const center = taskButton("Recenter", TASK_ICONS.recenter);
    center.setAttribute("aria-label", "Recenter the map");
    center.addEventListener("click", () => recenter(map));
    recenterSlot.append(center);
  } else new Recenter({ position: "topleft" }).addTo(map);
  addOfflineControl(map, taskbarSlot(map, "download"), () => taskButton("Download", TASK_ICONS.download));

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

/** The 3D button on a map. */
export interface Control3D {
  /** Call after the page redraws, so an open 3D view shows the change. */
  refresh(): void;
}

/**
 * A "3D" button under the base-map button, top right (the left side fills up
 * with zoom, recenter and offline buttons, and on a phone it ran into Clear map). scene() describes what to show; the
 * 2D map's view is used when there are no points. The 3D view (and MapLibre)
 * loads only when pressed.
 */
export function add3DControl(map: L.Map, scene: () => Omit<Scene3D, "center" | "zoom">): Control3D {
  let view: View3D | undefined;
  const full = (): Scene3D => {
    const c = map.getCenter();
    return { ...scene(), center: { lat: c.lat, lon: c.lng }, zoom: map.getZoom() };
  };
  const open = () =>
    import("./view3d")
      .then((m) => {
        view = m.open3DView(full());
      })
      .catch(() => alert("The 3D view couldn't load. It needs a connection the first time it's used."));
  const slot = taskbarSlot(map, "view3d");
  if (slot) {
    const b = taskButton("3D mode", TASK_ICONS.view3d);
    b.setAttribute("aria-label", "Open a 3D view of this area");
    b.addEventListener("click", () => void open());
    slot.append(b);
    return {
      refresh() {
        if (view?.isOpen()) view.update(full());
      },
    };
  }
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
        import("./view3d")
          .then((m) => {
            view = m.open3DView(full());
          })
          .catch(() => alert("The 3D view couldn't load. It needs a connection the first time it's used."));
      });
      return bar;
    },
  });
  new Control({ position: "topright" }).addTo(map);
  return {
    refresh() {
      if (view?.isOpen()) view.update(full());
    },
  };
}
