// The Environment dropdown, its tree height field and its one-line
// explanation, shared by the Link Analysis, Mesh Analysis and Coverage Analysis.

import { DEFAULT_TREE_HEIGHT_M, type Environment, environments, withTreeHeight } from "../lib/environment";
import { AUTO_ENVIRONMENT } from "../lib/landCover";
import { asDistanceUnit, fromMetres, toMetres } from "../lib/units";

/** The Environment dropdown's options: None first, then Auto (from the land cover map), then each profile. */
export function environmentOptions(): string {
  const [none, ...rest] = environments;
  return [
    `<option value="${none.id}">${none.name}</option>`,
    `<option value="${AUTO_ENVIRONMENT}">Auto (satellite map)</option>`,
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

/** The tree height box in a form, if the form has one. */
const treeInput = (form: HTMLElement) => form.querySelector<HTMLInputElement>('input[name="treeHeight"]');
/** The height unit chosen in the form's unit dropdown (named unitName), feet when there's none. */
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
  // Shows the tree height box only for Dense Vegetation or Auto, in the form's
  // height unit, with the default height as its placeholder.
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
  // Again once the page has filled in its saved values, which set fields without events.
  queueMicrotask(sync);
}

