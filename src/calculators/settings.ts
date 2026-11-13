// The Settings tab: the defaults the Link Analysis, Mesh Planner and Coverage
// Map start from. Changing a field on a tab still overrides it there.

import type { Calculator } from ".";
import { type AppSettings, connectorsDb, fieldNumber, inUnit } from "../lib/appSettings";
import { type CoordFormat, getCoordFormat, setCoordFormat } from "../lib/coords";
import { environments } from "../lib/environment";
import { kFactors } from "../lib/horizon";
import { climates, grounds } from "../lib/propagation";
import { enhanceFields } from "./fieldHelp";
import { settingsGuide } from "./helpText";
import { getSettings, resetSettings, setSettings } from "./settingsStore";

export const COORD_EVENT = "rf-toolkit:coord-format";

const numberField = (label: string, name: string, unit: string, attrs = "") => `
    <label>${label}
      <span class="input-unit">
        <input name="${name}" type="number" inputmode="decimal" step="any" ${attrs} />
        <span class="unit" ${unit === "height" ? 'data-height-unit=""' : ""}>${unit === "height" ? "ft" : unit}</span>
      </span>
    </label>`;

const options = (items: readonly { id: string | number; name: string }[]) => items.map((i) => `<option value="${i.id}">${i.name}</option>`).join("");
const [noEnv, ...envs] = environments;

const template = `
  <div class="inputs">
    <section class="card">
      <div class="card-head"><h2>Prediction standard</h2><span class="meta">How sure a prediction has to be</span></div>
      <div class="fields">
        ${numberField("Reliability (time)", "reliability", "%", 'min="1" max="99"')}
        ${numberField("Confidence", "confidence", "%", 'min="1" max="99"')}
        ${numberField("Fade margin", "fadeMarginDb", "dB", 'min="0"')}
        <label>Earth curvature (k)
          <select name="kFactor">${options(kFactors)}</select>
        </label>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Equipment</h2><span class="meta">Each end of a link, unless a tab says otherwise</span></div>
      <div class="fields">
        ${numberField("Antenna gain", "antennaGainDbi", "dBi")}
        ${numberField("Antenna height", "defaultHeight", "height", 'min="0"')}
        ${numberField("Cable loss", "cableLossDb", "dB", 'min="0"')}
        ${numberField("Connector / coupler loss", "connectorLossDb", "dB each", 'min="0"')}
        ${numberField("Connectors per end", "connectorsPerEnd", "", 'min="0" max="10" step="1"')}
        ${numberField("Sensitivity derating", "sensitivityDerateDb", "dB", 'min="0"')}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Environment</h2><span class="meta">Trees, buildings and open ground</span></div>
      <div class="fields">
        <label>Environment
          <select name="environment">
            <option value="${noEnv.id}">${noEnv.name}</option>
            <option value="auto">From land-cover map</option>
            ${options(envs)}
          </select>
        </label>
        <label>Land-cover fallback
          <select name="fallbackEnvironment">${options(environments)}</select>
        </label>
        ${numberField("Tree height", "treeHeight", "height", 'min="1"')}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Longley-Rice model</h2><span class="meta">Terrain loss</span></div>
      <div class="fields">
        <label>Radio climate
          <select name="climate">${options(climates)}</select>
        </label>
        <label>Ground
          <select name="ground">${options(grounds)}</select>
        </label>
        <label>Polarization
          <select name="polarization"><option value="vertical">Vertical</option><option value="horizontal">Horizontal</option></select>
        </label>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Units</h2><span class="meta">How the app shows numbers</span></div>
      <div class="fields">
        <label>Heights
          <select name="heightUnit"><option value="ft">Feet</option><option value="m">Metres</option></select>
        </label>
        <label>Distances
          <select name="distanceUnit"><option value="mi">Miles</option><option value="km">Kilometres</option></select>
        </label>
        <label>Coordinates
          <select name="coordFormat"><option value="latlon">Lat/Lon</option><option value="mgrs">MGRS</option></select>
        </label>
      </div>
    </section>
  </div>

  <aside class="results">
    <section class="card">
      <div class="card-head">
        <h2>Settings</h2>
        <button type="button" class="secondary" data-action="reset">Restore defaults</button>
      </div>
      <p class="note top">These are the starting values for the Link Analysis, Mesh Planner and Coverage Analysis. A field you change on one of those tabs keeps your value there until you press its Reset; the rest follow what's set here. Saved plans and shared links keep the values they were saved with, so they read the same on any device.</p>
      <ul class="settings-summary" data-out="summary"></ul>
    </section>
  </aside>
`;

