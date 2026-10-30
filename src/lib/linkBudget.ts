// Point-to-point link budget, in the order the signal travels:
//
//   TX power − TX cable − TX other + TX antenna   = EIRP
//   EIRP − free-space loss − extra path loss + RX antenna − RX cable − RX other
//                                                 = received signal level
//   received signal level − RX sensitivity        = link margin

import { distanceForLossM, fsplDb } from "./fspl";

export interface LinkInputs {
  freqHz: number;
  distanceM: number;
  txPowerDbm: number;
  txCableLossDb: number;
  txOtherLossDb: number;
  txGainDbi: number;
  /** Obstructions, foliage, rain and so on, on top of free-space loss. */
  extraPathLossDb: number;
  rxGainDbi: number;
  rxCableLossDb: number;
  rxOtherLossDb: number;
  rxSensitivityDbm: number;
  /** Margin the link must keep for fading, used for the max range. */
  fadeMarginDb: number;
}

export interface LinkResult {
  eirpDbm: number;
  fsplDb: number;
  /** Signal level arriving at the RX antenna, before its gain. */
  rxIsotropicDbm: number;
  rslDbm: number;
  marginDb: number;
  /** Longest distance that still keeps fadeMarginDb, in metres. */
  maxRangeM: number;
}

export function eirpDbm(i: Pick<LinkInputs, "txPowerDbm" | "txCableLossDb" | "txOtherLossDb" | "txGainDbi">): number {
  return i.txPowerDbm - i.txCableLossDb - i.txOtherLossDb + i.txGainDbi;
}

export function linkBudget(i: LinkInputs): LinkResult {
  const eirp = eirpDbm(i);
  const fspl = fsplDb(i.freqHz, i.distanceM);
  const rxIsotropic = eirp - fspl - i.extraPathLossDb;
  const rsl = rxIsotropic + i.rxGainDbi - i.rxCableLossDb - i.rxOtherLossDb;

  // Everything except free-space loss is fixed, so solve for the free-space
  // loss that leaves exactly the fade margin, then for its distance.
  const fixed = eirp - i.extraPathLossDb + i.rxGainDbi - i.rxCableLossDb - i.rxOtherLossDb;
  const allowedFspl = fixed - i.rxSensitivityDbm - i.fadeMarginDb;

  return {
    eirpDbm: eirp,
    fsplDb: fspl,
    rxIsotropicDbm: rxIsotropic,
    rslDbm: rsl,
    marginDb: rsl - i.rxSensitivityDbm,
    maxRangeM: distanceForLossM(i.freqHz, allowedFspl),
  };
}

export type MarginRating = "good" | "fair" | "marginal" | "fail";

/** Rough rating: 20 dB+ rides out deep fades, under 0 dB will not connect. */
export function rateMargin(marginDb: number): MarginRating {
  if (marginDb >= 20) return "good";
  if (marginDb >= 10) return "fair";
  if (marginDb >= 0) return "marginal";
  return "fail";
}
