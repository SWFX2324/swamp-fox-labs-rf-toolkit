import type { Calculator } from ".";
import { distanceForLossM, fsplDb, wavelengthM } from "../lib/fspl";
import {
  type DistanceUnit,
  type FrequencyUnit,
  distanceUnits,
  frequencyUnits,
  fromMetres,
  toHz,
  toMetres,
} from "../lib/units";

const template = `
  <section class="card">
    <h2>Free-Space Path Loss</h2>
    <p class="hint">
      Best-case loss between two antennas with clear line of sight. Terrain,
      foliage, buildings and the Fresnel zone all add loss on top of this.
    </p>
    <div class="fields">
      <label>Frequency
        <span class="input-unit">
          <input name="freq" type="number" inputmode="decimal" min="0" step="any" value="915" />
          <select name="freqUnit">${options(frequencyUnits, "MHz")}</select>
        </span>
      </label>
      <label>Distance
        <span class="input-unit">
          <input name="dist" type="number" inputmode="decimal" min="0" step="any" value="1" />
          <select name="distUnit">${options(distanceUnits, "km")}</select>
        </span>
      </label>
    </div>
    <output class="result" name="loss" aria-live="polite"></output>
    <p class="sub-result" data-out="wavelength"></p>
  </section>

  <section class="card">
    <h3>Distance for a loss budget</h3>
    <p class="hint">
      How far apart two antennas can be before free-space loss alone uses up
      the budget, at the frequency above.
    </p>
    <div class="fields">
      <label>Allowed path loss
        <span class="input-unit">
          <input name="budget" type="number" inputmode="decimal" step="any" value="120" />
          <span class="unit">dB</span>
        </span>
      </label>
    </div>
    <output class="result" name="range" aria-live="polite"></output>
  </section>
`;

function options(units: Record<string, number>, selected: string): string {
  return Object.keys(units)
    .map((u) => `<option${u === selected ? " selected" : ""}>${u}</option>`)
    .join("");
}

function format(value: number, digits: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export const fsplCalculator: Calculator = {
  id: "fspl",
  title: "Path Loss",
  render() {
    const form = document.createElement("form");
    form.className = "calculator";
    form.innerHTML = template;
    form.addEventListener("submit", (e) => e.preventDefault());

    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
    const loss = form.querySelector<HTMLOutputElement>('output[name="loss"]')!;
    const range = form.querySelector<HTMLOutputElement>('output[name="range"]')!;
    const wavelength = form.querySelector<HTMLElement>('[data-out="wavelength"]')!;

    const update = () => {
      const freqHz = toHz(field("freq").valueAsNumber, field("freqUnit").value as FrequencyUnit);
      const distUnit = field("distUnit").value as DistanceUnit;
      const distM = toMetres(field("dist").valueAsNumber, distUnit);
      const budget = field("budget").valueAsNumber;
      const freqOk = freqHz > 0;

      loss.textContent =
        freqOk && distM > 0 ? `${format(fsplDb(freqHz, distM), 2)} dB` : "Enter a frequency and distance above zero";
      wavelength.textContent = freqOk
        ? `Wavelength: ${format(wavelengthM(freqHz), 3)} m (${format(fromMetres(wavelengthM(freqHz), "ft"), 2)} ft)`
        : "";
      range.textContent =
        freqOk && Number.isFinite(budget)
          ? `${format(fromMetres(distanceForLossM(freqHz, budget), distUnit), 2)} ${distUnit}`
          : "Enter a frequency and a loss budget";
    };

    form.addEventListener("input", update);
    update();
    return form;
  },
};
