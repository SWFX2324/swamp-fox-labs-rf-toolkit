// Runs the relay finder: loads terrain around both sites, works out each hop's
// coverage for a receiver at the relay's height, and shades where a relay
// would close both hops. See lib/relay.ts for the method.

import { type CoverageRadio, coveragePathLoss, marginsFromLoss, sampleRadials } from "../lib/coverage";
import type { LatLon } from "../lib/geo";
import type { ModelSettings } from "../lib/propagation";
import { type RelaySurface, radiusToCover, relaySearchBox, relaySurface } from "../lib/relay";
import { ElevationGrid, chooseZoom, tilesCovering } from "../lib/terrainTiles";
import { loadTiles } from "./tileElevation";

/** One hop's radio, as the Coverage Analysis uses it: EIRP, receive gains and losses, derated sensitivity and clutter. */
export type HopRadio = Omit<CoverageRadio, "freqHz">;

export interface RelayFinderInputs {
  a: LatLon;
  b: LatLon;
  freqHz: number;
  model: ModelSettings;
  /** Antenna heights for the terrain paths (clutter tops where the profile lifts them), metres. */
  aHeightM: number;
  bHeightM: number;
  relayHeightM: number;
  /** Between site A and the relay, each direction (the weaker counts). */
  hop1: HopRadio[];
  /** Between the relay and site B, each direction, worked from B's end (path loss is the same either way). */
  hop2: HopRadio[];
}

const RADIALS = 120;
const STEPS = 100;
const SURFACE_SIZE = 160;

export async function findRelay(inputs: RelayFinderInputs, onStatus: (text: string) => void, signal: AbortSignal): Promise<RelaySurface | undefined> {
  const box = relaySearchBox(inputs.a, inputs.b);
  const sample = async (site: LatLon, label: string) => {
    const r = radiusToCover(site, box);
    const z = chooseZoom(site, r, 36);
    const tiles = tilesCovering(site, r, z);
    const grid = new ElevationGrid(z);
    await loadTiles(tiles, grid, { signal, onProgress: (done, total) => onStatus(`Loading terrain around ${label}: ${done} of ${total}…`) });
    // Sea-floor depths become sea level: the signal crosses the water surface.
    return sampleRadials(site, r, RADIALS, STEPS, (q) => Math.max(0, grid.sample(q)));
  };
  const s1 = await sample(inputs.a, "the first site");
  if (signal.aborted) return undefined;
  const s2 = await sample(inputs.b, "the second site");
  if (signal.aborted) return undefined;
  onStatus("Working out where a relay would reach both sites…");
  // Let the status paint before the heavy loop.
  await new Promise((resolve) => setTimeout(resolve, 30));
  const m1 = weakest(coveragePathLoss(s1, inputs.freqHz, inputs.aHeightM, inputs.relayHeightM, inputs.model), inputs.hop1);
  if (signal.aborted) return undefined;
  await new Promise((resolve) => setTimeout(resolve, 0));
  const m2 = weakest(coveragePathLoss(s2, inputs.freqHz, inputs.bHeightM, inputs.relayHeightM, inputs.model), inputs.hop2);
  if (signal.aborted) return undefined;
  return relaySurface(box, SURFACE_SIZE, SURFACE_SIZE, { samples: s1, margins: m1 }, { samples: s2, margins: m2 });
}

/** Margins for the weaker of several radios over the same path loss (a hop's two directions). */
function weakest(loss: Float32Array[], radios: HopRadio[]): Float32Array[] {
  const each = radios.map((r) => marginsFromLoss(loss, r));
  return each[0].map((row, i) => row.map((v, k) => each.reduce((m, g) => Math.min(m, g[i][k]), v)));
}

function cssColor(name: string): [number, number, number] {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  document.body.append(probe);
  const m = getComputedStyle(probe).color.match(/\d+/g) ?? ["0", "0", "0"];
  probe.remove();
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}

/**
 * The surface as a transparent PNG data URL in the Coverage Analysis's colours:
 * strong (fade margin + 10 dB), solid (fade margin), marginal (above 0 dB).
 * Spots where a relay wouldn't close both hops stay clear.
 */
export function surfaceImage(s: RelaySurface, fadeMarginDb: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = s.width;
  canvas.height = s.height;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(s.width, s.height);
  const good = cssColor("--good");
  const marginal = cssColor("--warning");
  for (let i = 0; i < s.values.length; i++) {
    const v = s.values[i];
    if (!(v >= 0)) continue;
    const [c, alpha] = v >= fadeMarginDb + 10 ? [good, 165] : v >= fadeMarginDb ? [good, 105] : [marginal, 120];
    img.data.set([c[0], c[1], c[2], alpha], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}
