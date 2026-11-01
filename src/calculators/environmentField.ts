// The Environment dropdown and its one-line explanation, shared by the Link
// Budget, Mesh Planner and Coverage Map.

import { type Environment, aboveModelRange, belowModelRange, clutterLossDb, environments } from "../lib/environment";

export function environmentOptions(): string {
  return environments.map((e) => `<option value="${e.id}">${e.name}</option>`).join("");
}

/** What the chosen profile adds for these two antenna heights. */
export function environmentNote(env: Environment, freqHz: number, aHeightM: number, bHeightM: number): string {
  if (env.id === "none" || !(freqHz > 0)) return "";
  if (belowModelRange(freqHz)) return "Environment profiles cover 30 MHz and up, so none is applied on HF.";
  const a = clutterLossDb(env, freqHz, aHeightM);
  const b = clutterLossDb(env, freqHz, bHeightM);
  const total = (a + b).toFixed(1);
  const rough = aboveModelRange(freqHz) ? " The model stops at 3 GHz, so this uses the 3 GHz figure and may read low." : "";
  return `${env.name} adds about ${total} dB: ${a.toFixed(1)} dB at one end and ${b.toFixed(1)} dB at the other. An estimate that assumes this surrounds both antennas; terrain is checked from the top of the clutter.${rough}`;
}
