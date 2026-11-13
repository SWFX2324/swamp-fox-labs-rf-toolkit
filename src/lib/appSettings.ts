// App-wide modelling settings: the defaults every planning tab starts from.
// A tab field the user hasn't changed follows these; one they changed for a
// particular link keeps its value until they press Reset on that tab. Saved
// plans and share links carry their own values, so a plan reads the same on
// any device whatever its Settings say.
//
// The defaults lean conservative on purpose: a prediction that says a link
// won't work when it would is far cheaper than one that says it will when it
// won't.

import type { StorageLike } from "./pathStore";

export const SETTINGS_KEY = "rf-toolkit:settings";
export const SETTINGS_EVENT = "rf-toolkit:settings";

export interface AppSettings {
  /** Longley-Rice percent of time, 1–99. */
  reliability: number;
  /** Longley-Rice confidence, 1–99. */
  confidence: number;
  fadeMarginDb: number;
  /** Earth curvature choice id, as in horizon.ts kFactors. */
  kFactor: string;
  antennaGainDbi: number;
  /** Flat cable loss per end, dB (the Link Analysis keeps its cable calculator). */
  cableLossDb: number;
  /** Loss per connector or coupler, dB. */
  connectorLossDb: number;
  connectorsPerEnd: number;
  /** Added to every receiver sensitivity: the radio is taken as this much less sensitive than its datasheet. */
  sensitivityDerateDb: number;
  /** Antenna height new links, nodes and sites start at, metres. */
  defaultHeightM: number;
  /** Environment choice id (or "auto" for the land-cover map). */
  environment: string;
  /** Environment used where the land-cover map has no data (offline, not loaded, or failed). */
  fallbackEnvironment: string;
  treeHeightM: number;
  /** Longley-Rice radio climate id, as a string. */
  climate: string;
  ground: string;
  polarization: string;
  heightUnit: "ft" | "m";
  distanceUnit: "mi" | "km";
}

export const defaultSettings: AppSettings = {
  reliability: 90,
  confidence: 90,
  fadeMarginDb: 10,
  kFactor: "2/3",
  antennaGainDbi: -3,
  cableLossDb: 0.5,
  connectorLossDb: 0.25,
  connectorsPerEnd: 2,
  sensitivityDerateDb: 3,
  defaultHeightM: 6 * 0.3048,
  environment: "auto",
  fallbackEnvironment: "dense",
  treeHeightM: 20,
  climate: "5",
  ground: "average",
  polarization: "vertical",
  heightUnit: "ft",
  distanceUnit: "mi",
};

type Rule = { min: number; max: number } | readonly string[];

// What a saved value may be; anything else falls back to the default.
const rules: Record<keyof AppSettings, Rule> = {
  reliability: { min: 1, max: 99 },
  confidence: { min: 1, max: 99 },
  fadeMarginDb: { min: 0, max: 60 },
  kFactor: ["4/3", "1", "2/3"],
  antennaGainDbi: { min: -30, max: 50 },
  cableLossDb: { min: 0, max: 30 },
  connectorLossDb: { min: 0, max: 5 },
  connectorsPerEnd: { min: 0, max: 10 },
  sensitivityDerateDb: { min: 0, max: 30 },
  defaultHeightM: { min: 0, max: 1000 },
  environment: ["none", "auto", "water", "fields", "desert", "light", "suburban", "urban", "dense"],
  fallbackEnvironment: ["none", "water", "fields", "desert", "light", "suburban", "urban", "dense"],
  treeHeightM: { min: 1, max: 120 },
  climate: ["1", "2", "3", "4", "5", "6", "7"],
  ground: ["average", "poor", "good", "fresh", "sea"],
  polarization: ["vertical", "horizontal"],
  heightUnit: ["ft", "m"],
  distanceUnit: ["mi", "km"],
};

/** Saved settings, with anything missing or out of range replaced by its default. */
export function parseSettings(raw: unknown): AppSettings {
  const out: Record<string, unknown> = { ...defaultSettings };
  if (typeof raw !== "object" || raw === null) return out as unknown as AppSettings;
  for (const [key, rule] of Object.entries(rules) as [keyof AppSettings, Rule][]) {
    const v = (raw as Record<string, unknown>)[key];
    if (Array.isArray(rule)) {
      if (typeof v === "string" && rule.includes(v)) out[key] = v;
    } else if (typeof v === "number" && Number.isFinite(v)) {
      const r = rule as { min: number; max: number };
      if (v >= r.min && v <= r.max) out[key] = v;
    }
  }
  return out as unknown as AppSettings;
}

export function loadSettings(storage: Pick<StorageLike, "getItem">): AppSettings {
  try {
    return parseSettings(JSON.parse(storage.getItem(SETTINGS_KEY) ?? "{}"));
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(storage: Pick<StorageLike, "setItem">, s: AppSettings): void {
  storage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

/** Total connector and coupler loss at one end, dB. */
export const connectorsDb = (s: AppSettings): number => s.connectorsPerEnd * s.connectorLossDb;

/** A number as a field shows it: up to two decimals, no trailing zeros. */
export const fieldNumber = (v: number): string => String(Math.round(v * 100) / 100);

/** A length in metres, as a field in this unit shows it: whole numbers from 10 up, one decimal below. */
export const inUnit = (metres: number, unit: "ft" | "m"): string => {
  const v = unit === "ft" ? metres / 0.3048 : metres;
  return String(v >= 10 ? Math.round(v) : Math.round(v * 10) / 10);
};

/**
 * What a tab saves: only the fields that differ from its defaults, so the
 * rest keep following Settings.
 */
export function changedFields(values: Record<string, string>, defaults: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) if (v !== defaults[k]) out[k] = v;
  return out;
}

/** Version mark on tab state saved as changed fields only. */
export const STATE_VERSION_KEY = "__v";
const STATE_VERSION = "2";

/**
 * A tab's field values: its current defaults with the user's changes on top.
 * Tab state saved before Settings existed stored every field; a value there
 * that equals the old built-in default wasn't a choice, so it's dropped and
 * the field follows Settings.
 */
export function tabValues(
  saved: unknown,
  defaults: Record<string, string>,
  legacyDefaults: Record<string, string> = {},
): Record<string, string> {
  const values = { ...defaults };
  if (typeof saved !== "object" || saved === null) return values;
  const s = saved as Record<string, unknown>;
  const legacy = s[STATE_VERSION_KEY] !== STATE_VERSION;
  for (const [k, v] of Object.entries(s)) {
    if (k === STATE_VERSION_KEY || typeof v !== "string" || !(k in defaults)) continue;
    if (legacy && legacyDefaults[k] === v) continue;
    values[k] = v;
  }
  return values;
}

/** Tab state to save: the changed fields, marked with the current version. */
export function tabStateToSave(values: Record<string, string>, defaults: Record<string, string>): Record<string, string> {
  return { ...changedFields(values, defaults), [STATE_VERSION_KEY]: STATE_VERSION };
}
