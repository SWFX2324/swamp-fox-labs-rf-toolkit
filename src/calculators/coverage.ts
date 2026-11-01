// Coverage Map: shade the area one site can reach, over terrain, on the map.

import { enhanceFields } from "./fieldHelp";
import { coverageGuide } from "./helpText";
import * as L from "leaflet";
import { createMap, showDefaultView } from "./mapKit";
import type { Calculator } from ".";
import { coordPlaceholder, formatCoordinates, parseCoordinates } from "../lib/coords";
import { type RadialSamples, coverageMargins, coverageStats, marginAt, sampleRadials } from "../lib/coverage";
import { bearingDeg, distanceBetweenM } from "../lib/geo";
import { EARTH_RADIUS_M } from "../lib/horizon";
import { compassPoint } from "../lib/satPointing";
import { ElevationGrid, chooseZoom, tilesCovering } from "../lib/terrainTiles";
import { type OverlayBounds, buildOverlayKml, buildZip, fileName } from "../lib/export";
import { clutterLossDb, effectiveHeightM, findEnvironment } from "../lib/environment";
import { applySettings, createPlanBar, downloadFile } from "./planBar";
import { environmentNote, environmentOptions } from "./environmentField";
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

const defaults: Record<string, string> = {
  site: "",
  freq: "915",
  freqUnit: "MHz",
  power: "1",
  powerUnit: "W",
  txGain: "3",
  txCable: "1",
  txHeight: "30",
  rxHeight: "5",
  heightUnit: "ft",
  rxGain: "2",
  rxCable: "0",
  sens: "-100",
  fade: "10",
  environment: "none",
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
      <div class="card-head"><h2>Site</h2><span class="meta">Transmitter or repeater</span></div>
      <div class="fields">
        <label>Location
          <span class="input-unit">
            <input name="site" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" />
            <button type="button" class="secondary unit-btn" data-action="locate" title="Use my location">Me</button>
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
        <label>Detail
          <select name="detail">${Object.entries(detailLevels).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("")}</select>
        </label>
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
      <p class="note">Before mapping, tap the map to place the site. After, tap anywhere to read the margin there.</p>
    </section>

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
        <p class="note" data-out="probe"></p>
      </div>
      <details class="about"><summary>About this calculation</summary><p>Free-space loss plus ITU-R P.526 Bullington diffraction over bare-earth terrain, sampled along radials from the site. Trees and buildings aren't counted unless you pick an Environment. Elevation: Terrain Tiles (Mapzen, AWS Open Data); US data courtesy of the U.S. Geological Survey. Tiles you've loaded work offline.</p></details>
    </section>
  </aside>
`;

function loadState(): Record<string, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return { ...defaults, ...(typeof saved === "object" && saved ? saved : {}) };
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


export const coverageCalculator: Calculator = {
  id: "coverage",
  title: "Coverage Map",
  shortTitle: "Coverage",
  render() {
    const form = document.createElement("form");
    form.className = "calculator two-col coverage";
    form.innerHTML = template;
    form.addEventListener("submit", (e) => e.preventDefault());

    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
    const out = (name: string) => form.querySelector<HTMLElement>(`[data-out="${name}"]`)!;
    const num = (name: string) => Number.parseFloat(field(name).value);

    for (const [name, value] of Object.entries(loadState())) {
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
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
    let marker: L.Marker | undefined;
    let ring: L.Circle | undefined;
    let overlay: L.ImageOverlay | undefined;
    let samples: RadialSamples | undefined;
    let sampledFor = "";
    let margins: Float32Array[] | undefined;
    let running: AbortController | undefined;
    let lastOverlay: { url: string; bounds: OverlayBounds } | undefined;

    const sampleKey = () => `${field("site").value}|${radiusM()}|${field("detail").value}`;

    const placeSite = (recenter: boolean) => {
      const p = site();
      if (!map) return;
      if (!p) {
        marker?.remove();
        ring?.remove();
        marker = ring = undefined;
        return;
      }
      if (!marker) {
        marker = L.marker([p.lat, p.lon], {
          icon: L.divIcon({ className: "pin", html: "<span><b>TX</b></span>", iconSize: [30, 30], iconAnchor: [15, 30] }),
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
      ring?.remove();
      ring = r > 0 ? L.circle([p.lat, p.lon], { radius: r, className: "coverage-ring", interactive: false }).addTo(map) : undefined;
      if (recenter && ring) map.fitBounds(ring.getBounds(), { padding: [10, 10] });
    };

    const radio = () => ({
      freqHz: toHz(num("freq"), asFrequencyUnit(field("freqUnit").value)),
      eirpDbm: toDbm(num("power"), asPowerUnit(field("powerUnit").value)) - (num("txCable") || 0) + (num("txGain") || 0),
      rxGainDbi: num("rxGain") || 0,
      rxCableLossDb: num("rxCable") || 0,
      sensitivityDbm: num("sens"),
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
        return;
      }
      const r = radio();
      if (!(r.freqHz > 0) || !Number.isFinite(r.eirpDbm) || !Number.isFinite(r.sensitivityDbm)) return;
      const env = findEnvironment(field("environment").value);
      const txH = toMetres(num("txHeight") || 0, heightUnit());
      const rxH = toMetres(num("rxHeight") || 0, heightUnit());
      out("envNote").hidden = env.id === "none";
      out("envNote").textContent = environmentNote(env, r.freqHz, txH, rxH);
      margins = coverageMargins(
        samples,
        { ...r, clutterLossDb: clutterLossDb(env, r.freqHz, txH) + clutterLossDb(env, r.freqHz, rxH) },
        effectiveHeightM(env, txH),
        effectiveHeightM(env, rxH),
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
      setStatus("Calculating…");
      // Let the status paint before the heavy loop.
      await new Promise((resolve) => setTimeout(resolve, 30));
      // Sea-floor depths become sea level: the signal crosses the water surface.
      samples = sampleRadials(p, r, detail.radials, detail.steps, (q) => Math.max(0, grid.sample(q)));
      sampledFor = sampleKey();
      recompute();
      setStatus("");
    };

    const inputsChanged = () => {
      save();
      placeSite(false);
      recompute();
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
      map.on("click", (e: L.LeafletMouseEvent) => {
        const q = { lat: e.latlng.lat, lon: e.latlng.lng };
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
        field("site").value = formatCoordinates(q);
        inputsChanged();
      });
      placeSite(!!p);
    };
    const waitForPage = () => (form.isConnected ? initMap() : setTimeout(waitForPage, 50));
    setTimeout(waitForPage, 0);

    form.querySelector('[data-action="run"]')!.addEventListener("click", () => void run());
    form.querySelector('[data-action="locate"]')!.addEventListener("click", () => {
      if (!navigator.geolocation) {
        setStatus("This browser can't share its location.", true);
        return;
      }
      setStatus("Finding your location…");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          field("site").value = formatCoordinates({ lat: pos.coords.latitude, lon: pos.coords.longitude });
          setStatus("");
          inputsChanged();
          placeSite(true);
        },
        (err) => setStatus(`Couldn't get your location: ${err.message}`, true),
        { enableHighAccuracy: true, timeout: 15000 },
      );
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
          syncHeightUnit();
          inputsChanged();
          placeSite(true);
        },
        exportLabel: "Export KMZ",
        onExport: (name) => {
          const p = site();
          if (!p || !samples || sampledFor !== sampleKey() || !lastOverlay) return "Press Map coverage first.";
          const kml = buildOverlayKml(`${name} coverage`, "coverage.png", lastOverlay.bounds, [{ name: "TX site", lat: p.lat, lon: p.lon }]);
          const png = Uint8Array.from(atob(lastOverlay.url.split(",")[1]), (c) => c.charCodeAt(0));
          const encoder = new TextEncoder();
          const kmz = buildZip([
            { name: "doc.kml", data: encoder.encode(kml) },
            { name: "coverage.png", data: png },
          ]);
          downloadFile(fileName(name, "kmz"), new Uint8Array(kmz), "application/vnd.google-earth.kmz");
          return undefined;
        },
      }),
    );
    enhanceFields(form, coverageGuide, defaults);
    return form;
  },
};
