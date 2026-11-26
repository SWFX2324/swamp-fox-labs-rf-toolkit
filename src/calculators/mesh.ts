import { escapeHtml } from "../lib/html";
import { rfIcon } from "../ui/rfIcons";
// Mesh Analysis: drop nodes on a map and see every node-to-node link over
// real terrain with identical radios, plus whether the mesh holds together.

import { enhanceFields } from "./fieldHelp";
import { locateButton, locateMe } from "./locate";
import { meshGuide } from "./helpText";
import * as L from "leaflet";
import { type ClearControl, type Control3D, DATA_ATTRIBUTION, add3DControl, addClearControl, createMap, showDefaultView } from "./mapKit";
import type { Calculator } from ".";
import { coordPlaceholder, formatCoordinates, parseCoordinates } from "../lib/coords";
import { buildKml, fileName, buildZip } from "../lib/export";
import { linkLineLabels, linkLineStyle } from "../lib/linkLines";
import { drawLinkLine, linkLegend } from "./linkLine";
import { findEnvironment } from "../lib/environment";
import { applySettings, createPlanCard } from "./planBar";
import { RADIO_FILE, radioIconFile, radioMarker } from "./radioIcon";
import { bindTreeField, environmentOptions, treeHeightFieldHtml, withFormTrees } from "./environmentField";
import { AUTO_ENVIRONMENT, type LandCoverPoint } from "../lib/landCover";
import { landCoverAt } from "./landCoverTiles";
import { globalK, readModel } from "./modelFields";
import { climates, grounds } from "../lib/propagation";
import { PANE_ICONS, moveModeBar, pane, setupMapFirst, sideToggles } from "./mapFirst";
import { tabStateToSave, tabValues } from "../lib/appSettings";
import { deratedSensitivity, fallbackEnvironment, getSettings, setSettings, sharedFields } from "./settingsStore";
import { fetchPathElevations } from "./tileElevation";
import { type LatLon, bearingDeg, destinationPoint, distanceBetweenM, samplePath } from "../lib/geo";
import { beam, elevationAngleDeg, patternLossDb, patterns } from "../lib/pattern";
import { type EndRadio, type MeshLink, type MeshLinkStatus, connectedGroups, hopCounts, meshLink, pairs } from "../lib/mesh";
import { createPathStore, pathKey } from "../lib/pathStore";
import { type ProfileStatus, analyzeProfile, sampleCount } from "../lib/profile";
import { drawProfile } from "./terrain";
import type { EditField } from "../lib/scene3d";
import { type RadioPreset, type Route, bestRoutes, formatRate, hopLimit, ladder, rateAt } from "../lib/radioPresets";
import { PRESETS_EVENT, adoptPreset, loadPresets, openPresetManager, presetsEventFor } from "./presetManager";
import {
  type DistanceUnit,
  frequencyUnits,
  fromMeters,
  powerUnits,
  toDbm,
  toHz,
  toMeters,
  asDistanceUnit,
  asFrequencyUnit,
  asPowerUnit,
} from "../lib/units";

const STORAGE_KEY = "rf-toolkit:mesh";
// Cards start closed; these remember which are open and which side panes are folded.
const PANES_KEY = "rf-toolkit:mesh-panes";
const SIDES_KEY = "rf-toolkit:mesh-sides";
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
/** True when a node has any of its own radio figures typed in, instead of the shared radio's. */
const hasOwnRadio = (n: MeshNode) => NODE_RADIO_FIELDS.some((f) => (n[f.key] ?? "").trim() !== "");
const RADIO_ICON = rfIcon("radio", "node-radio-icon");

// The built-in defaults from before Settings existed. Settings now override the
// fields they cover; these still fill the rest and recognize untouched old saves.
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
  height: "30",
  heightUnit: "ft",
};

const statusText: Record<MeshLinkStatus, [string, string]> = {
  good: ["Good", "s-good"],
  marginal: ["Marginal", "s-marginal"],
  fail: ["Won't connect", "s-fail"],
};

