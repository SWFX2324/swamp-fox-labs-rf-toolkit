// Terrain profile card for Link Analysis: a map with pins for Site A and Site B
// (and an optional relay between them), the elevation profile between them,
// and how well the path clears it.

import * as L from "leaflet";
import { type ClearControl, type Control3D, add3DControl, addClearControl, createMap, showDefaultView } from "./mapKit";
import type { EditField, Link3D, Point3D } from "../lib/scene3d";
import type { RelaySurface } from "../lib/relay";
import { type RelayFinderInputs, findRelay, surfaceImage } from "./relayFinder";
import { buildKml, buildZip } from "../lib/export";
import { downloadFile } from "./planBar";
import { drawLinkLine, linkLegend } from "./linkLine";
import { type LinkQuality, linkLineLabels, linkLineStyle } from "../lib/linkLines";
import { locateButton, locateMe } from "./locate";
import { RADIO_FILE, radioIconFile, radioMarker } from "./radioIcon";
import { type ModelSettings, type TerrainLoss, terrainLoss } from "../lib/propagation";
import { fetchPathElevations } from "./tileElevation";
import { createPathStore } from "../lib/pathStore";
import { coordPlaceholder, formatCoordinates, parseCoordinates } from "../lib/coords";
import { type LatLon, bearingDeg, distanceBetweenM, formatLatLon, parseLatLon, samplePath } from "../lib/geo";
import { FRESNEL_CLEAR_RATIO, type ProfilePoint, type ProfileResult, type ProfileStatus, analyzeProfile, sampleCount } from "../lib/profile";
import { type DistanceUnit, fromMetres } from "../lib/units";
import { STANDARD_K, kFactors } from "../lib/horizon";

const kLabel = (k: number) => kFactors.find((f) => f.k === k)?.id ?? k.toFixed(2);

const STORAGE_KEY = "rf-toolkit:terrain";

export interface TerrainParams {
  freqHz: number;
  txHeightM: number;
  rxHeightM: number;
  distUnit: DistanceUnit;
  heightUnit: DistanceUnit;
  /** False on HF, where a line-of-sight profile doesn't apply. */
  applies: boolean;
  model: ModelSettings;
  /** Effective earth radius factor for the clearance check. */
  k: number;
  /** The relay's antenna height for its hops' paths, metres. */
  relayHeightM?: number;
}

export type TerrainAnalysis = ProfileResult & { loss: TerrainLoss };

export type SiteId = "tx" | "rx" | "relay";

/** One hop through the relay: its length, terrain loss and line of sight. */
export interface HopAnalysis {
  distanceM: number;
  loss: TerrainLoss;
  status: ProfileStatus;
}

/** What the card needs from the Link Analysis about each site. */
export interface SiteHooks {
  /** Display names; blank means the default ("Site A", "Site B", "Relay"). */
  names(): Record<SiteId, string>;
  /** The site's values for the 3D view's editor (location is added here). */
  fields(site: SiteId): EditField[];
  /** Values changed in the 3D editor (location is handled here). */
  edit(site: SiteId, values: Record<string, string>): void;
  /** Everything the relay finder needs, or why it can't run. */
  finderInputs(): RelayFinderInputs | string;
  fadeMarginDb(): number;
}

const siteDefaults: Record<SiteId, string> = { tx: "Site A", rx: "Site B", relay: "Relay" };

export interface TerrainCard {
  element: HTMLElement;
  /** Length of the pinned path in metres, or undefined without both pins. */
  pathDistanceM(): number | undefined;
  /** Both pins, when both are down. */
  pins(): { tx: LatLon; rx: LatLon } | undefined;
  /** The relay, when one is placed. */
  relay(): LatLon | undefined;
  /** The two hops through the relay, once their terrain has loaded. */
  hops(params: TerrainParams): { hop1?: HopAnalysis; hop2?: HopAnalysis };
  /** How strong each hop is, to style their lines. */
  showHops(hop1: LinkQuality | undefined, hop2: LinkQuality | undefined): void;
  /** Redraw names on pins and in the 3D view. */
  namesChanged(): void;
  /** Re-run the analysis for new frequency or heights; returns it if there is one. */
  refresh(params: TerrainParams): TerrainAnalysis | undefined;
  /** Remove both pins and the profile. */
  reset(): void;
  /** How strong the budget says the link is, to style the line; undefined when it can't say. */
  showLink(quality: LinkQuality | undefined): void;
}

// Line of sight only, not a verdict on the link: the terrain loss from an
// obstruction is already in the budget, which says whether the link works. So
// no red here; red is kept for the budget's "won't close".
const statusText: Record<ProfileStatus, [string, string]> = {
  clear: ["Clear line of sight", "s-good"],
  fresnel: ["Fresnel zone partly blocked", "s-marginal"],
  blocked: ["No line of sight", "s-marginal"],
};
const losNote =
  "Line of sight only. The extra loss from this terrain is already counted in the link budget, so go by the budget's verdict: a link can still work over a ridge, by diffraction, if the margin holds.";

