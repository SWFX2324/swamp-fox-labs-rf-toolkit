// The map's "save this view" button: stores terrain and satellite tiles for
// what's on screen, in the same caches the service worker reads from.

import * as L from "leaflet";
import { IMAGERY_CACHE, type OfflinePlan, type OfflineTile, TERRAIN_CACHE, planOfflineArea } from "../lib/offlineArea";

const CONCURRENT = 4;

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

async function storedText(): Promise<string> {
  try {
    const { usage } = await navigator.storage.estimate();
    return usage ? `The toolkit is using about ${formatMb(usage)} on this device.` : "";
  } catch {
    return "";
  }
}

export function addOfflineControl(map: L.Map): void {
  if (typeof caches === "undefined") return;

  const Control = L.Control.extend({
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
        '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M4 20h16"/></svg>';

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
      const part = <T extends HTMLElement>(role: string) => panel.querySelector<T>(`[data-role="${role}"]`)!;
      const text = part("text");
      const status = part("status");
      const save = part<HTMLButtonElement>("save");
      const cancel = part<HTMLButtonElement>("cancel");
      const stored = part("stored");

      let running: AbortController | null = null;
      let plan: OfflinePlan | null = null;

      const describe = () => {
        if (running) return;
        const b = map.getBounds();
        plan = planOfflineArea({ north: b.getNorth(), south: b.getSouth(), west: b.getWest(), east: b.getEast() });
        save.disabled = plan.tooBig;
        text.textContent = plan.tooBig
          ? "This view is too big to save. Zoom in until it shows about 200 km across or less."
          : `Downloads about ${formatMb(plan.estimatedBytes)} of terrain and satellite imagery for everything on screen. OpenStreetMap doesn't allow saving street maps.`;
      };

      const refreshStored = async () => {
        stored.textContent = await storedText();
      };

      const open = (show: boolean) => {
        panel.hidden = !show;
        button.setAttribute("aria-expanded", String(show));
        if (!show) return;
        status.textContent = "";
        describe();
        void refreshStored();
      };

      const finish = () => {
        running = null;
        save.hidden = false;
        cancel.hidden = true;
        describe();
        void refreshStored();
      };

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
        else status.textContent = `Saved. Offline, switch to the Satellite map. ${imageryReach(closer)} Terrain calculations work anywhere inside this view.`;
        finish();
      };

      for (const element of [root, panel]) {
        L.DomEvent.disableClickPropagation(element);
        L.DomEvent.disableScrollPropagation(element);
      }
      L.DomEvent.on(button, "click", (e) => {
        L.DomEvent.preventDefault(e);
        open(panel.hidden !== false);
      });
      save.addEventListener("click", () => void start());
      cancel.addEventListener("click", () => running?.abort());
      part("close").addEventListener("click", () => open(false));
      part("clear").addEventListener("click", async () => {
        if (!confirm("Remove all saved and viewed terrain and satellite tiles from this device?")) return;
        await Promise.all([caches.delete(TERRAIN_CACHE), caches.delete(IMAGERY_CACHE)]);
        status.textContent = "Saved tiles cleared.";
        void refreshStored();
      });
      map.on("moveend", () => {
        if (!panel.hidden) describe();
      });
      return root;
    },
  });
  new Control({ position: "topleft" }).addTo(map);
}