/** A labeled number box with its unit. */
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
  <div class="lb-shell floating">
  ${sideToggles("mesh results")}
  <div class="lb-left">
    ${pane("config", "mesh", "Radio", `
      <div class="fields">
        <label class="wide">Radio
          <span class="preset-pick">
            <select name="preset"></select>
            <button type="button" class="secondary" data-action="presets">Manage presets</button>
          </span>
        </label>
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
      </div>`)}

    ${pane("nodes", "radio", "Nodes", `
      <div class="add-node">
        <input name="addLoc" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" />
        <button type="button" class="secondary" data-action="add">Add node</button>
        ${locateButton('data-action="locate"', "Add a node at my location", "")}
      </div>
      <p class="note node-count" data-out="nodeCount"></p>
      <p class="note warn" data-out="status"></p>
      <div class="table-wrap">
        <table class="ledger node-list">
          <thead><tr><th></th><th>Name</th><th>Location</th><th>Height</th><th>Antenna</th><th></th></tr></thead>
          <tbody data-out="nodes"></tbody>
        </table>
      </div>`)}

    ${pane("env", "env", "Environment", `
      <div class="fields">
        <label class="wide">Environment
          <select name="environment">${environmentOptions()}</select>
        </label>
        <label>Climate
          <select name="climate">${climates.map((c) => `<option value="${c.id}">${c.name}</option>`).join("")}</select>
        </label>
        <label>Ground type
          <select name="ground">${grounds.map((g) => `<option value="${g.id}">${g.name}</option>`).join("")}</select>
        </label>
        ${treeHeightFieldHtml()}
      </div>`)}

    ${pane("share", "share", "Share", `<div class="pane-slot" data-slot="share"></div>`)}
  </div>

  <div class="lb-map">
    <div class="map mesh-map" data-out="map"></div>
    <div class="map-legend"><div data-out="legend"></div></div>
  </div>

  <section class="card profile-dock" data-out="profileDock" hidden>
    <div class="dock-head">
      <h2 class="with-icon">${PANE_ICONS.terrain}Terrain profile</h2>
      <span class="dock-link" data-out="dockLink"></span>
      <span class="pill" data-out="dockPill" hidden></span>
      <button type="button" class="dock-toggle" data-action="closeProfile" aria-label="Close the terrain profile">${rfIcon("close")}</button>
    </div>
    <div class="dock-body">
      <div class="profile-chart" data-out="dockChart"></div>
      <p class="note" data-out="dockNote" hidden></p>
      <p class="dock-facts" data-out="dockFacts"></p>
    </div>
  </section>

  <aside class="results lb-right">
    <section class="card">
      <div class="card-head">
        <h2 class="with-icon">${PANE_ICONS.budget}Mesh</h2>
        <span class="pill" data-out="pill" hidden></span>
        <button type="button" class="secondary" data-action="reset">Reset</button>
      </div>
      <p class="note" data-out="empty">Add at least two nodes to see the links between them.</p>
      <div data-out="results" hidden>
        <p class="callout" data-out="split" hidden></p>
        <p class="callout" data-out="hopNote" hidden></p>
        <div class="tiles">
          <div class="tile"><span class="label">Links up</span><span class="value" data-out="up"></span><span class="sub" data-out="upSub"></span></div>
          <div class="tile"><span class="label">Most hops</span><span class="value" data-out="hops"></span><span class="sub" data-out="hopsSub"></span></div>
          <div class="tile" data-out="thruTile" hidden><span class="label">Slowest pair, end to end</span><span class="value" data-out="thru"></span><span class="sub" data-out="thruSub"></span></div>
        </div>
        <div class="table-wrap">
          <table class="ledger links">
            <thead><tr><th>Link</th><th class="num">Distance</th><th class="num">Terrain loss</th><th class="num">Margin</th></tr></thead>
            <tbody data-out="links"></tbody>
          </table>
        </div>
        <p class="note links-note">Each link is rated on its weaker direction. Tap a link for its terrain profile.</p>
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
      </div>
    </section>
  </aside>
  </div>
