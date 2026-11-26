import { escapeHtml } from "../lib/html";
import { rfIcon } from "../ui/rfIcons";
// Coverage Analysis: shade the area one or more sites can reach, over terrain,
// on the map. With several sites, each point is shaded for the site that
// serves it best.

import { enhanceFields } from "./fieldHelp";
import { locateButton, locateMe } from "./locate";
import { coverageGuide } from "./helpText";
import * as L from "leaflet";
import { type ClearControl, type Control3D, add3DControl, addClearControl, createMap, showDefaultView, DATA_ATTRIBUTION } from "./mapKit";
import type { Calculator } from ".";
import { coordPlaceholder, formatCoordinates, parseCoordinates } from "../lib/coords";
import {
  type RadialSamples,
  type SiteMargins,
  bestSite,
  combinedStats,
  coveragePathLoss,
  coveragePatternLoss,
  coverageStats,
  marginAt,
  marginsFromLoss,
  sampleRadials,
  siteMarginsAt,
  sumGrids,
  unionBounds,
} from "../lib/coverage";
import { type Beam, beam, patterns } from "../lib/pattern";
import { type PlanNode, sanitizePlan } from "../lib/plans";
import { AUTO_ENVIRONMENT, LandCoverGrid, type LandCoverPoint } from "../lib/landCover";
import { loadLandCover } from "./landCoverTiles";
import { type LatLon, bearingDeg, destinationPoint, distanceBetweenM } from "../lib/geo";
import { EARTH_RADIUS_M } from "../lib/horizon";
import { compassPoint } from "../lib/satPointing";
import { ElevationGrid, chooseZoom, tilesCovering } from "../lib/terrainTiles";
import { type OverlayBounds, buildOverlayKml, buildZip, fileName } from "../lib/export";
import { type Environment, clutterLossDb, effectiveHeightM, findEnvironment } from "../lib/environment";
import { applySettings, createPlanCard, pngBytes } from "./planBar";
import { PANE_ICONS, moveModeBar, pane, setupMapFirst, sideToggles } from "./mapFirst";
import { RADIO_FILE, radioIconFile, radioMarker } from "./radioIcon";
import { bindTreeField, environmentOptions, treeHeightFieldHtml, withFormTrees } from "./environmentField";
import { globalK, readModel } from "./modelFields";
import { climates, grounds } from "../lib/propagation";
import { tabStateToSave, tabValues } from "../lib/appSettings";
import { deratedSensitivity, fallbackEnvironment, getSettings, setSettings, sharedFields } from "./settingsStore";
import { loadTiles } from "./tileElevation";
import type { EditField } from "../lib/scene3d";
import { type RadioPreset, type Rung, formatRate, ladder, rateAt } from "../lib/radioPresets";
import { PRESETS_EVENT, adoptPreset, loadPresets, openPresetManager, presetsEventFor } from "./presetManager";
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

const STORAGE_KEY = "rf-toolkit:coverage";
// Cards start closed; these remember which are open and which side panes are folded.
const PANES_KEY = "rf-toolkit:coverage-panes";
const SIDES_KEY = "rf-toolkit:coverage-sides";

// The built-in defaults from before Settings existed. Settings now override the
// fields they cover; these still fill the rest and recognise untouched old saves.
const legacyDefaults: Record<string, string> = {
  sitePreset: "",
  rxPreset: "",
  siteName: "",
  site: "",
  freq: "915",
  freqUnit: "MHz",
  power: "1",
  powerUnit: "W",
  txGain: "3",
  txPattern: "omni",
  txAzimuth: "0",
  txTilt: "0",
  txCable: "1",
  txHeight: "30",
  rxHeight: "5",
  heightUnit: "ft",
  rxGain: "2",
  rxCable: "0",
  sens: "-100",
  siteSens: "-100",
  rxPower: "1",
  rxPowerUnit: "W",
  fade: "10",
  environment: "none",
  treeHeight: "",
  radius: "6",
  radiusUnit: "mi",
  detail: "standard",
};

