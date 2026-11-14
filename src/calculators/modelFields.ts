// The propagation model settings (Longley-Rice / ITM), shared by the Link
// Budget, Mesh Analysis and Coverage Analysis. Each page adds modelDefaults to its
// own defaults, so the settings save, reset and travel in plans like any
// other field.

import { type ModelSettings, climates, defaultModel, groundForEnvironment, grounds, parseModel } from "../lib/propagation";

export const modelDefaults: Record<string, string> = {
  reliability: String(defaultModel.reliability),
  confidence: String(defaultModel.confidence),
  climate: String(defaultModel.climate),
  ground: defaultModel.ground,
  polarization: defaultModel.polarization,
};

const percentField = (label: string, name: string) => `
    <label>${label}
      <span class="input-unit">
        <input name="${name}" type="number" inputmode="decimal" step="any" min="1" max="99" />
        <span class="unit">%</span>
      </span>
    </label>`;

export function modelFieldsHtml(): string {
  return `
    <div class="field-group-head" role="heading" aria-level="3">Longley-Rice model <span class="meta">Terrain loss settings</span></div>
    ${percentField("Reliability (time)", "reliability")}
    ${percentField("Confidence", "confidence")}
    <label>Radio climate
      <select name="climate">${climates.map((c) => `<option value="${c.id}">${c.name}</option>`).join("")}</select>
    </label>
    <label>Ground
      <select name="ground">${grounds.map((g) => `<option value="${g.id}">${g.name}</option>`).join("")}</select>
    </label>
    <label>Polarization
      <select name="polarization"><option value="vertical">Vertical</option><option value="horizontal">Horizontal</option></select>
    </label>`;
}

/** The settings as the form has them now. */
export function readModel(form: HTMLFormElement): ModelSettings {
  const value = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null)?.value;
  return parseModel({
    climate: value("climate"),
    ground: value("ground"),
    polarization: value("polarization"),
    reliability: value("reliability"),
    confidence: value("confidence"),
  });
}

/**
 * Picking an Environment suggests the matching Ground (Open Water → sea
 * water, Desert → poor ground), unless Ground was already changed from what
 * the previous Environment suggested. The previous Environment is read when
 * the dropdown gets focus, so plans and resets that set values directly are
 * handled too.
 */
export function linkGroundToEnvironment(form: HTMLFormElement): void {
  const env = form.elements.namedItem("environment");
  const ground = form.elements.namedItem("ground");
  if (!(env instanceof HTMLSelectElement) || !(ground instanceof HTMLSelectElement)) return;
  let previous = env.value;
  env.addEventListener("focus", () => (previous = env.value));
  // Runs before the form's own change handler, so the page recalculates once with both.
  env.addEventListener("change", () => {
    if (ground.value === groundForEnvironment(previous)) ground.value = groundForEnvironment(env.value);
    previous = env.value;
  });
}

export const modelHelp: Record<string, string> = {
  reliability:
    "The share of the time the link should hold up. 50% is the typical (median) signal; 90% or 99% plans for the weaker days, as the air bends signals differently with weather and season. Higher reliability means more predicted loss. Your fade margin still applies on top. Short paths change little over time, so there Confidence matters more.",
  confidence:
    "How sure you want to be of the prediction, since no model is exact: real paths land several dB either side of it. 50% is the model's best estimate; 90% assumes your path is tougher than average and plans for it. This is the biggest unknown on short paths.",
  climate:
    "The broad climate the path is in, which changes how much signals vary over time, especially on long paths. Continental temperate suits most inland mid-latitude areas; maritime suits coasts; subtropical and equatorial suit hot, humid regions.",
  ground:
    "The ground's electrical type along the path, which affects reflections and diffraction. Average ground suits most land. It matters most for low antennas and over water. Picking an Environment sets a matching Ground (sea water for Open Water, poor ground for Desert and Urban) unless you've changed it; switch to Fresh water for lakes and rivers.",
  polarization:
    "The orientation of the antennas. Most VHF/UHF FM, mesh and handheld radios use vertical; some point-to-point, SSB and weak-signal links use horizontal.",
};

export const modelAdvanced = ["confidence", "climate", "ground", "polarization"];
