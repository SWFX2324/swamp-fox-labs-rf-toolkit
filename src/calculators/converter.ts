// RF Converter: cards of linked fields. Each card keeps one canonical value
// (dBm, reflection coefficient, dBi, dB); typing in any field converts it to
// that value and refills the others. Wavelengths live in Antenna Length.

import type { Calculator } from ".";
import {
  dbToPowerRatio,
  dbToVoltageRatio,
  dbdToDbi,
  dbiToDbd,
  dbmToDbw,
  dbmToMicrovolts,
  dbwToDbm,
  gammaToReturnLoss,
  gammaToSwr,
  microvoltsToDbm,
  mismatchLossDb,
  returnLossToGamma,
  sMeter,
  swrToGamma,
} from "../lib/convert";
import { dbmToWatts, wattsToDbm } from "../lib/units";

const STORAGE_KEY = "rf-toolkit:converter";

interface Field {
  name: string;
  label: string;
  unit: string;
  /** Field value to the card's canonical value; undefined if out of range. */
  to(v: number): number | undefined;
  from(c: number): number;
}

interface Card {
  id: string;
  title: string;
  meta: string;
  initial: number;
  fields: Field[];
  outputs?(c: number): [string, string][];
  note?: string;
}

const positive = (f: (v: number) => number) => (v: number) => (v > 0 ? f(v) : undefined);
const pct = (fraction: number) => `${num(fraction * 100)}%`;

/** Up to 5 significant figures, scientific for very large or small values. */
function num(v: number): string {
  if (!Number.isFinite(v)) return "∞";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e7 || a < 1e-4) return v.toExponential(3).replace("e", "×10^").replace("^+", "^");
  return String(Number(v.toPrecision(5)));
}

const cards: Card[] = [
  {
    id: "power",
    title: "Power",
    meta: "Into 50 Ω",
    initial: 30,
    fields: [
      { name: "w", label: "Watts", unit: "W", to: positive(wattsToDbm), from: dbmToWatts },
      { name: "mw", label: "Milliwatts", unit: "mW", to: positive((v) => wattsToDbm(v / 1000)), from: (c) => dbmToWatts(c) * 1000 },
      { name: "dbm", label: "dBm", unit: "dBm", to: (v) => v, from: (c) => c },
      { name: "dbw", label: "dBW", unit: "dBW", to: dbwToDbm, from: dbmToDbw },
      { name: "uv", label: "Voltage at the receiver", unit: "µV", to: positive(microvoltsToDbm), from: dbmToMicrovolts },
    ],
    outputs: (c) => [
      ["S-meter, HF", sMeter(c, "hf")],
      ["S-meter, VHF and up", sMeter(c, "vhf")],
    ],
    note: "S-meter by the IARU standard: S9 is −73 dBm on HF and −93 dBm above 30 MHz, 6 dB per S-unit. Real radios vary.",
  },
  {
    id: "mismatch",
    title: "SWR and return loss",
    meta: "Mismatch",
    initial: 1 / 3,
    fields: [
      { name: "swr", label: "SWR", unit: ":1", to: (v) => (v >= 1 ? swrToGamma(v) : undefined), from: gammaToSwr },
      { name: "rl", label: "Return loss", unit: "dB", to: (v) => (v > 0 ? returnLossToGamma(v) : undefined), from: gammaToReturnLoss },
      { name: "gamma", label: "Reflection coefficient |Γ|", unit: "", to: (v) => (v >= 0 && v < 1 ? v : undefined), from: (c) => c },
    ],
    outputs: (c) => [
      ["Mismatch loss", `${num(mismatchLossDb(c))} dB`],
      ["Power reflected", pct(c * c)],
      ["Power accepted", pct(1 - c * c)],
    ],
  },
  {
    id: "gain",
    title: "Antenna gain",
    meta: "dBi and dBd",
    initial: 2.15,
    fields: [
      { name: "dbi", label: "Over isotropic", unit: "dBi", to: (v) => v, from: (c) => c },
      { name: "dbd", label: "Over a dipole", unit: "dBd", to: dbdToDbi, from: dbiToDbd },
    ],
    outputs: (c) => [["Power gain over isotropic", `×${num(dbToPowerRatio(c))}`]],
    note: "A half-wave dipole is 2.15 dBi. Gain quoted in dBd reads 2.15 lower than the same antenna in dBi.",
  },
  {
    id: "ratio",
    title: "Decibels",
    meta: "Ratios",
    initial: 3,
    fields: [
      { name: "db", label: "Decibels", unit: "dB", to: (v) => v, from: (c) => c },
      { name: "pr", label: "Power ratio", unit: "×", to: positive((v) => 10 * Math.log10(v)), from: dbToPowerRatio },
      { name: "vr", label: "Voltage ratio", unit: "×", to: positive((v) => 20 * Math.log10(v)), from: dbToVoltageRatio },
    ],
  },
];

