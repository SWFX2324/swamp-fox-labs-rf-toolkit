import { enhanceFields } from "./fieldHelp";
import { linkBudgetGuide } from "./helpText";
import type { Calculator } from ".";
import { beyondCableRange, cableLossDb, cables, findCable, lossPer100Ft } from "../lib/coax";
import { type Environment, clutterLossDb, effectiveHeightM, findEnvironment } from "../lib/environment";
import { bindTreeField, environmentNote, environmentOptions, landCoverNote, treeHeightFieldHtml, withFormTrees } from "./environmentField";
import { AUTO_ENVIRONMENT, type LandCoverPoint } from "../lib/landCover";
import { landCoverAt } from "./landCoverTiles";
import { linkGroundToEnvironment, modelDefaults, modelFieldsHtml, readModel } from "./modelFields";
import { type ModelSettings, timeAvailable } from "../lib/propagation";
import { STANDARD_K, kFactors, midpointClearance, parseKFactor } from "../lib/horizon";
import { createTerrainCard } from "./terrain";
import { type LinkInputs, type MarginRating, freeSpaceApplies, linkBudget, rateMargin } from "../lib/linkBudget";
import { linkQuality } from "../lib/linkLines";
import {
  type DistanceUnit,
  dbmToWatts,
  distanceUnits,
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

const defaults: Record<string, string> = {
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
  distUnit: "mi",
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
  kFactor: "4/3",
  ...modelDefaults,
};

const hfWarning =
  "Below 30 MHz, signals travel by ground wave and skywave, not line of sight, so " +
  "free-space loss, margin and range don't reflect real HF performance. Use an HF " +
  "propagation tool such as VOACAP for these bands.";

const ratingText: Record<MarginRating, string> = {
  good: "Solid",
  fair: "Workable",
  marginal: "Marginal",
  fail: "Won't close",
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
  <div class="inputs">
    <section class="card">
      <div class="card-head"><h2>Transmitter</h2><span class="meta">Sets EIRP</span></div>
      <div class="fields">
        ${unitField("Frequency", "freq", Object.keys(frequencyUnits), "freqUnit")}
        ${unitField("TX power", "txPower", powerUnits, "txPowerUnit")}
        ${cableFields("tx")}
        ${numberField("Other losses", "txOther", "dB", 'min="0" title="Connectors, lightning arrestor, filters"')}
        ${numberField("Antenna gain", "txGain", "dBi")}
        ${unitField("Antenna height", "txHeight", ["ft", "m"], "txHeightUnit")}
      </div>
      <div class="tile subtotal">
        <span class="label">EIRP</span>
        <span class="value" data-out="eirp"></span>
        <span class="sub" data-out="eirpW"></span>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Receiver</h2><span class="meta">Sets the margin</span></div>
      <div class="fields">
        ${numberField("Antenna gain", "rxGain", "dBi")}
        ${unitField("Antenna height", "rxHeight", ["ft", "m"], "rxHeightUnit")}
        ${cableFields("rx")}
        ${numberField("Other losses", "rxOther", "dB", 'min="0"')}
        ${numberField("Sensitivity", "rxSens", "dBm", 'title="From the radio datasheet, for the data rate or mode you use"')}
        ${numberField("Fade margin wanted", "fadeMargin", "dB", 'min="0" title="Used for the max range"')}
      </div>
    </section>

    <section class="card" data-card="path">
      <div class="card-head"><h2>Path</h2><span class="meta">Line of sight</span></div>
      <div class="fields">
        ${unitField("Distance", "dist", Object.keys(distanceUnits), "distUnit")}
        <label>Environment
          <select name="environment">${environmentOptions()}</select>
        </label>
        ${treeHeightFieldHtml()}
        <label>Earth curvature (k)
          <select name="kFactor">${kFactors.map((f) => `<option value="${f.id}">${f.name}</option>`).join("")}</select>
        </label>
        ${numberField("Extra path loss", "extraLoss", "dB", 'min="0" title="Foliage, buildings, rain, partial Fresnel blockage"')}
        ${modelFieldsHtml()}
      </div>
      <p class="note" data-out="envNote" hidden></p>
      <p class="note" data-out="distNote" hidden>
        Distance comes from the map pins in Terrain profile. Clear the pins to type one.
      </p>
      <div class="tile subtotal">
        <span class="label">Free-space path loss</span>
        <span class="value" data-out="fspl"></span>
        <span class="sub" data-out="rxIso"></span>
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
      <p class="callout" data-out="hfPath" hidden>${hfWarning}</p>
    </section>
  </div>

  <aside class="results">
    <section class="card">
      <div class="card-head">
        <h2>Link budget</h2>
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
          <span class="label">Max range</span>
          <span class="value" data-out="range"></span>
          <span class="sub" data-out="rangeSub"></span>
        </div>
      </div>
      <p class="error" data-out="error" hidden></p>
      <table class="ledger">
        <thead><tr><th>Stage</th><th class="num">Change</th><th class="num">Level</th></tr></thead>
        <tbody data-out="ledger"></tbody>
      </table>
      <details class="about"><summary>About this calculation</summary><p>Margin guide: 20 dB or more is solid, 10–20 workable, 0–10 marginal. Without map pins, free-space loss is the best case with a clear line of sight. With pins, the Irregular Terrain Model (Longley-Rice) adds the terrain along the path, at the reliability and confidence you set; the margin then shows how much of the time the link holds. Cable loss assumes a well-matched antenna; high SWR adds more.</p></details>
    </section>
  </aside>

  <div class="summary-bar">
    <span aria-hidden="true"><span class="k">RX</span> <b data-out="barRsl"></b></span>
    <span aria-hidden="true"><span class="k">Margin</span> <b data-out="barMargin"></b></span>
  </div>
`;

function loadState(): Record<string, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return { ...defaults, ...(typeof saved === "object" && saved ? saved : {}) };
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
const signed = (db: number) => (db === 0 ? fmt(0) : `${db > 0 ? "+" : "−"}${fmt(Math.abs(db))}`);
const dbm = (value: number) => `${value < 0 ? "−" : ""}${fmt(Math.abs(value))}<span class="unit">dBm</span>`;
const db = (value: number) => `${value < 0 ? "−" : ""}${fmt(Math.abs(value))}<span class="unit">dB</span>`;

/** A value with a small unit after it, built as text nodes rather than HTML. */
function setValueWithUnit(el: HTMLElement, value: string, unit: string): void {
  const span = document.createElement("span");
  span.className = "unit";
  span.textContent = unit;
  el.replaceChildren(value, span);
}

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
  title: "Link Budget",
  shortTitle: "Link",
  render() {
    const form = document.createElement("form");
    form.className = "calculator link-budget";
    form.innerHTML = template;
    linkGroundToEnvironment(form);
    bindTreeField(form, "txHeightUnit");
    form.addEventListener("submit", (e) => e.preventDefault());

    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
    const out = (name: string) => form.querySelector<HTMLElement>(`[data-out="${name}"]`)!;
    const num = (name: string) => Number.parseFloat(field(name).value);

    const state = loadState();
    const fill = (values: Record<string, string>) => {
      for (const [name, value] of Object.entries(values)) {
        const el = form.elements.namedItem(name);
        if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.value = value;
      }
    };
    fill(state);

    const terrain = createTerrainCard(() => update());
    form.querySelector('[data-card="path"]')!.after(terrain.element);

    // Land cover at the two pins, when Environment is "From land-cover map".
    let cover: { key: string; ends?: [LandCoverPoint, LandCoverPoint]; error?: string } | undefined;
    const landCover = (): { ends?: [LandCoverPoint, LandCoverPoint]; note: string } => {
      const pins = terrain.pins();
      if (!pins) return { note: "Drop both pins in Terrain profile to read the land cover at each end. Until then no clutter loss is added." };
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
      if (cover.error) return { note: `Couldn't read the land-cover map (${cover.error}), so no clutter loss is added.` };
      if (!cover.ends) return { note: "Reading the land-cover map…" };
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

    const update = () => {
      const distUnit = asDistanceUnit(field("distUnit").value);
      // With both pins down, the map sets the distance.
      const pinned = terrain.pathDistanceM();
      const distInput = field("dist") as HTMLInputElement;
      distInput.readOnly = pinned !== undefined;
      out("distNote").hidden = pinned === undefined;
      if (pinned !== undefined) distInput.value = String(Number(fromMetres(pinned, distUnit).toFixed(3)));

      for (const name of Object.keys(defaults)) state[name] = field(name).value;
      saveState(state);

      const freqHz = toHz(num("freq"), asFrequencyUnit(field("freqUnit").value));
      const auto = field("environment").value === AUTO_ENVIRONMENT;
      const ends = auto ? landCover() : undefined;
      const trees = (e: Environment) => withFormTrees(form, "txHeightUnit", e);
      const env = trees(findEnvironment(field("environment").value));
      const txEnv = trees(ends?.ends?.[0].environment ?? env);
      const rxEnv = trees(ends?.ends?.[1].environment ?? env);
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
        rxSensitivityDbm: num("rxSens"),
        fadeMarginDb: num("fadeMargin") || 0,
        txHeightM,
        rxHeightM,
        clutterLossDb: clutterLossDb(txEnv, freqHz, txHeightM) + clutterLossDb(rxEnv, freqHz, rxHeightM),
        k: parseKFactor(field("kFactor").value),
      };

      const problem =
        !(inputs.freqHz > 0) ? "Enter a frequency above zero."
        : !(inputs.distanceM > 0) ? "Enter a distance above zero."
        : !Number.isFinite(inputs.txPowerDbm) ? "Enter a TX power above zero."
        : !Number.isFinite(inputs.rxSensitivityDbm) ? "Enter the receiver sensitivity."
        : "";

      out("error").hidden = !problem;
      out("error").textContent = problem;
      const hf = inputs.freqHz > 0 && !freeSpaceApplies(inputs.freqHz);
      out("hfPath").hidden = !hf;
      out("hfResult").hidden = !hf;
      out("geometry").hidden = hf || !!problem;
      out("geoWarn").hidden = true;

      const model = readModel(form);
      const profile = terrain.refresh({
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
      });

      if (problem) {
        for (const name of ["eirp", "eirpW", "fspl", "rxIso", "rsl", "margin", "marginSub", "range", "rangeSub", "barRsl", "barMargin"]) {
          out(name).textContent = dash;
        }
        out("rating").hidden = true;
        out("ledger").replaceChildren();
        terrain.showLink(undefined);
        return;
      }

      out("envNote").hidden = env.id === "none" && !auto;
      out("envNote").textContent = ends
        ? ends.ends
          ? landCoverNote([{ ...ends.ends[0], environment: txEnv }, { ...ends.ends[1], environment: rxEnv }], ["The TX end", "the RX end"], freqHz, txHeightM, rxHeightM)
          : ends.note
        : environmentNote(env, freqHz, txHeightM, rxHeightM);
      inputs.terrainLossDb = profile?.loss.lossDb ?? 0;
      const r = linkBudget(inputs);
      const rating = rateMargin(r.marginDb);
      // The map line follows the same rule as the Mesh Planner: good once the fade margin is covered.
      terrain.showLink(hf ? undefined : linkQuality(r.marginDb, inputs.fadeMarginDb));

      out("eirp").innerHTML = dbm(r.eirpDbm);
      out("eirpW").textContent = formatWatts(dbmToWatts(r.eirpDbm));
      out("fspl").innerHTML = db(r.fsplDb);
      out("rxIso").textContent = `Arrives at ${fmt(r.rxIsotropicDbm)} dBm before RX antenna gain`;
      out("rsl").innerHTML = dbm(r.rslDbm);
      out("margin").innerHTML = db(r.marginDb);
      out("marginSub").textContent = profile?.loss.itm && !hf ? availabilityText(timeAvailable(profile.loss.itm, model, r.marginDb), model) : "";
      if (hf) {
        out("range").textContent = dash;
        out("rangeSub").textContent = "Not meaningful on HF";
      } else if (profile) {
        // The smooth-earth horizon assumes both ends at the same ground level,
        // which a real profile (a hilltop, say) overrules.
        setValueWithUnit(out("range"), formatRange(r.budgetRangeM, distUnit), distUnit);
        out("rangeSub").textContent =
          `What the budget allows with ${fmt(inputs.fadeMarginDb, 0)} dB of fade margin. Terrain decides the rest.`;
        showGeometry(inputs, r.horizonM, r.beyondHorizon, distUnit);
        out("geometry").hidden = out("geoWarn").hidden = true;
      } else {
        setValueWithUnit(out("range"), formatRange(r.maxRangeM, distUnit), distUnit);
        out("rangeSub").textContent =
          r.rangeLimit === "horizon"
            ? "Limited by the radio horizon at these antenna heights"
            : `Limited by the budget, keeping ${fmt(inputs.fadeMarginDb, 0)} dB of fade margin`;
        showGeometry(inputs, r.horizonM, r.beyondHorizon, distUnit);
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
        pill.textContent = ratingText[rating];
      }

      let level = inputs.txPowerDbm;
      const rows: string[] = [];
      const step = (stage: string, change: number | null, total = false) => {
        if (change !== null) level += change;
        rows.push(
          `<tr${total ? ' class="total"' : ""}><td>${stage}</td>` +
            `<td class="num mono">${change === null ? "" : signed(change)}</td>` +
            `<td class="num mono">${fmt(level)}</td></tr>`,
        );
      };
      step("TX power", null);
      if (inputs.txCableLossDb) step("TX coax", -inputs.txCableLossDb);
      if (inputs.txOtherLossDb) step("TX other losses", -inputs.txOtherLossDb);
      step("TX antenna", inputs.txGainDbi);
      step("EIRP", null, true);
      step("Free-space loss", -r.fsplDb);
      if (inputs.extraPathLossDb) step("Extra path loss", -inputs.extraPathLossDb);
      if (inputs.clutterLossDb) step(auto ? "Clutter (land cover)" : env.name, -inputs.clutterLossDb);
      if (profile) step(profile.loss.model === "itm" ? "Terrain (Longley-Rice)" : "Terrain diffraction", -inputs.terrainLossDb);
      step("RX antenna", inputs.rxGainDbi);
      if (inputs.rxCableLossDb) step("RX coax", -inputs.rxCableLossDb);
      if (inputs.rxOtherLossDb) step("RX other losses", -inputs.rxOtherLossDb);
      step("Received signal", null, true);
      rows.push(
        `<tr><td>RX sensitivity</td><td></td><td class="num mono">${fmt(inputs.rxSensitivityDbm)}</td></tr>` +
          `<tr class="total"><td>Link margin</td><td></td><td class="num mono">${fmt(r.marginDb)} dB</td></tr>`,
      );
      out("ledger").innerHTML = rows.join("");
    };

    form.addEventListener("input", update);
    form.addEventListener("change", update);
    form.querySelector('[data-action="reset"]')!.addEventListener("click", () => {
      fill(defaults);
      terrain.reset();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    update();
    enhanceFields(form, linkBudgetGuide, defaults);
    return form;
  },
};
