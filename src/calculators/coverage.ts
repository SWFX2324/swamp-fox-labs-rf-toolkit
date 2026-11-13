// Coverage Analysis: shade the area one site can reach, over terrain, on the map.

import { enhanceFields } from "./fieldHelp";
import { locateButton, locateMe } from "./locate";
import { coverageGuide } from "./helpText";
import * as L from "leaflet";
import { type ClearControl, type Control3D, add3DControl, addClearControl, createMap, showDefaultView } from "./mapKit";
import type { Calculator } from ".";
import { coordPlaceholder, formatCoordinates, parseCoordinates } from "../lib/coords";
import { type RadialSamples, coveragePathLoss, coveragePatternLoss, coverageStats, marginAt, marginsFromLoss, sampleRadials, sumGrids } from "../lib/coverage";
import { beam, patterns } from "../lib/pattern";
import { AUTO_ENVIRONMENT, LAND_COVER_CREDIT, LandCoverGrid, type LandCoverPoint, describePoint, landCoverNames } from "../lib/landCover";
import { loadLandCover } from "./landCoverTiles";
import { createReadingsCard } from "./readingsCard";
import { type LatLon, bearingDeg, destinationPoint, distanceBetweenM } from "../lib/geo";
import { EARTH_RADIUS_M } from "../lib/horizon";
import { compassPoint } from "../lib/satPointing";
import { ElevationGrid, chooseZoom, tilesCovering } from "../lib/terrainTiles";
import { type OverlayBounds, buildOverlayKml, buildZip, fileName } from "../lib/export";
import { type Environment, clutterLossDb, effectiveHeightM, findEnvironment } from "../lib/environment";
import { applySettings, createPlanBar, downloadFile, pngBytes } from "./planBar";
import { RADIO_FILE, radioIconFile, radioMarker } from "./radioIcon";
import { bindTreeField, environmentNote, environmentOptions, treeHeightFieldHtml, withFormTrees } from "./environmentField";
import { linkGroundToEnvironment, modelDefaults, modelFieldsHtml, readModel } from "./modelFields";
import { tabStateToSave, tabValues } from "../lib/appSettings";
import { deratedSensitivity, derateNote, fallbackEnvironment, modelFromSettings, sharedFields } from "./settingsStore";
import { loadTiles } from "./tileElevation";
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

