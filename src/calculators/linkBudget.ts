import { type PlanNode, decodePlan, encodePlan, planFromHash } from "../lib/plans";
import { enhanceFields } from "./fieldHelp";
import { linkBudgetGuide } from "./helpText";
import type { Calculator } from ".";
import { beyondCableRange, cableLossDb, cables, findCable, lossPer100Ft } from "../lib/coax";
import { type Environment, clutterLossDb, effectiveHeightM, findEnvironment } from "../lib/environment";
import { bindTreeField, environmentOptions, treeHeightFieldHtml, withFormTrees } from "./environmentField";
import { AUTO_ENVIRONMENT, type LandCoverPoint } from "../lib/landCover";
import { landCoverAt } from "./landCoverTiles";
import { globalK, readModel } from "./modelFields";
import { climates, grounds } from "../lib/propagation";
import { tabStateToSave, tabValues } from "../lib/appSettings";
import type { EditField } from "../lib/scene3d";
import type { RelayFinderInputs } from "./relayFinder";
import { deratedSensitivity, derateNote, fallbackEnvironment, getSettings, setSettings, sharedFields } from "./settingsStore";
import { type ModelSettings, timeAvailable } from "../lib/propagation";
import { STANDARD_K, midpointClearance } from "../lib/horizon";
import { type SiteId, createTerrainCard } from "./terrain";
import { type LatLon, distanceBetweenM } from "../lib/geo";
import { type LinkInputs, type MarginRating, freeSpaceApplies, linkBudget, rateMargin } from "../lib/linkBudget";
import { linkQuality } from "../lib/linkLines";
import {
  type DistanceUnit,
  dbmToWatts,
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

const STORAGE_KEY = "rf-toolkit:link-budget";
// Cards start closed; this remembers which ones you open.
const PANES_KEY = "rf-toolkit:link-panes";
const SIDES_KEY = "rf-toolkit:link-sides";

// The built-in defaults from before Settings existed. Settings now override the
// fields they cover; these still fill the rest and recognise untouched old saves.
const legacyDefaults: Record<string, string> = {
  txSens: "-100",
  rxPower: "1",
  rxPowerUnit: "W",
  txName: "",
  rxName: "",
  relayName: "",
  relayPower: "1",
  relayPowerUnit: "W",
  relayCable: "1",
  relayGain: "3",
  relayHeight: "30",
  relayHeightUnit: "ft",
  relaySens: "-100",
  freq: "915",
  freqUnit: "MHz",
  txPower: "1",
  txPowerUnit: "W",
  txCable: "lmr-400",
  txCableLen: "10",
  txCableUnit: "ft",
  txOther: "0.5",
  txGain: "3",
  txHeight: "30",
  txHeightUnit: "ft",
  dist: "3",
  environment: "none",
  treeHeight: "",
  extraLoss: "0",
  rxGain: "3",
  rxHeight: "30",
  rxHeightUnit: "ft",
  rxCable: "lmr-400",
  rxCableLen: "10",
  rxCableUnit: "ft",
  rxOther: "0.5",
  rxSens: "-100",
  fadeMargin: "10",

};

const hfWarning =
  "Below 30 MHz, signals travel by ground wave and skywave, not line of sight, so " +
  "free-space loss, margin and range don't reflect real HF performance. Use an HF " +
  "propagation tool such as VOACAP for these bands.";

const ratingText: Record<MarginRating, string> = {
  good: "Good link",
  fair: "Workable link",
  marginal: "Marginal link",
  fail: "Bad link",
};
/** Margin at or above which a good link reads "Superior link", dB. */
const SUPERIOR_DB = 30;
/** The words for a margin: five steps, from the four ratings plus one above good. */
const ratingWords = (rating: MarginRating, marginDb: number) => (rating === "good" && marginDb >= SUPERIOR_DB ? "Superior link" : ratingText[rating]);

function options(values: readonly string[], selected: string): string {
  return values.map((v) => `<option${v === selected ? " selected" : ""}>${v}</option>`).join("");
}

function cableOptions(): string {
  return [`<option value="none">None (direct)</option>`]
    .concat(cables.map((c) => `<option value="${c.id}">${c.name}</option>`))
    .join("");
}

function numberField(label: string, name: string, unit: string, attrs = ""): string {
  return `
    <label>${label}
      <span class="input-unit">
        <input name="${name}" type="number" inputmode="decimal" step="any" ${attrs} />
        <span class="unit">${unit}</span>
      </span>
    </label>`;
}

function unitField(label: string, name: string, units: readonly string[], unitName: string): string {
  return `
    <label>${label}
      <span class="input-unit">
        <input name="${name}" type="number" inputmode="decimal" step="any" min="0" />
        <select name="${unitName}">${options(units, "")}</select>
      </span>
    </label>`;
}

function cableFields(side: "tx" | "rx"): string {
  return `
    <label>Coax
      <select name="${side}Cable">${cableOptions()}</select>
    </label>
    <div data-show="${side}Cable">
      ${unitField("Coax length", `${side}CableLen`, ["ft", "m"], `${side}CableUnit`)}
    </div>
    <p class="note span-all" data-out="${side}CableNote"></p>`;
}

const svgIcon = (paths: string) => `<svg class="pane-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const PANE_ICONS = {
  tx: svgIcon('<path d="M12 12v9M9 21h6"/><circle cx="12" cy="10" r="2"/><path d="M8.5 6.5a5 5 0 0 0 0 7M15.5 6.5a5 5 0 0 1 0 7M5.6 3.6a9 9 0 0 0 0 12.8M18.4 3.6a9 9 0 0 1 0 12.8"/>'),
  rx: svgIcon('<path d="M4 20h16"/><path d="M6 20 12 6l6 14"/><path d="M8.5 15h7"/><path d="M12 3v3"/>'),
  relay: svgIcon('<circle cx="5" cy="17" r="2"/><circle cx="19" cy="17" r="2"/><circle cx="12" cy="6" r="2"/><path d="m6.5 15.5 4-7.5M17.5 15.5l-4-7.5"/>'),
  env: svgIcon('<path d="M12 21v-5"/><path d="m12 3-6 9h3l-3 4h12l-3-4h3z"/>'),
  terrain: svgIcon('<path d="m3 19 6-9 4 5 3-4 5 8z"/>'),
  share: svgIcon('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/>'),
  budget: svgIcon('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
};

/** An expandable card in the left pane. */
const pane = (id: keyof typeof PANE_ICONS, title: string, body: string, extraSummary = "") => `
    <details class="pane-card" data-pane="${id}">
      <summary>${PANE_ICONS[id]}<span class="pane-title">${title}</span>${extraSummary}</summary>
      <div class="pane-body">${body}</div>
    </details>`;

const template = `
  <div class="lb-shell floating">
  <button type="button" class="side-toggle" data-side="left" aria-expanded="true" aria-label="Hide the settings pane"></button>
  <button type="button" class="side-toggle" data-side="right" aria-expanded="true" aria-label="Hide the link budget"></button>
  <div class="lb-left">
    ${pane("tx", "Transmitter", `
      <div class="fields">
        <label>Name
          <input name="txName" type="text" autocomplete="off" maxlength="40" placeholder="Site A" />
        </label>
        <div class="pane-slot" data-slot="tx"></div>
        ${unitField("Frequency", "freq", Object.keys(frequencyUnits), "freqUnit")}
        ${unitField("TX power", "txPower", powerUnits, "txPowerUnit")}
        ${cableFields("tx")}
        ${numberField("Other losses", "txOther", "dB", 'min="0" title="Connectors, lightning arrestor, filters"')}
        ${numberField("Antenna gain", "txGain", "dBi")}
        ${unitField("Antenna height", "txHeight", ["ft", "m"], "txHeightUnit")}
        ${numberField("Sensitivity", "txSens", "dBm", 'title="From the radio datasheet, for the data rate or mode you use"')}
      </div>`)}

    ${pane("rx", "Receiver", `
      <div class="fields">
        <label>Name
          <input name="rxName" type="text" autocomplete="off" maxlength="40" placeholder="Site B" />
        </label>
        <div class="pane-slot" data-slot="rx"></div>
        ${unitField("TX power", "rxPower", powerUnits, "rxPowerUnit")}
        ${numberField("Antenna gain", "rxGain", "dBi")}
        ${unitField("Antenna height", "rxHeight", ["ft", "m"], "rxHeightUnit")}
        ${cableFields("rx")}
        ${numberField("Other losses", "rxOther", "dB", 'min="0"')}
        ${numberField("Sensitivity", "rxSens", "dBm", 'title="From the radio datasheet, for the data rate or mode you use"')}
        ${numberField("Fade margin wanted", "fadeMargin", "dB", 'min="0" title="Used for the max range"')}
      </div>`)}

    ${pane("relay", "Relay", `
      <div class="pane-slot" data-slot="relay"></div>
      <div class="relay-radio" data-card="relay" hidden>
      <div class="fields">
        <label>Name
          <input name="relayName" type="text" autocomplete="off" maxlength="40" placeholder="Relay" />
        </label>
        ${unitField("TX power", "relayPower", powerUnits, "relayPowerUnit")}
        ${numberField("Cable & connector loss", "relayCable", "dB", 'min="0"')}
        ${numberField("Antenna gain", "relayGain", "dBi")}
        ${unitField("Antenna height", "relayHeight", ["ft", "m"], "relayHeightUnit")}
        ${numberField("Sensitivity", "relaySens", "dBm")}
      </div>
      </div>`)}

    ${pane("env", "Environment", `
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
        ${numberField("Extra path loss", "extraLoss", "dB", 'min="0" title="Foliage, buildings, rain, partial Fresnel blockage"')}
      </div>
      <table class="ledger geometry" data-out="geometry">
        <tbody>
          <tr><td>Radio horizon for these heights</td><td class="num mono" data-out="horizon"></td></tr>
          <tr><td>Earth bulge at midpoint</td><td class="num mono" data-out="bulge"></td></tr>
          <tr><td>Beam height above it</td><td class="num mono" data-out="clearance"></td></tr>
          <tr><td>Needed (60% first Fresnel zone)</td><td class="num mono" data-out="fresnel"></td></tr>
        </tbody>
      </table>
      <p class="callout" data-out="geoWarn" hidden></p>
      <p class="callout" data-out="hfPath" hidden>${hfWarning}</p>`)}

    ${pane("terrain", "Terrain profile", `<div class="pane-slot" data-slot="profile"></div>`, '<span class="pane-pill" data-slot="pill"></span>')}

    ${pane("share", "Share", `<div class="pane-slot" data-slot="share"></div>`)}
  </div>

  <div class="lb-map" data-slot="map"></div>

  <aside class="results lb-right">
    <section class="card">
      <div class="card-head">
        <h2 class="with-icon">${PANE_ICONS.budget}Link budget</h2>
        <span class="pill" data-out="rating"></span>
        <button type="button" class="secondary" data-action="reset">Reset</button>
      </div>
      <p class="callout" data-out="hfResult" hidden>${hfWarning}</p>
      <div class="tiles">
        <div class="tile">
          <span class="label">Received signal</span>
          <span class="value" data-out="rsl"></span>
        </div>
        <div class="tile">
          <span class="label">Link margin</span>
          <span class="value" data-out="margin"></span>
          <span class="sub" data-out="marginSub"></span>
        </div>
        <div class="tile">
          <span class="label">TX EIRP</span>
          <span class="value" data-out="eirp"></span>
          <span class="sub" data-out="eirpW"></span>
        </div>
        <div class="tile">
          <span class="label">RX EIRP</span>
          <span class="value" data-out="eirpB"></span>
          <span class="sub" data-out="eirpBW"></span>
        </div>
        <div class="tile wide-tile">
          <span class="label">Free-space path loss</span>
          <span class="value" data-out="fspl"></span>
        </div>
        <div class="tile wide-tile tile-field">
          <label>Distance
            <span class="input-unit">
              <span class="value" data-out="distValue" hidden></span>
              <input name="dist" type="number" inputmode="decimal" step="any" min="0" />
              <span class="unit" data-out="distUnitLabel"></span>
            </span>
          </label>
        </div>
      </div>
      <p class="error" data-out="error" hidden></p>
      <details class="budget-details">
      <summary>Full budget</summary>
      <p class="note" data-out="dirNote" hidden></p>
      <div class="dir-switch" data-out="dirWrap" hidden>
        <span class="note">Details for</span>
        <div class="seg" role="group" aria-label="Direction shown">
          <button type="button" data-dir="ab"></button>
          <button type="button" data-dir="ba"></button>
        </div>
      </div>
      <div class="budget-flow" data-out="ledger"></div>
      </details>
      <div class="relay-results" data-out="relayResults" hidden>
        <div class="card-head"><h3>Through the relay</h3><span class="pill" data-out="relayRating"></span></div>
        <table class="ledger">
          <thead><tr><th>Hop</th><th class="num">Distance</th><th class="num">Margin</th></tr></thead>
          <tbody data-out="relayHops"></tbody>
        </table>
        <p class="note" data-out="relayNote"></p>
      </div>
    </section>
  </aside>
  </div>

  <div class="summary-bar">
    <span aria-hidden="true"><span class="k">Signal</span> <b data-out="barRsl"></b></span>
    <span aria-hidden="true"><span class="k">Margin</span> <b data-out="barMargin"></b></span>
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
    fadeMargin: s.fade,
    txGain: s.gain,
    rxGain: s.gain,
    // RG-213 is the default coax; LMR-400 was, so old saves still on it follow.
    txCable: "rg-213",
    rxCable: "rg-213",
    txOther: s.connectors,
    rxOther: s.connectors,
    relayGain: s.gain,
    relayCable: s.cableAndConnectors,
    relayHeight: s.height,
    relayHeightUnit: s.heightUnit,
    txHeight: s.height,
    rxHeight: s.height,
    txHeightUnit: s.heightUnit,
    rxHeightUnit: s.heightUnit,
    environment: s.environment,
    treeHeight: s.treeHeight,
  };
}

