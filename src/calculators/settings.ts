// The Settings tab: the defaults the Link Analysis, Mesh Planner and Coverage
// Analysis start from. Changing a field on a tab still overrides it there.

import type { Calculator } from ".";
import { type AppSettings, connectorsDb, fieldNumber, inUnit } from "../lib/appSettings";
import { type CoordFormat, getCoordFormat, setCoordFormat } from "../lib/coords";
import { environments } from "../lib/environment";
import { kFactors } from "../lib/horizon";
import { climates, grounds } from "../lib/propagation";
import { enhanceFields } from "./fieldHelp";
import { twoTap } from "./twoTap";
import { PANE_ICONS, fitStage, moveModeBar } from "./mapFirst";
import { settingsGuide } from "./helpText";
import { getSettings, resetSettings, setSettings } from "./settingsStore";

export const COORD_EVENT = "rf-toolkit:coord-format";

/**
 * A labeled number box with its unit. A unit of "height" shows the chosen
 * height unit and follows it when it changes; no unit draws no unit box.
 */
const numberField = (label: string, name: string, unit: string, attrs = "") => `
    <label>${label}
      <span class="input-unit">
        <input name="${name}" type="number" inputmode="decimal" step="any" ${attrs} />
        ${unit ? `<span class="unit" ${unit === "height" ? 'data-height-unit=""' : ""}>${unit === "height" ? "ft" : unit}</span>` : ""}
      </span>
    </label>`;

/** Dropdown options from a list of items with an id and a name. */
const options = (items: readonly { id: string | number; name: string }[]) => items.map((i) => `<option value="${i.id}">${i.name}</option>`).join("");
const [noEnv, ...envs] = environments;

// The page in the same three columns as the other tools: the prediction and
// equipment cards on the left, the environment, propagation and units in the
// middle, and a summary of what the settings mean on the right.
const template = `
  <div class="lb-shell stage-page">
  <div class="lb-left">
    <section class="card">
      <div class="card-head"><h2 class="with-icon">${PANE_ICONS.gauge}Prediction standard</h2></div>
      <div class="fields">
        ${numberField("Reliability (time)", "reliability", "%", 'min="1" max="99"')}
        ${numberField("Confidence", "confidence", "%", 'min="1" max="99"')}
        ${numberField("Fade margin", "fadeMarginDb", "dB", 'min="0"')}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2 class="with-icon">${PANE_ICONS.radio}Equipment</h2><span class="meta">Each end of a link</span></div>
      <div class="fields">
        ${numberField("Antenna gain", "antennaGainDbi", "dBi")}
        ${numberField("Antenna height", "defaultHeight", "height", 'min="0"')}
        ${numberField("Cable loss", "cableLossDb", "dB", 'min="0"')}
        ${numberField("Connector / coupler loss", "connectorLossDb", "dB each", 'min="0"')}
        ${numberField("Connectors per end", "connectorsPerEnd", "", 'min="0" max="10" step="1"')}
        ${numberField("Sensitivity derating", "sensitivityDerateDb", "dB", 'min="0"')}
      </div>
    </section>
  </div>

  <div class="lb-stage settings-stage">
    <section class="settings-section">
      <div class="card-head"><h2 class="with-icon">${PANE_ICONS.env}Environment</h2><span class="meta">Trees, buildings and open ground</span></div>
      <div class="fields">
        <label>Environment
          <select name="environment">
            <option value="${noEnv.id}">${noEnv.name}</option>
            <option value="auto">Auto (satellite map)</option>
            ${options(envs)}
          </select>
        </label>
        <label>Land-cover fallback
          <select name="fallbackEnvironment">${options(environments)}</select>
        </label>
        ${numberField("Tree height", "treeHeight", "height", 'min="1"')}
      </div>
    </section>

    <section class="settings-section">
      <div class="card-head"><h2 class="with-icon">${PANE_ICONS.terrain}Propagation</h2><span class="meta">Every tab uses these</span></div>
      <div class="fields">
        <label>Earth curvature (k)
          <select name="kFactor">${options(kFactors)}</select>
        </label>
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

    <section class="settings-section">
      <div class="card-head"><h2 class="with-icon">${PANE_ICONS.grid}Units</h2><span class="meta">How the app shows numbers</span></div>
      <div class="fields">
        <label>Heights
          <select name="heightUnit"><option value="ft">Feet</option><option value="m">Meters</option></select>
        </label>
        <label>Distances
          <select name="distanceUnit"><option value="mi">Miles</option><option value="km">Kilometers</option></select>
        </label>
        <label>Coordinates
          <select name="coordFormat"><option value="latlon">Lat/Lon</option><option value="mgrs">MGRS</option></select>
        </label>
      </div>
    </section>
  </div>

  <aside class="results lb-right">
    <section class="card">
      <div class="card-head"><h2 class="with-icon">${PANE_ICONS.settings}Summary</h2><button type="button" class="secondary" data-action="reset">Reset</button></div>
      <div class="tiles" data-out="summary"></div>
      <p class="note settings-note">Starting values for Link, Mesh and Coverage. A field you change on a tab stays until that tab's Reset.</p>
    </section>
  </aside>
  </div>
`;

