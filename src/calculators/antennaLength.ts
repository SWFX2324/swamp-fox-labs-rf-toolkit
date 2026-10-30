import { enhanceFields, withoutKeys } from "./fieldHelp";
import { antennaGuide } from "./helpText";
import type { Calculator } from ".";
import { bandPresets, designs, elementLengths, findDesign } from "../lib/antenna";
import { cables, findCable } from "../lib/coax";
import { wavelengthM } from "../lib/fspl";
import { drawAntenna } from "./antennaDiagrams";
import { type FrequencyUnit, formatFeetInches, frequencyUnits, toHz } from "../lib/units";

const STORAGE_KEY = "rf-toolkit:antenna-length";

const defaults: Record<string, string> = {
  freq: "146.52",
  freqUnit: "MHz",
  design: "dipole",
  factor: "0.95",
  cable: "rg-58",
};

const template = `
  <div class="inputs">
    <section class="card">
      <div class="card-head"><h2>Antenna</h2><span class="meta">Cut lengths</span></div>
      <div class="fields">
        <label>Frequency
          <span class="input-unit">
            <input name="freq" type="number" inputmode="decimal" step="any" min="0" />
            <select name="freqUnit">${Object.keys(frequencyUnits).map((u) => `<option>${u}</option>`).join("")}</select>
          </span>
        </label>
        <label>Antenna type
          <select name="design">${designs.map((d) => `<option value="${d.id}">${d.name}</option>`).join("")}</select>
        </label>
        <label data-show="cable">Coax
          <select name="cable">${cables.map((c) => `<option value="${c.id}">${c.name} (VF ${c.vf.toFixed(2)})</option>`).join("")}</select>
        </label>
        <label><span data-out="factorLabel"></span>
          <input name="factor" type="number" inputmode="decimal" step="0.01" min="0.5" max="1.1" />
        </label>
      </div>
      <div class="chips" role="group" aria-label="Band presets">
        ${bandPresets.map((b) => `<button type="button" class="chip" data-mhz="${b.mhz}">${b.label}</button>`).join("")}
      </div>
      <p class="note" data-out="factorNote"></p>
    </section>
  </div>

  <aside class="results">
    <section class="card">
      <div class="card-head">
        <h2 data-out="designName"></h2>
        <button type="button" class="secondary" data-action="reset">Reset</button>
      </div>
      <p class="error" data-out="error" hidden></p>
      <div class="antenna-diagram" data-out="diagram"></div>
      <div class="tiles" data-out="tiles"></div>
      <table class="ledger geometry">
        <tbody>
          <tr><td>Free-space wavelength</td><td class="num mono" data-out="lambda"></td></tr>
          <tr><td>Feed point</td><td class="feed" data-out="feed"></td></tr>
        </tbody>
      </table>
      <ul class="notes" data-out="notes"></ul>
      <p class="note">
        Cut about 3% long and trim to the lowest SWR. Nearby objects, wire
        insulation and height above ground all shift resonance.
      </p>
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

const metric = (m: number) =>
  m >= 1 ? `${m.toFixed(3)} m` : `${(m * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })} cm`;

export const antennaLengthCalculator: Calculator = {
  id: "antenna",
  title: "Antenna Length",
  shortTitle: "Antenna",
  render() {
    const form = document.createElement("form");
    form.className = "calculator two-col antenna-length";
    form.innerHTML = template;
    form.addEventListener("submit", (e) => e.preventDefault());

    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
    const out = (name: string) => form.querySelector<HTMLElement>(`[data-out="${name}"]`)!;

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

      const design = findDesign(field("design").value) ?? designs[0];
      const freqHz = toHz(Number.parseFloat(field("freq").value), field("freqUnit").value as FrequencyUnit);
      const factor = Number.parseFloat(field("factor").value);
      const isStub = design.id === "coaxstub";

      form.querySelector<HTMLElement>('[data-show="cable"]')!.hidden = !isStub;
      out("designName").textContent = design.name;
      out("factorLabel").textContent = design.factorLabel;
      out("factorNote").textContent = isStub
        ? "Velocity factor comes from the cable. Check your cable's datasheet; foam types vary."
        : `Default ${design.defaultFactor.toFixed(2)}. Thicker conductors resonate shorter, so tubing may need a slightly lower factor than thin wire.`;

      const mhz = freqHz / 1e6;
      for (const chip of form.querySelectorAll<HTMLButtonElement>(".chip")) {
        chip.setAttribute("aria-pressed", String(Math.abs(Number(chip.dataset.mhz) - mhz) < 1e-6));
      }

      const problem = !(freqHz > 0)
        ? "Enter a frequency above zero."
        : !(factor > 0)
          ? `Enter a ${design.factorLabel.toLowerCase()} above zero.`
          : "";
      out("error").hidden = !problem;
      out("error").textContent = problem;
      if (problem) {
        out("tiles").replaceChildren();
        out("diagram").replaceChildren();
        out("lambda").textContent = "—";
        return;
      }

      const lengths = elementLengths(design, freqHz, factor);
      out("diagram").innerHTML = drawAntenna(design.id, lengths);
      out("tiles").innerHTML = lengths
        .map(
          (e) => `
          <div class="tile">
            <span class="label">${e.name}${e.count > 1 ? ` <span class="count">×${e.count}</span>` : ""}</span>
            <span class="value">${formatFeetInches(e.lengthM)}</span>
            <span class="sub">${metric(e.lengthM)}${e.note ? ` · ${e.note}` : ""}</span>
          </div>`,
        )
        .join("");
      const lambda = wavelengthM(freqHz);
      out("lambda").textContent = `${formatFeetInches(lambda)} · ${metric(lambda)}`;
      out("feed").textContent = design.feed;
      out("notes").innerHTML = design.notes.map((n) => `<li>${n}</li>`).join("");
    };

    // Switching design or cable resets the factor to the matching default.
    field("design").addEventListener("change", () => {
      const design = findDesign(field("design").value);
      if (!design) return;
      field("factor").value = String(
        design.id === "coaxstub" ? (findCable(field("cable").value)?.vf ?? design.defaultFactor) : design.defaultFactor,
      );
    });
    field("cable").addEventListener("change", () => {
      const cable = findCable(field("cable").value);
      if (cable) field("factor").value = String(cable.vf);
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
    enhanceFields(form, antennaGuide, withoutKeys(defaults, "factor"));
    return form;
  },
};
