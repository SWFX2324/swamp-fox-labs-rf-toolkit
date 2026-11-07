// The Environment dropdown and its one-line explanation, shared by the Link
// Budget, Mesh Planner and Coverage Map.

import { type Environment, aboveModelRange, belowModelRange, clutterLossDb, environments } from "../lib/environment";
import { AUTO_ENVIRONMENT, type LandCoverPoint, describePoint } from "../lib/landCover";

export function environmentOptions(): string {
  const [none, ...rest] = environments;
  return [
    `<option value="${none.id}">${none.name}</option>`,
    `<option value="${AUTO_ENVIRONMENT}">From land-cover map</option>`,
    ...rest.map((e) => `<option value="${e.id}">${e.name}</option>`),
  ].join("");
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
  return `${env.name} adds about ${total} dB: ${a.toFixed(1)} dB at one end and ${b.toFixed(1)} dB at the other. An estimate that assumes this surrounds both antennas; terrain is checked from the top of the clutter.${roughNote(freqHz)}`;
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
  return `From the land-cover map: ${part(ends[0], labels[0], aHeightM)}; ${part(ends[1], labels[1], bHeightM)}. Terrain is checked from the top of the clutter at each end.${roughNote(freqHz)}`;
}