function loadState(defaults: Record<string, string>): Record<string, string> {
  try {
    return tabValues(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"), defaults, legacyDefaults);
  } catch {
    return { ...defaults };
  }
}

function saveState(state: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode or storage blocked: inputs just won't be remembered.
  }
}

const fmt = (value: number, digits = 2) =>
  value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace("-", "−");
const dbm = (value: number) => `${value < 0 ? "−" : ""}${fmt(Math.abs(value))}<span class="unit">dBm</span>`;
const db = (value: number) => `${value < 0 ? "−" : ""}${fmt(Math.abs(value))}<span class="unit">dB</span>`;

function formatWatts(watts: number): string {
  if (watts >= 1) return `${fmt(watts, watts >= 100 ? 0 : 2)} W`;
  if (watts >= 1e-3) return `${fmt(watts * 1e3, 1)} mW`;
  return `${fmt(watts * 1e6, 1)} µW`;
}

/** How often the link holds, under the margin. */
function availabilityText(percent: number, model: ModelSettings): string {
  const at = ` at ${fmt(model.confidence, 0)}% confidence`;
  if (percent >= 99.9) return `Holds over 99.9% of the time${at}`;
  if (percent <= 0.1) return `Holds under 0.1% of the time${at}`;
  return `Holds about ${fmt(percent, percent >= 99 ? 1 : 0)}% of the time${at}`;
}

