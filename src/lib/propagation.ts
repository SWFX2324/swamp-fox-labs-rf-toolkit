// Terrain loss for a profiled path, shared by the Link Analysis, Mesh Planner
// and Coverage Analysis: the Irregular Terrain Model (Longley-Rice, see itm.ts)
// where it applies, and Bullington diffraction (ITU-R P.526) where it
// doesn't (above 20 GHz, or antennas outside ITM's height range).
//
// The loss is given as dB beyond free space, so it slots into the budget
// where diffraction loss used to go. It can be negative: ground reflections
// and the climate can bring a path in a little better than free space.

import { bullingtonLoss } from "./diffraction";
import { Climate, ItmError, type ItmP2PResult, PropMode, itmP2P, lossAtPercentages } from "./itm";

export interface ModelSettings {
  climate: Climate;
  ground: GroundId;
  polarization: "vertical" | "horizontal";
  /** Percent of the time the link should hold, 1–99. */
  reliability: number;
  /** Confidence in that prediction, percent, 1–99. */
  confidence: number;
}

export const climates: { id: Climate; name: string }[] = [
  { id: Climate.ContinentalTemperate, name: "Continental temperate" },
  { id: Climate.MaritimeTemperateOverLand, name: "Maritime temperate, over land" },
  { id: Climate.MaritimeTemperateOverSea, name: "Maritime temperate, over sea" },
  { id: Climate.ContinentalSubtropical, name: "Continental subtropical" },
  { id: Climate.MaritimeSubtropical, name: "Maritime subtropical" },
  { id: Climate.Desert, name: "Desert" },
  { id: Climate.Equatorial, name: "Equatorial" },
];

export type GroundId = "average" | "poor" | "good" | "fresh" | "sea";

/** Ground electrical constants, as commonly used with Longley-Rice. */
export const grounds: { id: GroundId; name: string; permittivity: number; conductivity: number }[] = [
  { id: "average", name: "Average ground", permittivity: 15, conductivity: 0.005 },
  { id: "poor", name: "Poor ground (dry, rocky, city)", permittivity: 4, conductivity: 0.001 },
  { id: "good", name: "Good ground (wet, marshy)", permittivity: 25, conductivity: 0.02 },
  { id: "fresh", name: "Fresh water", permittivity: 80, conductivity: 0.01 },
  { id: "sea", name: "Sea water", permittivity: 80, conductivity: 5 },
];

/** The Ground that suits an Environment profile, by its id. */
export function groundForEnvironment(environmentId: string): GroundId {
  if (environmentId === "water") return "sea";
  if (environmentId === "desert" || environmentId === "urban") return "poor";
  // "auto" (the land-cover map) varies along the path: average suits most land.
  return "average";
}

export const defaultModel: ModelSettings = {
  climate: Climate.ContinentalTemperate,
  ground: "average",
  polarization: "vertical",
  reliability: 50,
  confidence: 50,
};

/** Surface refractivity at sea level, N-units: ITM's usual value. */
const REFRACTIVITY_N = 301;
/**
 * Mobile mode with location variability dropped (12), as NTIA's own
 * point-to-point tests use: the terrain of this exact path is known.
 */
const MDVAR = 12;
/** ITM's frequency range, Hz. */
export const ITM_MIN_HZ = 20e6;
export const ITM_MAX_HZ = 20e9;

const clampPercent = (p: number, fallback: number) => (Number.isFinite(p) ? Math.min(99.9, Math.max(0.1, p)) : fallback);

/** Read settings from strings (a form or a saved plan), falling back to the defaults. */
export function parseModel(v: { climate?: string; ground?: string; polarization?: string; reliability?: string; confidence?: string }): ModelSettings {
  const climate = Number(v.climate);
  return {
    climate: climates.some((c) => c.id === climate) ? climate : defaultModel.climate,
    ground: grounds.find((g) => g.id === v.ground)?.id ?? defaultModel.ground,
    polarization: v.polarization === "horizontal" ? "horizontal" : "vertical",
    reliability: clampPercent(Number.parseFloat(v.reliability ?? ""), defaultModel.reliability),
    confidence: clampPercent(Number.parseFloat(v.confidence ?? ""), defaultModel.confidence),
  };
}

export interface ProfiledPath {
  freqHz: number;
  distanceM: number;
  /** Ground elevation above sea level at evenly spaced points, TX end first. */
  elevationsM: ArrayLike<number>;
  txHeightM: number;
  rxHeightM: number;
}

export interface TerrainLoss {
  /** Loss beyond free space, dB. */
  lossDb: number;
  model: "itm" | "bullington";
  /**
   * ITM's propagation mode, when ITM ran. ITM picks it from smooth-earth
   * horizons, so a short path over a ridge can still read "line of sight":
   * not for display next to a terrain clearance verdict.
   */
  mode?: PropMode;
  /** ITM's full result, when it ran. */
  itm?: ItmP2PResult;
}

export const modeNames: Record<PropMode, string> = {
  [PropMode.NotSet]: "",
  [PropMode.LineOfSight]: "Line of sight",
  [PropMode.Diffraction]: "Diffraction",
  [PropMode.Troposcatter]: "Troposcatter",
};

/** Loss beyond free space for a profiled path. */
export function terrainLoss(path: ProfiledPath, s: ModelSettings): TerrainLoss {
  if (path.freqHz >= ITM_MIN_HZ && path.freqHz <= ITM_MAX_HZ && path.elevationsM.length >= 3) {
    const ground = grounds.find((g) => g.id === s.ground) ?? grounds[0];
    try {
      const itm = itmP2P({
        // ITM needs at least 0.5 m; an antenna on the ground is near enough to that.
        txHeightM: Math.max(0.5, path.txHeightM),
        rxHeightM: Math.max(0.5, path.rxHeightM),
        elevationsM: path.elevationsM,
        distanceM: path.distanceM,
        freqMhz: path.freqHz / 1e6,
        climate: s.climate,
        refractivityN: REFRACTIVITY_N,
        polarization: s.polarization,
        permittivity: ground.permittivity,
        conductivity: ground.conductivity,
        mdvar: MDVAR,
        time: s.reliability,
        location: 50,
        situation: s.confidence,
      });
      return { lossDb: itm.lossDb - itm.freeSpaceDb, model: "itm", mode: itm.mode, itm };
    } catch (e) {
      if (!(e instanceof ItmError)) throw e;
    }
  }
  const b = bullingtonLoss({ ...path, elevationsM: Array.from(path.elevationsM) });
  return { lossDb: b.lossDb, model: "bullington" };
}

/**
 * The percent of the time a link holds: the reliability at which the margin
 * falls to zero, at the same confidence. marginDb is the margin at the
 * settings' reliability. Clamped to 0.1–99.9%.
 */
export function timeAvailable(itm: ItmP2PResult, s: ModelSettings, marginDb: number): number {
  const lossAt = (t: number) => lossAtPercentages(itm, t, 50, s.confidence);
  const base = lossAt(s.reliability);
  const marginAt = (t: number) => marginDb - (lossAt(t) - base);
  if (marginAt(99.9) >= 0) return 99.9;
  if (marginAt(0.1) < 0) return 0.1;
  // Loss rises with the time percentage, so margin falls: bisect.
  let lo = 0.1;
  let hi = 99.9;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (marginAt(mid) >= 0) lo = mid;
    else hi = mid;
  }
  return lo;
}
