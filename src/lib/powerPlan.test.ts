import { describe, expect, it } from "vitest";
import { type PowerItem, ammpsSets, csvCell, itemLoad, planCsv, planTotals, recommendGenerator } from "./powerPlan";

const item = (o: Partial<PowerItem>): PowerItem => ({ name: "", qty: 1, ac: true, powerFactor: 1, ...o });

describe("itemLoad", () => {
  it("uses data plate watts as given", () => {
    expect(itemLoad(item({ watts: 150 }))).toEqual({ watts: 150, va: 150 });
  });

  it("multiplies volts by amps", () => {
    expect(itemLoad(item({ volts: 120, amps: 2.5 }))).toEqual({ watts: 300, va: 300 });
  });

  it("prefers watts when both are entered", () => {
    expect(itemLoad(item({ watts: 100, volts: 120, amps: 5 }))?.watts).toBe(100);
  });

  it("applies power factor to AC volts × amps", () => {
    const load = itemLoad(item({ volts: 120, amps: 10, powerFactor: 0.8 }))!;
    expect(load.va).toBe(1200);
    expect(load.watts).toBeCloseTo(960, 9);
  });

  it("turns AC watts into more VA at a lower power factor", () => {
    expect(itemLoad(item({ watts: 800, powerFactor: 0.8 }))!.va).toBeCloseTo(1000, 9);
  });

  it("ignores power factor on DC", () => {
    expect(itemLoad(item({ volts: 24, amps: 10, ac: false, powerFactor: 0.5 }))).toEqual({ watts: 240, va: 240 });
  });

  it("treats a power factor outside 0–1 as 1", () => {
    expect(itemLoad(item({ volts: 120, amps: 1, powerFactor: 0 }))!.watts).toBe(120);
    expect(itemLoad(item({ volts: 120, amps: 1, powerFactor: 1.5 }))!.watts).toBe(120);
  });

  it("waits for watts or both volts and amps", () => {
    expect(itemLoad(item({ volts: 120 }))).toBeUndefined();
    expect(itemLoad(item({ watts: -5 }))).toBeUndefined();
    expect(itemLoad(item({}))).toBeUndefined();
  });
});

describe("planTotals", () => {
  it("multiplies each item by its quantity and adds them up", () => {
    const totals = planTotals([item({ watts: 150, qty: 4 }), item({ volts: 28, amps: 5, ac: false, qty: 2 }), item({ volts: 120 })]);
    expect(totals.watts).toBe(880);
    expect(totals.counted).toBe(2);
  });

  it("skips items with no quantity", () => {
    expect(planTotals([item({ watts: 500, qty: 0 })]).watts).toBe(0);
  });
});

describe("recommendGenerator", () => {
  it("picks the smallest set inside the limit", () => {
    expect(recommendGenerator({ watts: 3500, va: 3500 }, 0.8)).toMatchObject({ set: { kw: 5 }, count: 1 });
    expect(recommendGenerator({ watts: 4100, va: 4100 }, 0.8)).toMatchObject({ set: { kw: 10 }, count: 1 });
  });

  it("counts a load exactly at the limit as fitting", () => {
    expect(recommendGenerator({ watts: 12_000, va: 12_000 }, 0.8)!.set.kw).toBe(15);
  });

  it("reports the load as a share of the rating", () => {
    expect(recommendGenerator({ watts: 6000, va: 6000 }, 0.8)!.fraction).toBeCloseTo(0.6, 9);
  });

  it("checks apparent power against the set's kVA at a low power factor", () => {
    // 3.6 kW fits 80% of 5 kW, but 6 kVA is past 80% of its 6.25 kVA.
    expect(recommendGenerator({ watts: 3600, va: 6000 }, 0.8)!.set.kw).toBe(10);
  });

  it("uses several 60 kW sets past the largest", () => {
    const rec = recommendGenerator({ watts: 100_000, va: 100_000 }, 0.8)!;
    expect(rec.set).toBe(ammpsSets[ammpsSets.length - 1]);
    expect(rec.count).toBe(3);
    expect(rec.fraction).toBeCloseTo(100 / 180, 9);
  });

  it("follows a different limit", () => {
    expect(recommendGenerator({ watts: 4500, va: 4500 }, 1)!.set.kw).toBe(5);
  });

  it("has nothing to recommend without a load", () => {
    expect(recommendGenerator({ watts: 0, va: 0 }, 0.8)).toBeUndefined();
  });
});

describe("planCsv", () => {
  it("writes each item and the totals", () => {
    const csv = planCsv([item({ name: "PRC-117G", watts: 150, qty: 4 }), item({ name: "Laptop", volts: 120, amps: 1.5, qty: 2 })], 0.8);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Item,Qty,Volts,Amps,AC/DC,Power factor,Watts each,Total watts");
    expect(lines[1]).toBe("PRC-117G,4,,,AC,1,150,600");
    expect(lines[2]).toBe("Laptop,2,120,1.5,AC,1,180,360");
    expect(csv).toContain("Total load (W),960");
    expect(csv).toContain("Recommended AMMPS,5 kW MEP-1030");
    expect(csv).toContain("Load on generator,19%");
  });

  it("leaves out empty rows", () => {
    expect(planCsv([item({}), item({ name: "Radio", watts: 50 })], 0.8).split("\r\n")[1]).toMatch(/^Radio,/);
  });
});

describe("csvCell", () => {
  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell('Radio, "big"')).toBe('"Radio, ""big"""');
  });

  it("keeps a spreadsheet from running a name as a formula", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell(-5)).toBe("-5");
  });
});
