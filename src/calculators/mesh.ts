// Mesh Analysis: drop nodes on a map and see every node-to-node link over
// real terrain with identical radios, plus whether the mesh holds together.

import { enhanceFields } from "./fieldHelp";
import { locateButton, locateMe } from "./locate";
import { meshGuide } from "./helpText";
import * as L from "leaflet";
import { type ClearControl, type Control3D, add3DControl, addClearControl, createMap, showDefaultView } from "./mapKit";
import type { Calculator } from ".";
import { coordPlaceholder, formatCoordinates, parseCoordinates } from "../lib/coords";
import { buildKml, fileName, buildZip } from "../lib/export";
import { linkLineLabels, linkLineStyle } from "../lib/linkLines";
import { drawLinkLine, linkLegend } from "./linkLine";
import { findEnvironment } from "../lib/environment";
import { applySettings, createPlanBar, downloadFile } from "./planBar";
import { RADIO_FILE, radioIconFile, radioMarker } from "./radioIcon";
import { bindTreeField, environmentOptions, treeHeightFieldHtml, withFormTrees } from "./environmentField";
import { AUTO_ENVIRONMENT, type LandCoverPoint, describePoint } from "../lib/landCover";
import { landCoverAt } from "./landCoverTiles";
import { linkGroundToEnvironment, modelDefaults, modelFieldsHtml, readModel } from "./modelFields";
import { tabStateToSave, tabValues } from "../lib/appSettings";
import { deratedSensitivity, derateNote, fallbackEnvironment, modelFromSettings, sharedFields } from "./settingsStore";
import { fetchPathElevations } from "./tileElevation";
import { type LatLon, bearingDeg, destinationPoint, distanceBetweenM, samplePath } from "../lib/geo";
import { beam, elevationAngleDeg, patternLossDb, patterns } from "../lib/pattern";
import { type EndRadio, type MeshLink, type MeshLinkStatus, connectedGroups, hopCounts, meshLink, pairs } from "../lib/mesh";
import { createPathStore, pathKey } from "../lib/pathStore";
import { sampleCount } from "../lib/profile";
import type { EditField } from "../lib/scene3d";
import { type RadioPreset, type Route, bestRoutes, formatRate, hopLimit, ladder, rateAt } from "../lib/radioPresets";
import { PRESETS_EVENT, adoptPreset, loadPresets, openPresetManager } from "./presetManager";
import { kFactors, parseKFactor } from "../lib/horizon";
import {
  type DistanceUnit,
  frequencyUnits,
  fromMetres,
  powerUnits,
  toDbm,
  toHz,
  toMetres,
  asDistanceUnit,
  asFrequencyUnit,
  asPowerUnit,
} from "../lib/units";

const STORAGE_KEY = "rf-toolkit:mesh";
const MAX_NODES = 10;

interface MeshNode extends LatLon {
  name: string;
  /** Antenna height in the chosen height unit, as typed. */
  height: string;
  /** Antenna pattern id; omni if unset. */
  antenna?: string;
  /** Degrees true the antenna points, as typed. */
  aim?: string;
  /** The node's own radio, as typed; blank uses the Radios card. */
  power?: string;
  powerUnit?: string;
  gain?: string;
  cable?: string;
  sens?: string;
  /** Which radio: blank for the net's, "custom" for the fields above, or a preset id. */
  preset?: string;
}

/** Which radio a node uses. Older saves without a choice count as custom if they have their own values. */
const nodeMode = (n: MeshNode): string => n.preset ?? (hasOwnRadio(n) ? "custom" : "");
/** A radio in a few words: power, gain and cable, where set. */
const radioWords = (power?: string, powerUnit?: string, gain?: string, cable?: string) =>
  [power ? `${power} ${powerUnit ?? ""}`.trim() : "", gain ? `${gain} dBi` : "", cable ? `${cable} dB cable` : ""].filter(Boolean).join(", ");

/** A node's own radio fields, and the Radios card field each stands in for. */
const NODE_RADIO_FIELDS = [
  { key: "power", label: "TX power", shared: "power", unit: "" },
  { key: "gain", label: "Antenna gain", shared: "gain", unit: "dBi" },
  { key: "cable", label: "Cable loss", shared: "cable", unit: "dB" },
  { key: "sens", label: "RX sensitivity", shared: "sens", unit: "dBm" },
] as const;
const hasOwnRadio = (n: MeshNode) => NODE_RADIO_FIELDS.some((f) => (n[f.key] ?? "").trim() !== "");
const RADIO_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M5 2l3 4M6 6h7a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V7a1 1 0 011-1h3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="10.5" cy="10" r="1.6" fill="currentColor"/></svg>';

// The built-in defaults from before Settings existed. Settings now override the
// fields they cover; these still fill the rest and recognise untouched old saves.
const legacySettingDefaults: Record<string, string> = {
  preset: "",
  freq: "915",
  freqUnit: "MHz",
  power: "1",
  powerUnit: "W",
  gain: "3",
  cable: "1",
  sens: "-100",
  fade: "10",
  environment: "none",
  treeHeight: "",
  distUnit: "mi",
  height: "30",
  heightUnit: "ft",
  kFactor: "4/3",
  ...modelDefaults,
};

const statusText: Record<MeshLinkStatus, [string, string]> = {
  good: ["Solid", "s-good"],
  marginal: ["Marginal", "s-marginal"],
  fail: ["No link", "s-fail"],
};

function numberField(label: string, name: string, unit: string, attrs = ""): string {
  return `
    <label>${label}
      <span class="input-unit">
        <input name="${name}" type="number" inputmode="decimal" step="any" ${attrs} />
        <span class="unit">${unit}</span>
      </span>
    </label>`;
}