function formatRange(metres: number, unit: DistanceUnit): string {
  const value = fromMetres(metres, unit);
  return value >= 1e5 ? "Beyond 100,000" : fmt(value, value < 10 ? 2 : 1);
}

export const linkBudgetCalculator: Calculator = {
  id: "link",
  aliases: ["fspl"],
  title: "Link Analysis",
  shortTitle: "Link",
  render() {
    const form = document.createElement("form");
    const defaults = currentDefaults();
    form.className = "calculator link-budget map-first";
    form.innerHTML = template;
    bindTreeField(form, "txHeightUnit");
    form.addEventListener("submit", (e) => e.preventDefault());

    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
    const out = (name: string) => form.querySelector<HTMLElement>(`[data-out="${name}"]`)!;
    const num = (name: string) => Number.parseFloat(field(name).value);

    const state = loadState(defaults);
    const fill = (values: Record<string, string>) => {
      for (const [name, value] of Object.entries(values)) {
        const el = form.elements.namedItem(name);
        if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.value = value;
      }
    };
    fill(state);

    // What each site shows in the 3D view's editor, by field name.
    const siteFields = (site: SiteId): EditField[] => {
      const f = (key: string, label: string, unit?: string, type: "text" | "number" = "number"): EditField => ({ key, label, value: field(key).value, unit, type });
      const unitOf = (name: string) => field(name).value;
      if (site === "tx")
        return [f("txName", "Name", undefined, "text"), f("txPower", "TX power", unitOf("txPowerUnit")), f("txSens", "Sensitivity", "dBm"), f("txGain", "Antenna gain", "dBi"), f("txHeight", "Antenna height", unitOf("txHeightUnit"))];
      if (site === "rx")
        return [f("rxName", "Name", undefined, "text"), f("rxPower", "TX power", unitOf("rxPowerUnit")), f("rxSens", "Sensitivity", "dBm"), f("rxGain", "Antenna gain", "dBi"), f("rxHeight", "Antenna height", unitOf("rxHeightUnit"))];
      return [
        f("relayName", "Name", undefined, "text"),
        f("relayPower", "TX power", unitOf("relayPowerUnit")),
        f("relaySens", "Sensitivity", "dBm"),
        f("relayGain", "Antenna gain", "dBi"),
        f("relayHeight", "Antenna height", unitOf("relayHeightUnit")),
      ];
    };
    // A change from the 3D editor lands in the field, as if typed there.
    const editSite = (_site: SiteId, values: Record<string, string>) => {
      for (const [key, value] of Object.entries(values)) {
        const control = field(key);
        if (!control) continue;
        control.value = value;
        control.dispatchEvent(new Event("input", { bubbles: true }));
      }
      terrain.namesChanged();
    };

    const terrain = createTerrainCard(() => update(), {
      names: () => ({ tx: field("txName").value, rx: field("rxName").value, relay: field("relayName").value }),
      fields: siteFields,
      edit: editSite,
      shareUrl: () => {
        const settings: Record<string, string> = {};
        for (const name of Object.keys(defaults)) settings[name] = field(name).value;
        const pins = terrain.pins();
        const relay = terrain.relay();
        const nodes: PlanNode[] = pins
          ? [
              { name: field("txName").value, lat: pins.tx.lat, lon: pins.tx.lon, height: "" },
              { name: field("rxName").value, lat: pins.rx.lat, lon: pins.rx.lon, height: "" },
              ...(relay ? [{ name: field("relayName").value, lat: relay.lat, lon: relay.lon, height: "" }] : []),
            ]
          : [];
        return `${location.origin}${location.pathname}#link?plan=${encodePlan({ settings, nodes })}`;
      },
      setName: (site, name) => {
        field(`${site}Name`).value = name;
        field(`${site}Name`).dispatchEvent(new Event("input", { bubbles: true }));
      },
      finderInputs: () => finderInputs(),
      fadeMarginDb: () => num("fadeMargin") || 0,
    });
    for (const name of ["txName", "rxName", "relayName"]) field(name).addEventListener("input", () => terrain.namesChanged());
    // The terrain card's parts go where they belong in this layout.
    for (const [name, part] of Object.entries(terrain.parts)) form.querySelector(`[data-slot="${name}"]`)!.append(part);
    const profilePill = terrain.parts.profile.querySelector(".pill");
    if (profilePill) form.querySelector('[data-slot="pill"]')!.append(profilePill);
    // Which cards are open is remembered on this device.
    const panes = [...form.querySelectorAll<HTMLDetailsElement>("details.pane-card")];
    const openPanes = (() => {
      try {
        return JSON.parse(localStorage.getItem(PANES_KEY) ?? "null") as Record<string, boolean> | null;
      } catch {
        return null;
      }
    })() ?? {};
    for (const p of panes) {
      p.open = !!openPanes[p.dataset.pane!];
      p.addEventListener("toggle", () => {
        openPanes[p.dataset.pane!] = p.open;
        try {
          localStorage.setItem(PANES_KEY, JSON.stringify(openPanes));
        } catch {
          // Storage blocked: the cards open as they started next time.
        }
        // The profile is drawn to its card's width, which is zero while closed.
        if (p.open && p.dataset.pane === "terrain") terrain.redraw();
      });
    }
    // Either side pane folds away to give the map the room; remembered here.
    const sides = (() => {
      try {
        return JSON.parse(localStorage.getItem(SIDES_KEY) ?? "{}") as Record<string, boolean>;
      } catch {
        return {};
      }
    })();
    const syncSides = () => {
      for (const side of ["left", "right"]) {
        const closed = !!sides[side];
        form.querySelector(".lb-shell")!.classList.toggle(`${side}-closed`, closed);
        const b = form.querySelector<HTMLButtonElement>(`.side-toggle[data-side="${side}"]`)!;
        b.setAttribute("aria-expanded", String(!closed));
        b.setAttribute("aria-label", `${closed ? "Show" : "Hide"} the ${side === "left" ? "settings pane" : "link budget"}`);
      }
    };
    for (const b of form.querySelectorAll<HTMLButtonElement>(".side-toggle")) {
      b.addEventListener("click", () => {
        sides[b.dataset.side!] = !sides[b.dataset.side!];
        try {
          localStorage.setItem(SIDES_KEY, JSON.stringify(sides));
        } catch {
          // Storage blocked: just for now.
        }
        syncSides();
      });
    }
    syncSides();
    // With the panes floating on the map, its taskbar, key and messages centre
    // in the gap between them, and the taskbar drops its labels when that gap
    // is too narrow for them.
    const floating = window.matchMedia("(min-width: 1100px)");
    const fitTaskbar = () => {
      const shellEl = form.querySelector<HTMLElement>(".lb-shell")!;
      const bar = form.querySelector<HTMLElement>(".map-taskbar");
      if (!shellEl.isConnected) return;
      if (!floating.matches) {
        shellEl.style.removeProperty("--gap-center");
        bar?.classList.remove("compact");
        return;
      }
      const box = shellEl.getBoundingClientRect();
      const left = form.querySelector<HTMLElement>(".lb-left")!.getBoundingClientRect();
      const right = form.querySelector<HTMLElement>(".lb-right")!.getBoundingClientRect();
      const from = left.width ? left.right - box.left : 0;
      const to = right.width ? right.left - box.left : box.width;
      shellEl.style.setProperty("--gap-center", `${(from + to) / 2}px`);
      if (!bar) return;
      bar.classList.remove("compact");
      if (bar.offsetWidth > to - from - 24) bar.classList.add("compact");
    };
    new ResizeObserver(fitTaskbar).observe(form.querySelector(".lb-shell")!);
    for (const p of panes) p.addEventListener("toggle", fitTaskbar);
    for (const b of form.querySelectorAll(".side-toggle")) b.addEventListener("click", fitTaskbar);
    // The taskbar arrives with the map, a moment after the page.
    const waitForBar = () => {
      if (form.querySelector(".map-taskbar")) fitTaskbar();
      else if (form.isConnected) setTimeout(waitForBar, 100);
    };
    setTimeout(waitForBar, 0);
    // The page fills the window below the header, so the map gets all the height.
    const shell = form.querySelector<HTMLElement>(".lb-shell")!;
    const fitShell = () => {
      if (!shell.isConnected) return;
      shell.style.setProperty("--lb-top", `${Math.max(0, shell.getBoundingClientRect().top + window.scrollY)}px`);
    };
    new ResizeObserver(fitShell).observe(document.body);
    window.addEventListener("resize", fitShell);
    requestAnimationFrame(fitShell);

    // Land cover at the two pins, when Environment is "Auto (satellite map)".
    let cover: { key: string; ends?: [LandCoverPoint, LandCoverPoint]; error?: string } | undefined;
    const landCover = (): { ends?: [LandCoverPoint, LandCoverPoint]; note: string } => {
      const pins = terrain.pins();
      if (!pins) return { note: `Drop both pins in Terrain profile to read the land cover at each end. Until then ${fallbackEnvironment().name} is used (the land-cover fallback in Settings).` };
      const key = JSON.stringify(pins);
      if (cover?.key !== key) {
        const mine = { key } as NonNullable<typeof cover>;
        cover = mine;
        landCoverAt([pins.tx, pins.rx])
          .then(([a, b]) => (mine.ends = [a, b]))
          .catch((err: Error) => {
            mine.error = navigator.onLine ? err.message : "no connection, and this area isn't saved";
          })
          .finally(() => cover === mine && update());
      }
      if (cover.error) return { note: `Couldn't read the land-cover map (${cover.error}), so ${fallbackEnvironment().name} is used instead (the land-cover fallback in Settings).` };
      if (!cover.ends) return { note: `Reading the land-cover map… ${fallbackEnvironment().name} is used until it loads.` };
      return { ends: cover.ends, note: "" };
    };

    // Cable loss for one side, plus the note under the cable picker.
    const sideCable = (side: "tx" | "rx", freqHz: number): number => {
      const cable = findCable(field(`${side}Cable`).value);
      form.querySelector<HTMLElement>(`[data-show="${side}Cable"]`)!.hidden = !cable;
      const note = out(`${side}CableNote`);
      if (!cable) {
        note.textContent = "";
        return 0;
      }
      const lengthM = toMetres(num(`${side}CableLen`) || 0, asDistanceUnit(field(`${side}CableUnit`).value));
      if (!(freqHz > 0) || lengthM < 0) {
        note.textContent = "";
        return 0;
      }
      const loss = cableLossDb(cable, freqHz, lengthM);
      note.textContent =
        `${fmt(lossPer100Ft(cable, freqHz))} dB per 100 ft · ${fmt(loss)} dB for this run` +
        (beyondCableRange(cable, freqHz) ? ` · above the ${cable.maxMHz} MHz this data covers, so treat it as rough` : "");
      note.classList.toggle("warn", beyondCableRange(cable, freqHz));
      return loss;
    };

    // Smooth-earth horizon and midpoint Fresnel clearance, in the Path card.
    const showGeometry = (i: LinkInputs, horizonM: number, beyond: boolean, distUnit: DistanceUnit) => {
      const heightUnit = asDistanceUnit(field("txHeightUnit").value);
      const height = (m: number) => `${m < 0 ? "−" : ""}${fmt(fromMetres(Math.abs(m), heightUnit), 1)} ${heightUnit}`;
      out("horizon").textContent = `${formatRange(horizonM, distUnit)} ${distUnit}`;

      const warn = out("geoWarn");
      if (beyond) {
        for (const name of ["bulge", "clearance", "fresnel"]) out(name).textContent = dash;
        warn.textContent =
          `This path is past the ${formatRange(horizonM, distUnit)} ${distUnit} radio horizon, so the ` +
          "earth blocks the direct signal. Raise the antennas or shorten the path.";
        warn.hidden = false;
        return;
      }
      const c = midpointClearance(i.freqHz, i.distanceM, i.txHeightM, i.rxHeightM, i.k);
      out("bulge").textContent = height(c.bulgeM);
      out("clearance").textContent = height(c.clearanceM);
      out("fresnel").textContent = height(c.neededM);
      // An Environment already charges for this, so don't suggest adding it again.
      if (c.clearanceM < c.neededM && field("environment").value === "none") {
        warn.textContent =
          `The beam is only ${height(c.clearanceM)} above smooth ground at the midpoint, ` +
          `short of the ${height(c.neededM)} it needs, so the ground eats into the Fresnel ` +
          "zone. Expect more loss than free space; add it as extra path loss, or raise the " +
          "antennas. Terrain and trees along the path make this worse.";
        warn.hidden = false;
      }
    };
    const dash = "—";

    const siteName = (site: SiteId) => field(`${site}Name`).value.trim() || { tx: "Site A", rx: "Site B", relay: "Relay" }[site];
    const relayHeightM = () => toMetres(num("relayHeight") || 0, asDistanceUnit(field("relayHeightUnit").value));
    const relayPowerDbm = () => toDbm(num("relayPower"), asPowerUnit(field("relayPowerUnit").value));

    // The environment at each site: the land-cover map at TX and RX when
    // chosen; the relay takes the chosen profile, or the Settings fallback.
    const siteEnvironments = () => {
      const auto = field("environment").value === AUTO_ENVIRONMENT;
      const ends = auto ? landCover() : undefined;
      const trees = (e: Environment) => withFormTrees(form, "txHeightUnit", e);
      const env = trees(auto ? fallbackEnvironment() : findEnvironment(field("environment").value));
      return { auto, ends, env, txEnv: trees(ends?.ends?.[0].environment ?? env), rxEnv: trees(ends?.ends?.[1].environment ?? env), relayEnv: env };
    };

    // Each site's radio: power and derated sensitivity.
    const sitePower = (site: SiteId): number => {
      if (site === "relay") return relayPowerDbm();
      const name = site === "tx" ? "txPower" : "rxPower";
      return toDbm(num(name), asPowerUnit(field(`${name}Unit`).value));
    };
    const siteSens = (site: SiteId): number =>
      deratedSensitivity(num(site === "relay" ? "relaySens" : site === "tx" ? "txSens" : "rxSens"));

    /** Both hops' radios for the relay finder, or why it can't run. */
    const finderInputs = (): RelayFinderInputs | string => {
      const pins = terrain.pins();
      if (!pins) return `Drop both ${siteName("tx")} and ${siteName("rx")} first.`;
      const freqHz = toHz(num("freq"), asFrequencyUnit(field("freqUnit").value));
      if (!(freqHz > 0) || !freeSpaceApplies(freqHz)) return "The relay finder needs a frequency of 30 MHz or more.";
      const relayPower = relayPowerDbm();
      if (![sitePower("tx"), sitePower("rx"), relayPower].every(Number.isFinite)) return "Enter TX power for both sites and the relay.";
      if (![siteSens("tx"), siteSens("rx"), siteSens("relay")].every(Number.isFinite)) return "Enter the sensitivity of both sites and the relay.";
      const { txEnv, rxEnv, relayEnv } = siteEnvironments();
      const txH = toMetres(num("txHeight") || 0, asDistanceUnit(field("txHeightUnit").value));
      const rxH = toMetres(num("rxHeight") || 0, asDistanceUnit(field("rxHeightUnit").value));
      const relayH = relayHeightM();
      const extra = num("extraLoss") || 0;
      const relayCable = num("relayCable") || 0;
      const relayGain = num("relayGain") || 0;
      const aLoss = sideCable("tx", freqHz) + (num("txOther") || 0);
      const bLoss = sideCable("rx", freqHz) + (num("rxOther") || 0);
      const aGain = num("txGain") || 0;
      const bGain = num("rxGain") || 0;
      const clutter1 = clutterLossDb(txEnv, freqHz, txH) + clutterLossDb(relayEnv, freqHz, relayH) + extra;
      const clutter2 = clutterLossDb(relayEnv, freqHz, relayH) + clutterLossDb(rxEnv, freqHz, rxH) + extra;
      return {
        a: pins.tx,
        b: pins.rx,
        freqHz,
        model: readModel(form),
        aHeightM: effectiveHeightM(txEnv, txH),
        bHeightM: effectiveHeightM(rxEnv, rxH),
        relayHeightM: effectiveHeightM(relayEnv, relayH),
        // Each hop both ways: the weaker direction is the one that limits.
        hop1: [
          {
            eirpDbm: sitePower("tx") - aLoss + aGain,
            rxGainDbi: relayGain,
            rxCableLossDb: relayCable,
            sensitivityDbm: siteSens("relay"),
            clutterLossDb: clutter1,
          },
          { eirpDbm: relayPower - relayCable + relayGain, rxGainDbi: aGain, rxCableLossDb: aLoss, sensitivityDbm: siteSens("tx"), clutterLossDb: clutter1 },
        ],
        hop2: [
          { eirpDbm: relayPower - relayCable + relayGain, rxGainDbi: bGain, rxCableLossDb: bLoss, sensitivityDbm: siteSens("rx"), clutterLossDb: clutter2 },
          {
            eirpDbm: sitePower("rx") - bLoss + bGain,
            rxGainDbi: relayGain,
            rxCableLossDb: relayCable,
            sensitivityDbm: siteSens("relay"),
            clutterLossDb: clutter2,
          },
        ],
      };
    };

    const update = () => {
      // Distances in the unit chosen in Settings.
      const distUnit = asDistanceUnit(getSettings().distanceUnit);
      out("distUnitLabel").textContent = distUnit === "km" ? "Kilometers" : "Miles";
      // With both pins down, the map sets the distance.
      const pinned = terrain.pathDistanceM();
      const distInput = field("dist") as HTMLInputElement;
      distInput.readOnly = pinned !== undefined;
      if (pinned !== undefined) distInput.value = fromMetres(pinned, distUnit).toFixed(2);
      // From the pins it reads like the other tiles; without them it's a field to type in.
      distInput.hidden = pinned !== undefined;
      out("distValue").hidden = pinned === undefined;
      out("distValue").textContent = pinned !== undefined ? distInput.value : "";

      for (const name of Object.keys(defaults)) state[name] = field(name).value;
      saveState(tabStateToSave(state, defaults));

      const freqHz = toHz(num("freq"), asFrequencyUnit(field("freqUnit").value));
      const { txEnv, rxEnv, relayEnv } = siteEnvironments();
      const txHeightM = toMetres(num("txHeight") || 0, asDistanceUnit(field("txHeightUnit").value));
      const rxHeightM = toMetres(num("rxHeight") || 0, asDistanceUnit(field("rxHeightUnit").value));
      const inputs: LinkInputs = {
        freqHz,
        distanceM: toMetres(num("dist"), distUnit),
        txPowerDbm: toDbm(num("txPower"), asPowerUnit(field("txPowerUnit").value)),
        txCableLossDb: sideCable("tx", freqHz),
        txOtherLossDb: num("txOther") || 0,
        txGainDbi: num("txGain") || 0,
        extraPathLossDb: num("extraLoss") || 0,
        rxGainDbi: num("rxGain") || 0,
        rxCableLossDb: sideCable("rx", freqHz),
        rxOtherLossDb: num("rxOther") || 0,
        rxSensitivityDbm: deratedSensitivity(num("rxSens")),
        fadeMarginDb: num("fadeMargin") || 0,
        txHeightM,
        rxHeightM,
        clutterLossDb: clutterLossDb(txEnv, freqHz, txHeightM) + clutterLossDb(rxEnv, freqHz, rxHeightM),
        k: globalK(),
      };

      // B back to A: the same path, each end's own power, gains, losses and sensitivity.
      const reverse: LinkInputs = {
        ...inputs,
        txPowerDbm: sitePower("rx"),
        txCableLossDb: inputs.rxCableLossDb,
        txOtherLossDb: inputs.rxOtherLossDb,
        txGainDbi: inputs.rxGainDbi,
        rxGainDbi: inputs.txGainDbi,
        rxCableLossDb: inputs.txCableLossDb,
        rxOtherLossDb: inputs.txOtherLossDb,
        rxSensitivityDbm: siteSens("tx"),
        txHeightM: rxHeightM,
        rxHeightM: txHeightM,
      };
      const problem =
        !(inputs.freqHz > 0) ? "Enter a frequency above zero."
        : !(inputs.distanceM > 0) ? "Enter a distance above zero."
        : !Number.isFinite(inputs.txPowerDbm) ? `Enter ${siteName("tx")}'s TX power.`
        : !Number.isFinite(reverse.txPowerDbm) ? `Enter ${siteName("rx")}'s TX power.`
        : !Number.isFinite(inputs.rxSensitivityDbm) ? `Enter ${siteName("rx")}'s sensitivity.`
        : !Number.isFinite(reverse.rxSensitivityDbm) ? `Enter ${siteName("tx")}'s sensitivity.`
        : "";

      out("error").hidden = !problem;
      out("error").textContent = problem;
      const hf = inputs.freqHz > 0 && !freeSpaceApplies(inputs.freqHz);
      out("hfPath").hidden = !hf;
      out("hfResult").hidden = !hf;
      out("geometry").hidden = hf || !!problem;
      out("geoWarn").hidden = true;

      const model = readModel(form);
      const terrainParams = {
        freqHz: inputs.freqHz,
        // The terrain path runs from the top of the clutter (or the antenna
        // itself in woodland); the clutter loss covers the rest. The horizon
        // above stays on the real antennas.
        txHeightM: effectiveHeightM(txEnv, txHeightM),
        rxHeightM: effectiveHeightM(rxEnv, rxHeightM),
        distUnit,
        heightUnit: asDistanceUnit(field("txHeightUnit").value),
        applies: !hf && !problem,
        model,
        k: inputs.k ?? STANDARD_K,
        relayHeightM: effectiveHeightM(relayEnv, relayHeightM()),
      };
      const profile = terrain.refresh(terrainParams);
      const relayAt = terrain.relay();
      form.querySelector<HTMLElement>('[data-card="relay"]')!.hidden = !relayAt;

      if (problem) {
        out("dirNote").hidden = out("dirWrap").hidden = true;
        for (const name of ["eirp", "eirpW", "eirpB", "eirpBW", "fspl", "rsl", "margin", "marginSub", "barRsl", "barMargin"]) {
          out(name).textContent = dash;
        }
        out("rating").hidden = true;
        out("ledger").replaceChildren();
        out("relayResults").hidden = true;
        terrain.showLink(undefined);
        terrain.showHops(undefined, undefined);
        return;
      }

      inputs.terrainLossDb = reverse.terrainLossDb = profile?.loss.lossDb ?? 0;
      const forward = linkBudget(inputs);
      const backward = linkBudget(reverse);
      // The weaker direction rates the link; the details follow the switch, or the weaker one.
      const weakerDir: "ab" | "ba" = backward.marginDb < forward.marginDb ? "ba" : "ab";
      const weakest = Math.min(forward.marginDb, backward.marginDb);
      const dir = ledgerDir ?? weakerDir;
      const r = dir === "ab" ? forward : backward;
      const shown = dir === "ab" ? inputs : reverse;
      const [fromName, toName] = dir === "ab" ? [siteName("tx"), siteName("rx")] : [siteName("rx"), siteName("tx")];
      const rating = rateMargin(weakest);
      // The map line follows the same rule as the Mesh Analysis: good once the fade margin is covered.
      terrain.showLink(hf ? undefined : linkQuality(weakest, inputs.fadeMarginDb));

      out("eirp").innerHTML = dbm(forward.eirpDbm);
      out("eirpW").textContent = formatWatts(dbmToWatts(forward.eirpDbm));
      out("eirpB").innerHTML = dbm(backward.eirpDbm);
      out("eirpBW").textContent = formatWatts(dbmToWatts(backward.eirpDbm));
      const ab = `${siteName("tx")} → ${siteName("rx")}`;
      const ba = `${siteName("rx")} → ${siteName("tx")}`;
      const same = Math.abs(forward.marginDb - backward.marginDb) < 0.05;
      out("dirNote").hidden = hf;
      // Only worth saying when the two ways differ.
      out("dirNote").hidden = hf || same;
      out("dirNote").textContent = `The weaker way, ${weakerDir === "ab" ? ab : ba}, sets the link.`;
      out("dirWrap").hidden = hf || same;
      for (const b of form.querySelectorAll<HTMLButtonElement>("[data-dir]")) {
        b.textContent = b.dataset.dir === "ab" ? ab : ba;
        b.setAttribute("aria-pressed", String(b.dataset.dir === dir));
      }
      out("fspl").innerHTML = db(forward.fsplDb);
      out("rsl").innerHTML = dbm(r.rslDbm);
      out("margin").innerHTML = db(r.marginDb);
      out("marginSub").textContent = profile?.loss.itm && !hf ? availabilityText(timeAvailable(profile.loss.itm, model, r.marginDb), model) : "";
      out("margin").title = `${fromName} → ${toName}`;
      if (!hf) {
        showGeometry(shown, r.horizonM, r.beyondHorizon, distUnit);
        // The smooth-earth geometry assumes both ends at the same ground level,
        // which a real profile (a hilltop, say) overrules.
        if (profile) out("geometry").hidden = out("geoWarn").hidden = true;
      }
      out("barRsl").textContent = `${fmt(r.rslDbm)} dBm`;
      out("barMargin").textContent = `${fmt(r.marginDb)} dB`;
      const pill = out("rating");
      pill.hidden = hf;
      // With a profile, terrain loss is in the margin, so the margin rating
      // already says whether the path works.
      if (!profile && r.beyondHorizon) {
        pill.className = "pill s-fail";
        pill.textContent = "Beyond horizon";
      } else {
        pill.className = `pill s-${rating}`;
        pill.textContent = ratingWords(rating, weakest);
      }

      // The budget in a few steps: what's sent, what's gained and lost on the
      // way, what arrives against what's needed.
      const from = escapeHtml(fromName);
      const to = escapeHtml(toName);
      const step1 = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt(Math.abs(v), 1)}`;
      const lineLoss = shown.txCableLossDb + shown.txOtherLossDb + shown.rxCableLossDb + shown.rxOtherLossDb;
      const pathParts: [string, number][] = [
        ["free space", r.fsplDb],
        ["terrain", profile ? (inputs.terrainLossDb ?? 0) : 0],
        ["clutter", inputs.clutterLossDb ?? 0],
        ["extra", inputs.extraPathLossDb ?? 0],
      ];
      const pathLoss = pathParts.reduce((sum, [, v]) => sum + v, 0);
      const parts = pathParts.filter(([, v]) => v > 0).map(([k, v]) => `${k} ${fmt(v, 1)}`).join(" · ");
      const antennas = shown.txGainDbi + shown.rxGainDbi;
      const flow: [string, string, string?, string?][] = [
        [`Transmitter (${from})`, `${fmt(shown.txPowerDbm, 1)} dBm`, undefined, "total accent-good"],
        ["Cable losses", `${step1(-lineLoss)} dB`],
        // Named for what they do here: high-gain antennas add, poor ones take away.
        [antennas >= 0 ? "Antenna gain" : "Antenna losses", `${step1(antennas)} dB`],
        ["Path loss", `${step1(-pathLoss)} dB`, parts],
        [`Receiver (${to})`, `${fmt(r.rslDbm, 1)} dBm`, undefined, `total s-${rating}`],
        ["Receiver requirement", `${fmt(shown.rxSensitivityDbm, 1)} dBm`, derateNote() ? "Sensitivity, derated" : "Sensitivity"],
        ["Overall link margin", `${fmt(r.marginDb, 1)} dB`, undefined, `total s-${rating}`],
      ];
      out("ledger").innerHTML = flow
        .map(([k, v, sub, cls]) => `<div class="flow-row${cls ? ` ${cls}` : ""}"><span class="flow-k">${k}${sub ? `<small>${sub}</small>` : ""}</span><span class="flow-v mono">${v.replace("-", "−")}</span></div>`)
        .join("");

      // Through the relay: each hop as its own budget; the weaker one sets the link.
      out("relayResults").hidden = !relayAt || hf;
      if (!relayAt || hf) {
        terrain.showHops(undefined, undefined);
        return;
      }
      const pins = terrain.pins();
      const hops = terrain.hops(terrainParams);
      const relayH = relayHeightM();
      const relayGain = num("relayGain") || 0;
      const relayCable = num("relayCable") || 0;
      // Each site's radio for the hops: losses, gain, height and surroundings.
      const radio = (site: SiteId) =>
        site === "tx"
          ? { loss: inputs.txCableLossDb + inputs.txOtherLossDb, gain: inputs.txGainDbi, h: txHeightM, env: txEnv }
          : site === "rx"
            ? { loss: inputs.rxCableLossDb + inputs.rxOtherLossDb, gain: inputs.rxGainDbi, h: rxHeightM, env: rxEnv }
            : { loss: relayCable, gain: relayGain, h: relayH, env: relayEnv };
      const oneWay = (a: SiteId, b: SiteId, distanceM: number, terrainLossDb: number | undefined) => {
        const A = radio(a);
        const B = radio(b);
        return linkBudget({
          ...inputs,
          distanceM,
          terrainLossDb: terrainLossDb ?? 0,
          txPowerDbm: sitePower(a),
          txCableLossDb: A.loss,
          txOtherLossDb: 0,
          txGainDbi: A.gain,
          txHeightM: A.h,
          rxGainDbi: B.gain,
          rxCableLossDb: B.loss,
          rxOtherLossDb: 0,
          rxSensitivityDbm: siteSens(b),
          rxHeightM: B.h,
          clutterLossDb: clutterLossDb(A.env, freqHz, A.h) + clutterLossDb(B.env, freqHz, B.h),
        }).marginDb;
      };
      /** A hop's margin each way; the weaker one limits it. */
      const hopBudget = (a: SiteId, b: SiteId, pa: LatLon, pb: LatLon, terrainLossDb: number | undefined) => {
        const d = distanceBetweenM(pa, pb);
        const out1 = oneWay(a, b, d, terrainLossDb);
        const back = oneWay(b, a, d, terrainLossDb);
        return { marginDb: Math.min(out1, back), out: out1, back, distanceM: d };
      };
      const tbody = out("relayHops");
      tbody.replaceChildren();
      if (!pins) {
        out("relayRating").hidden = true;
        out("relayNote").textContent = `Drop both ${siteName("tx")} and ${siteName("rx")} to see the two hops.`;
        terrain.showHops(undefined, undefined);
        return;
      }
      const h1 = hopBudget("tx", "relay", pins.tx, relayAt, hops.hop1?.loss.lossDb);
      const h2 = hopBudget("relay", "rx", relayAt, pins.rx, hops.hop2?.loss.lossDb);
      const fade = inputs.fadeMarginDb;
      const rows2: [string, typeof h1][] = [
        [`1 · ${siteName("tx")} ↔ ${siteName("relay")}`, h1],
        [`2 · ${siteName("relay")} ↔ ${siteName("rx")}`, h2],
      ];
      for (const [label, h] of rows2) {
        const tr = document.createElement("tr");
        const name = document.createElement("td");
        name.textContent = label; // names are user text
        const dist = document.createElement("td");
        dist.className = "num mono";
        dist.textContent = `${fmt(fromMetres(h.distanceM, distUnit))} ${distUnit}`;
        const margin = document.createElement("td");
        margin.className = "num";
        const rating = rateMargin(h.marginDb);
        margin.innerHTML = `<span class="mono">${fmt(h.marginDb)} dB</span> <span class="pill s-${rating}">${ratingWords(rating, h.marginDb)}</span>`;
        margin.title = `${fmt(h.out)} dB one way, ${fmt(h.back)} dB back`;
        tr.append(name, dist, margin);
        tbody.append(tr);
      }
      const weaker = Math.min(h1.marginDb, h2.marginDb);
      const overall = rateMargin(weaker);
      out("relayRating").hidden = false;
      out("relayRating").className = `pill s-${overall}`;
      out("relayRating").textContent = ratingWords(overall, weaker);
      const loading = !hops.hop1 || !hops.hop2;
      // Only said while it matters: until the hops' terrain loads, they're free-space figures.
      out("relayNote").textContent = loading ? "Terrain for the hops is still loading; free-space figures for now." : "";
      terrain.showHops(linkQuality(h1.marginDb, fade), linkQuality(h2.marginDb, fade));
    };

    // The ledger shows the weaker direction unless one is picked.
    let ledgerDir: "ab" | "ba" | undefined;
    form.querySelector('[data-out="dirWrap"]')!.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-dir]");
      if (!b) return;
      ledgerDir = b.dataset.dir as "ab" | "ba";
      update();
    });
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    form.querySelector('[data-action="reset"]')!.addEventListener("click", () => {
      fill(defaults);
      terrain.reset();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    update();
    enhanceFields(form, linkBudgetGuide, defaults);
    // A link arriving by share link: its settings, then its pins.
    const shared = planFromHash(location.hash, "link");
    if (shared) {
      history.replaceState(null, "", "#link");
      const plan = decodePlan(shared, Object.keys(defaults));
      if (plan) {
        fill(plan.settings);
        const [a, b, r] = plan.nodes ?? [];
        for (const [site, n] of [["tx", a], ["rx", b], ["relay", r]] as const) if (n) field(`${site}Name`).value = n.name;
        if (a && b) terrain.setPins({ tx: a, rx: b, relay: r });
        update();
      }
    }
    // Climate and ground type are global: shown here, kept in Settings, so a
    // change here applies on every tab.
    const climateSel = field("climate") as HTMLSelectElement;
    const groundSel = field("ground") as HTMLSelectElement;
    climateSel.value = getSettings().climate;
    groundSel.value = getSettings().ground;
    for (const sel of [climateSel, groundSel]) {
      sel.addEventListener("change", () => {
        setSettings({ ...getSettings(), climate: climateSel.value, ground: groundSel.value });
        update();
      });
    }
    // The Simple/Advanced switch heads the left pane.
    const modeBar = form.querySelector(".mode-bar");
    if (modeBar) form.querySelector(".lb-left")!.prepend(modeBar);
    return form;
  },
};

/** Names are user text: make them safe inside the ledger's markup. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
