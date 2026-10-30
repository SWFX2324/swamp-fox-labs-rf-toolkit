// Shared Leaflet setup: a Streets or Dark base map (the choice is remembered
// across every map in the app) and a recenter button that frames whatever
// the page cares about.

import * as L from "leaflet";
import "leaflet/dist/leaflet.css";

const LAYER_KEY = "rf-toolkit:map-layer";
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

type LayerName = "Streets" | "Dark";

function readLayer(): LayerName {
  try {
    return localStorage.getItem(LAYER_KEY) === "Dark" ? "Dark" : "Streets";
  } catch {
    return "Streets";
  }
}

function saveLayer(name: string): void {
  try {
    localStorage.setItem(LAYER_KEY, name);
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
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
  const layers: Record<LayerName, L.TileLayer> = {
    Streets: L.tileLayer(osm, { maxZoom: 19, attribution: OSM_ATTRIBUTION }),
    Dark: L.tileLayer(osm, { maxZoom: 19, attribution: OSM_ATTRIBUTION, className: "map-dark" }),
  };
  layers[readLayer()].addTo(map);
  L.control.layers(layers, undefined, { position: "topright" }).addTo(map);
  map.on("baselayerchange", (e: L.LayersControlEvent) => saveLayer(e.name));

  const Recenter = L.Control.extend({
    onAdd() {
      const bar = L.DomUtil.create("div", "leaflet-bar recenter-control");
      const button = L.DomUtil.create("a", "", bar);
      button.href = "#";
      button.title = "Recenter";
      button.setAttribute("role", "button");
      button.setAttribute("aria-label", "Recenter the map");
      button.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(button, "click", (e) => {
        L.DomEvent.preventDefault(e);
        recenter(map);
      });
      return bar;
    },
  });
  new Recenter({ position: "topleft" }).addTo(map);

  new ResizeObserver(() => map.invalidateSize()).observe(container);
  recenter(map);
  return map;
}
