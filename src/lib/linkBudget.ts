// Point-to-point link budget, in the order the signal travels:
//
//   TX power − TX cable − TX other + TX antenna   = EIRP
//   EIRP − free-space loss − extra path loss + RX antenna − RX cable − RX other
//                                                 = received signal level
//   received signal level − RX sensitivity        = link margin
//
// Max range is the shorter of what the budget allows and the radio horizon
// for the two antenna heights.

import { distanceForLossM, fsplDb } from "./fspl";
import { lineOfSightRangeM } from "./horizon";

export interface LinkInputs {
  freqHz: number;
  distanceM: number;
  txPowerDbm: number;
  txCableLossDb: number;
  txOtherLossDb: number;
  txGainDbi: number;
  /** Obstructions, foliage, rain and so on, on top of free-space loss. */
  extraPathLossDb: number;
  /**
   * Diffraction loss from a terrain profile of this exact path. Unlike extra
   * path loss it is left out of the max range, which is about other distances.
   */
  terrainLossDb?: number;
  rxGainDbi: number;
  rxCableLossDb: number;
  rxOtherLossDb: number;
  rxSensitivityDbm: number;
  /** Margin the link must keep for fading, used for the max range. */
  fadeMarginDb: number;
  /** Antenna heights above ground, metres. */
  txHeightM: number;
  rxHeightM: number;
}

export interface LinkResult {
  eirpDbm: number;
  fsplDb: number;
  /** Signal level arriving at the RX antenna, before its gain. */
  rxIsotropicDbm: number;
  rslDbm: number;
  marginDb: number;
  /** Longest distance that keeps fadeMarginDb and line of sight, in metres. */
  maxRangeM: number;
  /** Longest distance the budget alone allows, ignoring the horizon, metres. */
  budgetRangeM: number;
  /** What sets maxRangeM. */
  rangeLimit: "budget" | "horizon";
  /** Smooth-earth line-of-sight range for the antenna heights, metres. */
  horizonM: number;
  /** True when distanceM is past the radio horizon. */
  beyondHorizon: boolean;
}

export function eirpDbm(i: Pick<LinkInputs, "txPowerDbm" | "txCableLossDb" | "txOtherLossDb" | "txGainDbi">): number {
  return i.txPowerDbm - i.txCableLossDb - i.txOtherLossDb + i.txGainDbi;
}

export function linkBudget(i: LinkInputs): LinkResult {
  const eirp = eirpDbm(i);
  const fspl = fsplDb(i.freqHz, i.distanceM);
  const rxIsotropic = eirp - fspl - i.extraPathLossDb - (i.terrainLossDb ?? 0);
  const rsl = rxIsotropic + i.rxGainDbi - i.rxCableLossDb - i.rxOtherLossDb;

  // Everything except free-space loss is fixed, so solve for the free-space
  // loss that leaves exactly the fade margin, then for its distance.
  const fixed = eirp - i.extraPathLossDb + i.rxGainDbi - i.rxCableLossDb - i.rxOtherLossDb;
  const allowedFspl = fixed - i.rxSensitivityDbm - i.fadeMarginDb;
  const budgetRange = distanceForLossM(i.freqHz, allowedFspl);
  const horizon = lineOfSightRangeM(i.txHeightM, i.rxHeightM);

  return {
    eirpDbm: eirp,
    fsplDb: fspl,
    rxIsotropicDbm: rxIsotropic,
    rslDbm: rsl,
    marginDb: rsl - i.rxSensitivityDbm,
    maxRangeM: Math.min(budgetRange, horizon),
    budgetRangeM: budgetRange,
    rangeLimit: horizon < budgetRange ? "horizon" : "budget",
    horizonM: horizon,
    beyondHorizon: i.distanceM > horizon,
  };
}

/**
 * Below about 30 MHz, signals mostly travel by ground wave and by skywave off
 * the ionosphere, so a free-space line-of-sight model says nothing useful.
 */
export const FREE_SPACE_MIN_HZ = 30e6;

export function freeSpaceApplies(freqHz: number): boolean {
  return freqHz >= FREE_SPACE_MIN_HZ;
}

export type MarginRating = "good" | "fair" | "marginal" | "fail";

/** Rough rating: 20 dB+ rides out deep fades, under 0 dB will not connect. */
export function rateMargin(marginDb: number): MarginRating {
  if (marginDb >= 20) return "good";
  if (marginDb >= 10) return "fair";
  if (marginDb >= 0) return "marginal";
  return "fail";
}
