import { PANE_ICONS, moveModeBar, pane, setupMapFirst, sideToggles } from "./mapFirst";
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
import { type HopAnalysis, type SiteId, createTerrainCard } from "./terrain";
import { type LatLon, distanceBetweenM } from "../lib/geo";
import { type LinkInputs, type LinkResult, freeSpaceApplies, linkBudget } from "../lib/linkBudget";
import { type LinkQuality, linkQuality } from "../lib/linkLines";
import { rfIcon } from "../ui/rfIcons";
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
/** Whether the docked terrain profile is folded away. */
const DOCK_KEY = "rf-toolkit:link-profile-dock";

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

/** The card's words for a link: the same three as the map's link lines, by the same rule. */
const qualityWords: Record<LinkQuality, string> = {
  good: "Good",
  marginal: "Marginal",
  fail: "Won't connect",
};

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


const template = `
  <div class="lb-shell floating">
  ${sideToggles("link budget")}
  <div class="lb-left">
    ${pane("tx", "tx", "Site A", `
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

    ${pane("rx", "rx", "Site B", `
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

    ${pane("relay", "relay", "Relay", `
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
        ${numberField("Extra path loss", "extraLoss", "dB", 'min="0" title="Foliage, buildings, rain, partial Fresnel blockage"')}
      </div>
      <p class="callout" data-out="geoWarn" hidden></p>
      <p class="callout" data-out="hfPath" hidden>${hfWarning}</p>`)}

    ${pane("terrain", "terrain", "Terrain profile", `<div class="pane-slot" data-slot="profile"></div>`, '<span class="pane-pill" data-slot="pill"></span>')}

    ${pane("share", "share", "Share", `<div class="pane-slot" data-slot="share"></div>`)}
  </div>

  <div class="lb-map" data-slot="map"></div>

  <section class="card profile-dock" data-out="profileDock" hidden>
    <div class="dock-head">
      <h2 class="with-icon">${PANE_ICONS.terrain}Terrain profile</h2>
      <span class="dock-pill" data-out="dockPill"></span>
      <button type="button" class="dock-toggle" data-out="dockToggle" aria-expanded="true" aria-label="Hide the terrain profile">${rfIcon("chevronDown")}</button>
    </div>
    <div class="dock-body" data-out="dockBody"></div>
  </section>

  <aside class="results lb-right">
    <section class="card">
      <div class="card-head">
        <h2 class="with-icon">${PANE_ICONS.budget}Link budget</h2>
        <span class="pill" data-out="rating"></span>
        <button type="button" class="secondary" data-action="reset">Reset</button>
      </div>
      <div class="path-view" data-out="pathView" hidden>
        <div class="seg" role="group" aria-label="Path shown">
          <button type="button" data-path-view="relay">Via relay</button>
          <button type="button" data-path-view="direct">Direct</button>
        </div>
        <p class="note" data-out="pathNote"></p>
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
          <span class="label" data-out="eirpLabel">TX EIRP</span>
          <span class="value" data-out="eirp"></span>
          <span class="sub" data-out="eirpW"></span>
        </div>
        <div class="tile">
          <span class="label" data-out="eirpBLabel">RX EIRP</span>
          <span class="value" data-out="eirpB"></span>
          <span class="sub" data-out="eirpBW"></span>
        </div>
        <div class="tile wide-tile">
          <span class="label">Path loss</span>
          <span class="value" data-out="pathLoss"></span>
          <span class="sub" data-out="pathLossSub"></span>
        </div>
        <div class="tile wide-tile tile-field">
          <label><span data-out="distLabel">Distance</span>
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
        <div class="card-head"><h3>Hops</h3></div>
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
  title: "VHF/UHF Link Analysis",
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
    // Each site's pane is titled with its name; the relay's stays "Relay".
    const syncPaneTitles = () => {
      for (const site of ["tx", "rx"] as SiteId[]) {
        const title = form.querySelector(`details[data-pane="${site}"] .pane-title`);
        if (title) title.textContent = siteName(site);
      }
    };
    // The terrain card's parts go where they belong in this layout.
    for (const [name, part] of Object.entries(terrain.parts)) form.querySelector(`[data-slot="${name}"]`)!.append(part);
    const profilePill = terrain.parts.profile.querySelector(".pill");
    if (profilePill) form.querySelector('[data-slot="pill"]')!.append(profilePill);

    // Wide screens: the profile docks under the map, between the side panes,
    // so the ground and the budget show together. Narrower, it stays in its pane.
    const dock = out("profileDock");
    const shell = form.querySelector<HTMLElement>(".lb-shell")!;
    const terrainPane = form.querySelector<HTMLDetailsElement>('details[data-pane="terrain"]')!;
    const wide = window.matchMedia("(min-width: 1300px)");
    const profileSwitch = terrain.parts.profile.querySelector<HTMLElement>(".profile-view");
    let dockClosed = false;
    try {
      dockClosed = localStorage.getItem(DOCK_KEY) === "closed";
    } catch {
      // Storage blocked: the dock just starts open.
    }
    const syncDockOpen = () => {
      dock.classList.toggle("closed", dockClosed);
      out("dockToggle").setAttribute("aria-expanded", String(!dockClosed));
      out("dockToggle").setAttribute("aria-label", `${dockClosed ? "Show" : "Hide"} the terrain profile`);
    };
    const placeProfile = () => {
      const docked = wide.matches;
      dock.hidden = !docked;
      terrainPane.hidden = docked;
      shell.classList.toggle("has-dock", docked);
      (docked ? out("dockBody") : form.querySelector('[data-slot="profile"]')!).append(terrain.parts.profile);
      if (profileSwitch) {
        if (docked) out("dockToggle").before(profileSwitch);
        else terrain.parts.profile.querySelector(".profile-chart")!.before(profileSwitch);
      }
      if (profilePill) (docked ? out("dockPill") : form.querySelector('[data-slot="pill"]')!).append(profilePill);
      terrain.redraw();
    };
    out("dockToggle").addEventListener("click", () => {
      dockClosed = !dockClosed;
      try {
        localStorage.setItem(DOCK_KEY, dockClosed ? "closed" : "open");
      } catch {
        // Storage blocked: remembered for this visit only.
      }
      syncDockOpen();
      if (!dockClosed) terrain.redraw();
    });
    // The map's taskbar, key and credits sit above the dock.
    let dockH = "";
    new ResizeObserver(() => {
      const h = dock.hidden ? "0px" : `${dock.offsetHeight + 14}px`;
      if (h === dockH) return;
      dockH = h;
      shell.style.setProperty("--dock-h", h);
      // Keep the sites in view as the profile loads, opens or folds away.
      requestAnimationFrame(() => terrain.reframe());
    }).observe(dock);
    // Redraw at the new width when the gap between the panes changes.
    let dockWidth = 0;
    new ResizeObserver(() => {
      if (dock.hidden || dock.offsetWidth === dockWidth) return;
      dockWidth = dock.offsetWidth;
      terrain.redraw();
    }).observe(dock);
    wide.addEventListener("change", placeProfile);
    syncDockOpen();
    placeProfile();
    setupMapFirst(form, {
      panesKey: PANES_KEY,
      sidesKey: SIDES_KEY,
      rightName: "link budget",
      // The profile is drawn to its card's width, which is zero while closed.
      onPaneToggle: (id, open) => {
        if (open && id === "terrain") terrain.redraw();
      },
    });

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
    // Without map pins, only a short warning when smooth earth alone gets in the way.
    const showGeometry = (i: LinkInputs, horizonM: number, beyond: boolean, distUnit: DistanceUnit) => {
      const warn = out("geoWarn");
      if (beyond) {
        warn.textContent = `Past the ${formatRange(horizonM, distUnit)} ${distUnit} radio horizon: the earth blocks the signal.`;
        warn.hidden = false;
        return;
      }
      const c = midpointClearance(i.freqHz, i.distanceM, i.txHeightM, i.rxHeightM, i.k);
      // An Environment already charges for this, so only without one.
      if (c.clearanceM < c.neededM && field("environment").value === "none") {
        warn.textContent = "The ground at the midpoint blocks part of the Fresnel zone: expect more loss than shown.";
        warn.hidden = false;
      }
    };

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
      syncPaneTitles();
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
        for (const name of ["eirp", "eirpW", "eirpB", "eirpBW", "pathLoss", "pathLossSub", "rsl", "margin", "marginSub", "barRsl", "barMargin"]) {
          out(name).textContent = "—";
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

      // One way along a path: its inputs, result and end names.
      type Way = { inputs: LinkInputs; result: LinkResult; from: string; to: string };

      // A placed relay: each hop worked out as its own two-way budget, with
      // the relay's own radio. The weaker hop sets the route.
      const pins = terrain.pins();
      const route = relayAt && pins && !hf ? relayRoute(pins, relayAt) : undefined;
      const viaRelay = !!route && terrain.view() === "relay";
      out("pathView").hidden = !route;
      for (const b of form.querySelectorAll<HTMLButtonElement>("[data-path-view]")) {
        b.setAttribute("aria-pressed", String((b.dataset.pathView === "relay") === viaRelay));
      }

      // Everything below describes one path: the direct one, or the weaker hop.
      const ab: Way = viaRelay ? route!.weaker.ab : { inputs, result: forward, from: siteName("tx"), to: siteName("rx") };
      const ba: Way = viaRelay ? route!.weaker.ba : { inputs: reverse, result: backward, from: siteName("rx"), to: siteName("tx") };
      const itm = viaRelay ? route!.weaker.itm : profile?.loss.itm;
      if (route) {
        out("pathNote").textContent = viaRelay
          ? `${siteName("tx")} to ${siteName("rx")} through ${siteName("relay")}. Figures are for hop ${route.weaker.n}, the weaker hop, which sets the link.`
          : `${siteName("tx")} straight to ${siteName("rx")}, without the relay.`;
      }

      // The weaker direction rates the link; the details follow the switch, or the weaker one.
      const weakerDir: "ab" | "ba" = ba.result.marginDb < ab.result.marginDb ? "ba" : "ab";
      const weakest = Math.min(ab.result.marginDb, ba.result.marginDb);
      const directWeakest = Math.min(forward.marginDb, backward.marginDb);
      const dir = ledgerDir ?? weakerDir;
      const way = dir === "ab" ? ab : ba;
      const r = way.result;
      const shown = way.inputs;
      const fromName = way.from;
      const toName = way.to;
      // Rated as the map line is: good once the fade margin is covered, marginal above 0 dB.
      const rating = linkQuality(weakest, inputs.fadeMarginDb);
      // The map line is always the direct path; the hop lines are drawn below.
      // It follows the same rule as the Mesh Analysis: good once the fade margin is covered.
      terrain.showLink(hf ? undefined : linkQuality(directWeakest, inputs.fadeMarginDb));

      out("eirpLabel").textContent = `${ab.from} EIRP`;
      out("eirpBLabel").textContent = `${ab.to} EIRP`;
      out("eirp").innerHTML = dbm(ab.result.eirpDbm);
      out("eirpW").textContent = formatWatts(dbmToWatts(ab.result.eirpDbm));
      out("eirpB").innerHTML = dbm(ba.result.eirpDbm);
      out("eirpBW").textContent = formatWatts(dbmToWatts(ba.result.eirpDbm));
      const abText = `${ab.from} → ${ab.to}`;
      const baText = `${ba.from} → ${ba.to}`;
      const same = Math.abs(ab.result.marginDb - ba.result.marginDb) < 0.05;
      // Only worth saying when the two ways differ.
      out("dirNote").hidden = hf || same;
      out("dirNote").textContent = `The weaker way, ${weakerDir === "ab" ? abText : baText}, sets the link.`;
      out("dirWrap").hidden = hf || same;
      for (const b of form.querySelectorAll<HTMLButtonElement>("[data-dir]")) {
        b.textContent = b.dataset.dir === "ab" ? abText : baText;
        b.setAttribute("aria-pressed", String(b.dataset.dir === dir));
      }
      out("rsl").innerHTML = dbm(r.rslDbm);
      out("margin").innerHTML = db(r.marginDb);
      out("marginSub").textContent = itm && !hf ? availabilityText(timeAvailable(itm, model, r.marginDb), model) : "";
      out("margin").title = `${fromName} → ${toName}`;
      out("distLabel").textContent = viaRelay ? "Distance via relay" : "Distance";
      if (viaRelay) {
        const total = route!.hops[0].distanceM + route!.hops[1].distanceM;
        out("distValue").textContent = fmt(fromMetres(total, distUnit));
      }
      if (!hf) {
        // Horizon and geometry stay on the direct path.
        showGeometry(inputs, forward.horizonM, forward.beyondHorizon, distUnit);
        // The smooth-earth geometry assumes both ends at the same ground level,
        // which a real profile (a hilltop, say) overrules.
        if (profile) out("geoWarn").hidden = true;
      }
      out("barRsl").textContent = `${fmt(r.rslDbm)} dBm`;
      out("barMargin").textContent = `${fmt(r.marginDb)} dB`;
      const pill = out("rating");
      pill.hidden = hf;
      // With a profile, terrain loss is in the margin, so the margin rating
      // already says whether the path works.
      if (!viaRelay && !profile && r.beyondHorizon) {
        pill.className = "pill s-fail";
        pill.textContent = "Beyond horizon";
      } else {
        pill.className = `pill s-${rating}`;
        pill.textContent = qualityWords[rating];
      }

      // The budget in a few steps: what's sent, what's gained and lost on the
      // way, what arrives against what's needed.
      const from = escapeHtml(fromName);
      const to = escapeHtml(toName);
      const step1 = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt(Math.abs(v), 1)}`;
      const lineLoss = shown.txCableLossDb + shown.txOtherLossDb + shown.rxCableLossDb + shown.rxOtherLossDb;
      const pathParts: [string, number][] = [
        ["free space", r.fsplDb],
        ["terrain", viaRelay || profile ? (shown.terrainLossDb ?? 0) : 0],
        ["clutter", shown.clutterLossDb ?? 0],
        ["extra", shown.extraPathLossDb ?? 0],
      ];
      const pathLoss = pathParts.reduce((sum, [, v]) => sum + v, 0);
      const parts = pathParts.filter(([, v]) => v > 0).map(([k, v]) => `${k} ${fmt(v, 1)}`).join(" · ");
      out("pathLoss").innerHTML = db(pathLoss);
      out("pathLossSub").textContent = parts.charAt(0).toUpperCase() + parts.slice(1);
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

      // The hops, listed under the relay view; the map shows their lines either way.
      out("relayResults").hidden = !relayAt || hf || (!!route && !viaRelay);
      if (!relayAt || hf) {
        terrain.showHops(undefined, undefined);
        return;
      }
      const tbody = out("relayHops");
      tbody.replaceChildren();
      if (!route) {
        out("relayNote").textContent = `Drop both ${siteName("tx")} and ${siteName("rx")} to see the two hops.`;
        terrain.showHops(undefined, undefined);
        return;
      }
      for (const h of route.hops) {
        const tr = document.createElement("tr");
        if (h === route.weaker) tr.className = "weaker-hop";
        const name = document.createElement("td");
        name.textContent = `${h.n} · ${h.ab.from} ↔ ${h.ab.to}`; // names are user text
        const dist = document.createElement("td");
        dist.className = "num mono";
        dist.textContent = `${fmt(fromMetres(h.distanceM, distUnit))} ${distUnit}`;
        const margin = document.createElement("td");
        margin.className = "num";
        const hr = linkQuality(h.marginDb, inputs.fadeMarginDb);
        margin.innerHTML = `<span class="mono">${fmt(h.marginDb)} dB</span> <span class="pill s-${hr}">${qualityWords[hr]}</span>`;
        margin.title = `${fmt(h.ab.result.marginDb)} dB one way, ${fmt(h.ba.result.marginDb)} dB back`;
        tr.append(name, dist, margin);
        tbody.append(tr);
      }
      // Only said while it matters: until the hops' terrain loads, they're free-space figures.
      out("relayNote").textContent = route.loading ? "Terrain for the hops is still loading; free-space figures for now." : "";
      const fade = inputs.fadeMarginDb;
      terrain.showHops(linkQuality(route.hops[0].marginDb, fade), linkQuality(route.hops[1].marginDb, fade));

      /** Both hops through the relay, each as its own two-way budget. */
      function relayRoute(p: { tx: LatLon; rx: LatLon }, at: LatLon) {
        const analysed = terrain.hops(terrainParams);
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
        const oneWay = (a: SiteId, b: SiteId, distanceM: number, terrainLossDb: number | undefined): Way => {
          const A = radio(a);
          const B = radio(b);
          const wayInputs: LinkInputs = {
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
          };
          return { inputs: wayInputs, result: linkBudget(wayInputs), from: siteName(a), to: siteName(b) };
        };
        /** A hop's budget each way; the weaker one limits it. */
        const hop = (n: 1 | 2, a: SiteId, b: SiteId, pa: LatLon, pb: LatLon, h: HopAnalysis | undefined) => {
          const d = distanceBetweenM(pa, pb);
          const there = oneWay(a, b, d, h?.loss.lossDb);
          const back = oneWay(b, a, d, h?.loss.lossDb);
          return { n, ab: there, ba: back, distanceM: d, itm: h?.loss.itm, marginDb: Math.min(there.result.marginDb, back.result.marginDb) };
        };
        const h1 = hop(1, "tx", "relay", p.tx, at, analysed.hop1);
        const h2 = hop(2, "relay", "rx", at, p.rx, analysed.hop2);
        return { hops: [h1, h2] as const, weaker: h2.marginDb < h1.marginDb ? h2 : h1, loading: !analysed.hop1 || !analysed.hop2 };
      }
    };

    // The ledger shows the weaker direction unless one is picked.
    let ledgerDir: "ab" | "ba" | undefined;
    out("pathView").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-path-view]");
      if (!b) return;
      // A different path: its own weaker direction, not one picked for the other.
      ledgerDir = undefined;
      terrain.setView(b.dataset.pathView as "relay" | "direct");
    });
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
    moveModeBar(form);
    return form;
  },
};

/** Names are user text: make them safe inside the ledger's markup. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