const detailLevels: Record<string, { radials: number; steps: number; label: string }> = {
  quick: { radials: 72, steps: 80, label: "Quick (5° steps)" },
  standard: { radials: 120, steps: 120, label: "Standard (3° steps)" },
  fine: { radials: 240, steps: 160, label: "Fine (1.5° steps)" },
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
  <div class="lb-shell floating">
  ${sideToggles("coverage results")}
  <div class="lb-left">
    ${pane("tx", "tx", "Site A", `
      <div class="fields">
        <label class="wide">Radio
          <span class="preset-pick">
            <select name="sitePreset"></select>
            <button type="button" class="secondary" data-action="presets">Manage presets</button>
          </span>
        </label>
        <label>Name
          <input name="siteName" type="text" autocomplete="off" maxlength="40" placeholder="Site A" />
        </label>
        <label>Location
          <span class="input-unit">
            <input name="site" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" />
            ${locateButton('data-action="locate"')}
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
        ${numberField("Antenna gain", "txGain", "dBi")}
        <label>Antenna pattern
          <select name="txPattern">${patterns.map((p) => `<option value="${p.id}">${p.name}</option>`).join("")}</select>
        </label>
        <label data-show="txAim">Antenna points
          <span class="input-unit">
            <input name="txAzimuth" type="number" inputmode="decimal" step="any" min="0" max="360" />
            <span class="unit">° true</span>
          </span>
        </label>
        ${numberField("Downtilt", "txTilt", "°", 'min="-30" max="30"')}
        ${numberField("Cable loss", "txCable", "dB", 'min="0"')}
        <label>Antenna height
          <span class="input-unit">
            <input name="txHeight" type="number" inputmode="decimal" step="any" min="0" />
            <select name="heightUnit"><option>ft</option><option>m</option></select>
          </span>
        </label>
        ${numberField("RX sensitivity", "siteSens", "dBm")}
      </div>`)}

    ${pane("rx", "rx", "Site B", `
      <div class="fields">
        <label class="wide">Radio
          <select name="rxPreset"></select>
        </label>
        ${numberField("Antenna height", "rxHeight", "", 'min="0" title="About 5 ft for a handheld, 8 ft on a vehicle"')}
        ${numberField("Antenna gain", "rxGain", "dBi")}
        ${numberField("Cable loss", "rxCable", "dB", 'min="0"')}
        <label>TX power
          <span class="input-unit">
            <input name="rxPower" type="number" inputmode="decimal" step="any" />
            <select name="rxPowerUnit">${powerUnits.map((u) => `<option>${u}</option>`).join("")}</select>
          </span>
        </label>
        ${numberField("RX sensitivity", "sens", "dBm")}
        ${numberField("Fade margin wanted", "fade", "dB", 'min="0"')}
      </div>`)}

    ${pane("sites", "sites", "More sites", `
      <div class="extra-sites" data-out="extraSites"></div>
      <div class="add-site-row">
        <button type="button" class="secondary" data-action="addSite">Add site</button>
        <span class="note" data-out="addNote"></span>
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
    <div class="map coverage-map" data-out="map"></div>
    <div class="map-legend">
      <div class="legend coverage-legend">
        <span class="key"><span class="sw cov-strong"></span>Strong</span>
        <span class="key"><span class="sw cov-solid"></span>Good</span>
        <span class="key"><span class="sw cov-marginal"></span>Marginal</span>
      </div>
    </div>
  </div>

  <aside class="results lb-right">
    <section class="card">
      <div class="card-head">
        <h2 class="with-icon">${PANE_ICONS.mapping}Coverage</h2>
        <span class="pill" data-out="pill" hidden></span>
        <button type="button" class="secondary" data-action="reset">Reset</button>
      </div>
      <div class="fields run-fields">
        <label>Radius
          <span class="input-unit">
            <input name="radius" type="number" inputmode="decimal" step="any" min="0.5" max="80" />
            <select name="radiusUnit"><option>mi</option><option>km</option></select>
          </span>
        </label>
        <label>Detail
          <select name="detail">${Object.entries(detailLevels).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("")}</select>
        </label>
      </div>
      <div class="run-row">
        <button type="button" data-action="run">Run coverage analysis</button>
        <span class="note" data-out="status"></span>
      </div>
      <p class="note" data-out="empty">Place Site A, set the radius and run the analysis.</p>
      <p class="callout" data-out="stale" hidden>A site, the radius or the detail changed. Run the coverage analysis to update.</p>
      <div data-out="results" hidden>
        <div class="tiles">
          <div class="tile"><span class="label">Good coverage</span><span class="value" data-out="solid"></span><span class="sub" data-out="solidSub"></span></div>
          <div class="tile"><span class="label">Marginal</span><span class="value" data-out="marginal"></span><span class="sub">Connects, under the fade margin</span></div>
          <div class="tile wide-tile"><span class="label" data-out="farLabel">Farthest good point</span><span class="value" data-out="far"></span><span class="sub" data-out="farSub"></span></div>
        </div>
        <p class="note cov-key-note" data-out="keyNote"></p>
        <p class="note" data-out="dirNote" hidden></p>
      </div>
    </section>
  </aside>
  </div>
`;

/** The defaults now: the built-in ones, with Settings on top for everything Settings covers. */
function currentDefaults(): Record<string, string> {
  const s = sharedFields();
  return {
    ...legacyDefaults,
    // 50 MHz (low VHF) now; old saves left at the former 915 MHz follow it.
    freq: "50",
    freqUnit: "MHz",
    fade: s.fade,
    txGain: s.gain,
    rxGain: s.gain,
    txCable: s.cableAndConnectors,
    rxCable: s.cableAndConnectors,
    environment: s.environment,
    treeHeight: s.treeHeight,
    txHeight: s.height,
    rxHeight: s.height,
    heightUnit: s.heightUnit,
    radiusUnit: s.distanceUnit,
  };
}

function loadState(defaults: Record<string, string>): Record<string, string> {
  try {
    return tabValues(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"), defaults, legacyDefaults);
  } catch {
    return { ...defaults };
  }
}

const fmt = (v: number, digits = 1) =>
  v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace("-", "−");

/** "#0ca30c" or "rgb(...)" from a CSS custom property, as [r, g, b]. */
function cssColor(name: string): [number, number, number] {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  document.body.append(probe);
  const m = getComputedStyle(probe).color.match(/\d+/g) ?? ["0", "0", "0"];
  probe.remove();
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}



/** A site beyond Site A: where it is, its mast, its antenna and its radio. */
interface ExtraSite {
  name: string;
  lat: number;
  lon: number;
  /** Antenna height as typed, in the shared height unit; blank uses Site A's. */
  height: string;
  /** Antenna pattern id. */
  antenna: string;
  /** Degrees true the antenna points, as typed. */
  aim: string;
  /** Blank for Site A's radio, or a preset id. */
  preset: string;
}

const SITES_KEY = "rf-toolkit:coverage-sites";
/** Sites beyond Site A. Each adds its own terrain run. */
const MAX_EXTRA_SITES = 4;

function cleanExtras(raw: unknown): ExtraSite[] {
  const nodes = sanitizePlan({ settings: {}, nodes: raw }, [])?.nodes ?? [];
  return nodes.slice(0, MAX_EXTRA_SITES).map(toExtra);
}

const toExtra = (n: PlanNode): ExtraSite => ({
  name: n.name,
  lat: n.lat,
  lon: n.lon,
  height: n.height,
  antenna: n.antenna ?? "omni",
  aim: n.aim ?? "0",
  preset: n.preset ?? "",
});

function loadExtras(): ExtraSite[] {
  try {
    return cleanExtras(JSON.parse(localStorage.getItem(SITES_KEY) ?? "[]"));
  } catch {
    return [];
  }
}


/** One site's radio and antenna, ready for the math. */
interface SiteSpec {
  name: string;
  at: LatLon;
  heightM: number;
  beam: Beam;
  powerDbm: number;
  cableDb: number;
  gainDbi: number;
  /** The weakest signal the site's receiver uses, derated. */
  sensDbm: number;
  /** The site's rate ladder, derated; empty without one. */
  rungs: Rung[];
}

/** One site's terrain and the work that depends on it. */
interface SiteRun {
  at: LatLon;
  samples: RadialSamples;
  cover?: { site: LandCoverPoint; points: LandCoverPoint[][] };
  pathLoss?: { key: string; loss: Float32Array[] };
  patternLoss?: { key: string; loss: Float32Array[] | undefined };
  clutter?: { key: string; heights: Float32Array[]; loss: Float32Array[] };
  margins?: Float32Array[];
  /** What the shading added to the outbound margin: the weaker way. */
  offset: number;
  /** How much stronger Site B reaches this site than this site reaches Site B, dB. */
  delta: number;
}

export const coverageCalculator: Calculator = {
  id: "coverage",
  title: "VHF/UHF Coverage Analysis",
  shortTitle: "Coverage",
  render() {
    const form = document.createElement("form");
    const defaults = currentDefaults();
    form.className = "calculator coverage map-first";
    form.innerHTML = template;
    bindTreeField(form, "heightUnit");
    form.addEventListener("submit", (e) => e.preventDefault());

    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
    const out = (name: string) => form.querySelector<HTMLElement>(`[data-out="${name}"]`)!;
    const num = (name: string) => Number.parseFloat(field(name).value);

    // Radio presets: the user's own, from this device. Site B uses Site A's
    // radio unless another is picked, or user-defined numbers.
    const fillPresetOptions = () => {
      const presets = loadPresets("coverage");
      const fill = (name: string, first: HTMLOptionElement[], last: HTMLOptionElement[] = []) => {
        const select = field(name) as HTMLSelectElement;
        const keep = select.value;
        select.replaceChildren(...first, ...presets.map((p) => new Option(p.name, p.id)), ...last);
        select.value = [...select.options].some((o) => o.value === keep) ? keep : "";
      };
      fill("sitePreset", [new Option("User defined", "")]);
      fill("rxPreset", [new Option("Same as Site A", "")], [new Option("User defined", "custom")]);
    };
    fillPresetOptions();
    const sitePreset = (): RadioPreset | undefined => loadPresets("coverage").find((p) => p.id === field("sitePreset").value);
    const rxPreset = (): RadioPreset | undefined => {
      const v = field("rxPreset").value;
      if (v === "custom") return undefined;
      return v ? loadPresets("coverage").find((p) => p.id === v) : sitePreset();
    };
    /** Site B's rate ladder, derated, fastest first; empty without one. */
    const rungs = () => ladder(rxPreset(), deratedSensitivity);
    /** Site A's rate ladder, for Site B reaching it. */
    const siteRungs = () => ladder(sitePreset(), deratedSensitivity);
    const slowest = (r: Rung[]) => Math.min(...r.map((x) => x.sensDbm));
    /** Site B's sensitivity: its ladder's slowest rate, or the field. */
    const sensitivity = () => {
      const r = rungs();
      return r.length ? slowest(r) : deratedSensitivity(num("sens"));
    };
    /** Site A's sensitivity, the same way. */
    const siteSensitivity = () => {
      const r = siteRungs();
      return r.length ? slowest(r) : deratedSensitivity(num("siteSens"));
    };

    for (const [name, value] of Object.entries(loadState(defaults))) {
      const el = form.elements.namedItem(name);
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.value = value;
    }
    field("site").setAttribute("placeholder", coordPlaceholder());
    const savedSite = parseCoordinates(field("site").value);
    if (savedSite) field("site").value = formatCoordinates(savedSite);

    // Sites beyond Site A.
    let extras: ExtraSite[] = loadExtras();
    // The next map tap places a new site.
    let placing = false;

    const save = () => {
      const state: Record<string, string> = {};
      for (const name of Object.keys(defaults)) state[name] = field(name).value;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tabStateToSave(state, defaults)));
        localStorage.setItem(SITES_KEY, JSON.stringify(extras));
      } catch {
        // Storage blocked: settings just won't be remembered.
      }
    };
    const setStatus = (text: string, warn = false) => {
      out("status").textContent = text;
      out("status").classList.toggle("warn", warn);
    };
    const heightUnit = () => asDistanceUnit(field("heightUnit").value);
    const radiusM = () => toMetres(num("radius"), asDistanceUnit(field("radiusUnit").value));
    const site = () => parseCoordinates(field("site").value);
    const siteName = () => field("siteName").value.trim() || "Site A";
    const extraLabel = (i: number) => `Site A${i + 2}`;
    const extraName = (i: number) => extras[i]?.name.trim() || extraLabel(i);
    const txBeam = () => beam(field("txPattern").value, num("txGain") || 0, num("txAzimuth"), num("txTilt"));

    /** Every placed site's radio and antenna, Site A first. */
    const siteSpecs = (): SiteSpec[] => {
      const a = site();
      if (!a) return [];
      const A: SiteSpec = {
        name: siteName(),
        at: a,
        heightM: toMetres(num("txHeight") || 0, heightUnit()),
        beam: txBeam(),
        powerDbm: toDbm(num("power"), asPowerUnit(field("powerUnit").value)),
        cableDb: num("txCable") || 0,
        gainDbi: num("txGain") || 0,
        sensDbm: siteSensitivity(),
        rungs: siteRungs(),
      };
      const presets = loadPresets("coverage");
      const val = (v?: string) => {
        const x = Number.parseFloat(v ?? "");
        return Number.isFinite(x) ? x : undefined;
      };
      return [
        A,
        ...extras.map((e, i): SiteSpec => {
          // Its own preset where it has one; Site A's numbers for anything it leaves out.
          const p = e.preset ? presets.find((q) => q.id === e.preset) : undefined;
          const gain = val(p?.gain) ?? A.gainDbi;
          const own = p ? ladder(p, deratedSensitivity) : A.rungs;
          const presetSens = val(p?.sens);
          return {
            name: extraName(i),
            at: { lat: e.lat, lon: e.lon },
            heightM: val(e.height) !== undefined ? toMetres(val(e.height)!, heightUnit()) : A.heightM,
            beam: beam(e.antenna || "omni", gain, val(e.aim) ?? 0, 0),
            powerDbm: p?.power ? toDbm(Number(p.power), asPowerUnit(p.powerUnit ?? "W")) : A.powerDbm,
            cableDb: val(p?.cable) ?? A.cableDb,
            gainDbi: gain,
            sensDbm: own.length ? slowest(own) : presetSens !== undefined ? deratedSensitivity(presetSens) : A.sensDbm,
            rungs: own,
          };
        }),
      ];
    };
    const siteLocations = (): LatLon[] => {
      const a = site();
      return a ? [a, ...extras.map((e) => ({ lat: e.lat, lon: e.lon }))] : [];
    };

    let map: L.Map | undefined;
    let clearControl: ClearControl | undefined;
    let siteLayers: L.Layer[] = [];
    let rings: L.Circle[] = [];
    let overlay: L.ImageOverlay | undefined;
    let runs: SiteRun[] = [];
    let sampledFor = "";
    let view3d: Control3D | undefined;
    let running: AbortController | undefined;
    let lastOverlay: { url: string; bounds: OverlayBounds } | undefined;
    let runWhenReady = false;

    const autoCover = () => field("environment").value === AUTO_ENVIRONMENT;
    const sampleKey = () =>
      `${field("site").value}|${extras.map((e) => `${e.lat.toFixed(6)},${e.lon.toFixed(6)}`).join(";")}|${radiusM()}|${field("detail").value}|${autoCover()}`;
    const mapped = () => runs.length > 0 && runs.every((r) => r.margins) && sampledFor === sampleKey();

    // Pins, circles and aim lines for every site.
    const placeSites = (recenter: boolean) => {
      const title = form.querySelector('details[data-pane="tx"] .pane-title');
      if (title) title.textContent = siteName();
      const a = site();
      clearControl?.setVisible(!!a || runs.length > 0);
      if (!map) return;
      for (const layer of siteLayers) layer.remove();
      siteLayers = [];
      rings = [];
      const r = radiusM();
      const specs = siteSpecs();
      specs.forEach((spec, i) => {
        const tag = document.createElement("span");
        tag.textContent = spec.name; // user text
        const marker = L.marker([spec.at.lat, spec.at.lon], { icon: radioMarker("TX"), draggable: true }).addTo(map!);
        marker.bindTooltip(tag, { permanent: true, direction: "right", offset: [8, -16], className: "pin-name" });
        marker.on("dragend", () => {
          const q = marker.getLatLng();
          moveSite(i, { lat: q.lat, lon: q.lng });
          inputsChanged();
        });
        siteLayers.push(marker);
        if (spec.beam.pattern.id !== "omni" && r > 0) {
          const tip = destinationPoint(spec.at, spec.beam.azimuthDeg, r);
          siteLayers.push(L.polyline([[spec.at.lat, spec.at.lon], [tip.lat, tip.lon]], { className: "coverage-aim", interactive: false }).addTo(map!));
        }
        if (r > 0) {
          const ring = L.circle([spec.at.lat, spec.at.lon], { radius: r, className: "coverage-ring", interactive: false }).addTo(map!);
          rings.push(ring);
          siteLayers.push(ring);
        }
      });
      if (recenter && rings.length) {
        const bounds = rings[0].getBounds();
        for (const ring of rings.slice(1)) bounds.extend(ring.getBounds());
        map.fitBounds(bounds, { padding: [10, 10] });
      }
      view3d?.refresh();
    };
    /** Site i (0 is Site A) moved to q. */
    const moveSite = (i: number, q: LatLon) => {
      if (i === 0) field("site").value = formatCoordinates(q);
      else if (extras[i - 1]) {
        extras[i - 1].lat = q.lat;
        extras[i - 1].lon = q.lon;
        renderExtras();
      }
    };

    const syncPattern = () => {
      form.querySelector<HTMLElement>('[data-show="txAim"]')!.hidden = field("txPattern").value === "omni";
    };

    const siteMargins = (): SiteMargins[] => runs.map((r) => ({ samples: r.samples, margins: r.margins! }));

    // Field readings aren't on this page: nothing taken from the map taps, and no correction.
    const readingsCard = { correctionDb: () => 0, refresh: () => {}, takeMapTap: (_p: LatLon) => false };

    const drawOverlay = () => {
      overlay?.remove();
      overlay = undefined;
      if (!map || !mapped()) return;
      const sites = siteMargins();
      const box = unionBounds(sites.map((s) => s.samples));
      const fade = num("fade") || 0;
      const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M;
      const midLat = (box.north + box.south) / 2;
      // The canvas keeps the area's true shape, 640 pixels on the long side.
      const heightM = (box.north - box.south) * mPerDegLat;
      const widthM = (box.east - box.west) * mPerDegLat * Math.cos((midLat * Math.PI) / 180);
      const w = widthM >= heightM ? 640 : Math.max(64, Math.round((640 * widthM) / heightM));
      const h = heightM >= widthM ? 640 : Math.max(64, Math.round((640 * heightM) / widthM));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      const img = ctx.createImageData(w, h);
      const strong = cssColor("--good");
      const solid = cssColor("--good");
      const marginal = cssColor("--warning");
      for (let j = 0; j < h; j++) {
        const lat = box.north - ((j + 0.5) / h) * (box.north - box.south);
        const mPerDegLon = mPerDegLat * Math.cos((lat * Math.PI) / 180);
        for (let i = 0; i < w; i++) {
          const lon = box.west + ((i + 0.5) / w) * (box.east - box.west);
          // The best site here: the map is shaded for whichever serves it best.
          let v = Number.NaN;
          for (const s of sites) {
            const x = (lon - s.samples.site.lon) * mPerDegLon;
            const y = (lat - s.samples.site.lat) * mPerDegLat;
            const d = Math.hypot(x, y);
            if (d > s.samples.radiusM) continue;
            const m = marginAt(s.samples, s.margins, (Math.atan2(x, y) * 180) / Math.PI, d);
            if (!(m <= v)) v = m;
          }
          if (!(v >= 0)) continue;
          const [c, alpha] = v >= fade + 10 ? [strong, 165] : v >= fade ? [solid, 105] : [marginal, 120];
          const o = (j * w + i) * 4;
          img.data[o] = c[0];
          img.data[o + 1] = c[1];
          img.data[o + 2] = c[2];
          img.data[o + 3] = alpha;
        }
      }
      ctx.putImageData(img, 0, 0);
      const url = canvas.toDataURL();
      lastOverlay = { url, bounds: box };
      overlay = L.imageOverlay(url, [
        [box.south, box.west],
        [box.north, box.east],
      ], { interactive: false, className: "coverage-overlay" }).addTo(map);
      for (const ring of rings) ring.bringToFront();
      view3d?.refresh();
    };

    // Which way the shading is for at each site, and how far apart the two ways are.
    const syncDirectionNote = (specs: SiteSpec[]) => {
      const note = out("dirNote");
      const apart = specs.map((s, i) => ({ name: s.name, d: runs[i]?.delta ?? 0 })).filter((x) => Number.isFinite(x.d) && Math.abs(x.d) >= 0.1);
      // Only when the two ways differ: which way limits, and by how much.
      let text = "";
      if (apart.length === 1 && specs.length === 1) {
        text = apart[0].d < 0 ? `Shaded for the weaker way, back to Site A: ${fmt(-apart[0].d)} dB less.` : `Shaded for the weaker way, out to Site B: ${fmt(apart[0].d)} dB less.`;
      } else if (apart.length === specs.length && apart.every((x) => Math.abs(x.d - apart[0].d) < 0.05)) {
        // Every site the same: say it once.
        text = apart[0].d < 0 ? `Shaded for the weaker way, back to the sites: ${fmt(-apart[0].d)} dB less.` : `Shaded for the weaker way, out to Site B: ${fmt(apart[0].d)} dB less.`;
      } else if (apart.length) {
        text = `Shaded for the weaker way at each site (${apart.map((x) => `${x.name} ${fmt(Math.abs(x.d))} dB`).join(", ")}).`;
      }
      note.textContent = text;
      note.hidden = !text;
    };

    const recompute = () => {
      const ready = runs.length > 0 && sampledFor === sampleKey();
      out("stale").hidden = runs.length === 0 || ready;
      out("results").hidden = !ready;
      out("pill").hidden = !ready;
      out("empty").hidden = runs.length > 0;
      if (!ready) {
        overlay?.remove();
        overlay = undefined;
        readingsCard.refresh();
        view3d?.refresh();
        return;
      }
      const specs = siteSpecs();
      if (specs.length !== runs.length) return;
      const freqHz = toHz(num("freq"), asFrequencyUnit(field("freqUnit").value));
      const rxSens = sensitivity();
      const rxPowerDbm = toDbm(num("rxPower"), asPowerUnit(field("rxPowerUnit").value));
      const rxGainDbi = num("rxGain") || 0;
      const rxCableLossDb = num("rxCable") || 0;
      if (!(freqHz > 0) || !Number.isFinite(rxSens)) return;
      const trees = (e: Environment) => withFormTrees(form, "heightUnit", e);
      // Where the land-cover map has no data yet, the Settings fallback stands in.
      const env = trees(autoCover() ? fallbackEnvironment() : findEnvironment(field("environment").value));
      const rxH = toMetres(num("rxHeight") || 0, heightUnit());
      const model = readModel(form);
      const correction = readingsCard.correctionDb();
      // Each site's margins, from its own terrain, antenna and radio. The
      // terrain work only reruns when what it depends on changes.
      const next: { margins: Float32Array[]; offset: number; delta: number }[] = [];
      for (const [i, spec] of specs.entries()) {
        const run = runs[i];
        const eirpDbm = spec.powerDbm - spec.cableDb + spec.gainDbi;
        // The path is the same both ways: only power and sensitivity differ.
        const delta = rxPowerDbm - spec.powerDbm + rxSens - spec.sensDbm;
        if (!Number.isFinite(eirpDbm) || !Number.isFinite(delta)) return;
        const txH = spec.heightM;
        const lc = autoCover() ? run.cover : undefined;
        const siteEnv = lc ? trees(lc.site.environment) : env;
        const clutterKey = JSON.stringify([freqHz, rxH, field("treeHeight").value, heightUnit()]);
        if (lc && run.clutter?.key !== clutterKey) {
          const at = (rr: number, k: number) => trees(lc.points[rr][k].environment);
          run.clutter = {
            key: clutterKey,
            heights: run.samples.elevations.map((e, rr) => e.map((_, k) => effectiveHeightM(at(rr, k), rxH))),
            loss: run.samples.elevations.map((e, rr) => e.map((_, k) => (k === 0 ? 0 : clutterLossDb(at(rr, k), freqHz, rxH)))),
          };
        }
        const pathTxH = effectiveHeightM(siteEnv, txH);
        const pathRxH = lc ? run.clutter!.heights : effectiveHeightM(env, rxH);
        const lossKey = JSON.stringify([freqHz, pathTxH, lc ? `cover${rxH}` : pathRxH, model]);
        if (run.pathLoss?.key !== lossKey) run.pathLoss = { key: lossKey, loss: coveragePathLoss(run.samples, freqHz, pathTxH, pathRxH, model) };
        const b = spec.beam;
        const beamKey = JSON.stringify([b, txH, rxH]);
        if (run.patternLoss?.key !== beamKey) {
          // An omni at 0 dBi with no tilt has a 90° beam: not worth the grid.
          const flat = b.pattern.id === "omni" && b.downtiltDeg === 0 && b.vBeamwidthDeg >= 90;
          run.patternLoss = { key: beamKey, loss: flat ? undefined : coveragePatternLoss(run.samples, b, txH, rxH) };
        }
        const offset = Math.min(0, delta);
        next.push({
          offset,
          delta,
          margins: marginsFromLoss(
            run.pathLoss.loss,
            {
              eirpDbm: eirpDbm + correction + offset,
              rxGainDbi,
              rxCableLossDb,
              sensitivityDbm: rxSens,
              clutterLossDb: clutterLossDb(siteEnv, freqHz, txH) + (lc ? 0 : clutterLossDb(env, freqHz, rxH)),
            },
            sumGrids(run.patternLoss.loss, lc ? run.clutter!.loss : undefined),
          ),
        });
      }
      next.forEach((n, i) => Object.assign(runs[i], n));
      syncDirectionNote(specs);

      const first = runs[0];

      const fade = num("fade") || 0;
      const unit: DistanceUnit = field("radiusUnit").value === "mi" ? "mi" : "km";
      const pill = out("pill");
      let solid: number;
      let reach: number;
      if (runs.length === 1) {
        const stats = coverageStats(first.samples, first.margins!, fade);
        solid = stats.solid;
        reach = stats.solid + stats.marginal;
        out("marginal").textContent = `${fmt(stats.marginal * 100, 0)}%`;
        out("solidSub").textContent = `of the ${fmt(fromMetres(first.samples.radiusM, unit), 1)} ${unit} circle`;
        out("farLabel").textContent = "Farthest good point";
        out("far").textContent = stats.farthestSolidM ? `${fmt(fromMetres(stats.farthestSolidM, unit))} ${unit}` : "—";
        out("farSub").textContent = stats.farthestSolidM
          ? `Toward ${Math.round(stats.farthestSolidBearing)}° ${compassPoint(stats.farthestSolidBearing)}`
          : "Nowhere meets the fade margin";
      } else {
        const stats = combinedStats(siteMargins(), fade);
        solid = stats.solid;
        reach = stats.solid + stats.marginal;
        out("marginal").textContent = `${fmt(stats.marginal * 100, 0)}%`;
        out("solidSub").textContent = `of the area inside the ${runs.length} sites' circles`;
        out("farLabel").textContent = "Covered by 2+ sites";
        out("far").textContent = `${fmt(stats.redundant * 100, 0)}%`;
        out("farSub").textContent = "Meets the fade margin from more than one site";
      }
      // Rated on what meets the fade margin; reachable includes the marginal fringe.
      pill.className = `pill ${solid >= 0.6 ? "s-good" : solid >= 0.2 ? "s-marginal" : "s-fail"}`;
      pill.textContent = `${fmt(solid * 100, 0)}% good · ${fmt(reach * 100, 0)}% reachable`;
      out("keyNote").textContent = `Strong: ${fmt(fade + 10, 0)} dB+ margin. Good: ${fmt(fade, 0)} dB+, your fade margin. Marginal: connects, under ${fmt(fade, 0)} dB.`;
      out("solid").textContent = `${fmt(solid * 100, 0)}%`;
      drawOverlay();
      readingsCard.refresh();
    };

    const run = async () => {
      const p = site();
      const r = radiusM();
      if (!p) {
        setStatus("Place Site A first.", true);
        return;
      }
      if (!(r >= 500 && r <= 80_000)) {
        setStatus("Pick a radius between 0.5 and 80 km (50 mi).", true);
        return;
      }
      running?.abort();
      const controller = new AbortController();
      running = controller;
      const detail = detailLevels[field("detail").value] ?? detailLevels.standard;
      const locations = siteLocations();
      // One zoom for every site, so they share tiles where their circles overlap.
      const z = chooseZoom(p, r, 36);
      const seen = new Set<string>();
      const tiles = locations.flatMap((at) => tilesCovering(at, r, z)).filter((t) => {
        const key = `${t.x}/${t.y}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const grid = new ElevationGrid(z);
      setStatus(`Loading terrain 0 of ${tiles.length}…`);
      try {
        await loadTiles(tiles, grid, {
          signal: controller.signal,
          onProgress: (done, total) => setStatus(`Loading terrain ${done} of ${total}…`),
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        setStatus(
          navigator.onLine ? `Couldn't load terrain: ${(err as Error).message}` : "No connection, and this area's terrain isn't saved yet.",
          true,
        );
        return;
      }
      if (controller.signal.aborted) return;
      let coverGrid: LandCoverGrid | undefined;
      if (autoCover()) {
        coverGrid = new LandCoverGrid(z);
        try {
          await loadLandCover(tiles, coverGrid, {
            signal: controller.signal,
            onProgress: (done, total) => setStatus(`Loading land cover ${done} of ${total}…`),
          });
        } catch (err) {
          if (controller.signal.aborted) return;
          coverGrid = undefined;
        }
      }
      if (controller.signal.aborted) return;
      setStatus(locations.length > 1 ? `Calculating ${locations.length} sites…` : "Calculating…");
      // Let the status paint before the heavy loop.
      await new Promise((resolve) => setTimeout(resolve, 30));
      runs = locations.map((at): SiteRun => {
        // Sea-floor depths become sea level: the signal crosses the water surface.
        const s = sampleRadials(at, r, detail.radials, detail.steps, (q) => Math.max(0, grid.sample(q)));
        const g = coverGrid;
        return {
          at,
          samples: s,
          offset: 0,
          delta: 0,
          ...(g
            ? { cover: { site: g.at(at), points: s.bearings.map((b, rr) => Array.from({ length: s.elevations[rr].length }, (_, k) => g.at(k === 0 ? at : destinationPoint(at, b, k * s.stepM)))) } }
            : {}),
        };
      });
      sampledFor = sampleKey();
      recompute();
      setStatus("");
    };

    const inputsChanged = () => {
      save();
      syncPattern();
      placeSites(false);
      recompute();
    };

    // The rows for sites beyond Site A.
    const renderExtras = () => {
      const presets = loadPresets("coverage");
      const unit = field("heightUnit").value;
      out("extraSites").replaceChildren(
        ...extras.map((e, i) => {
          const row = document.createElement("div");
          row.className = "extra-site";
          row.innerHTML = `
            <div class="extra-site-head"><b></b><button type="button" class="secondary icon-btn" data-k="remove">${rfIcon("close")}</button></div>
            <div class="fields">
              <label>Name<input data-k="name" type="text" maxlength="40" autocomplete="off" /></label>
              <label>Location<input data-k="loc" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" /></label>
              <label>Antenna height<span class="input-unit"><input data-k="height" type="number" inputmode="decimal" step="any" min="0" /><span class="unit"></span></span></label>
              <label>Radio<select data-k="preset"></select></label>
              <label>Antenna pattern<select data-k="antenna">${patterns.map((p) => `<option value="${p.id}">${p.name}</option>`).join("")}</select></label>
              <label data-k="aimRow">Antenna points<span class="input-unit"><input data-k="aim" type="number" inputmode="decimal" step="any" min="0" max="360" /><span class="unit">° true</span></span></label>
            </div>`;
          const q = <T extends HTMLElement>(k: string) => row.querySelector<T>(`[data-k="${k}"]`)!;
          row.querySelector("b")!.textContent = extraLabel(i);
          q("remove").setAttribute("aria-label", `Remove ${extraName(i)}`); // user text, as an attribute
          const name = q<HTMLInputElement>("name");
          name.value = e.name;
          name.placeholder = extraLabel(i);
          const loc = q<HTMLInputElement>("loc");
          loc.value = formatCoordinates({ lat: e.lat, lon: e.lon });
          const height = q<HTMLInputElement>("height");
          height.value = e.height;
          height.placeholder = field("txHeight").value;
          row.querySelector<HTMLElement>('[data-k="height"] + .unit')!.textContent = unit;
          const preset = q<HTMLSelectElement>("preset");
          preset.replaceChildren(new Option("Same as Site A", ""), ...presets.map((p) => new Option(p.name, p.id)));
          preset.value = presets.some((p) => p.id === e.preset) ? e.preset : "";
          const antenna = q<HTMLSelectElement>("antenna");
          antenna.value = e.antenna;
          const aim = q<HTMLInputElement>("aim");
          aim.value = e.aim;
          q("aimRow").hidden = e.antenna === "omni";
          // These fields aren't the page's own: handle them here, not in the form's listeners.
          for (const type of ["input", "change"]) row.addEventListener(type, (ev) => ev.stopPropagation());
          name.addEventListener("input", () => {
            e.name = name.value;
            save();
            placeSites(false);
          });
          loc.addEventListener("change", () => {
            const at = parseCoordinates(loc.value);
            if (!at) {
              setStatus("That location wasn't understood. Use decimal degrees like 35.22710, -80.84310, or MGRS.", true);
              return;
            }
            e.lat = at.lat;
            e.lon = at.lon;
            loc.value = formatCoordinates(at);
            setStatus("");
            inputsChanged();
            placeSites(true);
          });
          const live = (input: HTMLInputElement | HTMLSelectElement, set: (v: string) => void) =>
            input.addEventListener(input instanceof HTMLSelectElement ? "change" : "input", () => {
              set(input.value);
              q("aimRow").hidden = e.antenna === "omni";
              inputsChanged();
            });
          live(height, (v) => (e.height = v));
          live(preset, (v) => (e.preset = v));
          live(antenna, (v) => (e.antenna = v));
          live(aim, (v) => (e.aim = v));
          q("remove").addEventListener("click", () => {
            extras.splice(i, 1);
            renderExtras();
            inputsChanged();
          });
          return row;
        }),
      );
      const add = form.querySelector<HTMLButtonElement>('[data-action="addSite"]')!;
      add.disabled = extras.length >= MAX_EXTRA_SITES;
      add.textContent = placing ? "Cancel" : "Add site";
      out("addNote").textContent = placing
        ? `Tap the map to place ${extraLabel(extras.length)}.`
        : extras.length >= MAX_EXTRA_SITES
          ? `Up to ${MAX_EXTRA_SITES + 1} sites in all.`
          : "";
    };
    form.querySelector('[data-action="addSite"]')!.addEventListener("click", () => {
      if (!placing && !site()) {
        setStatus("Place Site A first.", true);
        return;
      }
      placing = !placing && extras.length < MAX_EXTRA_SITES;
      renderExtras();
      if (placing) out("map").scrollIntoView({ block: "nearest", behavior: "smooth" });
    });

    // Remove every site, their circles and the coverage, so a tap places a new
    // Site A. Radio and antenna settings stay.
    const clearCoverage = () => {
      running?.abort();
      running = undefined;
      runs = [];
      sampledFor = "";
      lastOverlay = undefined;
      map?.closePopup();
      field("site").value = "";
      extras = [];
      placing = false;
      renderExtras();
      setStatus("");
      inputsChanged();
    };

    const initMap = () => {
      if (map || !form.isConnected) return;
      const p = site();
      map = createMap(out("map"), (m) => {
        // Frame the coverage circles, or the site, or the default view.
        const here = site();
        if (rings.length) {
          const bounds = rings[0].getBounds();
          for (const ring of rings.slice(1)) bounds.extend(ring.getBounds());
          m.fitBounds(bounds, { padding: [10, 10] });
        } else if (here) m.setView([here.lat, here.lon], 11);
        else showDefaultView(m);
      }, { taskbar: true });
      map.attributionControl.addAttribution(DATA_ATTRIBUTION);
      clearControl = addClearControl(map, "the sites and coverage", clearCoverage);
      // A field the Radios card shows (not set by a preset, or unused).
      const shown = (name: string) => !field(name).closest("label")!.hidden;
      // What the 3D view's editor shows for Site A, by field name.
      const siteFields = (p: LatLon): EditField[] => {
        const f = (key: string, label: string, unit?: string, type: EditField["type"] = "number"): EditField => ({ key, label, value: field(key).value, unit, type });
        const fields = [
          f("siteName", "Name", undefined, "text"),
          ...(shown("power") ? [f("power", "TX power", field("powerUnit").value)] : []),
          ...(shown("txGain") ? [f("txGain", "Antenna gain", "dBi")] : []),
          { ...f("txPattern", "Antenna pattern", undefined, "select"), options: patterns.map((q) => ({ value: q.id, label: q.name })) },
          ...(field("txPattern").value === "omni" ? [] : [f("txAzimuth", "Points", "° true")]),
          f("txHeight", "Antenna height", field("heightUnit").value),
          ...(shown("siteSens") ? [f("siteSens", "RX sensitivity", "dBm")] : []),
          ...(shown("sens") ? [f("sens", "Site B RX sensitivity", "dBm")] : []),
          f("radius", "Radius", field("radiusUnit").value),
        ];
        return [...fields, { key: "location", label: "Location", value: formatCoordinates(p), type: "text" }];
      };
      // And for the other sites.
      const extraFields = (i: number): EditField[] => {
        const e = extras[i];
        return [
          { key: "name", label: "Name", value: e.name, type: "text", placeholder: extraLabel(i) },
          { key: "antenna", label: "Antenna pattern", value: e.antenna, type: "select", options: patterns.map((q) => ({ value: q.id, label: q.name })) },
          ...(e.antenna === "omni" ? [] : [{ key: "aim", label: "Points", value: e.aim, unit: "° true", type: "number" as const }]),
          { key: "height", label: "Antenna height", value: e.height, unit: field("heightUnit").value, type: "number", placeholder: field("txHeight").value },
          { key: "location", label: "Location", value: formatCoordinates({ lat: e.lat, lon: e.lon }), type: "text" },
        ];
      };
      // Mapping again after a 3D change, so the shading there matches it.
      const remap = () => {
        setStatus("");
        inputsChanged();
        if (site()) void run();
      };
      view3d = add3DControl(map, () => {
        const p = site();
        const r = radiusM();
        const specs = siteSpecs();
        return {
          title: "VHF/UHF Coverage Analysis",
          points: specs.map((s, i) => ({ ...s.at, label: s.name, heightM: s.heightM, fields: i === 0 ? siteFields(s.at) : extraFields(i - 1) })),
          links: [],
          // Only shading that matches the current settings, as on this map.
          overlay: overlay && lastOverlay ? lastOverlay : undefined,
          ring: p && r > 0 && specs.length === 1 ? { center: p, radiusM: r } : undefined,
          k: globalK(),
          // Moving a site in 3D maps the coverage again straight away, so
          // there is something to see there.
          onMove: (i, q) => {
            moveSite(i, q);
            remap();
          },
          // The pop-up editor: changes land in the fields as if typed there.
          onEdit: (i, values) => {
            const { location, ...rest } = values;
            let at: LatLon | undefined;
            if (location !== undefined) {
              at = parseCoordinates(location);
              if (!at) setStatus("That location wasn't understood. Use decimal degrees like 35.22710, -80.84310, or MGRS.", true);
            }
            if (i === 0) {
              for (const [key, value] of Object.entries(rest)) field(key).value = value;
              if (at) field("site").value = formatCoordinates(at);
            } else if (extras[i - 1]) {
              const e = extras[i - 1];
              for (const key of ["name", "antenna", "aim", "height"] as const) if (rest[key] !== undefined) e[key] = rest[key];
              if (at) {
                e.lat = at.lat;
                e.lon = at.lon;
              }
              renderExtras();
            }
            syncPattern();
            placeSites(!!at);
            // Only the name changed: nothing to map again.
            if (Object.keys(values).every((k) => k === "siteName" || k === "name")) {
              inputsChanged();
              view3d?.refresh();
            } else remap();
          },
        };
      });
      map.on("click", (e: L.LeafletMouseEvent) => {
        const q = { lat: e.latlng.lat, lon: e.latlng.lng };
        if (readingsCard.takeMapTap(q)) return;
        if (placing) {
          placing = false;
          extras.push({ name: "", lat: q.lat, lon: q.lon, height: "", antenna: "omni", aim: "0", preset: "" });
          renderExtras();
          setStatus("");
          inputsChanged();
          return;
        }
        if (mapped()) {
          const specs = siteSpecs();
          const all = siteMarginsAt(siteMargins(), q);
          const best = bestSite(all);
          const unit: DistanceUnit = field("radiusUnit").value === "mi" ? "mi" : "km";
          if (!best) {
            L.popup({ className: "coverage-popup" }).setLatLng(e.latlng).setContent("<b>Outside the mapped circles</b>").openOn(map!);
            return;
          }
          const bestRun = runs[best.index];
          const spec = specs[best.index];
          // With a rate ladder, the fastest rate that keeps the fade margin there.
          const fade = num("fade") || 0;
          const words = (m: number, ladderHere: Rung[]) => {
            const held = ladderHere.length ? rateAt(m + slowest(ladderHere), ladderHere, fade) : undefined;
            const rateText = held?.solid ? `, holds ${formatRate(held.solid.kbps)}${held.any && held.any.kbps > held.solid.kbps ? ` (${formatRate(held.any.kbps)} under the fade margin)` : ""}` : held?.any ? `, ${formatRate(held.any.kbps)} under the fade margin` : "";
            return `${fmt(m)} dB margin${rateText}`;
          };
          // Each way's margin: the shading's offset comes off, the return difference goes on.
          const vOut = best.margin - bestRun.offset;
          const vIn = vOut + bestRun.delta;
          const outText = words(vOut, rungs());
          const inText = words(vIn, spec.rungs);
          const name = spec.name;
          const text = outText === inText ? `${outText} both ways` : `${words(Math.min(vOut, vIn), [])} the weaker way. ${name} to here: ${outText}. Here to ${name}: ${inText}`;
          const multi = specs.length > 1;
          // The other sites that reach here too.
          const others = all
            .map((m, i) => ({ m, i }))
            .filter((x) => x.i !== best.index && x.m >= 0)
            .sort((a, b) => b.m - a.m)
            .map((x) => `${specs[x.i].name} (${fmt(x.m)} dB)`);
          const d = distanceBetweenM(spec.at, q);
          const b = bearingDeg(spec.at, q);
          const where = `${fmt(fromMetres(d, unit), 2)} ${unit} ${multi ? `from ${name} ` : ""}at ${Math.round(b)}° ${compassPoint(b)}`;
          const alsoText = multi ? (others.length ? `Also reaches here: ${others.join(", ")}.` : "No other site reaches here.") : "";
          const lead = multi ? `Best: ${name}. ` : "";
          L.popup({ className: "coverage-popup" })
            .setLatLng(e.latlng)
            .setContent(`<b>${escapeHtml(lead + text)}</b><br>${escapeHtml(where)}${alsoText ? `<br>${escapeHtml(alsoText)}` : ""}`)
            .openOn(map!);
          return;
        }
        // Only an empty Site A is placed by tapping: a stray tap while panning
        // shouldn't silently move a site someone chose or was sent.
        if (site()) {
          setStatus("Drag a pin to move a site, or press Add site for another.");
          return;
        }
        field("site").value = formatCoordinates(q);
        setStatus("");
        inputsChanged();
      });
      placeSites(!!p);
      readingsCard.refresh();
      if (runWhenReady) {
        runWhenReady = false;
        void run();
      }
    };
    // The shading uses theme colours, so redraw it when the theme changes.
    const onTheme = () => {
      if (form.isConnected) drawOverlay();
      else window.removeEventListener("rf-toolkit:theme", onTheme);
    };
    window.addEventListener("rf-toolkit:theme", onTheme);
    const waitForPage = () => (form.isConnected ? initMap() : setTimeout(waitForPage, 50));
    setTimeout(waitForPage, 0);

    // Presets fill the fields they cover, and those fields are hidden: edit
    // the preset under Manage presets. Fields a preset leaves blank stay.
    const applyPresets = () => {
      const s = sitePreset();
      const r = rxPreset();
      const set = (name: string, v?: string) => {
        if (v) field(name).value = v;
      };
      if (s) {
        set("freq", s.freq);
        set("freqUnit", s.freqUnit);
        set("power", s.power);
        set("powerUnit", s.powerUnit);
        set("txGain", s.gain);
        set("txCable", s.cable);
        set("siteSens", s.sens);
      }
      if (r) {
        set("rxGain", r.gain);
        set("rxCable", r.cable);
        set("rxPower", r.power);
        set("rxPowerUnit", r.powerUnit);
        set("sens", r.sens);
      }
      const hide = (name: string, hidden: boolean) => (field(name).closest("label")!.hidden = hidden);
      hide("power", !!s?.power);
      hide("txGain", !!s?.gain);
      hide("txCable", !!s?.cable);
      hide("rxGain", !!r?.gain);
      hide("rxCable", !!r?.cable);
      hide("sens", rungs().length > 0 || !!r?.sens);
      hide("siteSens", siteRungs().length > 0 || !!s?.sens);
      hide("rxPower", !!r?.power);
    };
    for (const name of ["sitePreset", "rxPreset"]) field(name).addEventListener("change", applyPresets);
    const pickSaved = (id: string) => {
      fillPresetOptions();
      field("sitePreset").value = id;
      applyPresets();
      inputsChanged();
    };
    form.querySelector('[data-action="presets"]')!.addEventListener("click", () => openPresetManager("coverage", pickSaved));
    // Presets changed (here or in another tab): refresh the lists and the numbers.
    const onPresets = (e: Event) => {
      if (!presetsEventFor(e, "coverage")) return;
      if (!form.isConnected) {
        window.removeEventListener(PRESETS_EVENT, onPresets);
        return;
      }
      fillPresetOptions();
      applyPresets();
      renderExtras();
      inputsChanged();
    };
    window.addEventListener(PRESETS_EVENT, onPresets);
    applyPresets();

    form.querySelector('[data-action="run"]')!.addEventListener("click", () => void run());
    form.querySelector('[data-action="locate"]')!.addEventListener("click", () => {
      locateMe(setStatus, (p) => {
        field("site").value = formatCoordinates(p);
        setStatus("");
        inputsChanged();
        placeSites(true);
      });
    });
    form.querySelector('[data-action="reset"]')!.addEventListener("click", () => {
      for (const [name, value] of Object.entries(defaults)) {
        if (["site", "radius", "radiusUnit", "detail"].includes(name)) continue;
        field(name).value = value;
      }
      inputsChanged();
    });

    let pending: ReturnType<typeof setTimeout> | undefined;
    form.addEventListener("input", (e) => {
      // Typing a location or radius waits for "change"; radios recompute live.
      const name = (e.target as HTMLElement).getAttribute("name");
      if (name === "site") return;
      if (name === "siteName") {
        placeSites(false);
        save();
        return;
      }
      clearTimeout(pending);
      pending = setTimeout(inputsChanged, 200);
    });
    form.addEventListener("change", (e) => {
      if ((e.target as HTMLElement).getAttribute("name") === "site") placeSites(true);
      inputsChanged();
    });

    // Label the Site B height, and the other sites', with the shared height unit.
    const syncHeightUnit = () => {
      const unit = form.querySelector<HTMLElement>('input[name="rxHeight"] + .unit');
      if (unit) unit.textContent = field("heightUnit").value;
      renderExtras();
    };
    field("heightUnit").addEventListener("change", syncHeightUnit);
    syncHeightUnit();
    syncPattern();

    recompute();
    form.querySelector('[data-slot="share"]')!.append(
      createPlanCard({
        toolId: "coverage",
        settingNames: Object.keys(defaults),
        getPlan: () => {
          const settings: Record<string, string> = {};
          for (const name of Object.keys(defaults)) settings[name] = field(name).value;
          const presets = loadPresets("coverage");
          const site = sitePreset();
          const rxId = field("rxPreset").value;
          // Every other preset the plan uses: Site B's and the other sites'.
          const otherIds = new Set([...(rxId && rxId !== "custom" ? [rxId] : []), ...extras.map((e) => e.preset).filter(Boolean)]);
          const others = presets.filter((p) => otherIds.has(p.id) && p.id !== site?.id);
          const nodes: PlanNode[] = extras.map((e) => ({
            name: e.name,
            lat: e.lat,
            lon: e.lon,
            height: e.height,
            ...(e.antenna !== "omni" ? { antenna: e.antenna, aim: e.aim } : {}),
            ...(e.preset ? { preset: e.preset } : {}),
          }));
          return { settings, ...(site ? { preset: site } : {}), ...(others.length ? { nodePresets: others } : {}), ...(nodes.length ? { nodes } : {}) };
        },
        applyPlan: (plan) => {
          // The plan's presets join this device's (once), pointed at their ids here.
          const ids = new Map<string, string>();
          if (plan.preset) ids.set(plan.preset.id, adoptPreset(plan.preset, "coverage"));
          for (const p of plan.nodePresets ?? []) ids.set(p.id, adoptPreset(p, "coverage"));
          const rxWas = plan.settings.rxPreset ?? "";
          fillPresetOptions();
          applySettings(form, {
            ...plan.settings,
            sitePreset: plan.preset ? ids.get(plan.preset.id)! : "",
            rxPreset: rxWas === "custom" || rxWas === "" ? rxWas : (ids.get(rxWas) ?? ""),
          });
          applyPresets();
          // The plan's other sites replace these.
          extras = (plan.nodes ?? []).slice(0, MAX_EXTRA_SITES).map((n) => ({ ...toExtra(n), preset: n.preset ? (ids.get(n.preset) ?? "") : "" }));
          placing = false;
          // Show the location in this reader's coordinate format.
          const planned = site();
          if (planned) field("site").value = formatCoordinates(planned);
          syncHeightUnit();
          inputsChanged();
          placeSites(true);
          // A plan carries settings, not the finished map, so draw it now. A
          // shared link opens before the map exists; initMap picks that up.
          if (!planned) return;
          if (map) void run();
          else runWhenReady = true;
        },
        buildExport: (name) => {
          if (!mapped() || !lastOverlay) return "Run the coverage analysis first.";
          const points = siteSpecs().map((s) => ({ name: s.name, lat: s.at.lat, lon: s.at.lon }));
          const kml = buildOverlayKml(`${name} coverage`, "coverage.png", lastOverlay.bounds, points, RADIO_FILE);
          const encoder = new TextEncoder();
          const kmz = buildZip([
            { name: "doc.kml", data: encoder.encode(kml) },
            { name: "coverage.png", data: pngBytes(lastOverlay.url) },
            radioIconFile(),
          ]);
          return { name: fileName(name, "kmz"), data: new Uint8Array(kmz) };
        },
        markers: () => siteSpecs().map((s) => ({ name: s.name, lat: s.at.lat, lon: s.at.lon, description: "Coverage site, from RF Toolkit" })),
        onImport: (points) => {
          // An empty Site A takes the first point; the rest become more sites.
          let used = 0;
          if (!site()) {
            const first = points[used++];
            field("site").value = formatCoordinates(first);
            field("siteName").value = first.name;
          }
          const room = MAX_EXTRA_SITES - extras.length;
          const more = points.slice(used, used + room);
          extras.push(...more.map((p) => ({ name: p.name, lat: p.lat, lon: p.lon, height: "", antenna: "omni", aim: "0", preset: "" })));
          used += more.length;
          placing = false;
          renderExtras();
          inputsChanged();
          placeSites(true);
          const left = points.length - used;
          return used
            ? `Added ${used} site${used === 1 ? "" : "s"} from the file${left ? `; ${left} more didn't fit (up to ${MAX_EXTRA_SITES + 1} sites)` : ""}. Run the coverage analysis to map them.`
            : `No room for more sites (up to ${MAX_EXTRA_SITES + 1}). Remove one first.`;
        },
      }),
    );
    enhanceFields(form, coverageGuide, defaults);
    moveModeBar(form);
    setupMapFirst(form, { panesKey: PANES_KEY, sidesKey: SIDES_KEY, rightName: "coverage results" });
    // Climate and ground type are global: shown here, kept in Settings, so a
    // change here applies on every tab.
    const climateSel = field("climate") as HTMLSelectElement;
    const groundSel = field("ground") as HTMLSelectElement;
    climateSel.value = getSettings().climate;
    groundSel.value = getSettings().ground;
    for (const sel of [climateSel, groundSel]) {
      sel.addEventListener("change", () => {
        setSettings({ ...getSettings(), climate: climateSel.value, ground: groundSel.value });
        inputsChanged();
      });
    }
    return form;
  },
};