`;

/** The defaults now: the built-in ones, with Settings on top for everything Settings covers. */
function currentSettingDefaults(): Record<string, string> {
  const s = sharedFields();
  return {
    ...legacySettingDefaults,
    fade: s.fade,
    gain: s.gain,
    cable: s.cableAndConnectors,
    environment: s.environment,
    treeHeight: s.treeHeight,
    height: s.height,
    heightUnit: s.heightUnit,
  };
}

/** The saved plan: settings checked against the defaults (see tabValues) and nodes with real coordinates, at most MAX_NODES. */
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


/** A number to the given decimal places, with a true minus sign for negatives. */
const fmt = (v: number, digits = 1) =>
  v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace("-", "−");

export const meshCalculator: Calculator = {
  id: "mesh",
  title: "MANET Mesh Planner",
  shortTitle: "Mesh",
  // Builds the Mesh Planner page: the nodes and radio settings, the map, and the
  // link and route results, all recalculated on every change.
  render() {
    const form = document.createElement("form");
    const settingDefaults = currentSettingDefaults();
    form.className = "calculator mesh map-first";
    form.innerHTML = template;
    bindTreeField(form, "heightUnit");
    form.querySelector('[data-out="legend"]')!.replaceWith(linkLegend());
    form.addEventListener("submit", (e) => e.preventDefault());

    // A field in the form by its name.
    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
    // A result element by its data-out name.
    const out = (name: string) => form.querySelector<HTMLElement>(`[data-out="${name}"]`)!;
    // A field's value as a number (NaN when blank or not a number).
    const num = (name: string) => Number.parseFloat(field(name).value);

    const store = createPathStore({
      // Reads stored terrain, or nothing when storage is blocked.
      getItem: (k) => {
        try {
          return localStorage.getItem(k);
        } catch {
          return null;
        }
      },
      // Stores terrain; the path store handles a refusal.
      setItem: (k, v) => localStorage.setItem(k, v),
    });

    // Radio presets: the user's own, from this device.
    const fillPresetOptions = () => {
      const select = field("preset") as HTMLSelectElement;
      const keep = select.value;
      const none = new Option("User defined", "");
      select.replaceChildren(none, ...loadPresets("mesh").map((p) => new Option(p.name, p.id)));
      select.value = [...select.options].some((o) => o.value === keep) ? keep : "";
    };
    fillPresetOptions();
    // The radio preset chosen for the net, if any.
    const activePreset = (): RadioPreset | undefined => loadPresets("mesh").find((p) => p.id === field("preset").value);
    // True when the chosen preset has a rate ladder, which then sets the sensitivity.
    const ladderActive = () => ladder(activePreset()).length > 0;

    const state = loadState(settingDefaults);
    let nodes = state.nodes;
    // What a node is called in results and exports: its name, or its number when it has none.
    const nodeName = (i: number) => nodes[i].name.trim() || `Node ${i + 1}`;
    for (const [name, value] of Object.entries(state.settings)) {
      const el = form.elements.namedItem(name);
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.value = value;
    }
    field("addLoc").setAttribute("placeholder", coordPlaceholder());

    // Remembers the settings that differ from the defaults, and the nodes.
    const save = () => {
      const settings: Record<string, string> = {};
      for (const name of Object.keys(settingDefaults)) settings[name] = field(name).value;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings: tabStateToSave(settings, settingDefaults), nodes }));
      } catch {
        // Storage blocked: the plan just won't be remembered.
      }
    };
    // Shows a message under the node list, in warning colors when warn is set.
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

    // A node's antenna height in meters: its own, or the shared height when it has none.
    const heightM = (n: MeshNode) =>
      toMeters(Number.parseFloat(n.height) || Number.parseFloat(field("height").value) || 0, asDistanceUnit(field("heightUnit").value));

    // Pattern loss at node "from" toward node "to". The profile runs from "from".
    const antennaLoss = (from: MeshNode, to: MeshNode, distanceM: number, elev: number[] | undefined, gainDbi: number, k: number) => {
      // Omni antennas lose a little straight up or down too, which only
      // matters close in under a tall mast.
      const b = beam(from.antenna, gainDbi, Number.parseFloat(from.aim ?? "") || 0);
      const fromTop = (elev?.[0] ?? 0) + heightM(from);
      const toTop = (elev?.[elev.length - 1] ?? 0) + heightM(to);
      return patternLossDb(b, bearingDeg(from, to), elevationAngleDeg(fromTop, toTop, distanceM, k));
    };

    // Redraws the node list, each row with its name, height, antenna and own-radio fields.
    const renderNodes = () => {
      out("nodeCount").textContent = `${nodes.length} of ${MAX_NODES} nodes`;
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
              <button type="button" class="secondary icon-btn" data-remove title="Remove node" aria-label="Remove node ${idx + 1}">${rfIcon("close")}</button>
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
          const presets = loadPresets("mesh");
          const pick = cell.querySelector<HTMLSelectElement>('select[data-k="preset"]')!;
          pick.replaceChildren(new Option("Same as the net", ""), ...presets.map((p) => new Option(p.name, p.id)), new Option("User defined", "custom"));
          const mode = nodeMode(n);
          pick.value = [...pick.options].some((o) => o.value === mode) ? mode : "";
          const chosen = presets.find((p) => p.id === pick.value);
          const custom = pick.value === "custom";
          cell.querySelector<HTMLElement>('[data-k="custom"]')!.hidden = !custom;
          cell.querySelector<HTMLElement>('[data-k="customNote"]')!.hidden = !custom;
          const summary = cell.querySelector<HTMLElement>('[data-k="summary"]')!;
          summary.hidden = custom;
          summary.textContent = chosen
            ? `${radioWords(chosen.power, chosen.powerUnit, chosen.gain, chosen.cable) || "No power, gain or cable in this preset"}${chosen.sens && !ladderActive() ? `, ${chosen.sens.replace("-", "−")} dBm sensitivity` : ""}; anything it leaves out comes from the Radios card. Data rates come from the net's radio, since the whole mesh runs one waveform${chosen.sens && ladderActive() ? ", and so does sensitivity while it has a rate ladder" : ""}.`
            : "Uses the radio on the Radios card.";
          for (const type of ["input", "change"]) pick.addEventListener(type, (e) => e.stopPropagation());
          pick.addEventListener("change", () => {
            n.preset = pick.value;
            save();
            renderNodes();
            recompute();
          });
          const radioBtn = tr.querySelector<HTMLButtonElement>(".node-radio-btn")!;
          // Opens or closes this node's own-radio row, and remembers it across redraws.
          const showRadio = (open: boolean) => {
            sub.hidden = !open;
            radioBtn.setAttribute("aria-expanded", String(open));
            if (open) openRadios.add(n);
            else openRadios.delete(n);
          };
          // Highlights the radio button when the node has its own radio or a different preset.
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

    // The link whose terrain profile is open, by its two nodes (so it survives a re-sort).
    let selected: [MeshNode, MeshNode] | undefined;
    let selLine: L.Polyline | undefined;
    const LOS_WORDS: Record<ProfileStatus, [string, string]> = {
      clear: ["Clear line of sight", "s-good"],
      fresnel: ["Fresnel partly blocked", "s-marginal"],
      blocked: ["No line of sight", "s-marginal"],
    };
    /** Draw the chosen link's profile in the dock, or close it if that link is gone. */
    const showSelected = () => {
      selLine?.remove();
      selLine = undefined;
      const dock = out("profileDock");
      const r = selected && lastLinks.find((l) => nodes[l.a] === selected![0] && nodes[l.b] === selected![1]);
      for (const tr of out("links").querySelectorAll("tr")) tr.classList.toggle("selected", !!r && Number(tr.dataset.a) === r.a && Number(tr.dataset.b) === r.b);
      if (!r || nodes.length < 2) {
        selected = undefined;
        dock.hidden = true;
        syncDock();
        return;
      }
      const a = nodes[r.a];
      const b = nodes[r.b];
      dock.hidden = false;
      out("dockLink").textContent = `${nodeName(r.a)} ↔ ${nodeName(r.b)}`;
      if (map) selLine = L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { className: "mesh-link-selected", interactive: false }).addTo(map);
      const distUnit: DistanceUnit = asDistanceUnit(getSettings().distanceUnit, "mi");
      const heightUnit = asDistanceUnit(field("heightUnit").value);
      const elev = terrain.get(pathKey(a, b));
      const chart = out("dockChart");
      const note = out("dockNote");
      const pill = out("dockPill");
      const freqHz = toHz(num("freq"), asFrequencyUnit(field("freqUnit").value));
      if (Array.isArray(elev) && elev.length >= 3 && freqHz > 0) {
        const result = analyzeProfile({
          freqHz,
          distanceM: Math.max(1, distanceBetweenM(a, b)),
          elevationsM: elev,
          txHeightM: r.link.pathHeightsM[0],
          rxHeightM: r.link.pathHeightsM[1],
          k: globalK(),
        });
        const docked = !dock.classList.contains("inline");
        chart.hidden = false;
        chart.innerHTML = drawProfile([result], { distUnit, heightUnit }, chart.clientWidth || 600, [nodeName(r.a), nodeName(r.b)], docked ? 150 : undefined, false, [r.link.status]);
        note.hidden = true;
        const [words, cls] = LOS_WORDS[result.status];
        pill.hidden = false;
        pill.className = `pill ${cls}`;
        pill.textContent = words;
      } else {
        chart.hidden = true;
        chart.replaceChildren();
        pill.hidden = true;
        note.hidden = false;
        note.textContent =
          distanceBetweenM(a, b) < 50 ? "These nodes are too close together for a terrain profile."
          : elev === "error" ? "Couldn't load terrain for this link; it's worked out as free space."
          : "Terrain for this link is still loading.";
      }
      const [text] = statusText[r.link.status];
      out("dockFacts").innerHTML = [
        ["Distance", `${fmt(fromMeters(r.distanceM, distUnit), 2)} ${distUnit}`],
        ["Terrain loss", `${fmt(r.link.terrainLossDb)} dB`],
        ["Margin", `${fmt(r.link.marginDb)} dB, ${text}`],
      ]
        .map(([k, v]) => `<span>${k} <b>${v.replace("-", "−")}</b></span>`)
        .join("");
      syncDock();
    };

    // Leaves room under the map for the profile while it is docked there.
    function syncDock() {
      const dock = out("profileDock");
      const docked = !dock.hidden && !dock.classList.contains("inline");
      form.querySelector(".lb-shell")!.classList.toggle("has-dock", docked);
    }

    // Redraws every node's pin and name on the map; dragging a pin moves the node.
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
        // The name beside the pin, as on the other maps; an unnamed node by its number.
        const tag = document.createElement("span");
        tag.textContent = nodeName(idx); // User text, so set as text.
        m.bindTooltip(tag, { permanent: true, direction: "right", offset: [8, -16], className: "pin-name" });
        m.on("dragend", () => {
          const p = m.getLatLng();
          n.lat = p.lat;
          n.lon = p.lng;
          nodesChanged(false);
        });
        return m;
      });
    };

    // Land cover at every node, when Environment is "Auto (satellite map)".
    let cover: { key: string; points?: LandCoverPoint[]; error?: string } | undefined;
    // The land cover at every node when Environment is Auto, read once per set
    // of positions, with a note while it loads or when it can't be read.
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

    // Works out every link and route from the current nodes and settings, and
    // redraws the map lines, the tables and the summary.
    const recompute = () => {
      for (const l of lines) l.remove();
      lines = [];
      drawAims();
      const ready = nodes.length >= 2;
      out("empty").hidden = ready;
      out("results").hidden = !ready;
      out("pill").hidden = !ready;
      if (!ready) {
        showSelected();
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
        k: globalK(),
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
      const presetsHere = loadPresets("mesh");
      const nodeRadios: EndRadio[] = nodes.map((n) => {
        const mode = nodeMode(n);
        const np = presetsHere.find((p) => p.id === mode);
        // A node preset or custom radio brings its own numbers; otherwise the net's radio.
        // A net rate ladder sets every node's sensitivity, since the mesh runs one waveform.
        const src = np ? { power: np.power, powerUnit: np.powerUnit, gain: np.gain, cable: np.cable, sens: np.sens } : mode === "custom" ? n : {};
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
        return { a, b, link, distanceM: distanceBetweenM(nodes[a], nodes[b]), terrainState: distanceBetweenM(nodes[a], nodes[b]) < 50 ? "short" : elev === undefined ? "pending" : elev === "error" ? "error" : "ok" };
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
      if (solidGroups.length === 1) {
        pill.className = "pill s-good";
        pill.textContent = "Good mesh";
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
        const named = groups.map((g) => (g.length === 1 ? `${nodeName(g[0])} on its own` : g.map(nodeName).join(", ")));
        split.textContent = `The mesh splits into ${groups.length} groups that can't reach each other: ${named.join("; ")}. A relay between groups, or taller antennas, would join them.`;
      }
      out("up").textContent = `${up.length} of ${results.length}`;
      out("upSub").textContent = `${solid.length} good, ${up.length - solid.length} marginal`;
      out("hops").textContent = groups.length === 1 ? String(maxHops) : "—";
      out("hopsSub").textContent = (groups.length === 1 ? "Between the farthest two nodes" : "The mesh is split") + (limit ? `; the limit is ${limit}` : "");

      const hopNote = out("hopNote");
      hopNote.hidden = tooFar.length === 0;
      if (tooFar.length) {
        if (groups.length === 1) {
          pill.className = "pill s-fail";
          pill.textContent = "Past the hop limit";
        }
        const shown = tooFar.slice(0, 3).map(([a, b]) => `${nodeName(a)} and ${nodeName(b)} (${hops[a][b]} hops)`);
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
          : `${nodeName(slowest.a)} and ${nodeName(slowest.b)}, ${slowest.route!.hops} hop${slowest.route!.hops === 1 ? "" : "s"}`;
        const rows = [...all].sort((x, y) => (x.route?.kbps ?? -1) - (y.route?.kbps ?? -1));
        const body = out("routes") as HTMLTableSectionElement;
        body.innerHTML = rows
          .map((p) => `<tr><td></td><td class="num mono">${p.route ? p.route.hops : "—"}</td><td class="num mono">${p.route ? formatRate(p.route.kbps) : "No good route"}</td></tr>`)
          .join("");
        rows.forEach((p, i) => (body.rows[i].cells[0].textContent = `${nodeName(p.a)} ↔ ${nodeName(p.b)}`));
        out("routesNote").textContent = `Every hop keeps your fade margin at the rate used. ${
          preset?.sharedChannel ?? true ? "Relays share one channel, so each hop's time on the air adds up." : "Relays forward at once, so the slowest hop sets the pace."
        } Protocol overhead and other traffic aren't counted, so expect less in practice.`;
      }

      const distUnit: DistanceUnit = asDistanceUnit(getSettings().distanceUnit, "mi");
      out("links").innerHTML = [...results]
        .sort((x, y) => y.link.marginDb - x.link.marginDb)
        .map((r) => {
          const [text, cls] = statusText[r.link.status];
          const terrainCell =
            r.terrainState === "ok" ? `${fmt(r.link.terrainLossDb)} dB`
            : r.terrainState === "short" ? "Negligible"
            : r.terrainState === "pending" ? "waiting"
            : "free space";
          const chosen = selected && nodes[r.a] === selected[0] && nodes[r.b] === selected[1];
          return `<tr tabindex="0" data-a="${r.a}" data-b="${r.b}"${chosen ? ' class="selected"' : ""}>
            <td class="link-name"></td>
            <td class="num mono">${fmt(fromMeters(r.distanceM, distUnit), 2)} ${distUnit}</td>
            <td class="num mono">${terrainCell}</td>
            <td class="num"><span class="mono">${fmt(r.link.marginDb)} dB</span> <span class="pill ${cls}">${text}</span>${
              Math.abs(r.link.marginAbDb - r.link.marginBaDb) >= 0.5
                ? `<span class="weaker">${escapeHtml(r.link.marginBaDb < r.link.marginAbDb ? `${nodeName(r.b)} → ${nodeName(r.a)}` : `${nodeName(r.a)} → ${nodeName(r.b)}`)} is the weaker way; the other is ${fmt(Math.max(r.link.marginAbDb, r.link.marginBaDb))} dB</span>`
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
          (out("links") as HTMLTableSectionElement).rows[idx].querySelector(".link-name")!.textContent = `${nodeName(r.a)} ↔ ${nodeName(r.b)}`;
        });

      if (map) {
        lines = results.map((r) => drawLinkLine(map!, nodes[r.a], nodes[r.b], linkLineStyle(r.link.status, r.link.profile)));
      }
      showSelected();
      view3d?.refresh();
    };

    // Fetches terrain for every pair of nodes that doesn't have it yet (from the
    // device first, then the internet), recalculating as each arrives.
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

    // Saves and redraws after nodes are added, moved or removed. fit zooms the
    // map to show every node.
    const nodesChanged = (fit = true) => {
      save();
      renderNodes();
      drawMarkers();
      if (fit && map && nodes.length) map.fitBounds(L.latLngBounds(nodes.map((n) => [n.lat, n.lon] as [number, number])), { padding: [40, 40], maxZoom: 14 });
      recompute();
      void loadTerrain();
    };

    // Adds a node at a point, up to MAX_NODES.
    const addNode = (p: LatLon) => {
      if (nodes.length >= MAX_NODES) {
        setStatus(`The planner takes up to ${MAX_NODES} nodes.`, true);
        return;
      }
      nodes.push({ ...p, name: "", height: "" });
      setStatus("");
      nodesChanged(false);
    };

    // Creates the map once the page is on screen; tapping it adds a node.
    const initMap = () => {
      if (map || !form.isConnected) return;
      map = createMap(out("map"), (m) => {
        if (nodes.length) m.fitBounds(L.latLngBounds(nodes.map((n) => [n.lat, n.lon] as [number, number])), { padding: [40, 40], maxZoom: 14 });
        else showDefaultView(m);
      }, { taskbar: true });
      map.attributionControl.addAttribution(DATA_ATTRIBUTION);
      clearControl = addClearControl(map, "the nodes", clearNodes, () => `Clear ${nodes.length === 1 ? "the node" : `all ${nodes.length} nodes`} from the map`);
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
          value: [...loadPresets("mesh").map((p) => p.id), "custom"].includes(nodeMode(n)) ? nodeMode(n) : "",
          type: "select",
          options: [{ value: "", label: "Same as the net" }, ...loadPresets("mesh").map((p) => ({ value: p.id, label: p.name })), { value: "custom", label: "User defined" }],
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
        title: "MANET Mesh Planner",
        points: nodes.map((n, i) => ({ lat: n.lat, lon: n.lon, label: nodeName(i), heightM: heightM(n), fields: nodeFields(n) })),
        links: lastLinks
          .filter((r) => r.a < nodes.length && r.b < nodes.length)
          .map((r) => ({ a: r.a, b: r.b, style: linkLineStyle(r.link.status, r.link.profile) })),
        k: globalK(),
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
    // Waits until the page is on screen, since the map needs its real size.
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
    // Removes every node (Clear map).
    const clearNodes = () => {
      // The button has already asked for a second tap.
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

    // With a preset, the fields it sets are hidden (edit them under Manage presets);
    // anything it leaves blank stays as a field. With none, every field shows.
    const syncPresetUi = () => {
      const p = activePreset();
      const rungs = ladder(p);
      for (const key of ["power", "gain", "cable"] as const) field(key).closest("label")!.hidden = !!p?.[key];
      field("sens").closest("label")!.hidden = rungs.length > 0 || !!p?.sens;
    };
    // The preset's numbers go into the fields it covers, so the math uses them.
    const applyPreset = (p: RadioPreset | undefined) => {
      if (p) {
        for (const key of ["freq", "freqUnit", "power", "powerUnit", "gain", "cable", "sens"] as const) {
          const v = p[key];
          if (v) field(key).value = v;
        }
      }
      syncPresetUi();
      renderNodes();
    };
    field("preset").addEventListener("change", () => applyPreset(activePreset()));
    // Uses a preset just picked or saved in the preset manager.
    const pickSaved = (id: string) => {
      fillPresetOptions();
      field("preset").value = id;
      applyPreset(activePreset());
      save();
      recompute();
    };
    form.querySelector('[data-action="presets"]')!.addEventListener("click", () => openPresetManager("mesh", pickSaved));
    // Presets changed (here or in another tab): refresh the list and anything that used one.
    const onPresets = (e: Event) => {
      if (!presetsEventFor(e, "mesh")) return;
      if (!form.isConnected) {
        window.removeEventListener(PRESETS_EVENT, onPresets);
        return;
      }
      fillPresetOptions();
      // An edited preset brings its new numbers with it.
      applyPreset(activePreset());
      save();
      recompute();
    };
    window.addEventListener(PRESETS_EVENT, onPresets);
    // A saved preset's numbers win over what's in the fields, in case it changed since.
    if (activePreset()) {
      applyPreset(activePreset());
      save();
    } else syncPresetUi();

    renderNodes();
    recompute();
    if (nodes.length >= 2) void loadTerrain();
    form.querySelector('[data-slot="share"]')!.append(
      createPlanCard({
        toolId: "mesh",
        settingNames: Object.keys(settingDefaults),
        // The plan to share or save: settings, nodes and the presets they use.
        getPlan: () => {
          const settings: Record<string, string> = {};
          for (const name of Object.keys(settingDefaults)) settings[name] = field(name).value;
          const preset = activePreset();
          const used = new Set(nodes.map(nodeMode));
          const nodePresets = loadPresets("mesh").filter((p) => used.has(p.id));
          return { settings, nodes: nodes.map((n) => ({ ...n })), ...(preset ? { preset } : {}), ...(nodePresets.length ? { nodePresets } : {}) };
        },
        // Opens a plan: its settings, nodes and presets.
        applyPlan: (plan) => {
          // A plan's preset joins this device's presets (once), so its ladder and hop limit apply here too.
          const settingsHere = { ...plan.settings, preset: plan.preset ? adoptPreset(plan.preset, "mesh") : "" };
          fillPresetOptions();
          applySettings(form, settingsHere);
          syncPresetUi();
          // Node presets join this device's too; nodes are pointed at their ids here.
          const ids = new Map((plan.nodePresets ?? []).map((p) => [p.id, adoptPreset(p, "mesh")]));
          nodes = (plan.nodes ?? []).map((n) => ({ ...n, ...(n.preset && n.preset !== "custom" ? { preset: ids.get(n.preset) ?? "" } : {}) }));
          nodesChanged();
        },
        // The mesh as a KMZ: each node and each link line, rated.
        buildExport: (name) => {
          if (!nodes.length) return "Add some nodes first.";
          const kml = buildKml(
            name,
            nodes.map((n, i) => ({ name: nodeName(i), lat: n.lat, lon: n.lon })),
            lastLinks
              .filter((r) => r.a < nodes.length && r.b < nodes.length)
              .map((r) => ({
                name: `${nodeName(r.a)} to ${nodeName(r.b)}`,
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
          return { name: fileName(name, "kmz"), data: new Uint8Array(kmz) };
        },
        // The nodes, as markers for a TAK data package.
        markers: () => nodes.map((n, i) => ({ name: nodeName(i), lat: n.lat, lon: n.lon, description: "Mesh node, from RF Toolkit" })),
        onImport: (points) => {
          const room = MAX_NODES - nodes.length;
          const added = points.slice(0, room);
          if (!added.length) return `No room for more nodes (up to ${MAX_NODES}). Remove one first.`;
          nodes.push(...added.map((p) => ({ lat: p.lat, lon: p.lon, name: p.name, height: "" })));
          nodesChanged();
          const left = points.length - added.length;
          return `Added ${added.length} node${added.length === 1 ? "" : "s"} from the file${left ? `; ${left} more didn't fit (up to ${MAX_NODES})` : ""}.`;
        },
      }),
    );
    enhanceFields(form, meshGuide, settingDefaults);
    moveModeBar(form);
    setupMapFirst(form, { panesKey: PANES_KEY, sidesKey: SIDES_KEY, rightName: "mesh results" });
    // Opens the profile for a link tapped in the table, or closes it on a second tap.
    const pickRow = (tr: HTMLTableRowElement | null) => {
      if (!tr?.dataset.a) return;
      const a = nodes[Number(tr.dataset.a)];
      const b = nodes[Number(tr.dataset.b)];
      // A second tap on the open link closes it.
      selected = selected && selected[0] === a && selected[1] === b ? undefined : [a, b];
      showSelected();
      if (selected) requestAnimationFrame(() => showLinkOnMap(a, b));
      // In the card, below the table: bring it into view.
      if (selected && out("profileDock").classList.contains("inline")) out("profileDock").scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    /** Frame a link in the part of the map the panes and the dock leave open. */
    const showLinkOnMap = (a: MeshNode, b: MeshNode) => {
      if (!map) return;
      const box = map.getContainer().getBoundingClientRect();
      // The box a floating pane covers on the map, or nothing when it isn't floating there.
      const covered = (el: HTMLElement | null) =>
        el && el.offsetWidth && getComputedStyle(el).position === "absolute" ? el.getBoundingClientRect() : undefined;
      const left = covered(form.querySelector<HTMLElement>(".lb-left"));
      const right = covered(form.querySelector<HTMLElement>(".lb-right"));
      const tops = [covered(out("profileDock"))?.top, form.querySelector<HTMLElement>(".map-taskbar")?.getBoundingClientRect().top]
        .filter((t): t is number => t !== undefined && t > box.top);
      const bottom = tops.length ? box.bottom - Math.min(...tops) : 0;
      const bounds = L.latLngBounds([[a.lat, a.lon], [b.lat, b.lon]]);
      map.fitBounds(bounds, {
        paddingTopLeft: [40 + (left ? left.right - box.left : 0), 40],
        paddingBottomRight: [40 + (right ? box.right - right.left : 0), 40 + bottom],
        maxZoom: Math.max(map.getZoom(), 10),
      });
    };
    out("links").addEventListener("click", (e) => pickRow((e.target as HTMLElement).closest("tr")));
    out("links").addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      pickRow((e.target as HTMLElement).closest("tr"));
    });
    form.querySelector('[data-action="closeProfile"]')!.addEventListener("click", () => {
      selected = undefined;
      showSelected();
    });
    // Wide screens: docked under the map between the panes. Narrower: in the Mesh card.
    const shell = form.querySelector<HTMLElement>(".lb-shell")!;
    const dock = out("profileDock");
    const wide = window.matchMedia("(min-width: 1300px)");
    // Moves the profile between the dock under the map (wide screens) and the Mesh card (narrower).
    const placeDock = () => {
      if (wide.matches) shell.append(dock);
      else out("results").append(dock);
      dock.classList.toggle("inline", !wide.matches);
      showSelected();
    };
    wide.addEventListener("change", placeDock);
    let dockWidth = 0;
    new ResizeObserver(() => {
      shell.style.setProperty("--dock-h", dock.hidden || !wide.matches ? "0px" : `${dock.offsetHeight + 14}px`);
      if (!dock.hidden && dock.offsetWidth !== dockWidth) {
        dockWidth = dock.offsetWidth;
        showSelected();
      }
    }).observe(dock);
    placeDock();
    // Climate and ground type are global: shown here, kept in Settings, so a
    // change here applies on every tab.
    const climateSel = field("climate") as HTMLSelectElement;
    const groundSel = field("ground") as HTMLSelectElement;
    climateSel.value = getSettings().climate;
    groundSel.value = getSettings().ground;
    for (const sel of [climateSel, groundSel]) {
      sel.addEventListener("change", () => {
        setSettings({ ...getSettings(), climate: climateSel.value, ground: groundSel.value });
        recompute();
      });
    }
    return form;
  },
};
