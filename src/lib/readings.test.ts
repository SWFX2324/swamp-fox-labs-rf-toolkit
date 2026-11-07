import { describe, expect, it } from "vitest";
import { type Reading, errorStats, loadReadings, readingsCsv, sameSite, saveReadings, statsByCover } from "./readings";

const site = { lat: 35.2271, lon: -80.8431 };
const reading = (over: Partial<Reading> = {}): Reading => ({
  id: "a",
  lat: 35.25,
  lon: -80.8,
  measuredDbm: -92,
  site,
  note: "",
  takenAt: "2026-11-07T12:00:00.000Z",
  ...over,
});

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

describe("errorStats", () => {
  it("gives the average, spread and RMS of the errors", () => {
    const s = errorStats([2, 4, 6]);
    expect(s.count).toBe(3);
    expect(s.meanDb).toBe(4);
    expect(s.sdDb).toBeCloseTo(2, 9);
    expect(s.rmsDb).toBeCloseTo(Math.sqrt((4 + 16 + 36) / 3), 9);
  });

  it("handles none and one", () => {
    expect(errorStats([])).toEqual({ count: 0, meanDb: 0, sdDb: 0, rmsDb: 0 });
    expect(errorStats([-3]).sdDb).toBe(0);
  });
});

describe("statsByCover", () => {
  it("groups by cover, largest group first", () => {
    const groups = statsByCover([
      { cover: "Dense Vegetation", errorDb: -8 },
      { cover: "Open Fields", errorDb: 1 },
      { cover: "Dense Vegetation", errorDb: -6 },
      { errorDb: 0 },
    ]);
    expect(groups[0]).toMatchObject({ cover: "Dense Vegetation", stats: { count: 2, meanDb: -7 } });
    expect(groups.map((g) => g.cover)).toContain("Not recorded");
  });
});

describe("sameSite", () => {
  it("matches readings taken from the same site", () => {
    expect(sameSite(reading(), { lat: 35.2272, lon: -80.8431 })).toBe(true);
    expect(sameSite(reading(), { lat: 35.24, lon: -80.8431 })).toBe(false);
  });
});

describe("saving readings", () => {
  it("round-trips and drops malformed entries", () => {
    const store = memory();
    saveReadings(store, [reading(), reading({ id: "b", measuredDbm: -80, cover: "Urban", note: "car roof" })]);
    expect(loadReadings(store)).toHaveLength(2);
    store.setItem("rf-toolkit:readings", JSON.stringify([reading(), { lat: 99, lon: 0, measuredDbm: -1, site }, { lat: 1, lon: 1, measuredDbm: "x", site }]));
    expect(loadReadings(store)).toHaveLength(1);
    store.setItem("rf-toolkit:readings", "not json");
    expect(loadReadings(store)).toEqual([]);
  });
});

describe("readingsCsv", () => {
  it("writes a header and one row per reading with its error", () => {
    const csv = readingsCsv([{ reading: reading({ note: 'hill, "top"' }), predictedDbm: -95.5 }]);
    const [head, row] = csv.trim().split("\r\n");
    expect(head.split(",")).toContain("error_db");
    expect(row).toContain("-92.0,-95.5,3.5");
    expect(row).toContain('"hill, ""top"""');
  });

  it("defuses notes a spreadsheet would treat as formulas", () => {
    const csv = readingsCsv([{ reading: reading({ note: "=HYPERLINK(1)" }) }]);
    expect(csv).toContain("'=HYPERLINK(1)");
  });
});
