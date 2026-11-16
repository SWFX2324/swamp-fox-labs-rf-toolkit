// The propagation model settings (Longley-Rice / ITM), shared by the Link
// Analysis, Mesh Analysis and Coverage Analysis. Reliability and confidence
// are fields on each tab: they save, reset and travel in plans like any other
// field. Climate, ground, polarization and Earth curvature are global: they
// live only in Settings and every tab reads them from there.

import { parseKFactor } from "../lib/horizon";
import { type ModelSettings, defaultModel, groundForEnvironment, parseModel } from "../lib/propagation";
import { getSettings } from "./settingsStore";

export const modelDefaults: Record<string, string> = {
  reliability: String(defaultModel.reliability),
  confidence: String(defaultModel.confidence),
};

/** Earth curvature (k) from Settings. */
export const globalK = (): number => parseKFactor(getSettings().kFactor);

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
    ${percentField("Confidence", "confidence")}`;
}

/**
 * The model for this tab: its reliability and confidence, with climate, ground
 * and polarization from Settings. Ground follows the tab's Environment (Open
 * Water → sea water, Desert or Urban → poor ground) unless Ground in Settings
 * was changed from what its own Environment suggests.
 */
export function readModel(form: HTMLFormElement): ModelSettings {
  const value = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null)?.value;
  const s = getSettings();
  const env = value("environment");
  const ground = env !== undefined && s.ground === groundForEnvironment(s.environment) ? groundForEnvironment(env) : s.ground;
  return parseModel({
    climate: s.climate,
    ground,
    polarization: s.polarization,
    reliability: value("reliability"),
    confidence: value("confidence"),
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
    "The ground's electrical type along the path, which affects reflections and diffraction. Average ground suits most land. It matters most for low antennas and over water. Every tab uses it. While it matches what your Environment here suggests, a tab's own Environment picks the ground instead (sea water for Open Water, poor ground for Desert and Urban); set it to anything else to use it everywhere, such as Fresh water for lakes and rivers.",
  polarization:
    "The orientation of the antennas. Most VHF/UHF FM, mesh and handheld radios use vertical; some point-to-point, SSB and weak-signal links use horizontal.",
};

export const modelAdvanced = ["confidence"];
