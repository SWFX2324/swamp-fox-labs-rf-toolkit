// Free-space path loss: the spreading loss between two isotropic antennas
// with clear line of sight and no obstructions, reflections or atmospheric
// absorption. Real links lose more; treat this as the best case.
//
//   FSPL = 20·log10(4·π·d·f / c)  dB

import { SPEED_OF_LIGHT } from "./units";

/** Free-space wavelength in metres. */
export function wavelengthM(freqHz: number): number {
  return SPEED_OF_LIGHT / freqHz;
}

/** Free-space path loss in dB for a distance in metres and frequency in Hz. */
export function fsplDb(freqHz: number, distanceM: number): number {
  if (!(freqHz > 0) || !(distanceM > 0)) {
    throw new RangeError("Frequency and distance must be greater than zero");
  }
  return 20 * Math.log10((4 * Math.PI * distanceM * freqHz) / SPEED_OF_LIGHT);
}

/** The distance in metres at which free-space path loss reaches lossDb. */
export function distanceForLossM(freqHz: number, lossDb: number): number {
  if (!(freqHz > 0)) {
    throw new RangeError("Frequency must be greater than zero");
  }
  return (SPEED_OF_LIGHT * 10 ** (lossDb / 20)) / (4 * Math.PI * freqHz);
}
