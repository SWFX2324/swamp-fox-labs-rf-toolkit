// Coax Loss: loss, delivered power and SWR at the radio for one cable, plus
// every cable in the table compared side by side for the same run.

import { enhanceFields } from "./fieldHelp";
import { coaxGuide } from "./helpText";
import type { Calculator } from ".";
import { bandPresets } from "../lib/antenna";
import {
  beyondCableRange,
  cableLossDb,
  cables,
  findCable,
  lossPer100Ft,
  powerDelivered,
  swrAtInput,
  totalLineLossDb,
} from "../lib/coax";
import {
  dbmToWatts,
  frequencyUnits,
  powerUnits,
  toDbm,
  toHz,
  toMetres,
  asDistanceUnit,
  asFrequencyUnit,
  asPowerUnit,
} from "../lib/units";

const STORAGE_KEY = "rf-toolkit:coax-loss";

const defaults: Record<string, string> = {
  freq: "146.52",
  freqUnit: "MHz",
  runLength: "50",
  lengthUnit: "ft",
  power: "50",
  powerUnit: "W",
  swr: "1.0",
  connectors: "0",
  cable: "lmr-400",
};

const template = `
  <div class="inputs">
    <section class="card">
      <div class="card-head"><h2>Coax run</h2><span class="meta">Matched loss plus SWR</span></div>
      <div class="fields">
        <label>Frequency
          <span class="input-unit">
            <input name="freq" type="number" inputmode="decimal" step="any" min="0" />
            <select name="freqUnit">${Object.keys(frequencyUnits).map((u) => `<option>${u}</option>`).join("")}</select>
          </span>
        </label>
        <label>Cable length
          <span class="input-unit">
            <input name="runLength" type="number" inputmode="decimal" step="any" min="0" />
            <select name="lengthUnit"><option>ft</option><option>m</option></select>
          </span>
        </label>
        <label>Power in
          <span class="input-unit">
            <input name="power" type="number" inputmode="decimal" step="any" />
            <select name="powerUnit">${powerUnits.map((u) => `<option>${u}</option>`).join("")}</select>
          </span>
        </label>
        <label>SWR at the antenna
          <span class="input-unit">
            <input name="swr" type="number" inputmode="decimal" step="0.1" min="1" />
            <span class="unit">:1</span>
          </span>
        </label>
        <label>Connector losses
          <span class="input-unit">
            <input name="connectors" type="number" inputmode="decimal" step="0.05" min="0" title="Roughly 0.1 dB per good connector pair at VHF/UHF" />
            <span class="unit">dB</span>
          </span>
        </label>
        <label>Your cable
          <select name="cable">${cables.map((c) => `<option value="${c.id}">${c.name}</option>`).join("")}</select>
        </label>
      </div>
      <div class="chips" role="group" aria-label="Band presets">
        ${bandPresets.map((b) => `<button type="button" class="chip" data-mhz="${b.mhz}">${b.label}</button>`).join("")}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Compare cables</h2><span class="meta">Same run, lowest loss first</span></div>
      <div class="table-wrap">
        <table class="ledger compare">
          <thead>
            <tr><th>Cable</th><th class="num">dB/100 ft</th><th>Loss for this run</th><th class="num">Power out</th></tr>
          </thead>
          <tbody data-out="compare"></tbody>
        </table>
      </div>
      <p class="note">Tap a row to make it your cable. Loss includes SWR and connector losses.</p>
    </section>
  </div>

  <aside class="results">
    <section class="card">
      <div class="card-head">
        <h2 data-out="cableName"></h2>
        <span class="pill" data-out="pill" hidden></span>
        <button type="button" class="secondary" data-action="reset">Reset</button>
      </div>
      <p class="error" data-out="error" hidden></p>
      <p class="callout" data-out="warn" hidden></p>
      <div class="tiles">
        <div class="tile"><span class="label">Total loss</span><span class="value" data-out="loss"></span><span class="sub" data-out="lossSub"></span></div>
        <div class="tile"><span class="label">Power out</span><span class="value" data-out="pout"></span><span class="sub" data-out="poutSub"></span></div>
        <div class="tile"><span class="label">SWR at the radio</span><span class="value" data-out="swrIn"></span><span class="sub" data-out="swrInSub"></span></div>
        <div class="tile"><span class="label">Velocity factor</span><span class="value" data-out="vf"></span><span class="sub" data-out="vfSub"></span></div>
      </div>
      <details class="about"><summary>About this calculation</summary><p>Matched loss uses Times Microwave k1/k2 coefficients for LMR cable and typical values for RG types. High SWR adds loss because reflected power crosses the line twice (ARRL Antenna Book formula).</p></details>
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

function saveState(state: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked: inputs just won't be remembered.
  }
}

const fmt = (v: number, digits = 2) =>
  v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace("-", "−");

function formatWatts(w: number): string {
  if (w >= 1) return `${fmt(w, w >= 100 ? 0 : 1)} W`;
  if (w >= 1e-3) return `${fmt(w * 1e3, 1)} mW`;
  return `${fmt(w * 1e6, 1)} µW`;
}

/** A fraction as a whole percent, with "<1%" rather than a misleading "0%". */
const percent = (fraction: number) => (fraction > 0 && fraction < 0.005 ? "<1%" : `${fmt(fraction * 100, 0)}%`);

/** Share of power delivered, rated with a word so it never relies on color. */
function rating(fraction: number): { text: string; cls: string } {
  if (fraction >= 0.8) return { text: "Good", cls: "s-good" };
  if (fraction >= 0.5) return { text: "Fair", cls: "s-fair" };
  return { text: "Poor", cls: "s-fail" };
}

export const coaxLossCalculator: Calculator = {
  id: "coax",
  title: "Coax Loss",
  shortTitle: "Coax",
  render() {
    const form = document.createElement("form");
    form.className = "calculator two-col coax-loss";
    form.innerHTML = template;
    form.addEventListener("submit", (e) => e.preventDefault());

    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
    const out = (name: string) => form.querySelector<HTMLElement>(`[data-out="${name}"]`)!;
    const num = (name: string) => Number.parseFloat(field(name).value);
    const fill = (values: Record<string, string>) => {
      // Skip names that no longer exist, such as a renamed field in old saved state.
      for (const [name, value] of Object.entries(values)) {
        const el = form.elements.namedItem(name);
        if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.value = value;
      }
    };
    fill(loadState());

    const update = () => {
      const state: Record<string, string> = {};
      for (const name of Object.keys(defaults)) state[name] = field(name).value;
      saveState(state);

      const freqHz = toHz(num("freq"), asFrequencyUnit(field("freqUnit").value));
      const lengthM = toMetres(num("runLength"), asDistanceUnit(field("lengthUnit").value));
      const pinDbm = toDbm(num("power"), asPowerUnit(field("powerUnit").value));
      const swr = num("swr");
      const connectors = num("connectors") || 0;
      const selected = findCable(field("cable").value) ?? cables[0];
      out("cableName").textContent = selected.name;

      const mhz = freqHz / 1e6;
      for (const chip of form.querySelectorAll<HTMLButtonElement>(".chip")) {
        chip.setAttribute("aria-pressed", String(Math.abs(Number(chip.dataset.mhz) - mhz) < 1e-6));
      }

      const problem =
        !(freqHz > 0) ? "Enter a frequency above zero."
        : !(lengthM >= 0) ? "Enter a cable length."
        : !Number.isFinite(pinDbm) ? "Enter a power above zero."
        : !(swr >= 1) ? "SWR is 1.0 or more."
        : "";
      out("error").hidden = !problem;
      out("error").textContent = problem;
      out("pill").hidden = !!problem;
      if (problem) {
        for (const n of ["loss", "lossSub", "pout", "poutSub", "swrIn", "swrInSub", "vf", "vfSub"]) out(n).textContent = "—";
        out("compare").replaceChildren();
        out("warn").hidden = true;
        return;
      }

      const pinW = dbmToWatts(pinDbm);
      const rows = cables
        .map((cable) => {
          const matched = cableLossDb(cable, freqHz, lengthM) + connectors;
          const total = totalLineLossDb(matched, swr);
          return { cable, matched, total, delivered: powerDelivered(total) };
        })
        .sort((a, b) => a.total - b.total);
      const mine = rows.find((r) => r.cable.id === selected.id)!;

      // Selected cable.
      const r = rating(mine.delivered);
      const pill = out("pill");
      pill.className = `pill ${r.cls}`;
      pill.textContent = `${r.text}: ${percent(mine.delivered)} delivered`;
      out("loss").innerHTML = `${fmt(mine.total)}<span class="unit">dB</span>`;
      out("lossSub").textContent =
        swr > 1
          ? `${fmt(mine.matched)} dB matched + ${fmt(mine.total - mine.matched)} dB from SWR`
          : `${fmt(lossPer100Ft(mine.cable, freqHz))} dB per 100 ft${connectors ? ` + ${fmt(connectors)} dB connectors` : ""}`;
      out("pout").textContent = formatWatts(pinW * mine.delivered);
      out("poutSub").textContent = `${percent(mine.delivered)} of ${formatWatts(pinW)}; ${formatWatts(pinW * (1 - mine.delivered))} lost as heat or reflected`;
      const swrRadio = swrAtInput(mine.matched, swr);
      out("swrIn").innerHTML = `${fmt(swrRadio)}<span class="unit">:1</span>`;
      out("swrInSub").textContent =
        swr > 1 ? `The antenna is really ${fmt(swr, 1)}:1; line loss hides some of it` : "Matched antenna";
      out("vf").textContent = selected.vf.toFixed(2);
      out("vfSub").textContent = `Electrical length ${fmt(lengthM / selected.vf / (299_792_458 / freqHz), 2)} wavelengths`;

      const warn = out("warn");
      warn.hidden = !beyondCableRange(selected, freqHz);
      warn.textContent = `${selected.name} data stops at ${selected.maxMHz} MHz, so this figure is rough. Check the cable's datasheet.`;

      // Comparison table, bars scaled to the worst cable shown.
      const worst = Math.max(...rows.map((x) => x.total), 0.01);
      out("compare").innerHTML = rows
        .map(({ cable, total, delivered }) => {
          const rough = beyondCableRange(cable, freqHz);
          const rr = rating(delivered);
          const tip = `${cable.name}: ${fmt(total)} dB, ${percent(delivered)} delivered, ${formatWatts(pinW * delivered)} out`;
          return `
            <tr data-cable="${cable.id}" title="${tip}"${cable.id === selected.id ? ' class="selected"' : ""}>
              <td class="cable-name">${cable.name}${rough ? ' <span class="tag">rough</span>' : ""}</td>
              <td class="num mono">${fmt(lossPer100Ft(cable, freqHz))}</td>
              <td class="bar-cell">
                <span class="bar-track"><span class="bar" style="width:${((total / worst) * 100).toFixed(1)}%"></span></span>
                <span class="mono">${fmt(total)} dB</span>
              </td>
              <td class="num"><span class="mono">${formatWatts(pinW * delivered)}</span> <span class="pill ${rr.cls}">${percent(delivered)}</span></td>
            </tr>`;
        })
        .join("");
    };

    out("compare").addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLTableRowElement>("tr[data-cable]");
      if (!row) return;
      field("cable").value = row.dataset.cable!;
      update();
    });
    for (const chip of form.querySelectorAll<HTMLButtonElement>(".chip")) {
      chip.addEventListener("click", () => {
        const mhz = Number(chip.dataset.mhz);
        field("freqUnit").value = mhz >= 1000 ? "GHz" : "MHz";
        field("freq").value = String(mhz >= 1000 ? mhz / 1000 : mhz);
        update();
      });
    }
    form.querySelector('[data-action="reset"]')!.addEventListener("click", () => {
      fill(defaults);
      update();
    });

    form.addEventListener("input", update);
    form.addEventListener("change", update);
    update();
    enhanceFields(form, coaxGuide, defaults);
    return form;
  },
};