const template = `
  <div class="card-head">
    <h2>Terrain profile</h2>
    <span class="pill" data-t="pill" hidden></span>
    <button type="button" class="secondary" data-t="toggle" aria-expanded="false">Show</button>
  </div>
  <div class="terrain-body" data-t="body" hidden>
  <p class="note top">Tap the map for Site A, then Site B. Drag a pin to move it. To bridge a weak link, add a relay: place it yourself or let the app find the best spot.</p>
  <div class="map" data-t="map"></div>
  <div data-t="legend"></div>
  <div class="fields coords">
    <label>Site A location
      <span class="input-unit">
        <input name="txLoc" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" />
        ${locateButton('data-t="locate"')}
      </span>
    </label>
    <label>Site B location
      <input name="rxLoc" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" />
    </label>
    <label data-t="relayLocWrap" hidden>Relay location
      <input name="relayLoc" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" />
    </label>
  </div>
  <div class="relay-actions">
    <button type="button" class="secondary" data-t="addRelay">Place relay</button>
    <button type="button" class="secondary" data-t="findRelay">Find relay spot</button>
    <button type="button" class="secondary" data-t="removeRelay" hidden>Remove relay</button>
  </div>
  <div class="legend relay-legend" data-t="relayLegend" hidden>
    <span class="key"><span class="sw cov-strong"></span>Relay: strong</span>
    <span class="key"><span class="sw cov-solid"></span>Solid</span>
    <span class="key"><span class="sw cov-marginal"></span>Marginal</span>
    <span class="relay-legend-note">Where a relay would close both hops</span>
  </div>
  <p class="note" data-t="status"></p>
  <div class="dir-switch profile-view" data-t="viewWrap" hidden>
    <span class="note">Profile</span>
    <div class="seg" role="group" aria-label="Profile shown">
      <button type="button" data-view="relay">Via relay</button>
      <button type="button" data-view="direct">Direct</button>
    </div>
  </div>
  <div class="profile-chart" data-t="chart" hidden></div>
  <p class="note" data-t="losNote" hidden></p>
  <table class="ledger geometry" data-t="facts" hidden><tbody></tbody></table>
  <div class="terrain-actions">
    <button type="button" class="secondary" data-t="export">Export KMZ</button>
  </div>
  <div class="fields saved-paths">
    <label>Saved paths
      <span class="input-unit">
        <select data-t="savedList"></select>
        <button type="button" class="secondary unit-btn" data-t="delete">Delete</button>
      </span>
    </label>
    <label>Save this path as
      <span class="input-unit">
        <input data-t="saveName" type="text" placeholder="Ridge to base camp" autocomplete="off" />
        <button type="button" class="secondary unit-btn" data-t="save">Save</button>
      </span>
    </label>
  </div>
  <details class="about"><summary>About this calculation</summary><p>Terrain loss uses the Irregular Terrain Model (Longley-Rice), ported from NTIA's reference code: it covers line of sight, diffraction over terrain and troposcatter beyond the horizon, from 20 MHz to 20 GHz. Above 20 GHz it falls back to the Bullington method of ITU-R P.526-16. Elevation: Terrain Tiles (Mapzen, AWS Open Data), bare earth at up to about 30 m; US data courtesy of the U.S. Geological Survey. Saved and recent paths work offline, as do areas you've viewed before.</p></details>
  </div>
`;

function loadPins(): { tx?: LatLon; rx?: LatLon; relay?: LatLon } {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return { tx: parseLatLon(saved.tx ?? ""), rx: parseLatLon(saved.rx ?? ""), relay: parseLatLon(saved.relay ?? "") };
  } catch {
    return {};
  }
}

function savePins(tx?: LatLon, rx?: LatLon, relay?: LatLon): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tx: tx && formatLatLon(tx), rx: rx && formatLatLon(rx), relay: relay && formatLatLon(relay) }));
  } catch {
    // Storage blocked: pins just won't be remembered.
  }
}

const fmt = (value: number, digits: number) =>
  value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace("-", "−");

