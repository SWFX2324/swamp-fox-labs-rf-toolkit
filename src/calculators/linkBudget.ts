import type { Calculator } from ".";
import { beyondCableRange, cableLossDb, cables, findCable, lossPer100Ft } from "../lib/coax";
import { type LinkInputs, type MarginRating, linkBudget, rateMargin } from "../lib/linkBudget";
import {
  type DistanceUnit,
  type FrequencyUnit,
  type PowerUnit,
  dbmToWatts,
  distanceUnits,
  frequencyUnits,
  fromMetres,
  powerUnits,
  toDbm,
  toHz,
  toMetres,
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
  dist: "5",
  distUnit: "km",
  extraLoss: "0",
  rxGain: "3",
  rxCable: "lmr-400",
  rxCableLen: "10",
  rxCableUnit: "ft",
  rxOther: "0.5",
  rxSens: "-100",
  fadeMargin: "10",
};

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
      </div>
      <div class="tile subtotal">
        <span class="label">EIRP</span>
        <span class="value" data-out="eirp"></span>
        <span class="sub" data-out="eirpW"></span>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Path</h2><span class="meta">Line of sight</span></div>
      <div class="fields">
        ${unitField("Distance", "dist", Object.keys(distanceUnits), "distUnit")}
        ${numberField("Extra path loss", "extraLoss", "dB", 'min="0" title="Foliage, buildings, rain, partial Fresnel blockage"')}
      </div>
      <p class="note">
        Free-space loss is the best case with a clear line of sight. Use extra
        path loss for foliage, buildings or a blocked Fresnel zone.
      </p>
      <div class="tile subtotal">
        <span class="label">Free-space path loss</span>
        <span class="value" data-out="fspl"></span>
        <span class="sub" data-out="rxIso"></span>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Receiver</h2><span class="meta">Sets the margin</span></div>
      <div class="fields">
        ${numberField("Antenna gain", "rxGain", "dBi")}
        ${cableFields("rx")}
        ${numberField("Other losses", "rxOther", "dB", 'min="0"')}
        ${numberField("Sensitivity", "rxSens", "dBm", 'title="From the radio datasheet, for the data rate or mode you use"')}
        ${numberField("Fade margin wanted", "fadeMargin", "dB", 'min="0" title="Used for the max range"')}
      </div>
    </section>
  </div>

  <aside class="results">
    <section class="card">
      <div class="card-head">
        <h2>Link budget</h2>
        <span class="pill" data-out="rating"></span>
        <button type="button" class="secondary" data-action="reset">Reset</button>
      </div>
      <div class="tiles">
        <div class="tile">
          <span class="label">Received signal</span>
          <span class="value" data-out="rsl"></span>
        </div>
        <div class="tile">
          <span class="label">Link margin</span>
          <span class="value" data-out="margin"></span>
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
      <p class="note">
        Cable loss assumes a well-matched antenna. High SWR adds more. Margin
        guide: 20 dB+ solid, 10–20 workable, 0–10 marginal.
      </p>
    </section>
  </aside>

  <div class="summary-bar">
    <span aria-hidden="true"><span class="k">RX</span> <b data-out="barRsl"></b></span>
    <span aria-hidden="true"><span class="k">Margin</span> <b data-out="barMargin"></b></span>
    <button type="button" class="secondary" data-action="reset">Reset</button>
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
  value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
const signed = (db: number) => `${db >= 0 ? "+" : "−"}${fmt(Math.abs(db))}`;
const dbm = (value: number) => `${value < 0 ? "−" : ""}${fmt(Math.abs(value))}<span class="unit">dBm</span>`;
const db = (value: number) => `${value < 0 ? "−" : ""}${fmt(Math.abs(value))}<span class="unit">dB</span>`;

function formatWatts(watts: number): string {
  if (watts >= 1) return `${fmt(watts, watts >= 100 ? 0 : 2)} W`;
  if (watts >= 1e-3) return `${fmt(watts * 1e3, 1)} mW`;
  return `${fmt(watts * 1e6, 1)} µW`;
}

