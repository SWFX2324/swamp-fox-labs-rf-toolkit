import { twoTap } from "./twoTap";
import { rfIcon } from "../ui/rfIcons";
// The map's "save this view" button: stores terrain and satellite tiles for
// what's on screen, in the same caches the service worker reads from.

import * as L from "leaflet";
import { IMAGERY_CACHE, LAND_COVER_CACHE, type OfflinePlan, type OfflineTile, TERRAIN_CACHE, planOfflineArea } from "../lib/offlineArea";

const CONCURRENT = 4;

/** A size in bytes as whole megabytes, at least 1 MB. */
const formatMb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1e6))} MB`;

/** Store one tile unless it's already kept. False means it couldn't be fetched. */
async function saveTile(tile: OfflineTile, signal: AbortSignal): Promise<boolean> {
  const cache = await caches.open(tile.cache);
  if (await cache.match(tile.url)) return true;
  const res = await fetch(tile.url, { signal });
  if (!res.ok) return false;
  await cache.put(tile.url, res);
  return true;
}

/** Save tiles a few at a time. Returns how many failed. */
async function saveTiles(tiles: OfflineTile[], signal: AbortSignal, onProgress: (done: number) => void): Promise<number> {
  const queue = [...tiles];
  let done = 0;
  let failed = 0;
  // Saves tiles from the shared queue until it is empty or the download is stopped.
  const worker = async () => {
    while (queue.length && !signal.aborted) {
      const tile = queue.shift()!;
      try {
        if (!(await saveTile(tile, signal))) failed++;
      } catch {
        if (signal.aborted) return;
        failed++;
      }
      onProgress(++done);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENT }, worker));
  return failed;
}

/** How far in the saved imagery goes, counted in zoom button presses from this view. */
function imageryReach(closer: number): string {
  if (closer > 0) return `Imagery is saved up to ${closer} zoom ${closer === 1 ? "step" : "steps"} closer than this view.`;
  if (closer === 0) return "Imagery is saved up to this zoom.";
  return `This view is closer than the saved imagery: zoom out ${-closer} ${closer === -1 ? "step" : "steps"} to see it.`;
}

/** The real size of the kept tiles, viewed and saved. */
async function storedText(): Promise<string> {
  try {
    let bytes = 0;
    for (const name of [TERRAIN_CACHE, LAND_COVER_CACHE, IMAGERY_CACHE]) {
      for (const res of await (await caches.open(name)).matchAll()) bytes += (await res.blob()).size;
    }
    return bytes ? `Terrain, land-cover and satellite tiles on this device: about ${formatMb(bytes)}.` : "";
  } catch {
    return "";
  }
}

// The cache for street tiles before they moved to CORS. Its copies can't be
// used any more, and browsers count each as several MB.
const OLD_STREET_CACHE = "osm-tiles";

/**
 * The "save this view for offline" button and its panel: a corner button, or
 * a taskbar button made by makeButton and placed in slot.
 */
export function addOfflineControl(map: L.Map, slot?: HTMLElement, makeButton?: () => HTMLElement): void {
  if (typeof caches === "undefined") return;
  void caches.delete(OLD_STREET_CACHE);

  if (slot && makeButton) {
    const button = makeButton();
    button.setAttribute("aria-label", "Save this view for offline");
    button.setAttribute("aria-expanded", "false");
    slot.append(button);
    offlinePanel(map, button);
    return;
  }

  const Control = L.Control.extend({
    // Builds the corner button for maps without a taskbar.
    onAdd() {
      const root = L.DomUtil.create("div", "offline-control");
      const bar = L.DomUtil.create("div", "leaflet-bar recenter-control", root);
      const button = L.DomUtil.create("a", "", bar);
      button.href = "#";
      button.title = "Save this view for offline";
      button.setAttribute("role", "button");
      button.setAttribute("aria-label", "Save this view for offline");
      button.setAttribute("aria-expanded", "false");
      button.innerHTML =
        rfIcon("download");
      L.DomEvent.disableClickPropagation(root);
      L.DomEvent.disableScrollPropagation(root);
      offlinePanel(map, button);
      return root;
    },
  });
  new Control({ position: "topleft" }).addTo(map);
}

/** The offline panel on the map, opened and closed by button. */
function offlinePanel(map: L.Map, button: HTMLElement): void {
  // On the map itself, not in the control, so it can use the map's full height.
  const panel = L.DomUtil.create("div", "offline-panel", map.getContainer());
  panel.hidden = true;
  panel.innerHTML = `<strong>Save this view for offline</strong>
    <p data-role="text"></p>
    <p data-role="status" role="status"></p>
    <div class="offline-actions">
      <button type="button" data-role="save">Download</button>
      <button type="button" class="secondary" data-role="cancel" hidden>Stop</button>
      <button type="button" class="secondary" data-role="close">Close</button>
    </div>
    <p class="offline-stored"><span data-role="stored"></span> <button type="button" class="link" data-role="clear">Clear saved tiles</button></p>`;
  // An element of the panel by its data-role name.
  const part = <T extends HTMLElement>(role: string) => panel.querySelector<T>(`[data-role="${role}"]`)!;
  const text = part("text");
  const status = part("status");
  const save = part<HTMLButtonElement>("save");
  const cancel = part<HTMLButtonElement>("cancel");
  const stored = part("stored");

  let running: AbortController | null = null;
  let plan: OfflinePlan | null = null;

  // Plans what saving the current view would take and says how big it is, or
  // that the view is too big to save. Left alone while a download runs.
  const describe = () => {
    if (running) return;
    const b = map.getBounds();
    plan = planOfflineArea({ north: b.getNorth(), south: b.getSouth(), west: b.getWest(), east: b.getEast() });
    save.disabled = plan.tooBig;
    text.textContent = plan.tooBig
      ? "This view is too big to save. Zoom in until it shows about 200 km across or less."
      : `Downloads about ${formatMb(plan.estimatedBytes)} of terrain, land cover and satellite imagery for everything on screen. OpenStreetMap doesn't allow saving street maps.`;
  };

  // Shows how much tile storage this device holds now.
  const refreshStored = async () => {
    stored.textContent = await storedText();
  };

  // On a map with a taskbar, opens the panel just above it, centered on the
  // Download button and kept inside the map.
  const placeOverTaskbar = () => {
    const bar = button.closest<HTMLElement>(".map-taskbar");
    if (!bar) return;
    const box = map.getContainer().getBoundingClientRect();
    const barTop = bar.getBoundingClientRect().top;
    const b = button.getBoundingClientRect();
    panel.classList.add("over-taskbar");
    panel.style.bottom = `${box.bottom - barTop + 10}px`;
    panel.style.maxHeight = `${Math.max(160, barTop - box.top - 20)}px`;
    // Centered on the button, kept inside the map.
    const half = panel.offsetWidth / 2;
    const center = Math.min(Math.max(b.left + b.width / 2 - box.left, half + 10), box.width - half - 10);
    panel.style.left = `${center - half}px`;
  };

  // Opens or closes the panel. Opening it re-plans the current view.
  const open = (show: boolean) => {
    panel.hidden = !show;
    button.setAttribute("aria-expanded", String(show));
    if (!show) return;
    placeOverTaskbar();
    status.textContent = "";
    describe();
    void refreshStored();
  };

  // Puts the buttons back after a download ends, stopped or not.
  const finish = () => {
    running = null;
    save.hidden = false;
    cancel.hidden = true;
    describe();
    void refreshStored();
  };

  // Downloads every tile in the plan, showing progress, then says how it went.
  const start = async () => {
    if (!plan || plan.tooBig) return;
    const { tiles, imageryMaxZoom } = plan;
    const closer = imageryMaxZoom - Math.round(map.getZoom());
    const controller = new AbortController();
    running = controller;
    save.hidden = true;
    cancel.hidden = false;
    // Ask the browser not to clear these under storage pressure. It may say no.
    void navigator.storage?.persist?.().catch(() => false);
    status.textContent = `Saving 0 of ${tiles.length}…`;
    const failed = await saveTiles(tiles, controller.signal, (done) => {
      status.textContent = `Saving ${done} of ${tiles.length}…`;
    });
    if (controller.signal.aborted) status.textContent = "Stopped. Anything already saved stays saved.";
    else if (failed) status.textContent = `${failed} of ${tiles.length} tiles couldn't be saved. Download again with a better connection to fill the gaps.`;
    else status.textContent = `Saved. Offline, switch to the USGS Satellite map. ${imageryReach(closer)} Terrain calculations work anywhere inside this view.`;
    finish();
  };

  L.DomEvent.disableClickPropagation(panel);
  L.DomEvent.disableScrollPropagation(panel);
  L.DomEvent.on(button, "click", (e) => {
    L.DomEvent.preventDefault(e);
    open(panel.hidden !== false);
  });
  save.addEventListener("click", () => void start());
  cancel.addEventListener("click", () => running?.abort());
  part("close").addEventListener("click", () => open(false));
  twoTap(part<HTMLButtonElement>("clear"), "Tap again to clear saved tiles", async () => {
    await Promise.all([caches.delete(TERRAIN_CACHE), caches.delete(LAND_COVER_CACHE), caches.delete(IMAGERY_CACHE)]);
    status.textContent = "Saved tiles cleared.";
    void refreshStored();
  });
  map.on("moveend", () => {
    if (!panel.hidden) describe();
  });
}