export function createTerrainCard(onPathChange: () => void, hooks: SiteHooks): TerrainCard {
  const card = document.createElement("section");
  card.className = "card terrain";
  card.innerHTML = template;
  card.querySelector('[data-t="legend"]')!.replaceWith(linkLegend());
  const el = (name: string) => card.querySelector<HTMLElement>(`[data-t="${name}"]`)!;
  const input = (name: string) => card.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  input("txLoc").placeholder = input("rxLoc").placeholder = input("relayLoc").placeholder = coordPlaceholder();
  const nameOf = (site: SiteId) => hooks.names()[site].trim() || siteDefaults[site];

  const store = createPathStore({
    getItem: (key) => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem: (key, value) => localStorage.setItem(key, value),
  });
  let { tx, rx, relay } = loadPins();
  // The relay's two paths: Site A to relay, and relay to Site B.
  let relayElevations: [number[] | undefined, number[] | undefined] = [undefined, undefined];
  let relayLoading: AbortController | undefined;
  let relayMarker: L.Marker | undefined;
  let placingRelay = false;
  let hopQuality: [LinkQuality | undefined, LinkQuality | undefined] = [undefined, undefined];
  let hopStatus: [ProfileStatus | undefined, ProfileStatus | undefined] = [undefined, undefined];
  let finding: AbortController | undefined;
  let surface: { image: { url: string; bounds: { north: number; south: number; east: number; west: number } }; data: RelaySurface } | undefined;
  let surfaceOverlay: L.ImageOverlay | undefined;
  let elevations: number[] | undefined;
  let loading: AbortController | undefined;
  let map: L.Map | undefined;
  let clearControl: ClearControl | undefined;
  let txMarker: L.Marker | undefined;
  let rxMarker: L.Marker | undefined;
  let line: L.LayerGroup | undefined;
  let hopLines: L.LayerGroup[] = [];
  let view3d: Control3D | undefined;
  // The line's style comes from the budget's verdict and the profile's.
  let quality: LinkQuality | undefined;
  let lineOfSight: ProfileStatus | undefined;
  // Without a rating (a field missing, or HF) there's no line, just the pins.
  const drawPath = () => {
    line?.remove();
    for (const l of hopLines) l.remove();
    hopLines = [];
    line = map && tx && rx && quality ? drawLinkLine(map, tx, rx, linkLineStyle(quality, lineOfSight)) : undefined;
    if (map && relay) {
      if (tx && hopQuality[0]) hopLines.push(drawLinkLine(map, tx, relay, linkLineStyle(hopQuality[0], hopStatus[0])));
      if (rx && hopQuality[1]) hopLines.push(drawLinkLine(map, relay, rx, linkLineStyle(hopQuality[1], hopStatus[1])));
    }
    view3d?.refresh();
  };

  // The relay finder's shading, kept until a site moves.
  const setSurface = (next: typeof surface) => {
    surface = next;
    surfaceOverlay?.remove();
    surfaceOverlay = undefined;
    el("relayLegend").hidden = !surface;
    if (!map || !surface) return;
    const b = surface.image.bounds;
    surfaceOverlay = L.imageOverlay(surface.image.url, [
      [b.south, b.west],
      [b.north, b.east],
    ], { interactive: false, className: "coverage-overlay" }).addTo(map);
  };

  // A label beside each pin with the site's name (set as text: it's user input).
  const nameTag = (site: SiteId) => {
    const tag = document.createElement("span");
    tag.textContent = nameOf(site);
    return tag;
  };

  const setStatus = (text: string, warn = false) => {
    el("status").textContent = text;
    el("status").classList.toggle("warn", warn);
  };

  // Keep markers, inputs, the line and storage in step with tx and rx.
  const syncPins = () => {
    input("txLoc").value = tx ? formatCoordinates(tx) : "";
    input("rxLoc").value = rx ? formatCoordinates(rx) : "";
    input("relayLoc").value = relay ? formatCoordinates(relay) : "";
    el("relayLocWrap").hidden = !relay;
    el("removeRelay").hidden = !relay;
    el("addRelay").textContent = placingRelay ? "Cancel" : relay ? "Move relay" : "Place relay";
    savePins(tx, rx, relay);
    clearControl?.setVisible(!!(tx || rx || relay));
    if (!map) return;
    const place = (marker: L.Marker | undefined, at: LatLon | undefined, site: SiteId) => {
      if (!at) {
        marker?.remove();
        return undefined;
      }
      if (marker) {
        marker.setLatLng([at.lat, at.lon]);
        marker.setTooltipContent(nameTag(site));
        return marker;
      }
      const icon = radioMarker(site === "relay" ? "RT" : site === "tx" ? "A" : "B");
      const m = L.marker([at.lat, at.lon], { icon, draggable: true }).addTo(map!);
      m.bindTooltip(nameTag(site), { permanent: true, direction: "right", offset: [8, -16], className: "pin-name" });
      m.on("dragend", () => {
        const p = m.getLatLng();
        const moved = { lat: p.lat, lon: p.lng };
        if (site === "relay") {
          relay = moved;
          relayChanged();
          return;
        }
        if (site === "tx") tx = moved;
        else rx = moved;
        pinsChanged();
      });
      return m;
    };
    txMarker = place(txMarker, tx, "tx");
    rxMarker = place(rxMarker, rx, "rx");
    relayMarker = place(relayMarker, relay, "relay");
    drawPath();
  };

  const loadProfile = async () => {
    loading?.abort();
    elevations = undefined;
    if (!tx || !rx) return;
    const distance = distanceBetweenM(tx, rx);
    if (distance < 50) {
      setStatus("Move the pins farther apart.", true);
      return;
    }
    const kept = store.lookup(tx, rx);
    if (kept) {
      elevations = kept;
      setStatus("");
      onPathChange();
      return;
    }
    const controller = new AbortController();
    loading = controller;
    setStatus("Loading terrain…");
    try {
      const result = await fetchPathElevations(samplePath(tx, rx, sampleCount(distance)), controller.signal);
      if (controller.signal.aborted) return;
      elevations = result;
      store.remember(tx, rx, result);
      setStatus("");
    } catch (err) {
      if (controller.signal.aborted) return;
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      setStatus(
        offline
          ? "No connection, so terrain can't load. The rest of the link budget still works."
          : `Couldn't load terrain: ${(err as Error).message}`,
        true,
      );
    }
    onPathChange();
  };

  // Terrain along both hops, from the saved-path store when it has them.
  const loadRelayProfiles = async () => {
    relayLoading?.abort();
    relayElevations = [undefined, undefined];
    if (!relay || !tx || !rx) return;
    const controller = new AbortController();
    relayLoading = controller;
    const pairs: [LatLon, LatLon][] = [
      [tx, relay],
      [relay, rx],
    ];
    try {
      const results = await Promise.all(
        pairs.map(async ([a, b]) => {
          const d = distanceBetweenM(a, b);
          if (d < 50) return undefined;
          const kept = store.lookup(a, b);
          if (kept) return kept;
          const e = await fetchPathElevations(samplePath(a, b, sampleCount(d)), controller.signal);
          store.remember(a, b, e);
          return e;
        }),
      );
      if (controller.signal.aborted) return;
      relayElevations = [results[0], results[1]];
    } catch (err) {
      if (controller.signal.aborted) return;
      setStatus(`Couldn't load terrain for the relay's hops: ${(err as Error).message}`, true);
    }
    onPathChange();
  };

  const relayChanged = () => {
    placingRelay = false;
    syncPins();
    onPathChange();
    void loadRelayProfiles();
  };

  const removeRelay = () => {
    finding?.abort();
    relayLoading?.abort();
    relay = undefined;
    placingRelay = false;
    relayElevations = [undefined, undefined];
    hopQuality = [undefined, undefined];
    setSurface(undefined);
    setStatus("");
    syncPins();
    onPathChange();
  };

  const runFinder = async () => {
    if (!tx || !rx) {
      setStatus(`Drop both ${nameOf("tx")} and ${nameOf("rx")} first: the relay bridges the link between them.`, true);
      return;
    }
    const inputs = hooks.finderInputs();
    if (typeof inputs === "string") {
      setStatus(inputs, true);
      return;
    }
    finding?.abort();
    const controller = new AbortController();
    finding = controller;
    el("findRelay").textContent = "Finding…";
    el("findRelay").toggleAttribute("disabled", true);
    try {
      const found = await findRelay(inputs, (t) => setStatus(t), controller.signal);
      if (controller.signal.aborted || !found) return;
      const fade = hooks.fadeMarginDb();
      setSurface({ image: { url: surfaceImage(found, fade), bounds: found.box }, data: found });
      if (!found.best) {
        setStatus("No spot in the search area is within reach of both sites.", true);
        return;
      }
      const best = found.best;
      relay = { lat: best.lat, lon: best.lon };
      const verdict = best.marginDb >= fade ? "solid" : best.marginDb >= 0 ? "marginal" : "short";
      setStatus(
        verdict === "short"
          ? `No spot closes both hops. The best is ${fmt(-best.marginDb, 1)} dB short; a taller relay mast, more power or better antennas would help. The relay is placed there for a closer look.`
          : `Relay placed at the strongest spot: its weaker hop keeps ${fmt(best.marginDb, 1)} dB (${verdict}). Drag it to try nearby ground you can reach; shading shows where else works.`,
        verdict === "short",
      );
      relayChanged();
      if (map) map.fitBounds(L.latLngBounds([found.box.south, found.box.west], [found.box.north, found.box.east]), { padding: [10, 10] });
    } catch (err) {
      if (!controller.signal.aborted)
        setStatus(navigator.onLine ? `Couldn't run the relay finder: ${(err as Error).message}` : "No connection, and this area's terrain isn't saved yet.", true);
    } finally {
      if (finding === controller) {
        el("findRelay").textContent = "Find relay spot";
        el("findRelay").toggleAttribute("disabled", false);
      }
    }
  };

  const pinsChanged = () => {
    // A site moved: the shading no longer fits, and the hops need new terrain.
    setSurface(undefined);
    void loadRelayProfiles();
    syncPins();
    if (tx && rx && map) map.fitBounds(L.latLngBounds([tx.lat, tx.lon], [rx.lat, rx.lon]), { padding: [30, 30], maxZoom: 13 });
    onPathChange();
    void loadProfile();
  };

  const initMap = () => {
    if (map || !card.isConnected || el("body").hidden) return;
    map = createMap(el("map"), (m) => {
      if (tx && rx) m.fitBounds(L.latLngBounds([tx.lat, tx.lon], [rx.lat, rx.lon]), { padding: [30, 30], maxZoom: 13 });
      else if (tx) m.setView([tx.lat, tx.lon], 11);
      else showDefaultView(m);
    });
    map.on("click", (e: L.LeafletMouseEvent) => {
      const at = { lat: e.latlng.lat, lon: e.latlng.lng };
      if (placingRelay) {
        relay = at;
        setStatus("");
        relayChanged();
        return;
      }
      if (!tx) tx = at;
      else if (!rx) rx = at;
      else return;
      pinsChanged();
    });
    clearControl = addClearControl(map, "the pins, relay and terrain profile", reset);
    setSurface(surface);
    view3d = add3DControl(map, () => {
      const points: Point3D[] = [];
      const ids: SiteId[] = [];
      const at: Partial<Record<SiteId, number>> = {};
      const heights: Record<SiteId, number | undefined> = { tx: lastParams?.txHeightM, rx: lastParams?.rxHeightM, relay: lastParams?.relayHeightM };
      for (const [site, p] of [["tx", tx], ["rx", rx], ["relay", relay]] as const) {
        if (!p) continue;
        at[site] = points.length;
        ids.push(site);
        const location: EditField = { key: "location", label: "Location", value: formatCoordinates(p), type: "text" };
        points.push({ ...p, label: nameOf(site), heightM: heights[site] ?? 2, fields: [...hooks.fields(site), location] });
      }
      const links: Link3D[] = [];
      if (at.tx !== undefined && at.rx !== undefined && quality) links.push({ a: at.tx, b: at.rx, style: linkLineStyle(quality, lineOfSight) });
      if (at.relay !== undefined) {
        if (at.tx !== undefined && hopQuality[0]) links.push({ a: at.tx, b: at.relay, style: linkLineStyle(hopQuality[0], hopStatus[0]) });
        if (at.rx !== undefined && hopQuality[1]) links.push({ a: at.relay, b: at.rx, style: linkLineStyle(hopQuality[1], hopStatus[1]) });
      }
      const moveSite = (site: SiteId, p: LatLon) => {
        if (site === "relay") {
          relay = p;
          relayChanged();
          return;
        }
        if (site === "tx") tx = p;
        else rx = p;
        pinsChanged();
      };
      return {
        title: "Link Analysis",
        points,
        links,
        k: lastParams?.k ?? STANDARD_K,
        overlay: surface?.image,
        // A pin dragged in 3D moves just as if it were dragged on this map.
        onMove: (i: number, p: LatLon) => moveSite(ids[i], p),
        // The pop-up editor: location here, everything else on the Link Analysis.
        onEdit: (i: number, values: Record<string, string>) => {
          const { location, ...rest } = values;
          if (Object.keys(rest).length) hooks.edit(ids[i], rest);
          if (location !== undefined) {
            const p = parseCoordinates(location);
            if (p) moveSite(ids[i], p);
            else setStatus("That location wasn't understood. Use decimal degrees like 35.22710, -80.84310, or MGRS.", true);
          }
          view3d?.refresh();
        },
      };
    });
    syncPins();
  };
  // Leaflet needs the container in the page before it starts. A timer rather
  // than requestAnimationFrame, which doesn't run while the tab is hidden.
  const waitForPage = () => (card.isConnected ? initMap() : setTimeout(waitForPage, 50));
  setTimeout(waitForPage, 0);

  input("relayLoc").addEventListener("change", (e) => {
    e.stopPropagation();
    const text = (e.target as HTMLInputElement).value.trim();
    if (!text) return removeRelay();
    const parsed = parseCoordinates(text);
    if (!parsed) {
      setStatus("Enter decimal degrees like 35.22710, -80.84310, or MGRS like 17S NU 14277 98239.", true);
      return;
    }
    relay = parsed;
    relayChanged();
  });
  input("relayLoc").addEventListener("input", (e) => e.stopPropagation());
  el("addRelay").addEventListener("click", () => {
    placingRelay = !placingRelay;
    setStatus(placingRelay ? "Tap the map where the relay should go." : "");
    syncPins();
  });
  el("findRelay").addEventListener("click", () => void runFinder());
  el("removeRelay").addEventListener("click", removeRelay);

  for (const side of ["tx", "rx"] as const) {
    input(`${side}Loc`).addEventListener("change", (e) => {
      e.stopPropagation();
      const text = (e.target as HTMLInputElement).value.trim();
      const parsed = text ? parseCoordinates(text) : undefined;
      if (text && !parsed) {
        setStatus("Enter decimal degrees like 35.22710, -80.84310, or MGRS like 17S NU 14277 98239.", true);
        return;
      }
      if (side === "tx") tx = parsed;
      else rx = parsed;
      pinsChanged();
    });
    // Typing in these boxes shouldn't recalculate the budget on every key.
    input(`${side}Loc`).addEventListener("input", (e) => e.stopPropagation());
  }

  el("locate").addEventListener("click", () => {
    locateMe(setStatus, (p) => {
      tx = p;
      if (!rx) map?.setView([p.lat, p.lon], 12);
      setStatus("");
      pinsChanged();
    });
  });

  const reset = () => {
    tx = rx = relay = undefined;
    loading?.abort();
    relayLoading?.abort();
    finding?.abort();
    placingRelay = false;
    relayElevations = [undefined, undefined];
    setSurface(undefined);
    elevations = undefined;
    setStatus("");
    syncPins();
    onPathChange();
  };

  // Saved paths. These controls sit inside the link budget form, so keep their
  // events from re-running the budget on every key press.
  const savedList = el("savedList") as HTMLSelectElement;
  const saveName = el("saveName") as HTMLInputElement;
  for (const control of [savedList, saveName]) {
    control.addEventListener("input", (e) => e.stopPropagation());
    control.addEventListener("change", (e) => e.stopPropagation());
  }
  const listSaved = (selected = "") => {
    const paths = store.saved();
    savedList.innerHTML =
      `<option value="">${paths.length ? "Choose a saved path…" : "No saved paths yet"}</option>` +
      paths.map((p) => `<option${p.name === selected ? " selected" : ""}></option>`).join("");
    // Names are user text, so set them as text rather than markup.
    paths.forEach((p, idx) => {
      const option = savedList.options[idx + 1];
      option.value = option.textContent = p.name;
    });
    el("delete").toggleAttribute("disabled", !selected);
  };
  savedList.addEventListener("change", () => {
    const path = store.saved().find((p) => p.name === savedList.value);
    el("delete").toggleAttribute("disabled", !path);
    if (!path) return;
    loading?.abort();
    tx = path.tx;
    rx = path.rx;
    elevations = path.elevationsM;
    saveName.value = path.name;
    setStatus("");
    syncPins();
    if (map) map.fitBounds(L.latLngBounds([tx.lat, tx.lon], [rx.lat, rx.lon]), { padding: [30, 30], maxZoom: 13 });
    onPathChange();
  });
  el("save").addEventListener("click", () => {
    const name = saveName.value.trim();
    if (!tx || !rx || !elevations) {
      setStatus("Drop both pins and let the terrain load before saving.", true);
      return;
    }
    if (!name) {
      setStatus("Give the path a name to save it.", true);
      saveName.focus();
      return;
    }
    if (!store.save({ name, tx, rx, elevationsM: elevations })) {
      setStatus("This browser wouldn't save the path. Storage may be full or blocked.", true);
      return;
    }
    listSaved(name);
    setStatus(`Saved "${name}". It will work offline.`);
  });
  el("delete").addEventListener("click", () => {
    if (!savedList.value) return;
    const name = savedList.value;
    store.remove(name);
    listSaved();
    setStatus(`Deleted "${name}".`);
  });
  listSaved();

  // Tap or drag on the chart to read any point along the path.
  // The points drawn (distances from Site A), and which of them are antennas.
  let lastPoints: ProfilePoint[] | undefined;
  let lastAntennas = new Set<number>();
  let lastParams: TerrainParams | undefined;
  const readPoint = (e: PointerEvent) => {
    const svg = el("chart").querySelector("svg");
    if (!svg || !lastPoints || !lastParams) return;
    const box = svg.getBoundingClientRect();
    const width = svg.viewBox.baseVal.width;
    const left = Number(svg.dataset.left);
    const right = Number(svg.dataset.right);
    const x = ((e.clientX - box.left) / box.width) * width;
    const pts = lastPoints;
    const total = pts[pts.length - 1].distanceM;
    const want = Math.max(0, Math.min(1, (x - left) / (width - left - right))) * total;
    let i = 0;
    pts.forEach((p, k) => {
      if (Math.abs(p.distanceM - want) < Math.abs(pts[i].distanceM - want)) i = k;
    });
    const q = pts[i];
    const at = left + (q.distanceM / total) * (width - left - right);
    const cross = svg.querySelector<SVGLineElement>(".crosshair")!;
    cross.setAttribute("x1", String(at));
    cross.setAttribute("x2", String(at));
    cross.style.display = "";
    const { distUnit, heightUnit } = lastParams;
    const h = (m: number) => `${fmt(fromMetres(Math.abs(m), heightUnit), 0)} ${heightUnit}`;
    const status =
      lastAntennas.has(i)
        ? "at the antenna"
        : q.clearanceM < 0
          ? `terrain is ${h(q.clearanceM)} above the line of sight`
          : `${h(q.clearanceM)} clear, ${fmt(Math.max(0, q.clearanceRatio) * 100, 0)}% of the Fresnel zone`;
    el("chart").querySelector(".chart-readout")!.textContent =
      `${fmt(fromMetres(q.distanceM, distUnit), 2)} ${distUnit} from ${nameOf("tx")}: terrain ${h(q.terrainM)}, ${status}`;
  };
  // With a relay, the profile shows the path through it unless Direct is picked.
  let profileView: "relay" | "direct" = "relay";
  el("viewWrap").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-view]");
    if (!b || !lastParams) return;
    profileView = b.dataset.view as "relay" | "direct";
    refresh(lastParams);
  });
  el("chart").addEventListener("pointerdown", readPoint);
  el("chart").addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse" || e.buttons) readPoint(e);
  });

  el("export").addEventListener("click", () => {
    if (!tx || !rx) {
      setStatus("Drop both pins before exporting.", true);
      return;
    }
    const status = quality ? linkLineStyle(quality, lineOfSight) : undefined;
    const [txName, rxName, relayName] = [nameOf("tx"), nameOf("rx"), nameOf("relay")];
    const places = [
      { name: txName, lat: tx.lat, lon: tx.lon },
      { name: rxName, lat: rx.lat, lon: rx.lon },
    ];
    const lines = [{ name: `${txName} to ${rxName}`, from: tx, to: rx, status, description: status ? `${linkLineLabels[status]}.` : "Not rated." }];
    if (relay) {
      places.push({ name: relayName, lat: relay.lat, lon: relay.lon });
      const hop = (i: 0 | 1) => (hopQuality[i] ? linkLineStyle(hopQuality[i]!, hopStatus[i]) : undefined);
      const h1 = hop(0);
      const h2 = hop(1);
      lines.push({ name: `${txName} to ${relayName}`, from: tx, to: relay, status: h1, description: h1 ? `Hop 1. ${linkLineLabels[h1]}.` : "Hop 1. Not rated." });
      lines.push({ name: `${relayName} to ${rxName}`, from: relay, to: rx, status: h2, description: h2 ? `Hop 2. ${linkLineLabels[h2]}.` : "Hop 2. Not rated." });
    }
    const kml = buildKml("RF Toolkit path", places, lines, RADIO_FILE);
    const kmz = buildZip([{ name: "doc.kml", data: new TextEncoder().encode(kml) }, radioIconFile()]);
    downloadFile("rf-toolkit-path.kmz", new Uint8Array(kmz), "application/vnd.google-earth.kmz");
    setStatus("Exported. Import the file in ATAK, WinTAK or Google Earth.");
  });

  const hfNote = "A line-of-sight terrain profile doesn't apply below 30 MHz.";
  const refresh = (params: TerrainParams): TerrainAnalysis | undefined => {
    const pill = el("pill");
    const chart = el("chart");
    const facts = el("facts");
    lineOfSight = undefined;
    if (!tx || !rx || !elevations || !params.applies || !(params.freqHz > 0)) {
      pill.hidden = chart.hidden = facts.hidden = el("losNote").hidden = el("viewWrap").hidden = true;
      lastPoints = undefined;
      if (!params.applies && tx && rx) setStatus(hfNote);
      else if (el("status").textContent === hfNote) setStatus("");
      return undefined;
    }
    if (el("status").textContent === hfNote) setStatus("");

    const path = {
      freqHz: params.freqHz,
      distanceM: distanceBetweenM(tx, rx),
      elevationsM: elevations,
      txHeightM: params.txHeightM,
      rxHeightM: params.rxHeightM,
    };
    const result = analyzeProfile({ ...path, k: params.k });
    const loss = terrainLoss(path, params.model);
    // The map line follows the direct path's line of sight, whichever profile is shown.
    lineOfSight = result.status;

    // With a relay whose hops have loaded, the profile can show A → relay → B.
    const relayH = params.relayHeightM ?? params.rxHeightM;
    const hopSegments =
      relay && relayElevations[0] && relayElevations[1]
        ? ([
            [tx, relay, relayElevations[0], params.txHeightM, relayH],
            [relay, rx, relayElevations[1], relayH, params.rxHeightM],
          ] as const).map(([a, b, e, aH, bH]) => {
            const hop = { freqHz: params.freqHz, distanceM: distanceBetweenM(a, b), elevationsM: e, txHeightM: aH, rxHeightM: bH };
            return { result: analyzeProfile({ ...hop, k: params.k }), loss: terrainLoss(hop, params.model), from: a, to: b };
          })
        : undefined;
    el("viewWrap").hidden = !hopSegments;
    const viaRelay = !!hopSegments && profileView === "relay";
    el("viewWrap").querySelectorAll<HTMLButtonElement>("button[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === (viaRelay ? "relay" : "direct"))));

    const h = (m: number) => `${fmt(fromMetres(m, params.heightUnit), 0)} ${params.heightUnit}`;
    const d = (m: number) => `${fmt(fromMetres(m, params.distUnit), 2)} ${params.distUnit}`;
    const tightest = (w: ProfilePoint) =>
      w.clearanceM < 0
        ? `${h(-w.clearanceM)} above the line of sight`
        : `${h(w.clearanceM)} clear, ${fmt(Math.max(0, w.clearanceRatio) * 100, 0)}% of the Fresnel zone`;
    const lossLabel = (l: TerrainLoss, prefix = "") => `${prefix}Terrain loss (${l.model === "itm" ? "Longley-Rice" : "Bullington"})`;
    const kNote = (t: string) => (params.k === STANDARD_K ? t : `${t} at k = ${kLabel(params.k)}`);
    const [A, B, R] = [escapeXml(nameOf("tx")), escapeXml(nameOf("rx")), escapeXml(nameOf("relay"))];

    let shownStatus: ProfileStatus;
    let rows: string[][];
    let totalRows: number[];
    if (viaRelay && hopSegments) {
      const [s1, s2] = hopSegments;
      const rank: Record<ProfileStatus, number> = { clear: 0, fresnel: 1, blocked: 2 };
      shownStatus = rank[s1.result.status] >= rank[s2.result.status] ? s1.result.status : s2.result.status;
      const which = s1.result.status === s2.result.status ? "both hops" : s1.result.status === shownStatus ? "hop 1" : "hop 2";
      pill.textContent = kNote(shownStatus === "clear" ? "Clear line of sight on both hops" : `${statusText[shownStatus][0]} on ${which}`);
      const hopRows = (s: (typeof hopSegments)[number], n: number, fromName: string) => [
        [lossLabel(s.loss, `Hop ${n} `), `${fmt(s.loss.lossDb, 1)} dB beyond free space`],
        [`Hop ${n} tightest point`, `${d(s.result.worst.distanceM)} from ${fromName}: ${tightest(s.result.worst)}`],
        [`Hop ${n} length, bearing`, `${d(distanceBetweenM(s.from, s.to))}, ${fmt(bearingDeg(s.from, s.to), 1)}° (back ${fmt(bearingDeg(s.to, s.from), 1)}°)`],
      ];
      rows = [
        ...hopRows(s1, 1, A),
        ...hopRows(s2, 2, R),
        [`Ground at ${A} / ${R} / ${B}`, `${h(s1.result.txGroundM)} / ${h(s1.result.rxGroundM)} / ${h(s2.result.rxGroundM)}`],
      ];
      totalRows = [0, 3];
      // One chart: hop 2's points carry on from where hop 1 ends.
      const offset = s1.result.points[s1.result.points.length - 1].distanceM;
      lastPoints = [...s1.result.points, ...s2.result.points.map((q) => ({ ...q, distanceM: q.distanceM + offset }))];
      lastAntennas = new Set([0, s1.result.points.length - 1, s1.result.points.length, lastPoints.length - 1]);
    } else {
      shownStatus = result.status;
      pill.textContent = kNote(statusText[result.status][0]);
      const w = result.worst;
      rows = [
        [lossLabel(loss), `${fmt(loss.lossDb, 1)} dB beyond free space`],
        ["Tightest point", `${d(w.distanceM)} from ${A}`],
        [w.clearanceM < 0 ? "Terrain there is" : "Clearance there", tightest(w)],
        [`Ground at ${A} / ${B}`, `${h(result.txGroundM)} / ${h(result.rxGroundM)}`],
        [`Bearing ${A} → ${B}`, `${fmt(bearingDeg(tx, rx), 1)}° (back ${fmt(bearingDeg(rx, tx), 1)}°)`],
      ];
      totalRows = [0];
      lastPoints = result.points;
      lastAntennas = new Set([0, result.points.length - 1]);
    }
    pill.hidden = false;
    pill.className = `pill ${statusText[shownStatus][1]}`;
    pill.title = losNote;
    el("losNote").textContent = losNote;
    el("losNote").hidden = shownStatus === "clear";

    chart.hidden = false;
    // Draw at the real width so the axis text stays its CSS size on phones.
    const segments = viaRelay && hopSegments ? hopSegments.map((s) => s.result) : [result];
    const names = viaRelay ? [nameOf("tx"), nameOf("relay"), nameOf("rx")] : [nameOf("tx"), nameOf("rx")];
    chart.innerHTML = drawProfile(segments, params, chart.clientWidth || 640, names);
    lastParams = params;

    facts.hidden = false;
    facts.querySelector("tbody")!.innerHTML = rows
      .map(([k, v], idx) => `<tr${totalRows.includes(idx) ? ' class="total"' : ""}><td>${k}</td><td class="num mono">${v}</td></tr>`)
      .join("");
    return { ...result, loss };
  };

  // Open on desktop, where there's room beside the results. On a phone it stays
  // closed until wanted, so it doesn't push the results down, unless pins exist.
  const setOpen = (open: boolean) => {
    el("body").hidden = !open;
    el("toggle").textContent = open ? "Hide" : "Show";
    el("toggle").setAttribute("aria-expanded", String(open));
    if (open) initMap();
  };
  el("toggle").addEventListener("click", () => setOpen(el("body").hidden !== false));
  if (tx || rx || window.matchMedia("(min-width: 601px)").matches) el("body").hidden = false;
  el("toggle").textContent = el("body").hidden ? "Show" : "Hide";
  el("toggle").setAttribute("aria-expanded", String(!el("body").hidden));

  syncPins();
  // After the page finishes building: a cached path calls onPathChange straight away.
  if (tx && rx) queueMicrotask(() => {
    void loadProfile();
    if (relay) void loadRelayProfiles();
  });

  return {
    element: card,
    pathDistanceM: () => (tx && rx ? distanceBetweenM(tx, rx) : undefined),
    pins: () => (tx && rx ? { tx, rx } : undefined),
    relay: () => relay,
    hops(params) {
      hopStatus = [undefined, undefined];
      if (!relay || !tx || !rx || !params.applies || !(params.freqHz > 0)) return {};
      const relayH = params.relayHeightM ?? params.rxHeightM;
      const one = (a: LatLon, b: LatLon, e: number[] | undefined, aH: number, bH: number): HopAnalysis | undefined => {
        if (!e) return undefined;
        const path = { freqHz: params.freqHz, distanceM: distanceBetweenM(a, b), elevationsM: e, txHeightM: aH, rxHeightM: bH };
        return { distanceM: path.distanceM, loss: terrainLoss(path, params.model), status: analyzeProfile({ ...path, k: params.k }).status };
      };
      const hop1 = one(tx, relay, relayElevations[0], params.txHeightM, relayH);
      const hop2 = one(relay, rx, relayElevations[1], relayH, params.rxHeightM);
      hopStatus = [hop1?.status, hop2?.status];
      return { hop1, hop2 };
    },
    showHops(q1, q2) {
      hopQuality = [q1, q2];
      drawPath();
    },
    namesChanged() {
      syncPins();
      if (lastParams) refresh(lastParams);
      view3d?.refresh();
    },
    refresh,
    reset,
    showLink(q) {
      quality = q;
      drawPath();
    },
  };
}

