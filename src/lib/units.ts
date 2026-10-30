// Unit conversions. The math modules work in SI units (Hz, metres) and the UI
// converts at the edges.

/** Speed of light in a vacuum, m/s. */
export const SPEED_OF_LIGHT = 299_792_458;

export const frequencyUnits = {
  kHz: 1e3,
  MHz: 1e6,
  GHz: 1e9,
} as const;

export type FrequencyUnit = keyof typeof frequencyUnits;

export const distanceUnits = {
  m: 1,
  km: 1000,
  ft: 0.3048,
  mi: 1609.344,
} as const;

export type DistanceUnit = keyof typeof distanceUnits;

export function toHz(value: number, unit: FrequencyUnit): number {
  return value * frequencyUnits[unit];
}

export function toMetres(value: number, unit: DistanceUnit): number {
  return value * distanceUnits[unit];
}

export function fromMetres(metres: number, unit: DistanceUnit): number {
  return metres / distanceUnits[unit];
}

export const powerUnits = ["W", "mW", "dBm"] as const;

export type PowerUnit = (typeof powerUnits)[number];

export function wattsToDbm(watts: number): number {
  return 10 * Math.log10(watts * 1000);
}

export function dbmToWatts(dbm: number): number {
  return 10 ** (dbm / 10) / 1000;
}

export function toDbm(value: number, unit: PowerUnit): number {
  switch (unit) {
    case "dBm":
      return value;
    case "W":
      return wattsToDbm(value);
    case "mW":
      return wattsToDbm(value / 1000);
  }
}
