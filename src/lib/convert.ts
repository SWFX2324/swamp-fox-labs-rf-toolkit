// Everyday RF conversions: power units, S-meter, antenna gain references,
// mismatch figures and decibel ratios.

/** Signal into a 50 Ω receiver input. */
export const RX_IMPEDANCE = 50;

export function dbmToDbw(dbm: number): number {
  return dbm - 30;
}

export function dbwToDbm(dbw: number): number {
  return dbw + 30;
}

/** RMS microvolts across the receiver input for a power in dBm. */
export function dbmToMicrovolts(dbm: number, ohms = RX_IMPEDANCE): number {
  return Math.sqrt(10 ** (dbm / 10) * 1e-3 * ohms) * 1e6;
}

export function microvoltsToDbm(uv: number, ohms = RX_IMPEDANCE): number {
  return 10 * Math.log10(((uv * 1e-6) ** 2 / ohms) / 1e-3);
}

/**
 * S-meter reading by the IARU convention: S9 is −73 dBm (50 µV) below 30 MHz
 * and −93 dBm (5 µV) above, with 6 dB per S-unit.
 */
export function sMeter(dbm: number, band: "hf" | "vhf"): string {
  const s9 = band === "hf" ? -73 : -93;
  if (dbm >= s9) {
    const over = Math.round(dbm - s9);
    return over > 0 ? `S9+${over} dB` : "S9";
  }
  const units = 9 + (dbm - s9) / 6;
  return units < 1 ? "below S1" : `S${Math.floor(units)}`;
}

/** Gain over an isotropic radiator from gain over a half-wave dipole. */
export function dbdToDbi(dbd: number): number {
  return dbd + 2.15;
}

export function dbiToDbd(dbi: number): number {
  return dbi - 2.15;
}

export function swrToGamma(swr: number): number {
  return (swr - 1) / (swr + 1);
}

export function gammaToSwr(gamma: number): number {
  return gamma >= 1 ? Number.POSITIVE_INFINITY : (1 + gamma) / (1 - gamma);
}

/** Return loss in dB (positive) for a reflection coefficient magnitude. */
export function gammaToReturnLoss(gamma: number): number {
  return -20 * Math.log10(gamma);
}

export function returnLossToGamma(rlDb: number): number {
  return 10 ** (-rlDb / 20);
}

/** Power lost to reflection at the mismatch, dB. */
export function mismatchLossDb(gamma: number): number {
  return -10 * Math.log10(1 - gamma * gamma);
}

export function dbToPowerRatio(db: number): number {
  return 10 ** (db / 10);
}

export function dbToVoltageRatio(db: number): number {
  return 10 ** (db / 20);
}