export const settingsCalculator: Calculator = {
  id: "settings",
  title: "Settings",
  // Opened from the gear in the top bar, apart from the calculators.
  inTabBar: false,
  render() {
    const form = document.createElement("form");
    form.className = "calculator two-col settings";
    form.innerHTML = template;
    form.addEventListener("submit", (e) => e.preventDefault());
    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
    const num = (name: string) => Number.parseFloat(field(name).value);

    const fill = (s: AppSettings) => {
      for (const key of ["reliability", "confidence", "fadeMarginDb", "antennaGainDbi", "cableLossDb", "connectorLossDb", "connectorsPerEnd", "sensitivityDerateDb"] as const) {
        field(key).value = fieldNumber(s[key]);
      }
      for (const key of ["kFactor", "environment", "fallbackEnvironment", "climate", "ground", "polarization", "heightUnit", "distanceUnit"] as const) {
        field(key).value = s[key];
      }
      field("defaultHeight").value = inUnit(s.defaultHeightM, s.heightUnit);
      field("treeHeight").value = inUnit(s.treeHeightM, s.heightUnit);
      field("coordFormat").value = getCoordFormat();
      for (const u of form.querySelectorAll("[data-height-unit]")) u.textContent = s.heightUnit;
    };

    const summarize = (s: AppSettings) => {
      const env = s.environment === "auto" ? "the land-cover map" : (environments.find((e) => e.id === s.environment)?.name ?? s.environment);
      const fallback = environments.find((e) => e.id === s.fallbackEnvironment)?.name ?? s.fallbackEnvironment;
      const items = [
        `Plans for ${fieldNumber(s.reliability)}% of the time at ${fieldNumber(s.confidence)}% confidence, keeping ${fieldNumber(s.fadeMarginDb)} dB in reserve.`,
        `Each end starts at ${fieldNumber(s.antennaGainDbi)} dBi, ${inUnit(s.defaultHeightM, s.heightUnit)} ${s.heightUnit} up.`,
        `Mesh Planner and Coverage Analysis take ${fieldNumber(s.cableLossDb + connectorsDb(s))} dB per end (${fieldNumber(s.cableLossDb)} dB cable plus ${s.connectorsPerEnd} × ${fieldNumber(s.connectorLossDb)} dB connectors). The Link Analysis works cable loss from its cable type and length, and starts its other losses at ${fieldNumber(connectorsDb(s))} dB for the connectors.`,
        `Receivers are taken as ${fieldNumber(s.sensitivityDerateDb)} dB less sensitive than the number typed.`,
        `Clutter comes from ${env}${s.environment === "auto" ? `; where it has no data, ${fallback} is used instead` : ""}. Trees are ${inUnit(s.treeHeightM, s.heightUnit)} ${s.heightUnit} tall.`,
      ];
      const list = form.querySelector('[data-out="summary"]')!;
      list.replaceChildren(
        ...items.map((t) => {
          const li = document.createElement("li");
          li.textContent = t;
          return li;
        }),
      );
    };

    const read = (): AppSettings => {
      const current = getSettings();
      const unit = field("heightUnit").value as AppSettings["heightUnit"];
      const metres = (name: string, fallback: number) => {
        const v = num(name);
        return v > 0 || (name === "defaultHeight" && v === 0) ? (unit === "ft" ? v * 0.3048 : v) : fallback;
      };
      const n = (name: keyof AppSettings, min: number, max: number) => {
        const v = num(name);
        return Number.isFinite(v) && v >= min && v <= max ? v : (current[name] as number);
      };
      return {
        reliability: n("reliability", 1, 99),
        confidence: n("confidence", 1, 99),
        fadeMarginDb: n("fadeMarginDb", 0, 60),
        kFactor: field("kFactor").value,
        antennaGainDbi: n("antennaGainDbi", -30, 50),
        cableLossDb: n("cableLossDb", 0, 30),
        connectorLossDb: n("connectorLossDb", 0, 5),
        connectorsPerEnd: Math.round(n("connectorsPerEnd", 0, 10)),
        sensitivityDerateDb: n("sensitivityDerateDb", 0, 30),
        defaultHeightM: metres("defaultHeight", current.defaultHeightM),
        environment: field("environment").value,
        fallbackEnvironment: field("fallbackEnvironment").value,
        treeHeightM: metres("treeHeight", current.treeHeightM),
        climate: field("climate").value,
        ground: field("ground").value,
        polarization: field("polarization").value,
        heightUnit: unit,
        distanceUnit: field("distanceUnit").value as AppSettings["distanceUnit"],
      };
    };

    form.addEventListener("input", (e) => {
      const target = e.target as HTMLElement;
      if (target === field("coordFormat")) return;
      if (target === field("heightUnit")) {
        // A unit change converts the shown heights; the stored metres don't move.
        const s = { ...getSettings(), heightUnit: field("heightUnit").value as AppSettings["heightUnit"] };
        setSettings(s);
        fill(s);
        summarize(s);
        return;
      }
      const s = read();
      setSettings(s);
      summarize(s);
    });
    form.addEventListener("change", (e) => {
      if (e.target === field("coordFormat")) {
        setCoordFormat(field("coordFormat").value as CoordFormat);
        window.dispatchEvent(new Event(COORD_EVENT));
      }
    });
    form.querySelector('[data-action="reset"]')!.addEventListener("click", () => {
      resetSettings();
      setCoordFormat("latlon");
      window.dispatchEvent(new Event(COORD_EVENT));
      fill(getSettings());
      summarize(getSettings());
    });

    fill(getSettings());
    summarize(getSettings());
    enhanceFields(form, settingsGuide, {});
    // There are no results to jump to here, just the summary beside the fields.
    form.querySelector(".jump-btn")?.remove();
    return form;
  },
};

