// Terrain profile card for the link budget: a map with TX and RX pins, the
// elevation profile between them, and how well the path clears it.

import * as L from "leaflet";
import { createMap, showDefaultView } from "./mapKit";
import { type DiffractionResult, bullingtonLoss } from "../lib/diffraction";
import { fetchPathElevations } from "./tileElevation";
import { createPathStore } from "../lib/pathStore";
import { coordPlaceholder, formatCoordinates, parseCoordinates } from "../lib/coords";
import { type LatLon, bearingDeg, distanceBetweenM, formatLatLon, parseLatLon, samplePath } from "../lib/geo";
import { FRESNEL_CLEAR_RATIO, type ProfileResult, type ProfileStatus, analyzeProfile, sampleCount } from "../lib/profile";
import { type DistanceUnit, fromMetres } from "../lib/units";

const STORAGE_KEY = "rf-toolkit:terrain";

export interface TerrainParams {
  freqHz: number;
  txHeightM: number;
  rxHeightM: number;
  distUnit: DistanceUnit;
  heightUnit: DistanceUnit;
  /** False on HF, where a line-of-sight profile doesn't apply. */
  applies: boolean;
}

export type TerrainAnalysis = ProfileResult & { diffraction: DiffractionResult };

export interface TerrainCard {
  element: HTMLElement;
  /** Length of the pinned path in metres, or undefined without both pins. */
  pathDistanceM(): number | undefined;
  /** Re-run the analysis for new frequency or heights; returns it if there is one. */
  refresh(params: TerrainParams): TerrainAnalysis | undefined;
  /** Remove both pins and the profile. */
  reset(): void;
}

const statusText: Record<ProfileStatus, [string, string]> = {
  clear: ["Clear", "s-good"],
  fresnel: ["Fresnel obstructed", "s-marginal"],
  blocked: ["Blocked by terrain", "s-fail"],
};

const template = `
  <div class="card-head">
    <h2>Terrain profile</h2>
    <span class="pill" data-t="pill" hidden></span>
  </div>
  <p class="note top">
    Tap the map to drop the TX pin, then the RX pin, or type coordinates. Drag
    a pin to move it. The path distance then comes from the pins.
  </p>
  <div class="map" data-t="map"></div>
  <div class="fields coords">
    <label>TX location
      <span class="input-unit">
        <input name="txLoc" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" />
        <button type="button" class="secondary unit-btn" data-t="locate" title="Use my location">Me</button>
      </span>
    </label>
    <label>RX location
      <input name="rxLoc" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" />
    </label>
  </div>
  <p class="note" data-t="status"></p>
  <div class="profile-chart" data-t="chart" hidden></div>
  <table class="ledger geometry" data-t="facts" hidden><tbody></tbody></table>
  <div class="terrain-actions">
    <button type="button" class="secondary" data-t="clear">Clear pins</button>
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
  <p class="note attribution">
    Terrain loss uses the Bullington method of ITU-R P.526-16, which can read
    low on paths over several ridges. Elevation: Terrain Tiles (Mapzen, AWS Open
    Data), bare earth at up to about 30 m; US data courtesy of the U.S.
    Geological Survey. Saved and recent paths work offline, as do areas you've
    viewed before.
  </p>
`;

function loadPins(): { tx?: LatLon; rx?: LatLon } {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return { tx: parseLatLon(saved.tx ?? ""), rx: parseLatLon(saved.rx ?? "") };
  } catch {
    return {};
  }
}

function savePins(tx?: LatLon, rx?: LatLon): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tx: tx && formatLatLon(tx), rx: rx && formatLatLon(rx) }));
  } catch {
    // Storage blocked: pins just won't be remembered.
  }
}

const pinIcon = (label: string) =>
  L.divIcon({ className: "pin", html: `<span><b>${label}</b></span>`, iconSize: [30, 30], iconAnchor: [15, 30] });

