// Terrain profile card for Link Analysis: a map with pins for Site A and Site B
// (and an optional relay between them), the elevation profile between them,
// and how well the path clears it.

import { escapeHtml } from "../lib/html";
import * as L from "leaflet";
import { type ClearControl, type Control3D, add3DControl, addClearControl, createMap, showDefaultView, DATA_ATTRIBUTION } from "./mapKit";
import type { EditField, Link3D, Point3D } from "../lib/scene3d";
import { type RelaySurface, hopMarginDb, topCandidates } from "../lib/relay";
import { type RelayFinderInputs, findRelay, surfaceImage } from "./relayFinder";
import { type ExportPoint, buildKml, buildZip } from "../lib/export";
import { IMPORT_ACCEPT, NO_POINTS, SHARE_ICONS, downloadFile } from "./planBar";
import { MAX_IMPORT_BYTES, buildDataPackage, importPoints } from "../lib/tak";
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
import { STANDARD_K } from "../lib/horizon";

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
  /** A site's name from an imported file. */
  setName(site: SiteId, name: string): void;
  /** A link that opens this whole link (settings and pins) on another device. */
  shareUrl(): string;
  /** Everything the relay finder needs, or why it can't run. */
  finderInputs(): RelayFinderInputs | string;
  fadeMarginDb(): number;
}

const siteDefaults: Record<SiteId, string> = { tx: "Site A", rx: "Site B", relay: "Relay" };

export interface TerrainCard {
  /** Every part, before they're placed. */
  element: HTMLElement;
  /** Each part, to place where it belongs. */
  parts: Record<TerrainPart, HTMLElement>;
  /** Draw the profile again at its current width (after its card opens). */
  redraw(): void;
  /** Put the pins down, as from a share link. */
  setPins(p: { tx?: LatLon; rx?: LatLon; relay?: LatLon }): void;
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
  /** Which path a placed relay's cards describe: through it, or direct. Shared with the Link budget card. */
  view(): PathView;
  setView(v: PathView): void;
  /** Frame the sites again for space that changed (the docked profile), unless the user has moved the map. */
  reframe(): void;
  /** Run when a path line on the map is tapped, with the path tapped. */
  onLineTap(fn: (view: PathView) => void): void;
}

export type PathView = "relay" | "direct";

// Line of sight only, not a verdict on the link: the terrain loss from an
// obstruction is already in the budget, which says whether the link works. So
// no red here; red is kept for the budget's "won't close".
const statusText: Record<ProfileStatus, [string, string]> = {
  clear: ["Clear line of sight", "s-good"],
  fresnel: ["Fresnel partly blocked", "s-marginal"],
  blocked: ["No line of sight", "s-marginal"],
};
const losNote =
  "Line of sight only. The extra loss from this terrain is already counted in the link budget, so go by the budget's verdict: a link can still work over a ridge, by diffraction, if the margin holds.";

// The card's pieces, each placed by the Link Analysis where it belongs: the
// map in the middle, each site's location in its own card, and so on.
export type TerrainPart = "map" | "tx" | "rx" | "relay" | "profile" | "share";