export const settingsCalculator: Calculator = {
  id: "settings",
  title: "Settings",
  // Opened from the gear in the top bar, apart from the calculators.
  inTabBar: false,
  // Builds the Settings page. Every change is checked and saved at once, and
  // the summary at the side says in words what the settings mean.
  render() {
    const form = document.createElement("form");
    form.className = "calculator settings map-first";
    form.innerHTML = template;
    form.addEventListener("submit", (e) => e.preventDefault());
    // A field in the form by its name.
    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
    // A field's value as a number (NaN when blank or not a number).
    const num = (name: string) => Number.parseFloat(field(name).value);

    // Puts settings into the form, heights in the chosen unit.
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

    // Rewrites the summary: what the settings mean, one tile per topic, each a
    // value with a short line under it.
    const summarize = (s: AppSettings) => {
      // An environment's name from its id.
      const envName = (id: string) => environments.find((e) => e.id === id)?.name ?? id;
      const auto = s.environment === "auto";
      // The two tiles with the longest notes run the full width, so the notes fit on one line.
      const tiles: [label: string, value: string, unit: string, sub: string, kind?: "word" | "wide"][] = [
        ["Plans for", fieldNumber(s.reliability), "% of the time", `at ${fieldNumber(s.confidence)}% confidence`],
        ["Fade margin", fieldNumber(s.fadeMarginDb), "dB", "kept in reserve"],
        ["Each antenna", fieldNumber(s.antennaGainDbi), "dBi", `${inUnit(s.defaultHeightM, s.heightUnit)} ${s.heightUnit} up`],
        ["Receivers", fieldNumber(s.sensitivityDerateDb), "dB", "less sensitive than typed"],
        ["Loss per end", fieldNumber(s.cableLossDb + connectorsDb(s)), "dB", `cable ${fieldNumber(s.cableLossDb)} dB + ${s.connectorsPerEnd} connectors × ${fieldNumber(s.connectorLossDb)} dB`, "wide"],
        ["Clutter", auto ? "Auto" : envName(s.environment), "", `${auto ? `${envName(s.fallbackEnvironment)} where unmapped, trees` : "Trees"} ${inUnit(s.treeHeightM, s.heightUnit)} ${s.heightUnit}`, "wide"],
      ];
      form.querySelector('[data-out="summary"]')!.replaceChildren(
        ...tiles.map(([label, value, unit, sub, kind]) => {
          const tile = document.createElement("div");
          tile.className = kind === "wide" ? "tile tile-wide" : "tile";
          const l = document.createElement("span");
          l.className = "label";
          l.textContent = label;
          const v = document.createElement("span");
          v.className = value === "Auto" || Number.isNaN(Number(value)) ? "value value-word" : "value";
          v.textContent = value;
          if (unit) {
            const u = document.createElement("span");
            u.className = "unit";
            u.textContent = unit;
            v.append(u);
          }
          const sb = document.createElement("span");
          sb.className = "sub";
          sb.textContent = sub;
          tile.append(l, v, sb);
          return tile;
        }),
      );
    };

    // The settings as the form now shows them. A number that is blank or out of
    // its range keeps its current value instead of being saved.
    const read = (): AppSettings => {
      const current = getSettings();
      const unit = field("heightUnit").value as AppSettings["heightUnit"];
      // A height field in meters. Default antenna height may be 0; anything else must be above 0.
      const meters = (name: string, fallback: number) => {
        const v = num(name);
        return v > 0 || (name === "defaultHeight" && v === 0) ? (unit === "ft" ? v * 0.3048 : v) : fallback;
      };
      // A number field kept within min and max, or its current value when it isn't.
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
        defaultHeightM: meters("defaultHeight", current.defaultHeightM),
        environment: field("environment").value,
        fallbackEnvironment: field("fallbackEnvironment").value,
        treeHeightM: meters("treeHeight", current.treeHeightM),
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
        // A unit change converts the shown heights; the stored meters don't move.
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
    // Reset puts every setting back to its default, so it asks for a second tap.
    twoTap(form.querySelector<HTMLButtonElement>('[data-action="reset"]')!, "Tap again to reset settings", () => {
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
    moveModeBar(form);
    fitStage(form);
    return form;
  },
};