/**
 * SVG elevation profile: terrain, line of sight and the first Fresnel zone.
 * Several segments (the hops through a relay) are drawn end to end, each with
 * its own line of sight; names label every antenna, in order.
 */
function drawProfile(segments: ProfileResult[], p: TerrainParams, width: number, names: string[]): string {
  const W = Math.max(300, Math.round(width));
  const H = W < 500 ? 200 : 220;
  const pad = { l: 58, r: 12, t: 14, b: 26 };
  // Each segment's points, moved along by the length of those before it.
  let run = 0;
  const segs = segments.map((r) => {
    const start = run;
    run += r.points[r.points.length - 1].distanceM;
    return r.points.map((q) => ({ ...q, distanceM: q.distanceM + start }));
  });
  const pts = segs.flat();
  const total = run;
  const lows = pts.map((q) => Math.min(q.terrainM, q.losM - q.fresnelM));
  const highs = pts.map((q) => Math.max(q.terrainM, q.losM + q.fresnelM));
  let min = Math.min(...lows);
  let max = Math.max(...highs);
  const span = Math.max(max - min, 10);
  min -= span * 0.08;
  max += span * 0.05;

  const x = (d: number) => pad.l + (d / total) * (W - pad.l - pad.r);
  const y = (m: number) => pad.t + (1 - (m - min) / (max - min)) * (H - pad.t - pad.b);
  const path = (coords: [number, number][]) => coords.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`).join("");

  const terrain = path([[x(0), y(min)], ...pts.map((q): [number, number] => [x(q.distanceM), y(q.terrainM)]), [x(total), y(min)]]) + "Z";
  // Fresnel zone, 60% line and line of sight: one of each per segment.
  const zone = segs
    .map((sp) => {
      const upper = sp.map((q): [number, number] => [x(q.distanceM), y(q.losM + q.fresnelM)]);
      const lower = sp.map((q): [number, number] => [x(q.distanceM), y(q.losM - q.fresnelM)]).reverse();
      return path([...upper, ...lower]) + "Z";
    })
    .join("");
  const zone60 = segs.map((sp) => path(sp.map((q): [number, number] => [x(q.distanceM), y(q.losM - FRESNEL_CLEAR_RATIO * q.fresnelM)]))).join("");
  const los = segs.map((sp) => path([[x(sp[0].distanceM), y(sp[0].losM)], [x(sp[sp.length - 1].distanceM), y(sp[sp.length - 1].losM)]])).join("");

  const hits = segs
    .flatMap((sp) => sp.slice(1, -1))
    .filter((q) => q.clearanceRatio < FRESNEL_CLEAR_RATIO)
    .map((q) => `<circle class="${q.clearanceM < 0 ? "hit-block" : "hit-fresnel"}" cx="${x(q.distanceM).toFixed(1)}" cy="${y(q.terrainM).toFixed(1)}" r="2.6"/>`)
    .join("");

  const first = pts[0];
  const last = pts[pts.length - 1];
  const mast = (q: typeof first) => `<line class="mast" x1="${x(q.distanceM)}" x2="${x(q.distanceM)}" y1="${y(q.terrainM)}" y2="${y(q.losM)}"/>`;
  // Each antenna: the path's two ends, and each relay between segments (the
  // higher of the two hops' antenna tops, which are the same mast).
  const antennas = [first, ...segs.slice(0, -1).map((sp, i) => {
    const end = sp[sp.length - 1];
    const next = segs[i + 1][0];
    return next.losM > end.losM ? next : end;
  }), last];
  const relayLabels = antennas
    .slice(1, -1)
    .map((q, i) => `<text class="end-label relay-label" x="${x(q.distanceM)}" y="${Math.max(pad.t + 10, y(q.losM) - 8)}" text-anchor="middle">${escapeXml(names[i + 1] ?? "Relay")}</text>`)
    .join("");

  const hLabel = (m: number) => `${fmt(fromMetres(m, p.heightUnit), 0)} ${p.heightUnit}`;
  const dLabel = (m: number) => `${fmt(fromMetres(m, p.distUnit), fromMetres(total, p.distUnit) < 10 ? 1 : 0)}`;
  const yTicks = [min + (max - min) * 0.1, (min + max) / 2, max - (max - min) * 0.05];
  const xTicks = [0, total / 2, total];

  return `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${segs.length > 1 ? "Terrain profile through the relay" : "Terrain profile between the two sites"}" data-left="${pad.l}" data-right="${pad.r}">
      ${yTicks.map((m) => `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(m)}" y2="${y(m)}"/><text class="axis" x="${pad.l - 6}" y="${y(m) + 4}" text-anchor="end">${hLabel(m)}</text>`).join("")}
      <path class="zone" d="${zone}"/>
      <path class="zone60" d="${zone60}"/>
      <path class="terrain-fill" d="${terrain}"/>
      <path class="los" d="${los}"/>
      ${antennas.map(mast).join("")}
      ${hits}
      ${xTicks.map((d, i) => `<text class="axis" x="${x(d)}" y="${H - 8}" text-anchor="${["start", "middle", "end"][i]}">${dLabel(d)}${i === 2 ? ` ${p.distUnit}` : ""}</text>`).join("")}
      <text class="end-label" x="${x(0) + 4}" y="${y(first.losM) - 6}">${escapeXml(names[0])}</text>
      <text class="end-label" x="${x(total) - 4}" y="${y(last.losM) - 6}" text-anchor="end">${escapeXml(names[names.length - 1])}</text>
      ${relayLabels}
      <line class="crosshair" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" style="display:none"/>
    </svg>
    <p class="note chart-readout">Tap the chart to read any point.</p>
    <div class="legend">
      <span class="key"><span class="ln los-key"></span>Line of sight</span>
      <span class="key"><span class="sw zone-key"></span>First Fresnel zone</span>
      <span class="key"><span class="ln dash zone60-key"></span>60% line</span>
      <span class="key"><span class="sw terrain-key"></span>Terrain + earth curve</span>
    </div>`;
}

/** Names are user text: make them safe inside SVG markup. */
function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
