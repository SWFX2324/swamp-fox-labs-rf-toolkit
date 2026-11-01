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

// Unit names read back from the page (a <select>'s value) come back as one of
// the app's own constants, never the page's string, so nothing typed or
// tampered with can flow on into markup. Anything unknown takes the fallback.
export function asFrequencyUnit(value: string, fallback: FrequencyUnit = "MHz"): FrequencyUnit {
  return (Object.keys(frequencyUnits) as FrequencyUnit[]).find((u) => u === value) ?? fallback;
}

export function asDistanceUnit(value: string, fallback: DistanceUnit = "m"): DistanceUnit {
  return (Object.keys(distanceUnits) as DistanceUnit[]).find((u) => u === value) ?? fallback;
}

export function toHz(value: number, unit: FrequencyUnit): number {
  return value * frequencyUnits[unit];
}

export function toMetres(value: number, unit: DistanceUnit): number {
  return value * distanceUnits[unit];
}

export function fromMetres(metres: number, unit: DistanceUnit): number {
  return metres / distanceUnits[unit];
}

/** Feet and inches to the nearest eighth of an inch, like 32′ 10¾″ for cutting. */
export function formatFeetInches(metres: number): string {
  const eighths = Math.round(metres / 0.0254 / 0.125);
  const feet = Math.floor(eighths / 96);
  const inches = Math.floor((eighths % 96) / 8);
  const frac = ["", "⅛", "¼", "⅜", "½", "⅝", "¾", "⅞"][eighths % 8];
  const inchPart = `${inches}${frac}″`;
  return feet ? `${feet}′ ${inchPart}` : inchPart;
}

export const powerUnits = ["W", "mW", "dBm"] as const;

export type PowerUnit = (typeof powerUnits)[number];

export function asPowerUnit(value: string, fallback: PowerUnit = "W"): PowerUnit {
  return powerUnits.find((u) => u === value) ?? fallback;
}

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
