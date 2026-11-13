// The Environment dropdown, its tree height field and its one-line
// explanation, shared by the Link Analysis, Mesh Planner and Coverage Analysis.

import { DEFAULT_TREE_HEIGHT_M, type Environment, aboveModelRange, belowModelRange, clutterLossDb, environments, withTreeHeight } from "../lib/environment";
import { AUTO_ENVIRONMENT, type LandCoverPoint, describePoint } from "../lib/landCover";
import { asDistanceUnit, fromMetres, toMetres } from "../lib/units";

export function environmentOptions(): string {
  const [none, ...rest] = environments;
  return [
    `<option value="${none.id}">${none.name}</option>`,
    `<option value="${AUTO_ENVIRONMENT}">From land-cover map</option>`,
    ...rest.map((e) => `<option value="${e.id}">${e.name}</option>`),
  ].join("");
}

/** The tree height field, shown only when trees can be in play (Dense Vegetation or the land-cover map). */
export function treeHeightFieldHtml(): string {
  return `
    <label data-tree hidden>Tree height
      <span class="input-unit">
        <input name="treeHeight" type="number" inputmode="decimal" step="any" min="1" />
        <span class="unit" data-tree-unit>ft</span>
      </span>
    </label>`;
}

const treeInput = (form: HTMLElement) => form.querySelector<HTMLInputElement>('input[name="treeHeight"]');
const unitOf = (form: HTMLElement, unitName: string) =>
  asDistanceUnit(form.querySelector<HTMLSelectElement | HTMLInputElement>(`[name="${unitName}"]`)?.value ?? "ft", "ft");

/** The canopy height typed in, metres; undefined when blank, so the 20 m default applies. */
export function treeHeightM(form: HTMLElement, unitName: string): number | undefined {
  const v = Number.parseFloat(treeInput(form)?.value ?? "");
  return v > 0 ? toMetres(v, unitOf(form, unitName)) : undefined;
}

/** A profile with the typed tree height applied (woodland only). */
export function withFormTrees(form: HTMLElement, unitName: string, env: Environment): Environment {
  return withTreeHeight(env, treeHeightM(form, unitName));
}

/**
 * Show the tree height field when it matters, in the tab's height unit, with
 * the default as its placeholder. unitName is the select that sets the unit of
 * antenna heights.
 */
export function bindTreeField(form: HTMLElement, unitName: string): void {
  const sync = () => {
    const label = form.querySelector<HTMLElement>("[data-tree]");
    const input = treeInput(form);
    if (!label || !input) return;
    const env = form.querySelector<HTMLSelectElement>('select[name="environment"]')?.value;
    label.hidden = env !== "dense" && env !== AUTO_ENVIRONMENT;
    const unit = unitOf(form, unitName);
    label.querySelector("[data-tree-unit]")!.textContent = unit;
    input.placeholder = String(Math.round(fromMetres(DEFAULT_TREE_HEIGHT_M, unit)));
  };
  form.addEventListener("input", sync);
  form.addEventListener("change", sync);
  sync();
}

const roughNote = (freqHz: number) =>
  aboveModelRange(freqHz) ? " The model stops at 3 GHz, so this uses the 3 GHz figure and may read low." : "";

/** What the chosen profile adds for these two antenna heights. */
export function environmentNote(env: Environment, freqHz: number, aHeightM: number, bHeightM: number): string {
  if (env.id === "none" || !(freqHz > 0)) return "";
  if (belowModelRange(freqHz)) return "Environment profiles cover 30 MHz and up, so none is applied on HF.";
  const a = clutterLossDb(env, freqHz, aHeightM);
  const b = clutterLossDb(env, freqHz, bHeightM);
  const total = (a + b).toFixed(1);
  const how =
    env.model === "forest"
      ? `an antenna below the ${Math.round(env.clutterHeightM)} m canopy loses this on top of a path worked from its real height (ITU-R P.833 woodland), and one above it loses nothing`
      : "terrain is checked from the top of the clutter";
  return `${env.name} adds about ${total} dB: ${a.toFixed(1)} dB at one end and ${b.toFixed(1)} dB at the other. An estimate that assumes this surrounds both antennas; ${how}.${roughNote(freqHz)}`;
}

/** What the land-cover map found at each end, and what it adds. */
export function landCoverNote(
  ends: [LandCoverPoint, LandCoverPoint],
  labels: [string, string],
  freqHz: number,
  aHeightM: number,
  bHeightM: number,
): string {
  if (!(freqHz > 0)) return "";
  if (belowModelRange(freqHz)) return "Environment profiles cover 30 MHz and up, so none is applied on HF.";
  const part = (p: LandCoverPoint, label: string, h: number) =>
    `${label} is in ${describePoint(p)}, adding ${clutterLossDb(p.environment, freqHz, h).toFixed(1)} dB`;
  return `From the land-cover map: ${part(ends[0], labels[0], aHeightM)}; ${part(ends[1], labels[1], bHeightM)}. Terrain is checked from the top of the clutter at each end, or from the antenna itself under trees.${roughNote(freqHz)}`;
}