// The built-in defaults from before Settings existed. Settings now override the
// fields they cover; these still fill the rest and recognise untouched old saves.
const legacyDefaults: Record<string, string> = {
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
  fade: "10",
  environment: "none",
  treeHeight: "",
  ...modelDefaults,
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
  <div class="inputs">
    <section class="card">
      <div class="card-head"><h2>Radios</h2><span class="meta">Changes recalculate instantly</span></div>
      <div class="fields">
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
        ${numberField("TX antenna gain", "txGain", "dBi")}
        <label>TX antenna pattern
          <select name="txPattern">${patterns.map((p) => `<option value="${p.id}">${p.name}</option>`).join("")}</select>
        </label>
        <label data-show="txAim">TX antenna points
          <span class="input-unit">
            <input name="txAzimuth" type="number" inputmode="decimal" step="any" min="0" max="360" />
            <span class="unit">° true</span>
          </span>
        </label>
        ${numberField("TX downtilt", "txTilt", "°", 'min="-30" max="30"')}
        ${numberField("TX cable loss", "txCable", "dB", 'min="0"')}
        <label>TX antenna height
          <span class="input-unit">
            <input name="txHeight" type="number" inputmode="decimal" step="any" min="0" />
            <select name="heightUnit"><option>ft</option><option>m</option></select>
          </span>
        </label>
        ${numberField("RX antenna height", "rxHeight", "", 'min="0" title="About 5 ft for a handheld, 8 ft on a vehicle"')}
        ${numberField("RX antenna gain", "rxGain", "dBi")}
        ${numberField("RX cable loss", "rxCable", "dB", 'min="0"')}
        ${numberField("RX sensitivity", "sens", "dBm")}
        ${numberField("Fade margin wanted", "fade", "dB", 'min="0"')}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Site</h2><span class="meta">Transmitter or repeater</span></div>
      <div class="fields">
        <label>Location
          <span class="input-unit">
            <input name="site" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" />
            ${locateButton('data-action="locate"')}
          </span>
        </label>
        <label>Radius
          <span class="input-unit">
            <input name="radius" type="number" inputmode="decimal" step="any" min="0.5" max="80" />
            <select name="radiusUnit"><option>mi</option><option>km</option></select>
          </span>
        </label>
        <label>Environment
          <select name="environment">${environmentOptions()}</select>
        </label>
        ${treeHeightFieldHtml()}
        <label>Detail
          <select name="detail">${Object.entries(detailLevels).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("")}</select>
        </label>
        ${modelFieldsHtml()}
      </div>
      <div class="run-row">
        <button type="button" data-action="run">Map coverage</button>
        <span class="note" data-out="status"></span>
      </div>
      <div class="map coverage-map" data-out="map"></div>
      <div class="legend coverage-legend">
        <span class="key"><span class="sw cov-strong"></span>Strong (fade margin +10 dB)</span>
        <span class="key"><span class="sw cov-solid"></span>Solid (meets fade margin)</span>
        <span class="key"><span class="sw cov-marginal"></span>Marginal</span>
      </div>
      <p class="note">Tap the map to place the site, then drag the TX pin to move it. Once mapped, tap anywhere to read the margin there.</p>
    </section>
  </div>

  <aside class="results">
    <section class="card">
      <div class="card-head">
        <h2>Coverage</h2>
        <span class="pill" data-out="pill" hidden></span>
        <button type="button" class="secondary" data-action="reset">Reset</button>
      </div>
      <p class="note" data-out="empty">Place the site, set the radius and press Map coverage.</p>
      <p class="callout" data-out="stale" hidden>The site, radius or detail changed. Press Map coverage to update.</p>
      <div data-out="results" hidden>
        <div class="tiles">
          <div class="tile"><span class="label">Solid coverage</span><span class="value" data-out="solid"></span><span class="sub" data-out="solidSub"></span></div>
          <div class="tile"><span class="label">Marginal</span><span class="value" data-out="marginal"></span><span class="sub">Connects, under the fade margin</span></div>
          <div class="tile"><span class="label">Farthest solid point</span><span class="value" data-out="far"></span><span class="sub" data-out="farSub"></span></div>
        </div>
        <p class="note" data-out="envNote" hidden></p>
        <p class="note" data-out="corrNote" hidden></p>
        <p class="note" data-out="derateNote" hidden></p>
        <p class="note" data-out="probe"></p>
      </div>
      <details class="about"><summary>About this calculation</summary><p>Free-space loss plus terrain loss from the Irregular Terrain Model (Longley-Rice) over bare-earth terrain, sampled along radials from the site, at the reliability and confidence you set. Trees and buildings aren't counted unless you pick an Environment. Elevation: Terrain Tiles (Mapzen, AWS Open Data); US data courtesy of the U.S. Geological Survey. ${LAND_COVER_CREDIT}. Tiles you've loaded work offline.</p></details>
    </section>
  </aside>
`;

/** The defaults now: the built-in ones, with Settings on top for everything Settings covers. */
function currentDefaults(): Record<string, string> {
  const s = sharedFields();
  return {
    ...legacyDefaults,
    ...modelFromSettings(),
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


/** What the land-cover map found at the site and across the circle. */
function landCoverSummary(lc: { site: LandCoverPoint; points: LandCoverPoint[][] }, siteEnv: Environment, freqHz: number, txH: number): string {
  // Each point stands for a ring sector whose area grows with distance.
  const area = new Map<number, number>();
  let total = 0;
  for (const row of lc.points) {
    row.forEach((p, k) => {
      if (k === 0 || p.cls === 0) return;
      area.set(p.cls, (area.get(p.cls) ?? 0) + k);
      total += k;
    });
  }
  const top = [...area.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cls, a]) => `${Math.round((100 * a) / total)}% ${landCoverNames[cls]?.toLowerCase() ?? "other"}`);
  const siteLoss = clutterLossDb(siteEnv, freqHz, txH);
  return `From the land-cover map: the site is in ${describePoint(lc.site)}${siteLoss > 0 ? `, adding ${siteLoss.toFixed(1)} dB` : ""}. Across the circle: ${top.join(", ") || "no data"}. Each point is charged for the clutter where it is, and terrain is checked from the clutter tops, or from the antenna itself under trees.`;
}

export const coverageCalculator: Calculator = {
  id: "coverage",
  title: "Coverage Analysis",
  shortTitle: "Coverage",
  render() {
    const form = document.createElement("form");
    const defaults = currentDefaults();
    form.className = "calculator two-col coverage";
    form.innerHTML = template;
    linkGroundToEnvironment(form);
    bindTreeField(form, "heightUnit");
    form.addEventListener("submit", (e) => e.preventDefault());

    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
    const out = (name: string) => form.querySelector<HTMLElement>(`[data-out="${name}"]`)!;
    const num = (name: string) => Number.parseFloat(field(name).value);

    for (const [name, value] of Object.entries(loadState(defaults))) {
      const el = form.elements.namedItem(name);
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.value = value;
    }
    field("site").setAttribute("placeholder", coordPlaceholder());
    const savedSite = parseCoordinates(field("site").value);
    if (savedSite) field("site").value = formatCoordinates(savedSite);

    const save = () => {
      const state: Record<string, string> = {};
      for (const name of Object.keys(defaults)) state[name] = field(name).value;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tabStateToSave(state, defaults)));
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

    let map: L.Map | undefined;
    let clearControl: ClearControl | undefined;
    let marker: L.Marker | undefined;
    let ring: L.Circle | undefined;
    let overlay: L.ImageOverlay | undefined;
    let samples: RadialSamples | undefined;
    let sampledFor = "";
    let margins: Float32Array[] | undefined;
    let pathLoss: { samples: RadialSamples; key: string; loss: Float32Array[] } | undefined;
    let patternLoss: { samples: RadialSamples; key: string; loss: Float32Array[] | undefined } | undefined;
    let aimLine: L.Polyline | undefined;
    let view3d: Control3D | undefined;
    // Land cover at the site and every radial point, read with the terrain.
    let cover: { samples: RadialSamples; site: LandCoverPoint; points: LandCoverPoint[][] } | undefined;
    let coverError = "";
    let clutterGrids: { samples: RadialSamples; key: string; heights: Float32Array[]; loss: Float32Array[] } | undefined;
    let running: AbortController | undefined;
    let lastOverlay: { url: string; bounds: OverlayBounds } | undefined;
    let runWhenReady = false;

    const autoCover = () => field("environment").value === AUTO_ENVIRONMENT;
    const sampleKey = () => `${field("site").value}|${radiusM()}|${field("detail").value}|${autoCover()}`;

    const placeSite = (recenter: boolean) => {
      const p = site();
      clearControl?.setVisible(!!p || !!samples);
      if (!map) return;
      if (!p) {
        marker?.remove();
        ring?.remove();
        marker = ring = undefined;
        return;
      }
      if (!marker) {
        marker = L.marker([p.lat, p.lon], {
          icon: radioMarker("TX"),
          draggable: true,
        }).addTo(map);
        marker.on("dragend", () => {
          const q = marker!.getLatLng();
          field("site").value = formatCoordinates({ lat: q.lat, lon: q.lng });
          inputsChanged();
        });
      } else {
        marker.setLatLng([p.lat, p.lon]);
      }
      const r = radiusM();
      aimLine?.remove();
      aimLine = undefined;
      const b = txBeam();
      if (b.pattern.id !== "omni" && r > 0) {
        const tip = destinationPoint(p, b.azimuthDeg, r);
        aimLine = L.polyline([[p.lat, p.lon], [tip.lat, tip.lon]], { className: "coverage-aim", interactive: false }).addTo(map);
      }
      ring?.remove();
      ring = r > 0 ? L.circle([p.lat, p.lon], { radius: r, className: "coverage-ring", interactive: false }).addTo(map) : undefined;
      if (recenter && ring) map.fitBounds(ring.getBounds(), { padding: [10, 10] });
      view3d?.refresh();
    };

    const txBeam = () => beam(field("txPattern").value, num("txGain") || 0, num("txAzimuth"), num("txTilt"));
    const syncPattern = () => {
      form.querySelector<HTMLElement>('[data-show="txAim"]')!.hidden = field("txPattern").value === "omni";
    };

    // The nearest radial point to p, as [radial, step], or undefined outside the circle.
    const nearestPoint = (p: LatLon): [number, number] | undefined => {
      if (!samples) return undefined;
      const k = Math.round(distanceBetweenM(samples.site, p) / samples.stepM);
      if (k > samples.elevations[0].length - 1) return undefined;
      const n = samples.bearings.length;
      return [Math.round((((bearingDeg(samples.site, p) % 360) + 360) % 360) / (360 / n)) % n, k];
    };
    const mapped = () => !!samples && !!margins && sampledFor === sampleKey();

    const readingsCard = createReadingsCard({
      site,
      predict: (p) => {
        if (!mapped()) return undefined;
        const v = marginAt(samples!, margins!, bearingDeg(samples!.site, p), distanceBetweenM(samples!.site, p));
        // Margins include any correction; predictions are compared without it.
        return Number.isFinite(v) ? v - readingsCard.correctionDb() + deratedSensitivity(num("sens")) : undefined;
      },
      coverAt: (p) => {
        const at = cover && cover.samples === samples && mapped() ? nearestPoint(p) : undefined;
        if (at) return cover!.points[at[0]][at[1]].environment.name;
        const env = findEnvironment(field("environment").value);
        return autoCover() || env.id === "none" ? undefined : env.name;
      },
      map: () => map,
      onCorrectionChange: () => recompute(),
    });

    const radio = () => ({
      freqHz: toHz(num("freq"), asFrequencyUnit(field("freqUnit").value)),
      eirpDbm: toDbm(num("power"), asPowerUnit(field("powerUnit").value)) - (num("txCable") || 0) + (num("txGain") || 0),
      rxGainDbi: num("rxGain") || 0,
      rxCableLossDb: num("rxCable") || 0,
      sensitivityDbm: deratedSensitivity(num("sens")),
    });

    const drawOverlay = () => {
      overlay?.remove();
      overlay = undefined;
      if (!map || !samples || !margins) return;
      const s = samples;
      const m = margins;
      const fade = num("fade") || 0;
      const dLat = (s.radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
      const dLon = dLat / Math.cos((s.site.lat * Math.PI) / 180);
      const size = 640;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      const img = ctx.createImageData(size, size);
      const strong = cssColor("--good");
      const solid = cssColor("--good");
      const marginal = cssColor("--warning");
      const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M;
      for (let j = 0; j < size; j++) {
        const lat = s.site.lat + dLat - ((j + 0.5) / size) * 2 * dLat;
        const mPerDegLon = mPerDegLat * Math.cos((lat * Math.PI) / 180);
        for (let i = 0; i < size; i++) {
          const lon = s.site.lon - dLon + ((i + 0.5) / size) * 2 * dLon;
          const x = (lon - s.site.lon) * mPerDegLon;
          const y = (lat - s.site.lat) * mPerDegLat;
          const d = Math.hypot(x, y);
          if (d > s.radiusM) continue;
          const v = marginAt(s, m, (Math.atan2(x, y) * 180) / Math.PI, d);
          if (!(v >= 0)) continue;
          const [c, alpha] = v >= fade + 10 ? [strong, 165] : v >= fade ? [solid, 105] : [marginal, 120];
          const o = (j * size + i) * 4;
          img.data[o] = c[0];
          img.data[o + 1] = c[1];
          img.data[o + 2] = c[2];
          img.data[o + 3] = alpha;
        }
      }
      ctx.putImageData(img, 0, 0);
      const url = canvas.toDataURL();
      lastOverlay = {
        url,
        bounds: { north: s.site.lat + dLat, south: s.site.lat - dLat, east: s.site.lon + dLon, west: s.site.lon - dLon },
      };
      overlay = L.imageOverlay(url, [
        [s.site.lat - dLat, s.site.lon - dLon],
        [s.site.lat + dLat, s.site.lon + dLon],
      ], { interactive: false, className: "coverage-overlay" }).addTo(map);
      ring?.bringToFront();
      view3d?.refresh();
    };

    const recompute = () => {
      const ready = !!samples && sampledFor === sampleKey();
      out("stale").hidden = !samples || ready;
      out("results").hidden = !ready;
      out("pill").hidden = !ready;
      out("empty").hidden = !!samples;
      if (!ready || !samples) {
        overlay?.remove();
        overlay = undefined;
        readingsCard.refresh();
        view3d?.refresh();
        return;
      }
      const r = radio();
      if (!(r.freqHz > 0) || !Number.isFinite(r.eirpDbm) || !Number.isFinite(r.sensitivityDbm)) return;
      const trees = (e: Environment) => withFormTrees(form, "heightUnit", e);
      // Where the land-cover map has no data yet, the Settings fallback stands in.
      const env = trees(autoCover() ? fallbackEnvironment() : findEnvironment(field("environment").value));
      const txH = toMetres(num("txHeight") || 0, heightUnit());
      const rxH = toMetres(num("rxHeight") || 0, heightUnit());
      const lc = autoCover() && cover?.samples === samples ? cover : undefined;
      const siteEnv = lc ? trees(lc.site.environment) : env;
      if (lc && (!clutterGrids || clutterGrids.samples !== samples || clutterGrids.key !== JSON.stringify([r.freqHz, rxH, field("treeHeight").value, heightUnit()]))) {
        const at = (rr: number, k: number) => trees(lc.points[rr][k].environment);
        clutterGrids = {
          samples,
          key: JSON.stringify([r.freqHz, rxH, field("treeHeight").value, heightUnit()]),
          heights: samples.elevations.map((e, rr) => e.map((_, k) => effectiveHeightM(at(rr, k), rxH))),
          loss: samples.elevations.map((e, rr) => e.map((_, k) => (k === 0 ? 0 : clutterLossDb(at(rr, k), r.freqHz, rxH)))),
        };
      }
      out("envNote").hidden = env.id === "none" && !autoCover();
      out("envNote").textContent = lc
        ? landCoverSummary(lc, siteEnv, r.freqHz, txH)
        : autoCover()
          ? coverError
            ? `Couldn't read the land-cover map (${coverError}), so ${env.name} is used everywhere instead (the land-cover fallback in Settings). Press Map coverage to try again.`
            : `The land-cover map isn't loaded for this area yet, so ${env.name} is used everywhere (the land-cover fallback in Settings). Press Map coverage to read it.`
          : environmentNote(env, r.freqHz, txH, rxH);
      // The terrain work only reruns when what it depends on changes.
      const model = readModel(form);
      const pathTxH = effectiveHeightM(siteEnv, txH);
      const pathRxH = lc ? clutterGrids!.heights : effectiveHeightM(env, rxH);
      const lossKey = JSON.stringify([r.freqHz, pathTxH, lc ? `cover${rxH}` : pathRxH, model]);
      if (!pathLoss || pathLoss.samples !== samples || pathLoss.key !== lossKey) {
        pathLoss = { samples, key: lossKey, loss: coveragePathLoss(samples, r.freqHz, pathTxH, pathRxH, model) };
      }
      const b = txBeam();
      const beamKey = JSON.stringify([b, txH, rxH]);
      if (!patternLoss || patternLoss.samples !== samples || patternLoss.key !== beamKey) {
        // An omni at 0 dBi with no tilt has a 90° beam: not worth the grid.
        const flat = b.pattern.id === "omni" && b.downtiltDeg === 0 && b.vBeamwidthDeg >= 90;
        patternLoss = { samples, key: beamKey, loss: flat ? undefined : coveragePatternLoss(samples, b, txH, rxH) };
      }
      const correction = readingsCard.correctionDb();
      out("corrNote").hidden = correction === 0;
      out("derateNote").textContent = derateNote();
      out("derateNote").hidden = !derateNote();
      out("corrNote").textContent = `Corrected by ${correction > 0 ? "+" : ""}${fmt(correction)} dB, the average error of your field readings.`;
      margins = marginsFromLoss(
        pathLoss.loss,
        { ...r, eirpDbm: r.eirpDbm + correction, clutterLossDb: clutterLossDb(siteEnv, r.freqHz, txH) + (lc ? 0 : clutterLossDb(env, r.freqHz, rxH)) },
        sumGrids(patternLoss.loss, lc ? clutterGrids!.loss : undefined),
      );
      const fade = num("fade") || 0;
      const stats = coverageStats(samples, margins, fade);
      const pill = out("pill");
      const reach = stats.solid + stats.marginal;
      pill.className = `pill ${stats.solid >= 0.6 ? "s-good" : reach >= 0.3 ? "s-marginal" : "s-fail"}`;
      pill.textContent = `${fmt(reach * 100, 0)}% reachable`;
      out("solid").textContent = `${fmt(stats.solid * 100, 0)}%`;
      out("solidSub").textContent = `of the ${fmt(fromMetres(samples.radiusM, asDistanceUnit(field("radiusUnit").value)), 1)} ${asDistanceUnit(field("radiusUnit").value)} circle`;
      out("marginal").textContent = `${fmt(stats.marginal * 100, 0)}%`;
      const unit: DistanceUnit = field("radiusUnit").value === "mi" ? "mi" : "km";
      out("far").textContent = stats.farthestSolidM ? `${fmt(fromMetres(stats.farthestSolidM, unit))} ${unit}` : "—";
      out("farSub").textContent = stats.farthestSolidM
        ? `Toward ${Math.round(stats.farthestSolidBearing)}° ${compassPoint(stats.farthestSolidBearing)}`
        : "Nowhere meets the fade margin";
      drawOverlay();
      readingsCard.refresh();
    };

    const run = async () => {
      const p = site();
      const r = radiusM();
      if (!p) {
        setStatus("Place the site first.", true);
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
      const z = chooseZoom(p, r, 36);
      const tiles = tilesCovering(p, r, z);
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
      coverError = "";
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
          coverError = navigator.onLine ? (err as Error).message : "no connection, and this area isn't saved";
        }
      }
      if (controller.signal.aborted) return;
      setStatus("Calculating…");
      // Let the status paint before the heavy loop.
      await new Promise((resolve) => setTimeout(resolve, 30));
      // Sea-floor depths become sea level: the signal crosses the water surface.
      samples = sampleRadials(p, r, detail.radials, detail.steps, (q) => Math.max(0, grid.sample(q)));
      sampledFor = sampleKey();
      if (coverGrid) {
        const g = coverGrid;
        const s = samples;
        cover = {
          samples: s,
          site: g.at(p),
          points: s.bearings.map((b, rr) => Array.from({ length: s.elevations[rr].length }, (_, k) => g.at(k === 0 ? p : destinationPoint(p, b, k * s.stepM)))),
        };
      } else cover = undefined;
      recompute();
      setStatus("");
    };

    const inputsChanged = () => {
      save();
      syncPattern();
      placeSite(false);
      recompute();
    };

    // Remove the site, its circle and the coverage, so a tap places a new site.
    // Radio and antenna settings stay.
    const clearCoverage = () => {
      running?.abort();
      running = undefined;
      samples = margins = pathLoss = patternLoss = cover = clutterGrids = undefined;
      sampledFor = "";
      lastOverlay = undefined;
      map?.closePopup();
      out("probe").textContent = "";
      field("site").value = "";
      setStatus("");
      inputsChanged();
    };

    const initMap = () => {
      if (map || !form.isConnected) return;
      const p = site();
      map = createMap(out("map"), (m) => {
        // Frame the coverage circle, or the site, or the default view.
        const here = site();
        if (ring) m.fitBounds(ring.getBounds(), { padding: [10, 10] });
        else if (here) m.setView([here.lat, here.lon], 11);
        else showDefaultView(m);
      });
      clearControl = addClearControl(map, "the site and coverage", clearCoverage);
      view3d = add3DControl(map, () => {
        const p = site();
        const r = radiusM();
        return {
          title: "Coverage Analysis",
          points: p ? [{ ...p, label: "Site", heightM: toMetres(num("txHeight") || 0, heightUnit()) }] : [],
          links: [],
          // Only shading that matches the current settings, as on this map.
          overlay: overlay && lastOverlay ? lastOverlay : undefined,
          ring: p && r > 0 ? { center: p, radiusM: r } : undefined,
          k: 4 / 3,
          // Moving the site in 3D maps its coverage again straight away, so
          // there is something to see there.
          onMove: (_i, q) => {
            field("site").value = formatCoordinates(q);
            setStatus("");
            inputsChanged();
            void run();
          },
        };
      });
      map.on("click", (e: L.LeafletMouseEvent) => {
        const q = { lat: e.latlng.lat, lon: e.latlng.lng };
        if (readingsCard.takeMapTap(q)) return;
        if (samples && margins && sampledFor === sampleKey()) {
          const d = distanceBetweenM(samples.site, q);
          const b = bearingDeg(samples.site, q);
          const v = marginAt(samples, margins, b, d);
          const unit: DistanceUnit = field("radiusUnit").value === "mi" ? "mi" : "km";
          const text = Number.isFinite(v)
            ? `${fmt(v)} dB margin`
            : "Outside the mapped circle";
          L.popup({ className: "coverage-popup" })
            .setLatLng(e.latlng)
            .setContent(`<b>${text}</b><br>${fmt(fromMetres(d, unit), 2)} ${unit} at ${Math.round(b)}° ${compassPoint(b)}`)
            .openOn(map!);
          out("probe").textContent = Number.isFinite(v)
            ? `Tapped point: ${text}, ${fmt(fromMetres(d, unit), 2)} ${unit} toward ${Math.round(b)}°.`
            : "";
          return;
        }
        // Only an empty site is placed by tapping: a stray tap while panning
        // shouldn't silently move a site someone chose or was sent.
        if (site()) {
          setStatus("Drag the TX pin to move the site.");
          return;
        }
        field("site").value = formatCoordinates(q);
        setStatus("");
        inputsChanged();
      });
      placeSite(!!p);
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

    form.querySelector('[data-action="run"]')!.addEventListener("click", () => void run());
    form.querySelector('[data-action="locate"]')!.addEventListener("click", () => {
      locateMe(setStatus, (p) => {
        field("site").value = formatCoordinates(p);
        setStatus("");
        inputsChanged();
        placeSite(true);
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
      clearTimeout(pending);
      pending = setTimeout(inputsChanged, 200);
    });
    form.addEventListener("change", (e) => {
      if ((e.target as HTMLElement).getAttribute("name") === "site") placeSite(true);
      inputsChanged();
    });

    // Label the RX height with the shared height unit.
    const syncHeightUnit = () => {
      const unit = form.querySelector<HTMLElement>('input[name="rxHeight"] + .unit');
      if (unit) unit.textContent = field("heightUnit").value;
    };
    field("heightUnit").addEventListener("change", syncHeightUnit);
    syncHeightUnit();
    syncPattern();

    recompute();
    out("map").closest(".card")!.append(
      createPlanBar({
        toolId: "coverage",
        settingNames: Object.keys(defaults),
        getPlan: () => {
          const settings: Record<string, string> = {};
          for (const name of Object.keys(defaults)) settings[name] = field(name).value;
          return { settings };
        },
        applyPlan: (plan) => {
          applySettings(form, plan.settings);
          // Show the location in this reader's coordinate format.
          const planned = site();
          if (planned) field("site").value = formatCoordinates(planned);
          syncHeightUnit();
          inputsChanged();
          placeSite(true);
          // A plan carries settings, not the finished map, so draw it now. A
          // shared link opens before the map exists; initMap picks that up.
          if (!planned) return;
          if (map) void run();
          else runWhenReady = true;
        },
        exportLabel: "Export KMZ",
        onExport: (name) => {
          const p = site();
          if (!p || !samples || sampledFor !== sampleKey() || !lastOverlay) return "Press Map coverage first.";
          const kml = buildOverlayKml(`${name} coverage`, "coverage.png", lastOverlay.bounds, [{ name: "TX site", lat: p.lat, lon: p.lon }], RADIO_FILE);
          const encoder = new TextEncoder();
          const kmz = buildZip([
            { name: "doc.kml", data: encoder.encode(kml) },
            { name: "coverage.png", data: pngBytes(lastOverlay.url) },
            radioIconFile(),
          ]);
          downloadFile(fileName(name, "kmz"), new Uint8Array(kmz), "application/vnd.google-earth.kmz");
          return undefined;
        },
      }),
    );
    form.querySelector(".results")!.append(readingsCard.element);
    enhanceFields(form, coverageGuide, defaults);
    return form;
  },
};