function formatRange(metres: number, unit: DistanceUnit): string {
  const value = fromMetres(metres, unit);
  return value >= 1e5 ? "Beyond 100,000" : fmt(value, value < 10 ? 2 : 1);
}

export const linkBudgetCalculator: Calculator = {
  id: "link",
  aliases: ["fspl"],
  title: "Link Budget",
  render() {
    const form = document.createElement("form");
    form.className = "calculator link-budget";
    form.innerHTML = template;
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

    // Cable loss for one side, plus the note under the cable picker.
    const sideCable = (side: "tx" | "rx", freqHz: number): number => {
      const cable = findCable(field(`${side}Cable`).value);
      form.querySelector<HTMLElement>(`[data-show="${side}Cable"]`)!.hidden = !cable;
      const note = out(`${side}CableNote`);
      if (!cable) {
        note.textContent = "";
        return 0;
      }
      const lengthM = toMetres(num(`${side}CableLen`) || 0, field(`${side}CableUnit`).value as DistanceUnit);
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

    const update = () => {
      for (const name of Object.keys(defaults)) state[name] = field(name).value;
      saveState(state);

      const freqHz = toHz(num("freq"), field("freqUnit").value as FrequencyUnit);
      const distUnit = field("distUnit").value as DistanceUnit;
      const inputs: LinkInputs = {
        freqHz,
        distanceM: toMetres(num("dist"), distUnit),
        txPowerDbm: toDbm(num("txPower"), field("txPowerUnit").value as PowerUnit),
        txCableLossDb: sideCable("tx", freqHz),
        txOtherLossDb: num("txOther") || 0,
        txGainDbi: num("txGain") || 0,
        extraPathLossDb: num("extraLoss") || 0,
        rxGainDbi: num("rxGain") || 0,
        rxCableLossDb: sideCable("rx", freqHz),
        rxOtherLossDb: num("rxOther") || 0,
        rxSensitivityDbm: num("rxSens"),
        fadeMarginDb: num("fadeMargin") || 0,
      };

      const problem =
        !(inputs.freqHz > 0) ? "Enter a frequency above zero."
        : !(inputs.distanceM > 0) ? "Enter a distance above zero."
        : !Number.isFinite(inputs.txPowerDbm) ? "Enter a TX power above zero."
        : !Number.isFinite(inputs.rxSensitivityDbm) ? "Enter the receiver sensitivity."
        : "";

      out("error").hidden = !problem;
      out("error").textContent = problem;
      const dash = "—";
      if (problem) {
        for (const name of ["eirp", "eirpW", "fspl", "rxIso", "rsl", "margin", "range", "rangeSub", "barRsl", "barMargin"]) {
          out(name).textContent = dash;
        }
        out("rating").hidden = true;
        out("ledger").replaceChildren();
        return;
      }

      const r = linkBudget(inputs);
      const rating = rateMargin(r.marginDb);

      out("eirp").innerHTML = dbm(r.eirpDbm);
      out("eirpW").textContent = formatWatts(dbmToWatts(r.eirpDbm));
      out("fspl").innerHTML = db(r.fsplDb);
      out("rxIso").textContent = `Arrives at ${fmt(r.rxIsotropicDbm)} dBm before RX antenna gain`;
      out("rsl").innerHTML = dbm(r.rslDbm);
      out("margin").innerHTML = db(r.marginDb);
      out("range").innerHTML = `${formatRange(r.maxRangeM, distUnit)}<span class="unit">${distUnit}</span>`;
      out("rangeSub").textContent = `Keeping ${fmt(inputs.fadeMarginDb, 0)} dB of fade margin`;
      out("barRsl").textContent = `${fmt(r.rslDbm)} dBm`;
      out("barMargin").textContent = `${fmt(r.marginDb)} dB`;
      const pill = out("rating");
      pill.hidden = false;
      pill.className = `pill s-${rating}`;
      pill.textContent = ratingText[rating];

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
    for (const button of form.querySelectorAll<HTMLButtonElement>('[data-action="reset"]')) {
      button.addEventListener("click", () => {
        fill(defaults);
        update();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    }
    update();
    return form;
  },
};