function loadState(): Record<string, number> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return typeof saved === "object" && saved ? saved : {};
  } catch {
    return {};
  }
}

function saveState(state: Record<string, number>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked: values just won't be remembered.
  }
}

export const converterCalculator: Calculator = {
  id: "convert",
  title: "RF Converter",
  shortTitle: "Convert",
  render() {
    const root = document.createElement("form");
    root.className = "calculator converter";
    root.addEventListener("submit", (e) => e.preventDefault());
    const state = loadState();

    for (const card of cards) {
      const section = document.createElement("section");
      section.className = "card";
      section.innerHTML = `
        <div class="card-head"><h2>${card.title}</h2><span class="meta">${card.meta}</span></div>
        <div class="fields">
          ${card.fields
            .map(
              (f) => `
            <label>${f.label}
              <span class="input-unit">
                <input name="${card.id}-${f.name}" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" />
                ${f.unit ? `<span class="unit">${f.unit}</span>` : ""}
              </span>
            </label>`,
            )
            .join("")}
        </div>
        ${card.outputs ? `<table class="ledger geometry"><tbody data-out="${card.id}-outputs"></tbody></table>` : ""}
        ${card.note ? `<p class="note">${card.note}</p>` : ""}`;
      root.append(section);

      const input = (f: Field) => section.querySelector<HTMLInputElement>(`input[name="${card.id}-${f.name}"]`)!;
      const refill = (canonical: number, except?: Field) => {
        for (const f of card.fields) if (f !== except) input(f).value = num(f.from(canonical));
        const out = section.querySelector<HTMLElement>(`[data-out="${card.id}-outputs"]`);
        if (out && card.outputs) {
          out.innerHTML = card.outputs(canonical)
            .map(([k, v]) => `<tr><td>${k}</td><td class="num mono">${v}</td></tr>`)
            .join("");
        }
      };

      for (const f of card.fields) {
        input(f).addEventListener("input", () => {
          // Accept "1,000" and "×10^" pasted back from another field.
          const raw = input(f).value.replace(/,/g, "").replace(/×10\^/g, "e");
          const canonical = raw.trim() ? f.to(Number(raw)) : undefined;
          const ok = canonical !== undefined && Number.isFinite(canonical);
          input(f).classList.toggle("invalid", raw.trim() !== "" && !ok);
          if (!ok) return;
          state[card.id] = canonical;
          saveState(state);
          refill(canonical, f);
        });
        input(f).addEventListener("blur", () => {
          input(f).classList.remove("invalid");
          refill(state[card.id] ?? card.initial);
        });
      }
      refill(state[card.id] ?? card.initial);
    }

    const reset = document.createElement("div");
    reset.className = "converter-actions";
    reset.innerHTML = `<button type="button" class="secondary">Reset all</button>`;
    reset.querySelector("button")!.addEventListener("click", () => {
      for (const key of Object.keys(state)) delete state[key];
      saveState(state);
      root.replaceWith(converterCalculator.render());
    });
    root.append(reset);
    return root;
  },
};
