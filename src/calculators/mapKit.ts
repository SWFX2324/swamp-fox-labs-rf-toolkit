import { rfIcon } from "../ui/rfIcons";
// Shared Leaflet setup: a Light (streets), Dark, ESRI Satellite or USGS Satellite base map and a recenter
// button that frames whatever the page cares about. The base map starts as ESRI
// Satellite (USGS Satellite when offline); a choice is remembered for that theme
// across every map in the app.

import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { SENTINEL_MAX_ZOOM, SENTINEL_URL, SENTINEL_YEAR, USGS_MAX_ZOOM, USGS_URL, tileInUsgsArea } from "../lib/offlineArea";
import { addOfflineControl } from "./offlineControl";
import { THEME_EVENT, isDarkTheme } from "./theme";
import type { Scene3D } from "../lib/scene3d";
import type { View3D } from "./view3d";

const LAYER_KEY = "rf-toolkit:map-layer";
/** The data behind terrain and clutter predictions, credited on maps that use it. */
export const DATA_ATTRIBUTION =
  "Terrain: Mapzen, USGS · Land cover: Impact Observatory, Microsoft, Esri (CC BY 4.0)";
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export const SENTINEL_ATTRIBUTION = `<a href="https://cloudless.eox.at">EOxCloudless</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data ${SENTINEL_YEAR})`;
export const OVERLAY_ATTRIBUTION =
  'Labels: data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, rendering &copy; <a href="https://maps.eox.at">EOX::Maps</a> and <a href="https://github.com/mapserver/basemaps">MapServer</a>';
export const USGS_ATTRIBUTION = '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>';

// Esri's World Imagery (Clarity): sharper, recent imagery worldwide. Online only:
// Esri doesn't allow its tiles to be saved for offline use, so they're kept out of
// "save this view" and out of the service worker's tile caches (vite.config.ts).
const CLARITY_URL = "https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const CLARITY_ATTRIBUTION = "Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community";

// Esri's place names and boundaries, a see-through layer made to sit on its
// imagery: city, town and place names with thin pale borders. Online only, like
// Clarity, and kept out of the tile caches for the same reason.
const ESRI_LABELS_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const ESRI_LABELS_ATTRIBUTION = "Labels: Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community";
const BLANK_TILE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** A label layer left blank over the US, where the USGS imagery already prints names. */
const LabelsOutsideUs = L.TileLayer.extend({
  // A blank tile inside the USGS area, Esri's label tile everywhere else.
  getTileUrl(this: L.TileLayer, coords: L.Coords) {
    return tileInUsgsArea(coords) ? BLANK_TILE : L.TileLayer.prototype.getTileUrl.call(this, coords);
  },
}) as unknown as new (url: string, options?: L.TileLayerOptions) => L.TileLayer;

// The stored names stay as they were, so saved choices still work; the menu shows these.
type LayerName = "Streets" | "Dark" | "Satellite" | "Clarity";
const LAYER_LABELS: Record<LayerName, string> = {
  Streets: "Light",
  Dark: "Dark",
  Satellite: "USGS Satellite",
  Clarity: "ESRI Satellite",
};

/** Where the chosen map layer is kept: one choice for the light theme and one for the dark. */
const themeKey = (dark: boolean) => `${LAYER_KEY}:${dark ? "dark" : "light"}`;
/** True when a stored or clicked value is one of the map layer names. */
const isLayerName = (v: string | null): v is LayerName => v === "Streets" || v === "Dark" || v === "Satellite" || v === "Clarity";

/** The map layer to start on for this theme: the one the user chose, or the default. */
function readLayer(dark: boolean): LayerName {
  try {
    const saved = localStorage.getItem(themeKey(dark));
    if (isLayerName(saved)) return saved;
    // Before choices were kept per theme there was one for both. Only carry
    // over Satellite, so the Streets and Dark defaults follow the theme.
    if (localStorage.getItem(LAYER_KEY) === "Satellite") return "Satellite";
  } catch {
    // Storage blocked: use the default.
  }
  // Until the user picks one, every map starts on ESRI Satellite, or on USGS
  // Satellite with no connection, since ESRI tiles can't be saved for offline use.
  return navigator.onLine === false ? "Satellite" : "Clarity";
}

/** Remembers the chosen map layer for the current theme. */
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