const fmt = (value: number, digits: number) =>
  value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function createTerrainCard(onPathChange: () => void): TerrainCard {
  const card = document.createElement("section");
  card.className = "card terrain";
  card.innerHTML = template;
  const el = (name: string) => card.querySelector<HTMLElement>(`[data-t="${name}"]`)!;
  const input = (name: string) => card.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  input("txLoc").placeholder = input("rxLoc").placeholder = coordPlaceholder();

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
  let { tx, rx } = loadPins();
  let elevations: number[] | undefined;
  let loading: AbortController | undefined;
  let map: L.Map | undefined;
  let txMarker: L.Marker | undefined;
  let rxMarker: L.Marker | undefined;
  let line: L.Polyline | undefined;

  const setStatus = (text: string, warn = false) => {
    el("status").textContent = text;
    el("status").classList.toggle("warn", warn);
  };

  // Keep markers, inputs, the line and storage in step with tx and rx.
  const syncPins = () => {
    input("txLoc").value = tx ? formatCoordinates(tx) : "";
    input("rxLoc").value = rx ? formatCoordinates(rx) : "";
    savePins(tx, rx);
    if (!map) return;
    const place = (marker: L.Marker | undefined, at: LatLon | undefined, label: "tx" | "rx") => {
      if (!at) {
        marker?.remove();
        return undefined;
      }
      if (marker) return marker.setLatLng([at.lat, at.lon]);
      const m = L.marker([at.lat, at.lon], { icon: pinIcon(label.toUpperCase()), draggable: true }).addTo(map!);
      m.on("dragend", () => {
        const p = m.getLatLng();
        if (label === "tx") tx = { lat: p.lat, lon: p.lng };
        else rx = { lat: p.lat, lon: p.lng };
        pinsChanged();
      });
      return m;
    };
    txMarker = place(txMarker, tx, "tx");
    rxMarker = place(rxMarker, rx, "rx");
    line?.remove();
    line = tx && rx ? L.polyline([[tx.lat, tx.lon], [rx.lat, rx.lon]], { className: "path-line" }).addTo(map) : undefined;
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

  const pinsChanged = () => {
    syncPins();
    if (tx && rx && map) map.fitBounds(L.latLngBounds([tx.lat, tx.lon], [rx.lat, rx.lon]), { padding: [30, 30], maxZoom: 13 });
    onPathChange();
    void loadProfile();
  };

  const initMap = () => {
    if (map || !card.isConnected) return;
    map = createMap(el("map"), (m) => {
      if (tx && rx) m.fitBounds(L.latLngBounds([tx.lat, tx.lon], [rx.lat, rx.lon]), { padding: [30, 30], maxZoom: 13 });
      else if (tx) m.setView([tx.lat, tx.lon], 11);
      else showDefaultView(m);
    });
    map.on("click", (e: L.LeafletMouseEvent) => {
      const at = { lat: e.latlng.lat, lon: e.latlng.lng };
      if (!tx) tx = at;
      else if (!rx) rx = at;
      else return;
      pinsChanged();
    });
    syncPins();
  };
  // Leaflet needs the container in the page before it starts. A timer rather
  // than requestAnimationFrame, which doesn't run while the tab is hidden.
  const waitForPage = () => (card.isConnected ? initMap() : setTimeout(waitForPage, 50));
  setTimeout(waitForPage, 0);

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
    if (!navigator.geolocation) {
      setStatus("This browser can't share its location.", true);
      return;
    }
    setStatus("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        tx = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        if (!rx) map?.setView([tx.lat, tx.lon], 12);
        setStatus("");
        pinsChanged();
      },
      (err) => setStatus(`Couldn't get your location: ${err.message}`, true),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  });

  const reset = () => {
    tx = rx = undefined;
    loading?.abort();
    elevations = undefined;
    setStatus("");
    syncPins();
    onPathChange();
  };
  el("clear").addEventListener("click", reset);

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

  const hfNote = "A line-of-sight terrain profile doesn't apply below 30 MHz.";
  const refresh = (params: TerrainParams): TerrainAnalysis | undefined => {
    const pill = el("pill");
    const chart = el("chart");
    const facts = el("facts");
    line?.getElement()?.classList.remove("s-good", "s-marginal", "s-fail");
    if (!tx || !rx || !elevations || !params.applies || !(params.freqHz > 0)) {
      pill.hidden = chart.hidden = facts.hidden = true;
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
    const result = analyzeProfile(path);
    const diffraction = bullingtonLoss(path);
    const [text, cls] = statusText[result.status];
    pill.hidden = false;
    pill.className = `pill ${cls}`;
    pill.textContent = text;
    line?.getElement()?.classList.add(cls);

    chart.hidden = false;
    // Draw at the real width so the axis text stays its CSS size on phones.
    chart.innerHTML = drawProfile(result, params, chart.clientWidth || 640);

    const h = (m: number) => `${fmt(fromMetres(m, params.heightUnit), 0)} ${params.heightUnit}`;
    const d = (m: number) => `${fmt(fromMetres(m, params.distUnit), 2)} ${params.distUnit}`;
    const w = result.worst;
    const tightest =
      w.clearanceM < 0
        ? `${h(-w.clearanceM)} above the line of sight`
        : `${h(w.clearanceM)} clear, ${fmt(Math.max(0, w.clearanceRatio) * 100, 0)}% of the Fresnel zone`;
    facts.hidden = false;
    facts.querySelector("tbody")!.innerHTML = [
      ["Terrain diffraction loss", `${fmt(diffraction.lossDb, 1)} dB`],
      ["Tightest point", `${d(w.distanceM)} from TX`],
      [w.clearanceM < 0 ? "Terrain there is" : "Clearance there", tightest],
      ["Ground at TX / RX", `${h(result.txGroundM)} / ${h(result.rxGroundM)}`],
      ["Bearing TX → RX", `${fmt(bearingDeg(tx, rx), 1)}° (back ${fmt(bearingDeg(rx, tx), 1)}°)`],
    ]
      .map(([k, v], idx) => `<tr${idx === 0 ? ' class="total"' : ""}><td>${k}</td><td class="num mono">${v}</td></tr>`)
      .join("");
    return { ...result, diffraction };
  };

  syncPins();
  if (tx && rx) void loadProfile();

  return {
    element: card,
    pathDistanceM: () => (tx && rx ? distanceBetweenM(tx, rx) : undefined),
    refresh,
    reset,
  };
}

