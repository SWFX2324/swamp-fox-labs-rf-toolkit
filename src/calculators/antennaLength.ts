import { enhanceFields, withoutKeys } from "./fieldHelp";
import { antennaGuide } from "./helpText";
import type { Calculator } from ".";
import { bandPresets, designs, elementLengths, findDesign } from "../lib/antenna";
import { cables, findCable } from "../lib/coax";
import { wavelengthM } from "../lib/fspl";
import { drawAntenna } from "./antennaDiagrams";
import { pattern3d } from "../lib/antennaPattern";
import { type PatternScene, createPattern3d } from "./pattern3dView";
import { PANE_ICONS, bandButtons, fitStage, moveModeBar } from "./mapFirst";
import {
  formatFeetInches,
  frequencyUnits,
  toHz,
  asFrequencyUnit,
} from "../lib/units";

const STORAGE_KEY = "rf-toolkit:antenna-length";

/** How each design stands in the 3D pattern view. */
const ANTENNA_POSE: Record<string, PatternScene["antenna"]> = {
  dipole: "horizontal",
  fullwave: "horizontal",
  efhw: "horizontal",
  groundplane: "ground",
  fiveeighths: "ground",
  jpole: "vertical",
  loop: "loop",
};

const defaults: Record<string, string> = {
  freq: "146.52",
  freqUnit: "MHz",
  design: "dipole",
  factor: "0.95",
  cable: "rg-58",
};

const template = `
  <div class="lb-shell stage-page">
  <div class="lb-left">
    <section class="card">
      <div class="card-head"><h2 class="with-icon">${PANE_ICONS.tx}Antenna</h2></div>
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
      ${bandButtons(bandPresets)}
    </section>
  </div>

  <div class="lb-map lb-stage">
    <p class="error" data-out="error" hidden></p>
    <div class="antenna-diagram" data-out="diagram"></div>
    <div data-out="patterns"></div>
    <p class="note pattern-note" data-out="patternNote">Idealized pattern: free space, or perfect ground for verticals with radials. Drag to turn it.</p>
  </div>

  <aside class="results lb-right">
    <section class="card">
      <div class="card-head">
        <h2 class="with-icon">${PANE_ICONS.pattern}<span data-out="designName"></span></h2>
        <button type="button" class="secondary" data-action="reset">Reset</button>
      </div>
      <div class="tiles" data-out="tiles"></div>
      <table class="ledger geometry">
        <tbody>
          <tr><td>Free-space wavelength</td><td class="num mono" data-out="lambda"></td></tr>
          <tr><td>Feed point</td><td class="feed" data-out="feed"></td></tr>
        </tbody>
      </table>
      <ul class="notes" data-out="notes"></ul>
    </section>
  </aside>
  </div>
`;

/** The saved inputs over the defaults, so a field added since still gets its default. */
function loadState(): Record<string, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return { ...defaults, ...(typeof saved === "object" && saved ? saved : {}) };
  } catch {
    return { ...defaults };
  }
}

/** Remembers the inputs. */
function saveState(state: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked: inputs just won't be remembered.
  }
}

/** A length in meters to three decimal places, or in centimeters below a meter. */
const metric = (m: number) =>
  m >= 1 ? `${m.toFixed(3)} m` : `${(m * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })} cm`;

export const antennaLengthCalculator: Calculator = {
  id: "antenna",
  title: "Antenna Planning Tool",
  shortTitle: "Antenna",
  // Builds the page and recalculates the element lengths, diagram and pattern on every change.
  render() {
    const form = document.createElement("form");
    form.className = "calculator antenna-length map-first";
    form.innerHTML = template;
    form.addEventListener("submit", (e) => e.preventDefault());

    // A field in the form by its name.
    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
    // A result element by its data-out name.
    const out = (name: string) => form.querySelector<HTMLElement>(`[data-out="${name}"]`)!;

    // Puts saved or default values into the form's fields.
    const fill = (values: Record<string, string>) => {
      // Skip names that no longer exist, such as a renamed field in old saved state.
      for (const [name, value] of Object.entries(values)) {
        const el = form.elements.namedItem(name);
        if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.value = value;
      }
    };
    fill(loadState());
    const pattern = createPattern3d();
    out("patterns").replaceWith(pattern.element);

    // Reads the inputs, saves them, and redraws every result, or shows what to fix when an input isn't usable.
    const update = () => {
      const state: Record<string, string> = {};
      for (const name of Object.keys(defaults)) state[name] = field(name).value;
      saveState(state);

      const design = findDesign(field("design").value) ?? designs[0];
      const freqHz = toHz(Number.parseFloat(field("freq").value), asFrequencyUnit(field("freqUnit").value));
      const factor = Number.parseFloat(field("factor").value);
      const isStub = design.id === "coaxstub";

      form.querySelector<HTMLElement>('[data-show="cable"]')!.hidden = !isStub;
      out("designName").textContent = design.name;
      out("factorLabel").textContent = design.factorLabel;

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
        pattern.show(undefined);
        out("patternNote").hidden = true;
        out("lambda").textContent = "—";
        return;
      }

      const lengths = elementLengths(design, freqHz, factor);
      out("diagram").innerHTML = drawAntenna(design.id, lengths);
      // The pattern in 3D; a coax stub has none.
      const shape = pattern3d(design.id);
      pattern.show(shape ? { field: shape, antenna: ANTENNA_POSE[design.id] ?? "horizontal" } : undefined);
      out("patternNote").hidden = !shape;
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
    moveModeBar(form);
    fitStage(form);
    return form;
  },
};
