import { describe, expect, it } from "vitest";
import { DEFAULT_TREE_HEIGHT_M, aboveModelRange, belowModelRange, clutterLossDb, effectiveHeightM, environments, findEnvironment, withTreeHeight, woodlandLossDb } from "./environment";

const env = findEnvironment;

describe("clutterLossDb", () => {
  it("adds nothing for None", () => {
    expect(clutterLossDb(env("none"), 915e6, 1.5)).toBe(0);
  });

  it("is zero once the antenna clears the clutter", () => {
    for (const e of environments) expect(clutterLossDb(e, 915e6, 25)).toBe(0);
  });

  it("follows equation 2b over open ground", () => {
    // Kh2 = 21.8 + 6.2·log10(0.915) = 21.56; −21.56·log10(1.5/10) = 17.76.
    expect(clutterLossDb(env("fields"), 915e6, 1.5)).toBeCloseTo(17.76, 1);
  });

  it("follows equation 2a in urban clutter", () => {
    // hdif 13.5 m, θ 26.57°, ν = 0.342·√0.915·√(13.5·26.57) = 6.21.
    const nu = 6.21;
    const j = 6.9 + 20 * Math.log10(Math.sqrt((nu - 0.1) ** 2 + 1) + nu - 0.1);
    expect(clutterLossDb(env("urban"), 915e6, 1.5)).toBeCloseTo(j - 6.03, 1);
  });

  it("grows with frequency and shrinks with antenna height", () => {
    const e = env("urban");
    expect(clutterLossDb(e, 2.4e9, 2)).toBeGreaterThan(clutterLossDb(e, 915e6, 2));
    expect(clutterLossDb(e, 915e6, 2)).toBeGreaterThan(clutterLossDb(e, 150e6, 2));
    expect(clutterLossDb(e, 915e6, 10)).toBeLessThan(clutterLossDb(e, 915e6, 2));
  });

  it("ranks urban above light vegetation", () => {
    const at = (id: string) => clutterLossDb(env(id), 915e6, 1.5);
    expect(at("urban")).toBeGreaterThan(at("light"));
  });

  it("stays finite at ground level", () => {
    expect(Number.isFinite(clutterLossDb(env("water"), 915e6, 0))).toBe(true);
  });

  // ITU-R P.833-10 Table 1: measured maximum excess loss in 16 m mixed forest,
  // [MHz, Am dB]. The model should land in the same range, not match exactly.
  it.each([
    [105.9, 9.4],
    [466.475, 18.0],
    [949, 26.5],
    [1852.2, 29.0],
    [2117.5, 34.1],
  ])("dense vegetation at %d MHz is within 7 dB of the measured %d dB", (mhz, am) => {
    expect(Math.abs(clutterLossDb(env("dense"), mhz * 1e6, 1.5) - am)).toBeLessThan(7);
  });

  it("roughly matches plane-earth excess loss for handhelds over open ground", () => {
    // Plane earth at 5 km with 1.5 m antennas: 40·log10(5000) − 20·log10(2.25) = 140.9 dB.
    // Free space at 915 MHz is 105.7 dB, so about 35 dB of excess.
    const both = 2 * clutterLossDb(env("fields"), 915e6, 1.5);
    expect(Math.abs(both - 35.2)).toBeLessThan(2);
  });
});

describe("woodland (Dense Vegetation, ITU-R P.833)", () => {
  it("is Am = 1.15·f^0.43 below the canopy, at any height under it", () => {
    expect(woodlandLossDb(50e6)).toBeCloseTo(1.15 * Math.pow(50, 0.43), 9);
    expect(clutterLossDb(env("dense"), 50e6, 1.8)).toBeCloseTo(6.2, 1);
    expect(clutterLossDb(env("dense"), 150e6, 12)).toBeCloseTo(clutterLossDb(env("dense"), 150e6, 1.8), 9);
  });

  it("adds nothing once the antenna is above the trees", () => {
    expect(clutterLossDb(env("dense"), 150e6, DEFAULT_TREE_HEIGHT_M + 1)).toBe(0);
  });

  it("works the path from the antenna's real height, not the treetops", () => {
    expect(effectiveHeightM(env("dense"), 1.8)).toBe(1.8);
  });

  it("takes a tree height, so tall pines cover a 22 m mast", () => {
    const pines = withTreeHeight(env("dense"), 24);
    expect(pines.clutterHeightM).toBe(24);
    expect(clutterLossDb(env("dense"), 150e6, 22)).toBe(0);
    expect(clutterLossDb(pines, 150e6, 22)).toBeGreaterThan(0);
    // Only woodland takes it; a missing height keeps the default.
    expect(withTreeHeight(env("urban"), 24).clutterHeightM).toBe(15);
    expect(withTreeHeight(env("dense"), undefined).clutterHeightM).toBe(DEFAULT_TREE_HEIGHT_M);
  });
});

describe("frequency limits", () => {
  it("adds nothing below 30 MHz", () => {
    expect(belowModelRange(7.1e6)).toBe(true);
    expect(clutterLossDb(env("urban"), 7.1e6, 1.5)).toBe(0);
  });

  it("holds the 3 GHz figure above 3 GHz", () => {
    expect(aboveModelRange(5.8e9)).toBe(true);
    expect(clutterLossDb(env("urban"), 5.8e9, 1.5)).toBe(clutterLossDb(env("urban"), 3e9, 1.5));
  });
});

describe("effectiveHeightM and findEnvironment", () => {
  it("lifts the path to the top of the clutter", () => {
    expect(effectiveHeightM(env("urban"), 2)).toBe(15);
    expect(effectiveHeightM(env("urban"), 30)).toBe(30);
    expect(effectiveHeightM(env("none"), 2)).toBe(2);
  });

  it("falls back to None for an unknown id", () => {
    expect(findEnvironment("<b>x</b>").id).toBe("none");
  });
});
