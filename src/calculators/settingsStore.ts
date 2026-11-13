// The app's Settings in the browser: read and saved through localStorage, with
// an event so anything showing them can follow a change.

import { type AppSettings, SETTINGS_EVENT, connectorsDb, defaultSettings, fieldNumber, inUnit, loadSettings, saveSettings } from "../lib/appSettings";
import { type Environment, findEnvironment } from "../lib/environment";

const storage = {
  getItem: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // Storage blocked: settings last until the page closes.
    }
  },
};

let cached: AppSettings | undefined;

export function getSettings(): AppSettings {
  cached ??= loadSettings(storage);
  return cached;
}

export function setSettings(next: AppSettings): void {
  cached = next;
  saveSettings(storage, next);
  window.dispatchEvent(new Event(SETTINGS_EVENT));
}

export function resetSettings(): void {
  setSettings({ ...defaultSettings });
}

/** The Environment to use where the land-cover map has nothing (offline, not loaded yet, or failed). */
export function fallbackEnvironment(): Environment {
  return findEnvironment(getSettings().fallbackEnvironment);
}

/** Receiver sensitivity after the Settings derating: typed −100 with 3 dB derating plans as −97. */
export function deratedSensitivity(typedDbm: number): number {
  return typedDbm + getSettings().sensitivityDerateDb;
}

/** A note for results, when derating is on. */
export function derateNote(): string {
  const d = getSettings().sensitivityDerateDb;
  return d > 0 ? `Receiver sensitivity is derated by ${fieldNumber(d)} dB (Settings).` : "";
}

/** The Longley-Rice fields as Settings fill them. */
export function modelFromSettings(s: AppSettings = getSettings()): Record<string, string> {
  return {
    reliability: fieldNumber(s.reliability),
    confidence: fieldNumber(s.confidence),
    climate: s.climate,
    ground: s.ground,
    polarization: s.polarization,
  };
}

/** Values the planning tabs share, as their fields show them. */
export function sharedFields(s: AppSettings = getSettings()) {
  return {
    ...modelFromSettings(s),
    fade: fieldNumber(s.fadeMarginDb),
    gain: fieldNumber(s.antennaGainDbi),
    /** Flat per-end loss for tabs without a cable calculator: cable plus connectors. */
    cableAndConnectors: fieldNumber(s.cableLossDb + connectorsDb(s)),
    connectors: fieldNumber(connectorsDb(s)),
    environment: s.environment,
    treeHeight: inUnit(s.treeHeightM, s.heightUnit),
    kFactor: s.kFactor,
    height: inUnit(s.defaultHeightM, s.heightUnit),
    heightUnit: s.heightUnit,
    distanceUnit: s.distanceUnit,
  };
}
