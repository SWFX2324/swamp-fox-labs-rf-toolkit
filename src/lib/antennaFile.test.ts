import { describe, expect, it } from "vitest";
import { cleanPatterns, closestShape, fallbackOf, isFilePatternId, parseMsi } from "./antennaFile";
import { beam, findPattern, patternLossDb } from "./pattern";

/** An MSI file from cuts given as functions of the angle. */
function msi(h: (a: number) => number, v: (a: number) => number, head = "NAME Test Sector\nFREQUENCY 900\nGAIN 14.5 dBd\n"): string {
  const cut = (f: (a: number) => number) => Array.from({ length: 360 }, (_, a) => `${a} ${f(a).toFixed(2)}`).join("\n");
  return `${head}HORIZONTAL 360\n${cut(h)}\nVERTICAL 360\n${cut(v)}\n`;
}

// A 90° sector: 3 dB down 45° either side, 25 dB at the back.
const sectorH = (a: number) => Math.min(25, 12 * ((((a + 180) % 360) - 180) / 90) ** 2);
// A beam peaking 4° below the horizon (electrical downtilt), 7° wide.
const tiltedV = (a: number) => Math.min(30, 12 * (((((a + 180) % 360) - 180) - 4) / 7) ** 2);

describe("parseMsi", () => {
  it("reads the name, frequency, gain (dBd to dBi) and both cuts", () => {
    const p = parseMsi(msi(sectorH, tiltedV));
    if (typeof p === "string") throw new Error(p);
    expect(p.name).toBe("Test Sector");
    expect(p.freqMhz).toBe(900);
    expect(p.gainDbi).toBeCloseTo(16.65, 2);
    expect(p.h).toHaveLength(360);
    expect(p.v[4]).toBe(0);
    expect(isFilePatternId(p.id)).toBe(true);
    expect(fallbackOf(p.id)).toBe("sector90");
  });

  it("takes a gain marked dBi as it is, and a GHz frequency in MHz", () => {
    const p = parseMsi(msi(() => 0, tiltedV, "Omni Whip\nFREQUENCY 2.4 GHz\nGAIN 6 dBi\n"));
    if (typeof p === "string") throw new Error(p);
    expect(p.name).toBe("Omni Whip");
    expect(p.gainDbi).toBe(6);
    expect(p.freqMhz).toBe(2400);
    expect(fallbackOf(p.id)).toBe("omni");
  });

  it("fills in every degree from a coarser file, and treats minus signs as losses", () => {
    const coarse = `NAME Coarse\nGAIN 3\nHORIZONTAL 4\n0 0\n90 -10\n180 -20\n270 -10\nVERTICAL 4\n0 0\n90 20\n180 20\n270 20\n`;
    const p = parseMsi(coarse);
    if (typeof p === "string") throw new Error(p);
    expect(p.h[45]).toBeCloseTo(5, 6);
    expect(p.h[180]).toBe(20);
    expect(p.h[315]).toBeCloseTo(5, 6);
  });

  it("explains a file it can't use", () => {
    expect(parseMsi("hello")).toMatch(/HORIZONTAL and a VERTICAL/);
    expect(parseMsi(msi(sectorH, tiltedV, "NAME No Gain\n"))).toMatch(/GAIN/);
  });
});

describe("imported patterns in the link maths", () => {
  const p = parseMsi(msi(sectorH, tiltedV)) as Exclude<ReturnType<typeof parseMsi>, string>;

  it("measures horizontal angles clockwise from where the antenna points", () => {
    const b = beam(p.id, p.gainDbi, 90, 0, p);
    // Aimed east: 45° either side is 3 dB down, the back 25 dB.
    expect(patternLossDb(b, 45, -4)).toBeCloseTo(3, 1);
    expect(patternLossDb(b, 135, -4)).toBeCloseTo(3, 1);
    expect(patternLossDb(b, 270, -4)).toBeCloseTo(25, 1);
  });

  it("measures vertical angles downward, so a downtilted beam peaks below the horizon", () => {
    const b = beam(p.id, p.gainDbi, 0, 0, p);
    expect(patternLossDb(b, 0, -4)).toBeCloseTo(0, 6);
    expect(patternLossDb(b, 0, 0)).toBeGreaterThan(3);
    // A mechanical downtilt lowers it further.
    expect(patternLossDb(beam(p.id, p.gainDbi, 0, 2, p), 0, -6)).toBeCloseTo(0, 6);
  });

  it("caps the loss at the file's deepest null", () => {
    const b = beam(p.id, p.gainDbi, 0, 0, p);
    expect(patternLossDb(b, 180, 60)).toBeLessThanOrEqual(30);
  });

  it("stands in the closest built-in shape where the file isn't on the device", () => {
    expect(findPattern(p.id).id).toBe("sector90");
    expect(closestShape(Array(360).fill(0))).toBe("omni");
  });
});

describe("cleanPatterns", () => {
  it("keeps valid patterns and drops damaged ones", () => {
    const good = parseMsi(msi(sectorH, tiltedV));
    const list = cleanPatterns([good, { name: "Broken", gainDbi: 5, h: [1, 2], v: [] }, null, { ...(good as object), h: Array(360).fill(-1) }]);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Test Sector");
  });
});