export const TASK_ICONS = {
  layers: rfIcon("layers"),
  download: rfIcon("download"),
  clear: rfIcon("clear"),
  zoomIn: rfIcon("zoomIn"),
  zoomOut: rfIcon("zoomOut"),
  recenter: rfIcon("recenter"),
  view3d: rfIcon("view3d"),
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
export function addClearControl(
  map: L.Map,
  what: string,
  onClear: () => void,
  /** What the button says it will clear while it waits for the second tap. */
  ask: () => string = () => `Clear ${what} from the map`,
): ClearControl {
  const slot = taskbarSlot(map, "clear");
  if (slot) {
    // In the taskbar it stays put, greyed out while there's nothing to clear.
    const b = taskButton("Clear map", TASK_ICONS.clear);
    const label = b.querySelector("span")!;
    b.setAttribute("aria-label", `Clear ${what} from the map`);
    b.disabled = true;
    let armed: ReturnType<typeof setTimeout> | undefined;
    // Puts the button back to "Clear map" after a second tap or a timeout.
    const disarm = () => {
      clearTimeout(armed);
      armed = undefined;
      b.classList.remove("armed");
      label.textContent = "Clear map";
      b.title = "Clear map";
    };
    b.addEventListener("click", () => {
      // The first tap asks; a second tap within four seconds clears.
      const question = armed ? undefined : ask();
      if (question) {
        // First tap: the button changes to ask for a second tap.
        b.classList.add("armed");
        label.textContent = "Tap again to clear";
        b.title = question;
        armed = setTimeout(disarm, 4000);
        return;
      }
      disarm();
      onClear();
    });
    slot.append(b);
    return {
      // Greys the button out when there's nothing to clear.
      setVisible(visible) {
        b.disabled = !visible;
        if (!visible) disarm();
      },
    };
  }
  let button: HTMLButtonElement | undefined;
  const Control = L.Control.extend({
    // Builds the corner button for maps without a taskbar, with the same two-tap clear.
    onAdd() {
      button = L.DomUtil.create("button", "map-clear");
      button.type = "button";
      button.hidden = true;
      button.setAttribute("aria-label", `Clear ${what} from the map`);
      button.innerHTML =
        `${TASK_ICONS.clear}Clear map`;
      L.DomEvent.disableClickPropagation(button);
      let armed: ReturnType<typeof setTimeout> | undefined;
      const b = button;
      // Puts the button back to "Clear map" after a second tap or a timeout.
      const disarm = () => {
        clearTimeout(armed);
        armed = undefined;
        b.classList.remove("armed");
        b.innerHTML = `${TASK_ICONS.clear}Clear map`;
      };
      L.DomEvent.on(button, "click", (e) => {
        L.DomEvent.preventDefault(e);
        if (!armed) {
          b.classList.add("armed");
          b.innerHTML = `${TASK_ICONS.clear}Tap again to clear`;
          b.title = ask();
          armed = setTimeout(disarm, 4000);
          return;
        }
        disarm();
        onClear();
      });
      return button;
    },
  });
  new Control({ position: "bottomleft" }).addTo(map);
  return {
    // Hides the button when there's nothing to clear.
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
      // Esri's place names outside the US, where the USGS imagery has none.
      // (Not EOX's labels: they come with orange borders and coastlines.)
      new LabelsOutsideUs(ESRI_LABELS_URL, { maxZoom: 19, crossOrigin: true, attribution: ESRI_LABELS_ATTRIBUTION }),
    ]),
    // Clarity imagery with Esri's place names on top.
    Clarity: L.layerGroup([
      L.tileLayer(CLARITY_URL, { maxZoom: 19, crossOrigin: true, attribution: CLARITY_ATTRIBUTION }),
      L.tileLayer(ESRI_LABELS_URL, { maxZoom: 19, crossOrigin: true, attribution: ESRI_LABELS_ATTRIBUTION }),
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
    const names: LayerName[] = ["Streets", "Dark", "Clarity", "Satellite"];
    menu.innerHTML = names.map((n) => `<button type="button" role="menuitemradio" data-layer="${n}">${LAYER_LABELS[n]}</button>`).join("");
    // Opens or closes the layers menu.
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
    const labelled = Object.fromEntries((Object.keys(layers) as LayerName[]).map((n) => [LAYER_LABELS[n], layers[n]]));
    L.control.layers(labelled, undefined, { position: "topright" }).addTo(map);
  }
  // The layer control also fires this when the code adds a layer: the first one
  // once the map has a view, and theme swaps. Only a different layer is a choice.
  map.on("baselayerchange", (e: L.LayersControlEvent) => {
    const name = (Object.keys(LAYER_LABELS) as LayerName[]).find((n) => LAYER_LABELS[n] === e.name);
    if (!name || name === current) return;
    current = name;
    saveLayer(name);
  });
  // Switch to the new theme's map when the theme changes.
  // Also run when the connection drops or returns, so a map left on the default
  // moves between ESRI and USGS Satellite. A layer the user picked stays put.
  const onTheme = () => {
    if (!container.isConnected) {
      window.removeEventListener(THEME_EVENT, onTheme);
      window.removeEventListener("online", onTheme);
      window.removeEventListener("offline", onTheme);
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
  window.addEventListener("online", onTheme);
  window.addEventListener("offline", onTheme);

  const Recenter = L.Control.extend({
    // Builds the corner Recenter button for maps without a taskbar.
    onAdd() {
      const bar = L.DomUtil.create("div", "leaflet-bar recenter-control");
      const button = L.DomUtil.create("a", "", bar);
      button.href = "#";
      button.title = "Recenter";
      button.setAttribute("role", "button");
      button.setAttribute("aria-label", "Recenter the map");
      button.innerHTML =
        TASK_ICONS.recenter;
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
 * A "3D mode" button: in the taskbar when the map has one, otherwise in the top
 * right corner, clear of the zoom and Clear map buttons. scene() describes what
 * to show; the 2D map's view is used when there are no points. The 3D view's
 * code (and MapLibre) loads only when the button is pressed.
 */
export function add3DControl(map: L.Map, scene: () => Omit<Scene3D, "center" | "zoom">): Control3D {
  let view: View3D | undefined;
  // The scene with the 2D map's current centre and zoom added.
  const full = (): Scene3D => {
    const c = map.getCenter();
    return { ...scene(), center: { lat: c.lat, lon: c.lng }, zoom: map.getZoom() };
  };
  // Loads the 3D view's code the first time, then opens it on the current scene.
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
      // Updates an open 3D view after the page's points or results change.
      refresh() {
        if (view?.isOpen()) view.update(full());
      },
    };
  }
  const Control = L.Control.extend({
    // Builds the corner "3D" button for maps without a taskbar.
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
    // Updates an open 3D view after the page's points or results change.
    refresh() {
      if (view?.isOpen()) view.update(full());
    },
  };
}