const template = `
  <div class="inputs">
    <section class="card">
      <div class="card-head"><h2>Radios</h2><span class="meta">Every node, unless it has its own</span></div>
      <div class="fields">
        <label class="wide">Radio preset
          <span class="preset-pick">
            <select name="preset"></select>
            <button type="button" class="secondary" data-action="presets">Presets</button>
          </span>
        </label>
        <div class="radio-summary" data-out="radioSummary" hidden>
          <span data-out="radioSummaryText"></span>
          <button type="button" class="secondary" data-action="override">Override</button>
        </div>
        <p class="note wide" data-out="presetNote" hidden></p>
        <label>Frequency
          <span class="input-unit">
            <input name="freq" type="number" inputmode="decimal" step="any" min="0" />
            <select name="freqUnit">${Object.keys(frequencyUnits).map((u) => `<option>${u}</option>`).join("")}</select>
          </span>
        </label>
        <label>TX power
          <span class="input-unit">
            <input name="power" type="number" inputmode="decimal" step="any" />
            <select name="powerUnit">${powerUnits.map((u) => `<option>${u}</option>`).join("")}</select>
          </span>
        </label>
        ${numberField("Antenna gain", "gain", "dBi")}
        ${numberField("Cable loss at each node", "cable", "dB", 'min="0"')}
        ${numberField("RX sensitivity", "sens", "dBm")}
        ${numberField("Fade margin wanted", "fade", "dB", 'min="0"')}
        <label>Default antenna height
          <span class="input-unit">
            <input name="height" type="number" inputmode="decimal" step="any" min="0" />
            <select name="heightUnit"><option>ft</option><option>m</option></select>
          </span>
        </label>
        <label>Show distances in
          <select name="distUnit"><option>mi</option><option>km</option></select>
        </label>
        <label>Earth curvature (k)
          <select name="kFactor">${kFactors.map((f) => `<option value="${f.id}">${f.name}</option>`).join("")}</select>
        </label>
        ${modelFieldsHtml()}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Nodes</h2><span class="meta" data-out="nodeCount"></span></div>
      <p class="note top">Tap the map to add a node (up to ${MAX_NODES}), or type coordinates. Drag a node to move it. For a sector or directional antenna, pick it under Antenna and enter the way it points. A node with a different radio (a base or vehicle set among manpacks, say) picks its own preset, or custom numbers, under the radio button in its row.</p>
      <div class="fields">
        <label>Environment
          <select name="environment">${environmentOptions()}</select>
        </label>
        ${treeHeightFieldHtml()}
      </div>
      <div class="map mesh-map" data-out="map"></div>
      <div data-out="legend"></div>
      <div class="add-node">
        <input name="addLoc" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" />
        <button type="button" class="secondary" data-action="add">Add node</button>
        ${locateButton('data-action="locate"', "Add a node at my location", "")}
      </div>
      <p class="note warn" data-out="status"></p>
      <div class="table-wrap">
        <table class="ledger node-list">
          <thead><tr><th></th><th>Name</th><th>Location</th><th>Height</th><th>Antenna</th><th></th></tr></thead>
          <tbody data-out="nodes"></tbody>
        </table>
      </div>
    </section>
  </div>

  <aside class="results">
    <section class="card">
      <div class="card-head">
        <h2>Mesh</h2>
        <span class="pill" data-out="pill" hidden></span>
        <button type="button" class="secondary" data-action="reset">Reset</button>
      </div>
      <p class="note" data-out="empty">Add at least two nodes to see the links between them.</p>
      <div data-out="results" hidden>
        <p class="callout" data-out="split" hidden></p>
        <p class="callout" data-out="hopNote" hidden></p>
        <p class="note" data-out="envNote" hidden></p>
        <p class="note" data-out="derateNote" hidden></p>
        <div class="tiles">
          <div class="tile"><span class="label">Links up</span><span class="value" data-out="up"></span><span class="sub" data-out="upSub"></span></div>
          <div class="tile"><span class="label">Most hops</span><span class="value" data-out="hops"></span><span class="sub" data-out="hopsSub"></span></div>
          <div class="tile" data-out="thruTile" hidden><span class="label">Slowest pair, end to end</span><span class="value" data-out="thru"></span><span class="sub" data-out="thruSub"></span></div>
        </div>
        <div class="table-wrap">
          <table class="ledger links">
            <thead><tr><th>Link</th><th class="num">Distance</th><th class="num">Terrain</th><th class="num">Margin</th></tr></thead>
            <tbody data-out="links"></tbody>
          </table>
        </div>
        <details class="routes" data-out="routesWrap" hidden>
          <summary>End-to-end throughput for every pair</summary>
          <div class="table-wrap">
            <table class="ledger">
              <thead><tr><th>Between</th><th class="num">Hops</th><th class="num">Throughput</th></tr></thead>
              <tbody data-out="routes"></tbody>
            </table>
          </div>
          <p class="note" data-out="routesNote"></p>
        </details>
        <details class="about"><summary>About this calculation</summary><p>Solid links keep your fade margin; marginal ones connect with less. Terrain loss uses the Irregular Terrain Model (Longley-Rice) on bare-earth elevation (Terrain Tiles, USGS in the US), at the reliability and confidence you set, so trees and buildings aren't counted unless you pick an Environment.</p></details>
      </div>
    </section>
  </aside>
`;

/** The defaults now: the built-in ones, with Settings on top for everything Settings covers. */
function currentSettingDefaults(): Record<string, string> {
  const s = sharedFields();
  return {
    ...legacySettingDefaults,
    ...modelFromSettings(),
    fade: s.fade,
    gain: s.gain,
    cable: s.cableAndConnectors,
    environment: s.environment,
    treeHeight: s.treeHeight,
    distUnit: s.distanceUnit,
    height: s.height,
    heightUnit: s.heightUnit,
    kFactor: s.kFactor,
  };
}

function loadState(settingDefaults: Record<string, string>): { settings: Record<string, string>; nodes: MeshNode[] } {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    const nodes = Array.isArray(saved.nodes)
      ? saved.nodes.filter((n: MeshNode) => Number.isFinite(n?.lat) && Number.isFinite(n?.lon)).slice(0, MAX_NODES)
      : [];
    return { settings: tabValues(saved.settings, settingDefaults, legacySettingDefaults), nodes };
  } catch {
    return { settings: { ...settingDefaults }, nodes: [] };
  }
}

/** Node names are user text: safe inside markup. */
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const fmt = (v: number, digits = 1) =>
  v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace("-", "−");