const template = `
  <div class="terrain-part" data-part="map">
    <div class="map" data-t="map"></div>
    <p class="map-status" data-t="status" role="status"></p>
    <div class="map-legend" data-t="legend"></div>
  </div>
  <div class="terrain-part fields" data-part="tx">
    <label class="wide">Location
      <span class="input-unit">
        <input name="txLoc" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" />
        ${locateButton('data-t="locate"')}
      </span>
    </label>
  </div>
  <div class="terrain-part fields" data-part="rx">
    <label class="wide">Location
      <input name="rxLoc" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" />
    </label>
  </div>
  <div class="terrain-part" data-part="relay">
    <div class="relay-actions">
      <button type="button" class="secondary" data-t="addRelay">Place</button>
      <button type="button" class="secondary" data-t="findRelay">Recommend</button>
      <button type="button" class="secondary" data-t="removeRelay" hidden>Remove</button>
    </div>
    <div class="legend relay-legend" data-t="relayLegend" hidden>
      <span class="key"><span class="sw cov-strong"></span>Relay: strong</span>
      <span class="key"><span class="sw cov-solid"></span>Good</span>
      <span class="key"><span class="sw cov-marginal"></span>Marginal</span>
      <span class="relay-legend-note">Where a relay would close both hops</span>
    </div>
    <div class="fields" data-t="relayLocWrap" hidden>
      <label class="wide">Location
        <input name="relayLoc" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" />
      </label>
    </div>
  </div>
  <div class="terrain-part" data-part="profile">
    <span class="pill" data-t="pill" hidden></span>
    <p class="note" data-t="hint">Tap the map for Site A, then Site B, to see the ground between them. Drag a pin to move it.</p>
    <div class="dir-switch profile-view" data-t="viewWrap" hidden>
      <span class="note">Profile</span>
      <div class="seg" role="group" aria-label="Profile shown">
        <button type="button" data-view="relay">Via relay</button>
        <button type="button" data-view="direct">Direct</button>
      </div>
    </div>
    <div class="profile-chart" data-t="chart" hidden></div>
    <div class="profile-stats" data-t="facts" hidden></div>
  </div>
  <div class="terrain-part" data-part="share">
    <h3 class="share-head">Export</h3>
    <div class="share-grid">
      <button type="button" class="share-choice" data-t="exportTak">${SHARE_ICONS.tak}TAK</button>
      <button type="button" class="share-choice" data-t="exportKmz">${SHARE_ICONS.earth}Google Earth</button>
      <button type="button" class="share-choice" data-t="sendLink">${SHARE_ICONS.link}Send link</button>
    </div>
    <h3 class="share-head">Import</h3>
    <div class="share-grid">
      <button type="button" class="share-choice" data-t="import" title="KML, KMZ, CoT or a TAK data package">${SHARE_ICONS.file}From file</button>
    </div>
    <input type="file" data-t="file" accept="${IMPORT_ACCEPT}" hidden />
    <h3 class="share-head">Saved paths</h3>
    <ul class="saved-list" data-t="savedItems"></ul>
    <div class="save-row">
      <input data-t="saveName" type="text" placeholder="Name this path" autocomplete="off" aria-label="Name for the saved path" />
      <button type="button" class="secondary" data-t="save">Save</button>
    </div>
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
  const card = document.createElement("div");
  card.className = "terrain";
  card.innerHTML = template;
  card.querySelector('[data-t="legend"]')!.append(linkLegend());
  // Looked up once: the parts move into different places on the page.
  const byT = new Map<string, HTMLElement>();
  for (const e of card.querySelectorAll<HTMLElement>("[data-t]")) byT.set(e.dataset.t!, e);
  const inputs = new Map<string, HTMLInputElement>();
  for (const e of card.querySelectorAll<HTMLInputElement>("input[name]")) inputs.set(e.name, e);
  const el = (name: string) => byT.get(name)!;
  const input = (name: string) => inputs.get(name)!;
  const parts = Object.fromEntries([...card.querySelectorAll<HTMLElement>("[data-part]")].map((p) => [p.dataset.part, p])) as Record<TerrainPart, HTMLElement>;
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
  let profileView: PathView = "relay";
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
  /** Called when a path line is tapped, with the path it belongs to. */
  let lineTap: ((view: PathView) => void) | undefined;
  /** A wide, invisible line over a path line, so a finger can tap it. */
  const tappable = (group: L.LayerGroup, a: LatLon, b: LatLon, view: PathView) => {
    const hit = L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { className: "link-hit", weight: 20, opacity: 0 });
    hit.on("click", (e) => {
      // While a relay is being placed, a tap on the line places it there.
      if (placingRelay || !lineTap) return;
      L.DomEvent.stopPropagation(e);
      lineTap(view);
    });
    group.addLayer(hit);
    return group;
  };
  // Without a rating (a field missing, or HF) there's no line, just the pins.
  const drawPath = () => {
    line?.remove();
    for (const l of hopLines) l.remove();
    hopLines = [];
    line = map && tx && rx && quality ? tappable(drawLinkLine(map, tx, rx, linkLineStyle(quality, lineOfSight)), tx, rx, "direct") : undefined;
    if (map && relay) {
      if (tx && hopQuality[0]) hopLines.push(tappable(drawLinkLine(map, tx, relay, linkLineStyle(hopQuality[0], hopStatus[0])), tx, relay, "relay"));
      if (rx && hopQuality[1]) hopLines.push(tappable(drawLinkLine(map, relay, rx, linkLineStyle(hopQuality[1], hopStatus[1])), relay, rx, "relay"));
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

  // Messages float on the map. Plain news fades after a few seconds; warnings
  // and work in progress (ending in "…") stay until replaced.
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  const setStatus = (text: string, warn = false) => {
    el("status").textContent = text;
    el("status").classList.toggle("warn", warn);
    clearTimeout(statusTimer);
    if (text && !warn && !text.endsWith("…")) {
      statusTimer = setTimeout(() => {
        if (el("status").textContent === text) el("status").textContent = "";
      }, 6000);
    }
  };

  // Keep markers, inputs, the line and storage in step with tx and rx.
  const syncPins = () => {
    input("txLoc").value = tx ? formatCoordinates(tx) : "";
    input("rxLoc").value = rx ? formatCoordinates(rx) : "";
    input("relayLoc").value = relay ? formatCoordinates(relay) : "";
    el("relayLocWrap").hidden = !relay;
    el("removeRelay").hidden = !relay;
    el("addRelay").textContent = placingRelay ? "Cancel" : "Place";
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
    // The next relay opens on the path through it again.
    profileView = "relay";
    relayElevations = [undefined, undefined];
    hopQuality = [undefined, undefined];
    setSurface(undefined);
    setStatus("");
    syncPins();
    onPathChange();
  };

  /**
   * Check candidate relay spots on detailed terrain profiles, the same way the
   * link budget checks the placed relay, and return the one whose weaker hop
   * has the most margin. Each hop's profile is kept in the saved-path store, so
   * the budget reuses it once the relay is placed.
   */
  const verifyCandidates = async (candidates: { lat: number; lon: number }[], inputs: RelayFinderInputs, signal: AbortSignal) => {
    if (!tx || !rx || !lastParams) return undefined;
    const model = lastParams.model;
    const profile = async (a: LatLon, b: LatLon) => {
      const d = distanceBetweenM(a, b);
      const kept = store.lookup(a, b);
      if (kept || d < 50) return { d, e: kept };
      const e = await fetchPathElevations(samplePath(a, b, sampleCount(d)), signal);
      store.remember(a, b, e);
      return { d, e };
    };
    /** A hop's margin on detailed terrain, or free space when it's too short to profile. */
    const hop = async (a: LatLon, b: LatLon, aHeightM: number, bHeightM: number, radios: RelayFinderInputs["hop1"]) => {
      const { d, e } = await profile(a, b);
      const loss = e ? terrainLoss({ freqHz: inputs.freqHz, distanceM: d, elevationsM: e, txHeightM: aHeightM, rxHeightM: bHeightM }, model).lossDb : 0;
      return hopMarginDb(radios, inputs.freqHz, Math.max(1, d), loss);
    };
    let best: { lat: number; lon: number; marginDb: number } | undefined;
    for (const c of candidates) {
      if (signal.aborted) return undefined;
      const m1 = await hop(tx, c, inputs.aHeightM, inputs.relayHeightM, inputs.hop1);
      const m2 = await hop(c, rx, inputs.relayHeightM, inputs.bHeightM, inputs.hop2);
      const m = Math.min(m1, m2);
      if (!best || m > best.marginDb) best = { lat: c.lat, lon: c.lon, marginDb: m };
    }
    return best;
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
      // The quick search runs on coarse terrain, which can smooth over ridges and
      // read too kindly. So its strongest few spots are checked on the same
      // detailed terrain profile the link budget uses, and the relay goes to the
      // best spot that check confirms. The message reports the checked figure.
      setStatus("Checking the best spots on detailed terrain…");
      const best = await verifyCandidates(topCandidates(found, 8, 500), inputs, controller.signal);
      if (controller.signal.aborted || !best) return;
      relay = { lat: best.lat, lon: best.lon };
      const verdict = best.marginDb >= fade ? "good" : best.marginDb >= 0 ? "marginal" : "short";
      setStatus(
        verdict === "short"
          ? `No spot closes both hops on detailed terrain. The best is ${fmt(-best.marginDb, 1)} dB short; a taller relay mast, more power or better antennas would help. The relay is placed there for a closer look.`
          : `Relay placed at the strongest spot on detailed terrain: its weaker hop keeps ${fmt(best.marginDb, 1)} dB (${verdict}). The shading is a quicker, rougher estimate of where else may work.`,
        verdict === "short",
      );
      relayChanged();
      if (map) map.fitBounds(L.latLngBounds([found.box.south, found.box.west], [found.box.north, found.box.east]), { padding: [10, 10] });
    } catch (err) {
      if (!controller.signal.aborted)
        setStatus(navigator.onLine ? `Couldn't run the relay finder: ${(err as Error).message}` : "No connection, and this area's terrain isn't saved yet.", true);
    } finally {
      if (finding === controller) {
        el("findRelay").textContent = "Recommend";
        el("findRelay").toggleAttribute("disabled", false);
      }
    }
  };

  /**
   * Frame both sites (and the relay) in the part of the map nothing covers:
   * clear of the floating side panes and the docked profile on wide screens.
   */
  const fitPath = (m: L.Map) => {
    if (!tx || !rx) return;
    const box = m.getContainer().getBoundingClientRect();
    const shell = m.getContainer().closest<HTMLElement>(".lb-shell.floating");
    const covered = (sel: string) => {
      const e = shell?.querySelector<HTMLElement>(sel);
      if (!e || !e.offsetWidth || getComputedStyle(e).position !== "absolute") return undefined;
      return e.getBoundingClientRect();
    };
    const left = covered(".lb-left");
    const right = covered(".lb-right");
    // The taskbar floats above the dock, so whichever starts higher bounds the view.
    const tops = [covered(".profile-dock")?.top, shell ? shell.querySelector<HTMLElement>(".map-taskbar")?.getBoundingClientRect().top : undefined]
      .filter((t): t is number => t !== undefined && t > box.top);
    const bottomCover = tops.length ? box.bottom - Math.min(...tops) : 0;
    const points: [number, number][] = [[tx.lat, tx.lon], [rx.lat, rx.lon]];
    if (relay) points.push([relay.lat, relay.lon]);
    m.fitBounds(L.latLngBounds(points), {
      // The top padding also clears the pin icon, which stands about 31 px above its point.
      paddingTopLeft: [30 + (left ? left.right - box.left : 0), 30 + 32],
      paddingBottomRight: [30 + (right ? box.right - right.left : 0), 30 + bottomCover],
      maxZoom: 13,
    });
    fittedAt = performance.now();
    framed = true;
  };
  /** Whether the view is still the one fitPath set, so it can follow the dock. */
  let framed = false;
  let fittedAt = 0;

  const pinsChanged = () => {
    // A site moved: the shading no longer fits, and the hops need new terrain.
    setSurface(undefined);
    void loadRelayProfiles();
    syncPins();
    if (tx && rx && map) fitPath(map);
    onPathChange();
    void loadProfile();
  };

  const initMap = () => {
    if (map || !el("map").isConnected) return;
    map = createMap(el("map"), (m) => {
      if (tx && rx) fitPath(m);
      else if (tx) m.setView([tx.lat, tx.lon], 11);
      else showDefaultView(m);
    }, { taskbar: true });
    map.attributionControl.addAttribution(DATA_ATTRIBUTION);
    // Panning or zooming by hand means the view is the user's now.
    // (Leaflet starts its own zoom a frame after fitBounds, so a zoom right
    // after framing is ours.)
    map.on("dragstart", () => {
      framed = false;
    });
    map.on("zoomstart", () => {
      if (performance.now() - fittedAt > 600) framed = false;
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
        title: "VHF/UHF Link Analysis",
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
  const waitForPage = () => (el("map").isConnected ? initMap() : setTimeout(waitForPage, 50));
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

  // Saved paths: a list to open or delete, and a name box to save the
  // current one. These sit inside the link budget form, so their typing
  // mustn't re-run the budget.
  const saveName = el("saveName") as HTMLInputElement;
  for (const type of ["input", "change"]) saveName.addEventListener(type, (e) => e.stopPropagation());
  const openSaved = (name: string) => {
    const path = store.saved().find((p) => p.name === name);
    if (!path) return;
    loading?.abort();
    tx = path.tx;
    rx = path.rx;
    elevations = path.elevationsM;
    saveName.value = path.name;
    setStatus(`Opened "${path.name}".`);
    syncPins();
    if (map) fitPath(map);
    onPathChange();
  };
  const listSaved = () => {
    const paths = store.saved();
    const list = el("savedItems");
    if (!paths.length) {
      list.replaceChildren();
      return;
    }
    // Names are user text, so they're set as text.
    list.replaceChildren(
      ...paths.map((p) => {
        const li = document.createElement("li");
        const open = document.createElement("button");
        open.type = "button";
        open.className = "saved-open";
        open.textContent = p.name;
        open.addEventListener("click", () => openSaved(p.name));
        const del = document.createElement("button");
        del.type = "button";
        del.className = "secondary icon-btn saved-del";
        del.textContent = "✕";
        del.setAttribute("aria-label", `Delete ${p.name}`);
        del.addEventListener("click", () => {
          if (!confirm(`Delete the saved path "${p.name}"?`)) return;
          store.remove(p.name);
          listSaved();
          setStatus(`Deleted "${p.name}".`);
        });
        li.append(open, del);
        return li;
      }),
    );
  };
  const saveCurrent = () => {
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
    listSaved();
    setStatus(`Saved "${name}". It will work offline.`);
  };
  el("save").addEventListener("click", saveCurrent);
  saveName.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    saveCurrent();
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
  // The Link budget card has the same switch; both follow this one value.
  el("viewWrap").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-view]");
    if (!b) return;
    profileView = b.dataset.view as PathView;
    onPathChange();
  });
  el("chart").addEventListener("pointerdown", readPoint);
  el("chart").addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse" || e.buttons) readPoint(e);
  });

  // The path as a KMZ (pins and rated lines), and the pins as TAK markers.
  const pathExport = (): { kmz: Uint8Array; places: ExportPoint[] } | undefined => {
    if (!tx || !rx) return undefined;
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
    return { kmz: new Uint8Array(kmz), places };
  };
  const exportAs = (tak: boolean) => {
    const out = pathExport();
    if (!out) {
      setStatus("Drop both pins before exporting.", true);
      return;
    }
    if (tak) {
      const name = `${nameOf("tx")} to ${nameOf("rx")}`;
      const pkg = buildDataPackage(name, [{ name: "rf-toolkit-path.kmz", data: out.kmz }], out.places.map((p) => ({ ...p, description: "Link site, from RF Toolkit" })));
      downloadFile("rf-toolkit-path.zip", pkg as BlobPart, "application/zip");
      setStatus("Exported. Import the .zip in ATAK, WinTAK or iTAK (Import, or drag it onto the map).");
    } else {
      downloadFile("rf-toolkit-path.kmz", out.kmz as BlobPart, "application/vnd.google-earth.kmz");
      setStatus("Exported. Import the file in ATAK, WinTAK or Google Earth.");
    }
  };
  el("exportKmz").addEventListener("click", () => exportAs(false));
  el("exportTak").addEventListener("click", () => exportAs(true));
  // On a phone the share sheet offers Messages, email and the rest; elsewhere
  // the link is copied.
  el("sendLink").addEventListener("click", async () => {
    if (!tx || !rx) {
      setStatus("Drop both pins before sending the link.", true);
      return;
    }
    const url = hooks.shareUrl();
    try {
      if (navigator.share) {
        await navigator.share({ title: `${nameOf("tx")} to ${nameOf("rx")}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setStatus("Link copied. Anyone you send it to sees these locations.");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setStatus("Couldn't copy the link automatically in this browser.", true);
    }
  });

  const listWords = (w: string[]) => (w.length < 2 ? w.join("") : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`);
  // Import: points fill Site A, Site B, then the relay. With both sites
  // already down, the file's points replace them in that order.
  const fileInput = el("file") as HTMLInputElement;
  el("import").addEventListener("click", () => {
    fileInput.value = "";
    fileInput.click();
  });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setStatus("That file is over 20 MB, too large to import.", true);
      return;
    }
    setStatus("Reading…");
    let points: Awaited<ReturnType<typeof importPoints>>;
    try {
      points = await importPoints(file.name, new Uint8Array(await file.arrayBuffer()));
    } catch {
      setStatus("That file couldn't be read.", true);
      return;
    }
    if (!points.length) {
      setStatus(NO_POINTS, true);
      return;
    }
    const replace = !!tx && !!rx;
    const slots: SiteId[] = (replace ? ["tx", "rx", "relay"] : (["tx", "rx", "relay"] as SiteId[]).filter((s) => !{ tx, rx, relay }[s]));
    const used = slots.slice(0, points.length);
    used.forEach((site, i) => {
      const p = { lat: points[i].lat, lon: points[i].lon };
      if (site === "tx") tx = p;
      else if (site === "rx") rx = p;
      else relay = p;
      hooks.setName(site, points[i].name);
    });
    placingRelay = false;
    pinsChanged();
    const left = points.length - used.length;
    setStatus(`${replace ? "Replaced" : "Placed"} ${listWords(used.map((s) => siteDefaults[s]))} from the file${left ? `; ${left} more point${left === 1 ? "" : "s"} left out (a link has two sites and a relay)` : ""}.`);
  });

  const hfNote = "A line-of-sight terrain profile doesn't apply below 30 MHz.";
  const refresh = (params: TerrainParams): TerrainAnalysis | undefined => {
    const pill = el("pill");
    const chart = el("chart");
    const facts = el("facts");
    lineOfSight = undefined;
    if (!tx || !rx || !elevations || !params.applies || !(params.freqHz > 0)) {
      pill.hidden = chart.hidden = facts.hidden = el("viewWrap").hidden = true;
      el("hint").hidden = false;
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
    // The tightest point: how far the ground rises into the line, or clears it.
    const tight = (w: ProfilePoint): [string, string] =>
      w.clearanceM < 0 ? [`${h(-w.clearanceM)} blocked`, "Ground above the line of sight"] : [`${h(w.clearanceM)} clear`, `${fmt(Math.max(0, w.clearanceRatio) * 100, 0)}% of the Fresnel zone`];

    let shownStatus: ProfileStatus;
    /** Three figures under the chart: label, value, a line of context. */
    let stats: [string, string, string][];
    if (viaRelay && hopSegments) {
      const [s1, s2] = hopSegments;
      const rank: Record<ProfileStatus, number> = { clear: 0, fresnel: 1, blocked: 2 };
      shownStatus = rank[s1.result.status] >= rank[s2.result.status] ? s1.result.status : s2.result.status;
      const which = s1.result.status === s2.result.status ? "both hops" : s1.result.status === shownStatus ? "hop 1" : "hop 2";
      pill.textContent = shownStatus === "clear" ? "Clear on both hops" : `${statusText[shownStatus][0]}, ${which}`;
      const worst = s1.result.worst.clearanceRatio <= s2.result.worst.clearanceRatio ? { w: s1.result.worst, from: nameOf("tx"), hop: 1 } : { w: s2.result.worst, from: nameOf("relay"), hop: 2 };
      const [tv, ts] = tight(worst.w);
      const l1 = distanceBetweenM(s1.from, s1.to);
      const l2 = distanceBetweenM(s2.from, s2.to);
      stats = [
        ["Terrain loss", `${fmt(s1.loss.lossDb, 1)} + ${fmt(s2.loss.lossDb, 1)} dB`, "Hop 1 + hop 2, beyond free space"],
        ["Tightest point", tv, `Hop ${worst.hop}, ${d(worst.w.distanceM)} from ${worst.from}. ${ts}`],
        ["Distance", d(l1 + l2), `${d(l1)} + ${d(l2)}`],
      ];
      // One chart: hop 2's points carry on from where hop 1 ends.
      const offset = s1.result.points[s1.result.points.length - 1].distanceM;
      lastPoints = [...s1.result.points, ...s2.result.points.map((q) => ({ ...q, distanceM: q.distanceM + offset }))];
      lastAntennas = new Set([0, s1.result.points.length - 1, s1.result.points.length, lastPoints.length - 1]);
    } else {
      shownStatus = result.status;
      pill.textContent = statusText[result.status][0];
      const w = result.worst;
      const [tv, ts] = tight(w);
      stats = [
        ["Terrain loss", `${fmt(loss.lossDb, 1)} dB`, `Beyond free space (${loss.model === "itm" ? "Longley-Rice" : "Bullington"})`],
        ["Tightest point", tv, `${d(w.distanceM)} from ${nameOf("tx")}. ${ts}`],
        ["Distance", d(path.distanceM), `Bearing ${fmt(bearingDeg(tx, rx), 0)}°, back ${fmt(bearingDeg(rx, tx), 0)}°`],
      ];
      lastPoints = result.points;
      lastAntennas = new Set([0, result.points.length - 1]);
    }
    pill.hidden = false;
    pill.className = `pill ${statusText[shownStatus][1]}`;
    pill.title = losNote;

    chart.hidden = false;
    el("hint").hidden = true;
    // Draw at the real width so the axis text stays its CSS size on phones.
    const segments = viaRelay && hopSegments ? hopSegments.map((s) => s.result) : [result];
    const names = viaRelay ? [nameOf("tx"), nameOf("relay"), nameOf("rx")] : [nameOf("tx"), nameOf("rx")];
    const docked = !!chart.closest(".profile-dock");
    chart.innerHTML = drawProfile(segments, params, chart.clientWidth || 640, names, docked ? 150 : undefined, true, viaRelay ? [...hopQuality] : [quality]);
    lastParams = params;

    // Built as text: site names are user input.
    facts.hidden = false;
    facts.replaceChildren(
      ...stats.map(([label, value, sub]) => {
        const t = document.createElement("div");
        t.className = "tile";
        for (const [cls, text] of [["label", label], ["value", value], ["sub", sub]]) {
          const span = document.createElement("span");
          span.className = cls;
          span.textContent = text;
          t.append(span);
        }
        return t;
      }),
    );
    return { ...result, loss };
  };


  syncPins();
  // After the page finishes building: a cached path calls onPathChange straight away.
  if (tx && rx) queueMicrotask(() => {
    void loadProfile();
    if (relay) void loadRelayProfiles();
  });

  return {
    element: card,
    parts,
    setPins(next) {
      tx = next.tx;
      rx = next.rx;
      relay = next.relay;
      placingRelay = false;
      pinsChanged();
    },
    redraw() {
      if (lastParams) refresh(lastParams);
    },
    pathDistanceM: () => (tx && rx ? distanceBetweenM(tx, rx) : undefined),
    pins: () => (tx && rx ? { tx, rx } : undefined),
    relay: () => relay,
    view: () => profileView,
    onLineTap(fn) {
      lineTap = fn;
    },
    reframe() {
      if (map && framed) fitPath(map);
    },
    setView(v) {
      profileView = v;
      onPathChange();
    },
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
      const changed = q1 !== hopQuality[0] || q2 !== hopQuality[1];
      hopQuality = [q1, q2];
      drawPath();
      if (changed && lastParams) refresh(lastParams);
    },
    namesChanged() {
      syncPins();
      if (lastParams) refresh(lastParams);
      view3d?.refresh();
    },
    refresh,
    reset,
    showLink(q) {
      const changed = q !== quality;
      quality = q;
      drawPath();
      if (changed && lastParams) refresh(lastParams);
    },
  };
}

/**
 * SVG elevation profile: terrain, line of sight and the first Fresnel zone.
 * Several segments (the hops through a relay) are drawn end to end, each with
 * its own line of sight; names label every antenna, in order.
 */
type LosStyle = ReturnType<typeof linkLineStyle> | "unknown";
/** The key's words for each line-of-sight style. */
const LOS_KEY: Record<LosStyle, string> = {
  "good-clear": "Line of sight, clear",
  "good-obstructed": "Line of sight, obstructed (link still good)",
  marginal: "Line of sight (link marginal)",
  fail: "Line of sight (won't connect)",
  unknown: "Line of sight, obstructed",
};

export function drawProfile(
  segments: ProfileResult[],
  p: Pick<TerrainParams, "distUnit" | "heightUnit">,
  width: number,
  names: string[],
  height?: number,
  /** False where the chart has no tap-to-read handler. */
  readout = true,
  /** Each segment's budget verdict, to style its line of sight as the map styles its link. */
  qualities?: (LinkQuality | undefined)[],
): string {
  const W = Math.max(300, Math.round(width));
  // The graph is the point of the card: tall enough to read the ground.
  // Docked under the map it's a wide strip instead, so the map keeps its room.
  const H = height ?? Math.round(Math.min(320, Math.max(220, W * 0.48)));
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
  // The line of sight per segment: green while it clears the ground, red where it doesn't.
  const losLines = segs
    .map((sp, i) => `<path class="los los-${losStyle(i)}" d="${path([[x(sp[0].distanceM), y(sp[0].losM)], [x(sp[sp.length - 1].distanceM), y(sp[sp.length - 1].losM)]])}"/>`)
    .join("");
  // The same rule as the map's link lines: colour from the budget, dashes when the
  // path isn't clear. Red only when the budget says it won't connect; a blocked
  // path that still closes by diffraction is dashed green. Without a verdict, grey.
  function losStyle(i: number): LosStyle {
    const q = qualities?.[i];
    if (q) return linkLineStyle(q, segments[i].status);
    return segments[i].status === "clear" ? "good-clear" : "unknown";
  }
  const shownStyles = [...new Set(segments.map((_, i) => losStyle(i)))];

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
    .map((q, i) => `<text class="end-label relay-label" x="${x(q.distanceM)}" y="${Math.max(pad.t + 10, y(q.losM) - 8)}" text-anchor="middle">${escapeHtml(names[i + 1] ?? "Relay")}</text>`)
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
      ${losLines}
      ${antennas.map(mast).join("")}
      ${hits}
      ${xTicks.map((d, i) => `<text class="axis" x="${x(d)}" y="${H - 8}" text-anchor="${["start", "middle", "end"][i]}">${dLabel(d)}${i === 2 ? ` ${p.distUnit}` : ""}</text>`).join("")}
      <text class="end-label" x="${x(0) + 4}" y="${y(first.losM) - 6}">${escapeHtml(names[0])}</text>
      <text class="end-label" x="${x(total) - 4}" y="${y(last.losM) - 6}" text-anchor="end">${escapeHtml(names[names.length - 1])}</text>
      ${relayLabels}
      <line class="crosshair" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" style="display:none"/>
    </svg>
    ${readout ? `<p class="note chart-readout">Tap the chart to read any point.</p>` : ""}
    <div class="legend">
      ${shownStyles.map((st) => `<span class="key"><span class="ln los-key los-${st}"></span>${LOS_KEY[st]}</span>`).join("")}
      <span class="key"><span class="sw zone-key"></span>First Fresnel zone</span>
      <span class="key"><span class="ln dash zone60-key"></span>60% line</span>
      <span class="key"><span class="sw terrain-key"></span>Terrain + earth curve</span>
    </div>`;
}
