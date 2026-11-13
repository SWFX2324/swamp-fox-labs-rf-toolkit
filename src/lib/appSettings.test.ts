import { describe, expect, it } from "vitest";
import {
  STATE_VERSION_KEY,
  changedFields,
  connectorsDb,
  defaultSettings,
  inUnit,
  loadSettings,
  parseSettings,
  saveSettings,
  tabStateToSave,
  tabValues,
} from "./appSettings";

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

describe("default settings", () => {
  it("lean conservative, as asked", () => {
    expect(defaultSettings).toMatchObject({
      reliability: 90,
      confidence: 90,
      fadeMarginDb: 10,
      antennaGainDbi: -3,
      cableLossDb: 0.5,
      connectorLossDb: 0.25,
      connectorsPerEnd: 2,
      environment: "auto",
      fallbackEnvironment: "dense",
      kFactor: "2/3",
      sensitivityDerateDb: 3,
    });
    expect(inUnit(defaultSettings.defaultHeightM, "ft")).toBe("6");
    expect(connectorsDb(defaultSettings)).toBe(0.5);
    expect(inUnit(defaultSettings.treeHeightM, "ft")).toBe("66");
    expect(inUnit(defaultSettings.defaultHeightM, "m")).toBe("1.8");
  });
});

describe("parseSettings", () => {
  it("keeps valid values and replaces bad ones with defaults", () => {
    const s = parseSettings({ reliability: 95, confidence: 150, kFactor: "4/3", environment: "<script>", heightUnit: "m", fadeMarginDb: "12" });
    expect(s.reliability).toBe(95);
    expect(s.confidence).toBe(90);
    expect(s.kFactor).toBe("4/3");
    expect(s.environment).toBe("auto");
    expect(s.heightUnit).toBe("m");
    expect(s.fadeMarginDb).toBe(10);
  });

  it("never uses the land-cover map as its own fallback", () => {
    expect(parseSettings({ fallbackEnvironment: "auto" }).fallbackEnvironment).toBe("dense");
  });

  it("round-trips through storage, and survives junk", () => {
    const store = memory();
    saveSettings(store, { ...defaultSettings, treeHeightM: 24 });
    expect(loadSettings(store).treeHeightM).toBe(24);
    store.setItem("rf-toolkit:settings", "not json");
    expect(loadSettings(store)).toEqual(defaultSettings);
  });
});

describe("tab fields follow Settings unless changed", () => {
  const defaults = { reliability: "90", fade: "10", freq: "915" };

  it("saves only what differs from the defaults", () => {
    expect(changedFields({ reliability: "90", fade: "15", freq: "915" }, defaults)).toEqual({ fade: "15" });
    expect(tabStateToSave({ reliability: "90", fade: "15", freq: "915" }, defaults)).toEqual({ fade: "15", [STATE_VERSION_KEY]: "2" });
  });

  it("lays the saved changes over the current defaults", () => {
    const saved = tabStateToSave({ reliability: "90", fade: "15", freq: "915" }, defaults);
    // Settings later move reliability to 95: the untouched field follows, the changed one stays.
    expect(tabValues(saved, { ...defaults, reliability: "95" })).toEqual({ reliability: "95", fade: "15", freq: "915" });
  });

  it("treats old saved values that equal the old built-in defaults as untouched", () => {
    const old = { reliability: "50", fade: "10", freq: "146" };
    const legacy = { reliability: "50", fade: "10", freq: "915" };
    // reliability was the old default, so it follows Settings; freq was a real choice and stays.
    expect(tabValues(old, defaults, legacy)).toEqual({ reliability: "90", fade: "10", freq: "146" });
  });

  it("keeps a new-format value even if it matches an old default", () => {
    const saved = { reliability: "50", [STATE_VERSION_KEY]: "2" };
    expect(tabValues(saved, defaults, { reliability: "50" }).reliability).toBe("50");
  });

  it("ignores unknown keys and non-strings", () => {
    expect(tabValues({ evil: "x", fade: 3 }, defaults)).toEqual(defaults);
    expect(tabValues(null, defaults)).toEqual(defaults);
  });
});