export const meshCalculator: Calculator = {
  id: "mesh",
  title: "Mesh Analysis",
  shortTitle: "Mesh",
  render() {
    const form = document.createElement("form");
    const settingDefaults = currentSettingDefaults();
    form.className = "calculator two-col mesh";
    form.innerHTML = template;
    linkGroundToEnvironment(form);
    bindTreeField(form, "heightUnit");
    form.querySelector('[data-out="legend"]')!.replaceWith(linkLegend());
    form.addEventListener("submit", (e) => e.preventDefault());

    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
    const out = (name: string) => form.querySelector<HTMLElement>(`[data-out="${name}"]`)!;
    const num = (name: string) => Number.parseFloat(field(name).value);

    const store = createPathStore({
      getItem: (k) => {
        try {
          return localStorage.getItem(k);
        } catch {
          return null;
        }
      },
      setItem: (k, v) => localStorage.setItem(k, v),
    });

    // Radio presets: the user's own, from this device.
    const fillPresetOptions = () => {
      const select = field("preset") as HTMLSelectElement;
      const keep = select.value;
      const none = new Option("None: enter the radio below", "");
      select.replaceChildren(none, ...loadPresets().map((p) => new Option(p.name, p.id)));
      select.value = [...select.options].some((o) => o.value === keep) ? keep : "";
    };
    fillPresetOptions();
    const activePreset = (): RadioPreset | undefined => loadPresets().find((p) => p.id === field("preset").value);
    const ladderActive = () => ladder(activePreset()).length > 0;

    const state = loadState(settingDefaults);
    let nodes = state.nodes;
    for (const [name, value] of Object.entries(state.settings)) {
      const el = form.elements.namedItem(name);
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.value = value;
    }
    field("addLoc").setAttribute("placeholder", coordPlaceholder());

    const save = () => {
      const settings: Record<string, string> = {};
      for (const name of Object.keys(settingDefaults)) settings[name] = field(name).value;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings: tabStateToSave(settings, settingDefaults), nodes }));
      } catch {
        // Storage blocked: the plan just won't be remembered.
      }
    };
    const setStatus = (text: string, warn = false) => {
      out("status").textContent = text;
      out("status").classList.toggle("warn", warn);
    };

    // Terrain per pair, keyed by the two node positions (A to B, A first).
    const terrain = new Map<string, number[] | "error">();
    let loading: AbortController | undefined;
    let map: L.Map | undefined;
    let clearControl: ClearControl | undefined;
    let markers: L.Marker[] = [];
    let lines: L.LayerGroup[] = [];
    let aimLines: L.Polyline[] = [];
    let lastLinks: { a: number; b: number; link: MeshLink; distanceM: number }[] = [];
    let view3d: Control3D | undefined;
    // Nodes whose own-radio row is open, so it stays open when the list redraws.
    const openRadios = new WeakSet<MeshNode>();

    const heightM = (n: MeshNode) =>
      toMetres(Number.parseFloat(n.height) || Number.parseFloat(field("height").value) || 0, asDistanceUnit(field("heightUnit").value));

    // Pattern loss at node "from" toward node "to". The profile runs from "from".
    const antennaLoss = (from: MeshNode, to: MeshNode, distanceM: number, elev: number[] | undefined, gainDbi: number, k: number) => {
      // Omni antennas lose a little straight up or down too, which only
      // matters close in under a tall mast.
      const b = beam(from.antenna, gainDbi, Number.parseFloat(from.aim ?? "") || 0);
      const fromTop = (elev?.[0] ?? 0) + heightM(from);
      const toTop = (elev?.[elev.length - 1] ?? 0) + heightM(to);
      return patternLossDb(b, bearingDeg(from, to), elevationAngleDeg(fromTop, toTop, distanceM, k));
    };

    const renderNodes = () => {
      out("nodeCount").textContent = `${nodes.length} of ${MAX_NODES}`;
      const body = out("nodes");
      body.replaceChildren(
        ...nodes.flatMap((n, idx) => {
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td><span class="node-badge">${idx + 1}</span></td>
            <td><input class="node-name" type="text" autocomplete="off" /></td>
            <td class="mono node-loc"></td>
            <td><span class="input-unit node-height"><input type="number" inputmode="decimal" step="any" min="0" /><span class="unit"></span></span></td>
            <td class="node-antenna">
              <select aria-label="Node ${idx + 1} antenna pattern">${patterns.map((p) => `<option value="${p.id}">${p.id === "directional" ? "Directional" : p.name.replace(", ", " ")}</option>`).join("")}</select>
              <span class="input-unit node-aim"><input type="number" inputmode="decimal" step="any" min="0" max="360" placeholder="0" title="Degrees from true north" aria-label="Node ${idx + 1} antenna points, degrees true" /><span class="unit">°</span></span>
            </td>
            <td class="node-actions">
              <button type="button" class="secondary icon-btn node-radio-btn" aria-expanded="false" title="This node's radio" aria-label="Node ${idx + 1} radio">${RADIO_ICON}</button>
              <button type="button" class="secondary icon-btn" data-remove title="Remove node" aria-label="Remove node ${idx + 1}">✕</button>
            </td>`;
          const name = tr.querySelector<HTMLInputElement>(".node-name")!;
          name.value = n.name;
          name.addEventListener("input", (e) => {
            e.stopPropagation();
            n.name = name.value;
            save();
            recompute();
          });
          tr.querySelector(".node-loc")!.textContent = formatCoordinates(n);
          const h = tr.querySelector<HTMLInputElement>(".node-height input")!;
          h.value = n.height;
          h.placeholder = field("height").value;
          tr.querySelector(".node-height .unit")!.textContent = field("heightUnit").value;
          h.addEventListener("input", (e) => {
            e.stopPropagation();
            n.height = h.value;
            save();
            recompute();
          });
          const pattern = tr.querySelector<HTMLSelectElement>(".node-antenna select")!;
          const aimBox = tr.querySelector<HTMLElement>(".node-aim")!;
          const aim = aimBox.querySelector("input")!;
          pattern.value = n.antenna ?? "omni";
          aim.value = n.aim ?? "";
          aimBox.hidden = pattern.value === "omni";
          for (const type of ["input", "change"]) {
            pattern.addEventListener(type, (e) => e.stopPropagation());
            aim.addEventListener(type, (e) => e.stopPropagation());
          }
          pattern.addEventListener("change", () => {
            n.antenna = pattern.value === "omni" ? undefined : pattern.value;
            aimBox.hidden = pattern.value === "omni";
            save();
            recompute();
          });
          aim.addEventListener("input", () => {
            n.aim = aim.value;
            save();
            recompute();
          });
          tr.querySelector("button[data-remove]")!.addEventListener("click", () => {
            nodes.splice(idx, 1);
            nodesChanged();
          });

          // The node's own radio, in a row of its own under the node.
          const sub = document.createElement("tr");
          sub.className = "node-radio-row";
          const cell = document.createElement("td");
          cell.colSpan = 6;
          const unitOptions = powerUnits.map((u) => `<option>${u}</option>`).join("");
          cell.innerHTML = `
            <label class="node-radio-pick">Radio <select data-k="preset" aria-label="Node ${idx + 1} radio"></select></label>
            <p class="note node-radio-summary" data-k="summary"></p>
            <div class="node-radio" data-k="custom">
              ${NODE_RADIO_FIELDS.map((f) =>
                f.key === "power"
                  ? `<label>TX power<span class="input-unit"><input data-k="power" type="number" inputmode="decimal" step="any" min="0" /><select data-k="powerUnit">${unitOptions}</select></span></label>`
                  : `<label>${f.label}<span class="input-unit"><input data-k="${f.key}" type="number" step="any"${f.key === "cable" ? ' min="0" inputmode="decimal"' : ""} /><span class="unit">${f.unit}</span></span></label>`,
              ).join("")}
            </div>
            <p class="note" data-k="customNote">Blank uses the Radios card. Sensitivity is derated as set in Settings.</p>`;
          sub.append(cell);
          // Which radio: the net's, one of the presets, or custom numbers.
          const presets = loadPresets();
          const pick = cell.querySelector<HTMLSelectElement>('select[data-k="preset"]')!;
          pick.replaceChildren(new Option("Same as the net", ""), ...presets.map((p) => new Option(p.name, p.id)), new Option("Custom", "custom"));
          const mode = nodeMode(n);
          pick.value = [...pick.options].some((o) => o.value === mode) ? mode : "";
          const chosen = presets.find((p) => p.id === pick.value);
          const custom = pick.value === "custom";
          cell.querySelector<HTMLElement>('[data-k="custom"]')!.hidden = !custom;
          cell.querySelector<HTMLElement>('[data-k="customNote"]')!.hidden = !custom;
          const summary = cell.querySelector<HTMLElement>('[data-k="summary"]')!;
          summary.hidden = custom;
          summary.textContent = chosen
            ? `${radioWords(chosen.power, chosen.powerUnit, chosen.gain, chosen.cable) || "No power, gain or cable in this preset"}; anything it leaves out comes from the Radios card. Data rates and sensitivity come from the net's radio, since the whole mesh runs one waveform.`
            : "Uses the radio on the Radios card.";
          for (const type of ["input", "change"]) pick.addEventListener(type, (e) => e.stopPropagation());
          pick.addEventListener("change", () => {
            n.preset = pick.value;
            save();
            renderNodes();
            recompute();
          });
          const radioBtn = tr.querySelector<HTMLButtonElement>(".node-radio-btn")!;
          const showRadio = (open: boolean) => {
            sub.hidden = !open;
            radioBtn.setAttribute("aria-expanded", String(open));
            if (open) openRadios.add(n);
            else openRadios.delete(n);
          };
          const markOwn = () => radioBtn.classList.toggle("on", nodeMode(n) !== "");
          showRadio(openRadios.has(n));
          markOwn();
          radioBtn.addEventListener("click", () => showRadio(sub.hidden !== false));
          const sharedUnit = field("powerUnit").value;
          for (const f of NODE_RADIO_FIELDS) {
            const input = cell.querySelector<HTMLInputElement>(`input[data-k="${f.key}"]`)!;
            input.value = n[f.key] ?? "";
            // The shared value shows through when blank, if it's in the same unit.
            input.placeholder = f.key !== "power" || (n.powerUnit ?? sharedUnit) === sharedUnit ? field(f.shared).value : "";
            for (const type of ["input", "change"]) input.addEventListener(type, (e) => e.stopPropagation());
            input.addEventListener("input", () => {
              n[f.key] = input.value;
              if (f.key === "power" && !n.powerUnit) n.powerUnit = sharedUnit;
              markOwn();
              save();
              recompute();
            });
          }
          // With a rate ladder, sensitivity comes from the ladder for every node.
          cell.querySelector('input[data-k="sens"]')!.closest("label")!.hidden = ladderActive();
          const unit = cell.querySelector<HTMLSelectElement>('select[data-k="powerUnit"]')!;
          unit.value = n.powerUnit ?? sharedUnit;
          for (const type of ["input", "change"]) unit.addEventListener(type, (e) => e.stopPropagation());
          unit.addEventListener("change", () => {
            n.powerUnit = unit.value;
            save();
            renderNodes();
            recompute();
          });
          return [tr, sub];
        }),
      );
    };

    const drawMarkers = () => {
      clearControl?.setVisible(nodes.length > 0);
      if (!map) return;
      for (const m of markers) m.remove();
      markers = nodes.map((n, idx) => {
        const m = L.marker([n.lat, n.lon], {
          icon: radioMarker(idx + 1),
          draggable: true,
          title: n.name,
        }).addTo(map!);
        m.on("dragend", () => {
          const p = m.getLatLng();
          n.lat = p.lat;
          n.lon = p.lng;
          nodesChanged(false);
        });
        return m;
      });
    };

    // Land cover at every node, when Environment is "From land-cover map".
    let cover: { key: string; points?: LandCoverPoint[]; error?: string } | undefined;
    const nodeCover = (): { points?: LandCoverPoint[]; note: string } => {
      const key = JSON.stringify(nodes.map((n) => [n.lat, n.lon]));
      if (cover?.key !== key) {
        const mine: NonNullable<typeof cover> = { key };
        cover = mine;
        landCoverAt(nodes)
          .then((p) => (mine.points = p))
          .catch((err: Error) => {
            mine.error = navigator.onLine ? err.message : "no connection, and this area isn't saved";
          })
          .finally(() => cover === mine && recompute());
      }
      if (cover.error) return { note: `Couldn't read the land-cover map (${cover.error}), so ${fallbackEnvironment().name} is used instead (the land-cover fallback in Settings).` };
      if (!cover.points) return { note: `Reading the land-cover map… ${fallbackEnvironment().name} is used until it loads.` };
      return { points: cover.points, note: "" };
    };

    // A dotted line out from each directional node the way it points.
    const drawAims = () => {
      for (const l of aimLines) l.remove();
      aimLines = [];
      if (!map) return;
      for (const n of nodes) {
        if (!n.antenna || n.antenna === "omni") continue;
        const far = Math.max(0, ...nodes.map((o) => distanceBetweenM(n, o)));
        const tip = destinationPoint(n, Number.parseFloat(n.aim ?? "") || 0, far > 0 ? 0.4 * far : 1000);
        aimLines.push(L.polyline([[n.lat, n.lon], [tip.lat, tip.lon]], { className: "coverage-aim", interactive: false }).addTo(map));
      }
    };

    const recompute = () => {
      for (const l of lines) l.remove();
      lines = [];
      drawAims();
      const ready = nodes.length >= 2;
      out("empty").hidden = ready;
      out("results").hidden = !ready;
      out("pill").hidden = !ready;
      if (!ready) {
        view3d?.refresh();
        return;
      }

      const radio = {
        freqHz: toHz(num("freq"), asFrequencyUnit(field("freqUnit").value)),
        txPowerDbm: toDbm(num("power"), asPowerUnit(field("powerUnit").value)),
        gainDbi: num("gain") || 0,
        cableLossDb: num("cable") || 0,
        sensitivityDbm: deratedSensitivity(num("sens")),
        fadeMarginDb: num("fade") || 0,
        // Where the land-cover map has no data yet, the Settings fallback stands in.
        environment: withFormTrees(
          form,
          "heightUnit",
          field("environment").value === AUTO_ENVIRONMENT ? fallbackEnvironment() : findEnvironment(field("environment").value),
        ),
        model: readModel(form),
        k: parseKFactor(field("kFactor").value),
      };
      // A rate ladder: links are checked against its most sensitive (slowest) rate.
      const preset = activePreset();
      const rungs = ladder(preset, deratedSensitivity);
      if (rungs.length) radio.sensitivityDbm = Math.min(...rungs.map((r) => r.sensDbm));
      if (!(radio.freqHz > 0) || !Number.isFinite(radio.txPowerDbm) || !Number.isFinite(radio.sensitivityDbm)) {
        out("pill").hidden = true;
        out("links").replaceChildren();
        return;
      }

      // Each node's radio: its own values where it has them, the shared ones elsewhere.
      const own = (v: string | undefined) => {
        const x = Number.parseFloat(v ?? "");
        return Number.isFinite(x) ? x : undefined;
      };
      const presetsHere = loadPresets();
      const nodeRadios: EndRadio[] = nodes.map((n) => {
        const mode = nodeMode(n);
        const np = presetsHere.find((p) => p.id === mode);
        // A node preset brings power, gain and cable; custom brings all four; otherwise the net's radio.
        const src = np ? { power: np.power, powerUnit: np.powerUnit, gain: np.gain, cable: np.cable, sens: undefined } : mode === "custom" ? n : {};
        const power = own(src.power);
        const sens = own(src.sens);
        return {
          txPowerDbm: power === undefined ? radio.txPowerDbm : toDbm(power, asPowerUnit(src.powerUnit ?? field("powerUnit").value)),
          gainDbi: own(src.gain) ?? radio.gainDbi,
          cableLossDb: own(src.cable) ?? radio.cableLossDb,
          sensitivityDbm: sens === undefined || rungs.length ? radio.sensitivityDbm : deratedSensitivity(sens),
        };
      });

      const auto = field("environment").value === AUTO_ENVIRONMENT;
      const landCover = auto ? nodeCover() : undefined;
      const results = pairs(nodes.length).map(([a, b]) => {
        const elev = terrain.get(pathKey(nodes[a], nodes[b]));
        const distanceM = Math.max(1, distanceBetweenM(nodes[a], nodes[b]));
        const link: MeshLink = meshLink(
          radio,
          distanceM,
          heightM(nodes[a]),
          heightM(nodes[b]),
          Array.isArray(elev) ? elev : undefined,
          antennaLoss(nodes[a], nodes[b], distanceM, Array.isArray(elev) ? elev : undefined, nodeRadios[a].gainDbi, radio.k) +
            antennaLoss(nodes[b], nodes[a], distanceM, Array.isArray(elev) ? [...elev].reverse() : undefined, nodeRadios[b].gainDbi, radio.k),
          landCover?.points
            ? [withFormTrees(form, "heightUnit", landCover.points[a].environment), withFormTrees(form, "heightUnit", landCover.points[b].environment)]
            : undefined,
          [nodeRadios[a], nodeRadios[b]],
        );
        return { a, b, link, distanceM: distanceBetweenM(nodes[a], nodes[b]), terrainState: elev === undefined ? "pending" : elev === "error" ? "error" : "ok" };
      });

      lastLinks = results;
      const up = results.filter((r) => r.link.status !== "fail");
      const solid = results.filter((r) => r.link.status === "good");
      const groups = connectedGroups(nodes.length, up.map((r) => [r.a, r.b]));
      const solidGroups = connectedGroups(nodes.length, solid.map((r) => [r.a, r.b]));
      const hops = hopCounts(nodes.length, up.map((r) => [r.a, r.b]));
      const maxHops = Math.max(0, ...hops.flat().filter(Number.isFinite));
      const limit = hopLimit(preset);
      // Pairs that can reach each other, but only in more hops than the radios allow.
      const tooFar = limit ? pairs(nodes.length).filter(([a, b]) => Number.isFinite(hops[a][b]) && hops[a][b] > limit) : [];
      // The rate each link holds, and the best route between every pair over links that keep the fade margin.
      const rates = results.map((r) => rateAt(r.link.rslDbm, rungs, radio.fadeMarginDb));
      const rateOf = new Map(results.map((r, i) => [r, rates[i]]));
      const routes = rungs.length
        ? bestRoutes(
            nodes.length,
            results.flatMap((r, i) => (rates[i].solid ? [{ a: r.a, b: r.b, kbps: rates[i].solid!.kbps }] : [])),
            limit ?? nodes.length - 1,
            preset?.sharedChannel ?? true,
          )
        : undefined;

      const pill = out("pill");
      const split = out("split");
      // A named node goes by its name; an unnamed one by its number.
      const label = (i: number) => nodes[i].name.trim() || String(i + 1);
      const ref = (i: number) => nodes[i].name.trim() || `node ${i + 1}`;
      if (solidGroups.length === 1) {
        pill.className = "pill s-good";
        pill.textContent = "Solid mesh";
        split.hidden = true;
      } else if (groups.length === 1) {
        pill.className = "pill s-marginal";
        pill.textContent = "Connected, some marginal";
        split.hidden = false;
        split.textContent = "Every node is reachable, but only through at least one marginal link. Add a relay or raise antennas to firm it up.";
      } else {
        pill.className = "pill s-fail";
        pill.textContent = `Split into ${groups.length} groups`;
        split.hidden = false;
        const named = groups.map((g) => (g.length === 1 ? `${ref(g[0])} on its own` : g.map(ref).join(", ")));
        split.textContent = `The mesh splits into ${groups.length} groups that can't reach each other: ${named.join("; ")}. A relay between groups, or taller antennas, would join them.`;
      }
      const envLoss = results.map((r) => r.link.clutterLossDb);
      const envLow = Math.min(...envLoss);
      const envHigh = Math.max(...envLoss);
      const env = radio.environment;
      out("envNote").hidden = !landCover && (env.id === "none" || !(envHigh > 0));
      if (landCover) {
        out("envNote").textContent = landCover.points
          ? `From the land-cover map: ${landCover.points.map((p, i) => `${ref(i)} is in ${describePoint(p)}`).join("; ")}. Clutter adds ${envLow === envHigh ? fmt(envHigh) : `${fmt(envLow)}–${fmt(envHigh)}`} dB per link, included in the margins below.`
          : landCover.note;
      } else out("envNote").textContent = `${env.name} adds about ${envLow === envHigh ? fmt(envHigh) : `${fmt(envLow)}–${fmt(envHigh)}`} dB to each link, included in the margins below. An estimate; ${env.model === "forest" ? "below the canopy the Terrain column is checked from each antenna's real height (ITU-R P.833 woodland)" : "the Terrain column is checked from the top of the clutter"}.`;
      out("derateNote").textContent = derateNote();
      out("derateNote").hidden = !derateNote();
      out("up").textContent = `${up.length} of ${results.length}`;
      out("upSub").textContent = `${solid.length} solid, ${up.length - solid.length} marginal`;
      out("hops").textContent = groups.length === 1 ? String(maxHops) : "—";
      out("hopsSub").textContent = (groups.length === 1 ? "Between the farthest two nodes" : "The mesh is split") + (limit ? `; the limit is ${limit}` : "");

      const hopNote = out("hopNote");
      hopNote.hidden = tooFar.length === 0;
      if (tooFar.length) {
        if (groups.length === 1) {
          pill.className = "pill s-fail";
          pill.textContent = "Past the hop limit";
        }
        const shown = tooFar.slice(0, 3).map(([a, b]) => `${label(a)} and ${label(b)} (${hops[a][b]} hops)`);
        hopNote.textContent = `Past the preset's hop limit of ${limit}: ${shown.join(", ")}${tooFar.length > 3 ? `, and ${tooFar.length - 3} more pairs` : ""}. Messages between them run out of hops before they arrive. A relay node that shortens the route, or taller antennas for longer hops, would bring them in.`;
      }

      // End-to-end throughput, when the preset has a rate ladder.
      out("thruTile").hidden = out("routesWrap").hidden = !routes;
      if (routes) {
        const all = pairs(nodes.length).map(([a, b]) => ({ a, b, route: routes[a][b] as Route | undefined }));
        const missing = all.filter((p) => !p.route);
        const slowest = all.filter((p) => p.route).sort((x, y) => x.route!.kbps - y.route!.kbps)[0];
        out("thru").textContent = missing.length ? "—" : formatRate(slowest.route!.kbps);
        out("thruSub").textContent = missing.length
          ? `${missing.length} pair${missing.length === 1 ? " has" : "s have"} no route that keeps the fade margin${limit ? " within the hop limit" : ""}`
          : `${label(slowest.a)} and ${label(slowest.b)}, ${slowest.route!.hops} hop${slowest.route!.hops === 1 ? "" : "s"}`;
        const rows = [...all].sort((x, y) => (x.route?.kbps ?? -1) - (y.route?.kbps ?? -1));
        const body = out("routes") as HTMLTableSectionElement;
        body.innerHTML = rows
          .map((p) => `<tr><td></td><td class="num mono">${p.route ? p.route.hops : "—"}</td><td class="num mono">${p.route ? formatRate(p.route.kbps) : "No solid route"}</td></tr>`)
          .join("");
        rows.forEach((p, i) => (body.rows[i].cells[0].textContent = `${label(p.a)} ↔ ${label(p.b)}`));
        out("routesNote").textContent = `Every hop keeps your fade margin at the rate used. ${
          preset?.sharedChannel ?? true ? "Relays share one channel, so each hop's time on the air adds up." : "Relays forward at once, so the slowest hop sets the pace."
        } Protocol overhead and other traffic aren't counted, so expect less in practice.`;
      }

      const distUnit: DistanceUnit = asDistanceUnit(field("distUnit").value, "mi");
      out("links").innerHTML = [...results]
        .sort((x, y) => y.link.marginDb - x.link.marginDb)
        .map((r) => {
          const [text, cls] = statusText[r.link.status];
          const terrainCell =
            r.terrainState === "ok" ? `${fmt(r.link.terrainLossDb)} dB`
            : r.terrainState === "pending" ? "waiting"
            : "free space";
          return `<tr>
            <td class="link-name"></td>
            <td class="num mono">${fmt(fromMetres(r.distanceM, distUnit), 2)} ${distUnit}</td>
            <td class="num mono">${terrainCell}</td>
            <td class="num"><span class="mono">${fmt(r.link.marginDb)} dB</span> <span class="pill ${cls}">${text}</span>${
              Math.abs(r.link.marginAbDb - r.link.marginBaDb) >= 0.5
                ? `<span class="weaker">${escapeHtml(r.link.marginBaDb < r.link.marginAbDb ? `${label(r.b)} → ${label(r.a)}` : `${label(r.a)} → ${label(r.b)}`)} is the weaker way; the other is ${fmt(Math.max(r.link.marginAbDb, r.link.marginBaDb))} dB</span>`
                : ""
            }${(() => {
              const rate = rateOf.get(r);
              if (!rungs.length || !rate?.any) return "";
              return rate.solid
                ? `<span class="rate">Holds ${formatRate(rate.solid.kbps)}${rate.any.kbps > rate.solid.kbps ? `; ${formatRate(rate.any.kbps)} under the fade margin` : ""}</span>`
                : `<span class="rate">${formatRate(rate.any.kbps)}, under the fade margin</span>`;
            })()}</td>
          </tr>`;
        })
        .join("");
      // Names are user text: set them as text, not markup.
      [...results]
        .sort((x, y) => y.link.marginDb - x.link.marginDb)
        .forEach((r, idx) => {
          (out("links") as HTMLTableSectionElement).rows[idx].querySelector(".link-name")!.textContent = `${label(r.a)} ↔ ${label(r.b)}`;
        });

      if (map) {
        lines = results.map((r) => drawLinkLine(map!, nodes[r.a], nodes[r.b], linkLineStyle(r.link.status, r.link.profile)));
      }
      view3d?.refresh();
    };

    const loadTerrain = async () => {
      loading?.abort();
      const controller = new AbortController();
      loading = controller;
      // Paths not loaded yet, plus any that failed before.
      const todo = pairs(nodes.length)
        .map(([a, b]) => [nodes[a], nodes[b]] as const)
        .filter(([a, b]) => {
          const t = terrain.get(pathKey(a, b));
          return (t === undefined || t === "error") && distanceBetweenM(a, b) >= 50;
        });
      let fetched = 0;
      let lastError = "";
      for (const [a, b] of todo) {
        const key = pathKey(a, b);
        const kept = store.lookup(a, b);
        if (kept) {
          terrain.set(key, kept);
          continue;
        }
        setStatus(`Loading terrain ${++fetched} of ${todo.length}…`);
        try {
          const elev = await fetchPathElevations(samplePath(a, b, sampleCount(distanceBetweenM(a, b))), controller.signal);
          if (controller.signal.aborted) return;
          terrain.set(key, elev);
          store.remember(a, b, elev);
        } catch (err) {
          if (controller.signal.aborted) return;
          terrain.set(key, "error");
          lastError = (err as Error).message;
        }
        recompute();
      }
      if (controller.signal.aborted) return;
      const failed = [...terrain.values()].some((v) => v === "error");
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      setStatus(
        failed
          ? `Some terrain couldn't load (${offline ? "no connection" : lastError || "service error"}), so those links use free-space loss only.`
          : "",
        failed,
      );
      recompute();
    };

    const nodesChanged = (fit = true) => {
      save();
      renderNodes();
      drawMarkers();
      if (fit && map && nodes.length) map.fitBounds(L.latLngBounds(nodes.map((n) => [n.lat, n.lon] as [number, number])), { padding: [40, 40], maxZoom: 14 });
      recompute();
      void loadTerrain();
    };

    const addNode = (p: LatLon) => {
      if (nodes.length >= MAX_NODES) {
        setStatus(`The planner takes up to ${MAX_NODES} nodes.`, true);
        return;
      }
      nodes.push({ ...p, name: "", height: "" });
      setStatus("");
      nodesChanged(false);
    };

    const initMap = () => {
      if (map || !form.isConnected) return;
      map = createMap(out("map"), (m) => {
        if (nodes.length) m.fitBounds(L.latLngBounds(nodes.map((n) => [n.lat, n.lon] as [number, number])), { padding: [40, 40], maxZoom: 14 });
        else showDefaultView(m);
      });
      clearControl = addClearControl(map, "the nodes", clearNodes);
      // What the 3D view's editor shows for a node. A blank height uses the default.
      const nodeFields = (n: MeshNode): EditField[] => [
        { key: "name", label: "Name", value: n.name, type: "text", placeholder: "Optional" },
        { key: "height", label: "Antenna height", value: n.height, unit: field("heightUnit").value, type: "number", placeholder: field("height").value },
        {
          key: "antenna",
          label: "Antenna",
          value: n.antenna ?? "omni",
          type: "select",
          options: patterns.map((p) => ({ value: p.id, label: p.id === "directional" ? "Directional" : p.name.replace(", ", " ") })),
        },
        ...(n.antenna && n.antenna !== "omni" ? [{ key: "aim", label: "Points", value: n.aim ?? "", unit: "° true", type: "number" as const, placeholder: "0" }] : []),
        {
          key: "preset",
          label: "Radio",
          value: [...loadPresets().map((p) => p.id), "custom"].includes(nodeMode(n)) ? nodeMode(n) : "",
          type: "select",
          options: [{ value: "", label: "Same as the net" }, ...loadPresets().map((p) => ({ value: p.id, label: p.name })), { value: "custom", label: "Custom" }],
        },
        // Custom numbers; blank shows the shared value and keeps using it.
        ...NODE_RADIO_FIELDS.filter((f) => nodeMode(n) === "custom" && (f.key !== "sens" || !ladderActive())).map((f): EditField => {
          const unit = f.key === "power" ? (n.powerUnit ?? field("powerUnit").value) : f.unit;
          const sameUnit = f.key !== "power" || unit === field("powerUnit").value;
          return { key: f.key, label: f.label, value: n[f.key] ?? "", unit, type: "number", placeholder: sameUnit ? field(f.shared).value : "" };
        }),
        { key: "location", label: "Location", value: formatCoordinates(n), type: "text" },
      ];
      view3d = add3DControl(map, () => ({
        title: "Mesh Analysis",
        points: nodes.map((n, i) => ({ lat: n.lat, lon: n.lon, label: nodeLabel(i), heightM: heightM(n), fields: nodeFields(n) })),
        links: lastLinks
          .filter((r) => r.a < nodes.length && r.b < nodes.length)
          .map((r) => ({ a: r.a, b: r.b, style: linkLineStyle(r.link.status, r.link.profile) })),
        k: parseKFactor(field("kFactor").value),
        // A node dragged in 3D moves just as if it were dragged on this map.
        onMove: (i, p) => {
          if (!nodes[i]) return;
          nodes[i].lat = p.lat;
          nodes[i].lon = p.lon;
          nodesChanged(false);
        },
        // The pop-up editor: changes land in the node, as if typed in its row.
        onEdit: (i, values) => {
          const n = nodes[i];
          if (!n) return;
          if (values.name !== undefined) n.name = values.name;
          if (values.height !== undefined) n.height = values.height;
          if (values.antenna !== undefined) n.antenna = values.antenna === "omni" ? undefined : values.antenna;
          if (values.aim !== undefined) n.aim = values.aim;
          if (values.preset !== undefined) n.preset = values.preset;
          for (const f of NODE_RADIO_FIELDS) {
            const v = values[f.key];
            if (v === undefined) continue;
            n[f.key] = v;
            if (f.key === "power" && v && !n.powerUnit) n.powerUnit = field("powerUnit").value;
          }
          if (values.location !== undefined) {
            const p = parseCoordinates(values.location);
            if (p) {
              n.lat = p.lat;
              n.lon = p.lon;
            } else setStatus("That location wasn't understood. Use decimal degrees like 35.22710, -80.84310, or MGRS.", true);
          }
          nodesChanged(false);
          view3d?.refresh();
        },
      }));
      map.on("click", (e: L.LeafletMouseEvent) => addNode({ lat: e.latlng.lat, lon: e.latlng.lng }));
      drawMarkers();
      recompute();
    };
    const waitForPage = () => (form.isConnected ? initMap() : setTimeout(waitForPage, 50));
    setTimeout(waitForPage, 0);

    form.querySelector('[data-action="add"]')!.addEventListener("click", () => {
      const p = parseCoordinates(field("addLoc").value);
      if (!p) {
        setStatus("Enter decimal degrees like 35.22710, -80.84310, or MGRS like 17S NU 14277 98239.", true);
        return;
      }
      field("addLoc").value = "";
      addNode(p);
      map?.setView([p.lat, p.lon], Math.max(map.getZoom(), 12));
    });
    for (const type of ["input", "change"]) field("addLoc").addEventListener(type, (e) => e.stopPropagation());
    form.querySelector('[data-action="locate"]')!.addEventListener("click", () => {
      locateMe(setStatus, (p) => {
        addNode(p);
        map?.setView([p.lat, p.lon], Math.max(map.getZoom(), 12));
      });
    });
    const clearNodes = () => {
      // Several nodes take a while to place again, so ask first.
      if (nodes.length > 1 && !confirm(`Clear all ${nodes.length} nodes from the map?`)) return;
      nodes = [];
      setStatus("");
      nodesChanged(false);
    };
    form.querySelector('[data-action="reset"]')!.addEventListener("click", () => {
      for (const [name, value] of Object.entries(settingDefaults)) field(name).value = value;
      save();
      renderNodes();
      recompute();
    });

    // Radio settings: recalculate; a height unit change also relabels nodes.
    form.addEventListener("input", () => {
      save();
      recompute();
    });
    form.addEventListener("change", (e) => {
      save();
      const changed = (e.target as HTMLElement).getAttribute("name") ?? "";
      if (changed.startsWith("height") || ["power", "powerUnit", "gain", "cable", "sens"].includes(changed)) renderNodes();
      recompute();
    });

    // The preset note, and the sensitivity field only when there's no ladder.
    // With a preset, its radio numbers fold into one line; Override opens them.
    let overriding = false;
    const syncPresetUi = () => {
      const p = activePreset();
      const rungs = ladder(p);
      const folded = !!p && !overriding;
      for (const key of ["power", "gain", "cable"]) field(key).closest("label")!.hidden = folded;
      field("sens").closest("label")!.hidden = rungs.length > 0 || folded;
      out("radioSummary").hidden = !p;
      if (p) {
        const edited = (["power", "powerUnit", "gain", "cable"] as const).some((k) => p[k] && p[k] !== field(k).value);
        const sensWords = rungs.length ? `${rungs.length} rate${rungs.length === 1 ? "" : "s"}` : `${field("sens").value} dBm sensitivity`;
        out("radioSummaryText").textContent = `From the preset: ${[radioWords(field("power").value, field("powerUnit").value, field("gain").value, field("cable").value), sensWords].filter(Boolean).join(", ")}${edited ? " (changed here)" : ""}.`;
        form.querySelector('[data-action="override"]')!.textContent = overriding ? "Fold up" : "Override";
      }
      const note = out("presetNote");
      const bits: string[] = [];
      if (rungs.length) {
        const fastest = rungs[0];
        const slowest = rungs[rungs.length - 1];
        bits.push(
          rungs.length === 1
            ? `Sensitivity comes from the preset: ${formatRate(fastest.kbps)} at ${fmt(fastest.sensDbm, 0)} dBm.`
            : `Sensitivity comes from the preset's rate ladder: ${rungs.length} rates, ${formatRate(fastest.kbps)} at ${fmt(fastest.sensDbm, 0)} dBm down to ${formatRate(slowest.kbps)} at ${fmt(slowest.sensDbm, 0)} dBm.`,
        );
      }
      const lim = hopLimit(p);
      if (lim) bits.push(`Hop limit ${lim}.`);
      note.textContent = bits.join(" ");
      note.hidden = bits.length === 0;
    };
    // Picking a preset fills in the radio fields it has; they stay editable.
    const applyPreset = (p: RadioPreset | undefined) => {
      overriding = false;
      if (p) {
        for (const key of ["freq", "freqUnit", "power", "powerUnit", "gain", "cable"] as const) {
          const v = p[key];
          if (v) field(key).value = v;
        }
      }
      syncPresetUi();
      renderNodes();
    };
    field("preset").addEventListener("change", () => applyPreset(activePreset()));
    form.querySelector('[data-action="override"]')!.addEventListener("click", () => {
      overriding = !overriding;
      syncPresetUi();
    });
    // Edits in the open fields show in the summary line.
    form.addEventListener("input", () => syncPresetUi());
    form.querySelector('[data-action="presets"]')!.addEventListener("click", () =>
      openPresetManager((id) => {
        fillPresetOptions();
        field("preset").value = id;
        applyPreset(activePreset());
        save();
        recompute();
      }),
    );
    // Presets changed (here or in another tab): refresh the list and anything that used one.
    const onPresets = () => {
      if (!form.isConnected) {
        window.removeEventListener(PRESETS_EVENT, onPresets);
        return;
      }
      fillPresetOptions();
      syncPresetUi();
      renderNodes();
      recompute();
    };
    window.addEventListener(PRESETS_EVENT, onPresets);
    syncPresetUi();

    renderNodes();
    recompute();
    if (nodes.length >= 2) void loadTerrain();
    const nodeLabel = (i: number) => nodes[i].name.trim() || String(i + 1);
    out("nodes").closest(".card")!.append(
      createPlanBar({
        toolId: "mesh",
        settingNames: Object.keys(settingDefaults),
        getPlan: () => {
          const settings: Record<string, string> = {};
          for (const name of Object.keys(settingDefaults)) settings[name] = field(name).value;
          const preset = activePreset();
          const used = new Set(nodes.map(nodeMode));
          const nodePresets = loadPresets().filter((p) => used.has(p.id));
          return { settings, nodes: nodes.map((n) => ({ ...n })), ...(preset ? { preset } : {}), ...(nodePresets.length ? { nodePresets } : {}) };
        },
        applyPlan: (plan) => {
          // A plan's preset joins this device's presets (once), so its ladder and hop limit apply here too.
          const settingsHere = { ...plan.settings, preset: plan.preset ? adoptPreset(plan.preset) : "" };
          fillPresetOptions();
          applySettings(form, settingsHere);
          syncPresetUi();
          // Node presets join this device's too; nodes are pointed at their ids here.
          const ids = new Map((plan.nodePresets ?? []).map((p) => [p.id, adoptPreset(p)]));
          nodes = (plan.nodes ?? []).map((n) => ({ ...n, ...(n.preset && n.preset !== "custom" ? { preset: ids.get(n.preset) ?? "" } : {}) }));
          nodesChanged();
        },
        exportLabel: "Export KMZ",
        onExport: (name) => {
          if (!nodes.length) return "Add some nodes first.";
          const kml = buildKml(
            name,
            nodes.map((n, i) => ({ name: nodeLabel(i), lat: n.lat, lon: n.lon })),
            lastLinks
              .filter((r) => r.a < nodes.length && r.b < nodes.length)
              .map((r) => ({
                name: `${nodeLabel(r.a)} to ${nodeLabel(r.b)}`,
                from: nodes[r.a],
                to: nodes[r.b],
                status: linkLineStyle(r.link.status, r.link.profile),
                description: `${linkLineLabels[linkLineStyle(r.link.status, r.link.profile)]}. Margin ${fmt(r.link.marginDb)} dB.`,
              })),
            RADIO_FILE,
          );
          const kmz = buildZip([
            { name: "doc.kml", data: new TextEncoder().encode(kml) },
            radioIconFile(),
          ]);
          downloadFile(fileName(name, "kmz"), new Uint8Array(kmz), "application/vnd.google-earth.kmz");
          return undefined;
        },
      }),
    );
    enhanceFields(form, meshGuide, settingDefaults);
    return form;
  },
};
