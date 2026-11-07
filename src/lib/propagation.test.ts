import { describe, expect, it } from "vitest";
import { bullingtonLoss } from "./diffraction";
import { defaultModel, groundForEnvironment, parseModel, terrainLoss, timeAvailable } from "./propagation";
import { environments } from "./environment";

// 20 km over a 150 m ridge at the midpoint, 101 samples.
const ridge = Array.from({ length: 101 }, (_, i) => 100 + 150 * Math.max(0, 1 - Math.abs(i - 50) / 10));
const flat = Array.from({ length: 101 }, () => 100);
const path = (elevationsM: number[], freqHz = 450e6) => ({ freqHz, distanceM: 20_000, elevationsM, txHeightM: 10, rxHeightM: 10 });

describe("terrainLoss", () => {
  it("uses Longley-Rice from 20 MHz to 20 GHz", () => {
    const t = terrainLoss(path(ridge), defaultModel);
    expect(t.model).toBe("itm");
    expect(t.lossDb).toBeGreaterThan(15);
  });

  it("charges far more for a ridge than for flat ground", () => {
    expect(terrainLoss(path(ridge), defaultModel).lossDb - terrainLoss(path(flat), defaultModel).lossDb).toBeGreaterThan(10);
  });

  it("falls back to Bullington above 20 GHz", () => {
    const t = terrainLoss(path(ridge, 24e9), defaultModel);
    expect(t.model).toBe("bullington");
    expect(t.lossDb).toBeCloseTo(bullingtonLoss(path(ridge, 24e9)).lossDb, 9);
  });

  it("raises an antenna on the ground to ITM's 0.5 m minimum instead of failing", () => {
    expect(terrainLoss({ ...path(flat), rxHeightM: 0 }, defaultModel).model).toBe("itm");
  });

  it("predicts more loss for higher reliability and confidence", () => {
    const base = terrainLoss(path(ridge), defaultModel).lossDb;
    expect(terrainLoss(path(ridge), { ...defaultModel, reliability: 95 }).lossDb).toBeGreaterThan(base);
    expect(terrainLoss(path(ridge), { ...defaultModel, confidence: 90 }).lossDb).toBeGreaterThan(base);
  });
});

describe("timeAvailable", () => {
  const t = terrainLoss(path(ridge), defaultModel);
  it("is 50% when the median margin is zero", () => {
    expect(timeAvailable(t.itm!, defaultModel, 0)).toBeCloseTo(50, 1);
  });
  it("rises with margin and stays in range", () => {
    expect(timeAvailable(t.itm!, defaultModel, 5)).toBeGreaterThan(timeAvailable(t.itm!, defaultModel, 1));
    expect(timeAvailable(t.itm!, defaultModel, 200)).toBe(99.9);
    expect(timeAvailable(t.itm!, defaultModel, -200)).toBe(0.1);
  });
});

describe("parseModel", () => {
  it("falls back to the defaults for anything unknown", () => {
    expect(parseModel({})).toEqual(defaultModel);
    expect(parseModel({ climate: "9", ground: "lava", polarization: "diagonal", reliability: "abc" })).toEqual(defaultModel);
  });
  it("keeps valid settings and clamps percentages", () => {
    const m = parseModel({ climate: "4", ground: "sea", polarization: "horizontal", reliability: "100", confidence: "0" });
    expect(m).toEqual({ climate: 4, ground: "sea", polarization: "horizontal", reliability: 99.9, confidence: 0.1 });
  });
});

describe("groundForEnvironment", () => {
  it("suggests water, poor or average ground", () => {
    expect(groundForEnvironment("water")).toBe("sea");
    expect(groundForEnvironment("desert")).toBe("poor");
    expect(groundForEnvironment("urban")).toBe("poor");
    expect(groundForEnvironment("none")).toBe(defaultModel.ground);
    expect(groundForEnvironment("dense")).toBe("average");
  });
  it("has a suggestion for every Environment profile", () => {
    for (const e of environments) expect(["average", "poor", "good", "fresh", "sea"]).toContain(groundForEnvironment(e.id));
  });
});