/** SVG elevation profile: terrain, line of sight and the first Fresnel zone. */
function drawProfile(r: ProfileResult, p: TerrainParams, width: number): string {
  const W = Math.max(300, Math.round(width));
  const H = W < 500 ? 200 : 220;
  const pad = { l: 58, r: 12, t: 14, b: 26 };
  const pts = r.points;
  const total = pts[pts.length - 1].distanceM;
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
  const upper = pts.map((q): [number, number] => [x(q.distanceM), y(q.losM + q.fresnelM)]);
  const lower = pts.map((q): [number, number] => [x(q.distanceM), y(q.losM - q.fresnelM)]).reverse();
  const zone = path([...upper, ...lower]) + "Z";
  const zone60 = path(pts.map((q): [number, number] => [x(q.distanceM), y(q.losM - FRESNEL_CLEAR_RATIO * q.fresnelM)]));
  const los = path([[x(0), y(pts[0].losM)], [x(total), y(pts[pts.length - 1].losM)]]);

  const hits = pts
    .slice(1, -1)
    .filter((q) => q.clearanceRatio < FRESNEL_CLEAR_RATIO)
    .map((q) => `<circle class="${q.clearanceM < 0 ? "hit-block" : "hit-fresnel"}" cx="${x(q.distanceM).toFixed(1)}" cy="${y(q.terrainM).toFixed(1)}" r="2.6"/>`)
    .join("");

  const first = pts[0];
  const last = pts[pts.length - 1];
  const mast = (q: typeof first) => `<line class="mast" x1="${x(q.distanceM)}" x2="${x(q.distanceM)}" y1="${y(q.terrainM)}" y2="${y(q.losM)}"/>`;

  const hLabel = (m: number) => `${fmt(fromMetres(m, p.heightUnit), 0)} ${p.heightUnit}`;
  const dLabel = (m: number) => `${fmt(fromMetres(m, p.distUnit), fromMetres(total, p.distUnit) < 10 ? 1 : 0)}`;
  const yTicks = [min + (max - min) * 0.1, (min + max) / 2, max - (max - min) * 0.05];
  const xTicks = [0, total / 2, total];

  return `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Terrain profile between TX and RX">
      ${yTicks.map((m) => `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(m)}" y2="${y(m)}"/><text class="axis" x="${pad.l - 6}" y="${y(m) + 4}" text-anchor="end">${hLabel(m)}</text>`).join("")}
      <path class="zone" d="${zone}"/>
      <path class="zone60" d="${zone60}"/>
      <path class="terrain-fill" d="${terrain}"/>
      <path class="los" d="${los}"/>
      ${mast(first)}${mast(last)}
      ${hits}
      ${xTicks.map((d, i) => `<text class="axis" x="${x(d)}" y="${H - 8}" text-anchor="${["start", "middle", "end"][i]}">${dLabel(d)}${i === 2 ? ` ${p.distUnit}` : ""}</text>`).join("")}
      <text class="end-label" x="${x(0) + 4}" y="${y(first.losM) - 6}">TX</text>
      <text class="end-label" x="${x(total) - 4}" y="${y(last.losM) - 6}" text-anchor="end">RX</text>
    </svg>
    <div class="legend">
      <span class="key"><span class="ln los-key"></span>Line of sight</span>
      <span class="key"><span class="sw zone-key"></span>First Fresnel zone</span>
      <span class="key"><span class="ln dash zone60-key"></span>60% line</span>
      <span class="key"><span class="sw terrain-key"></span>Terrain + earth curve</span>
    </div>`;
}
