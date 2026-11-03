import { describe, expect, it } from "vitest";
import {
  type PowerItem,
  generatorSizes,
  cleanPowerItem,
  cleanProfiles,
  csvCell,
  itemLoad,
  planCsv,
  planTotals,
  recommendGenerator,
  removeProfile,
  saveProfile,
} from "./powerPlan";

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
    expect(rec.set).toBe(generatorSizes[generatorSizes.length - 1]);
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
    const csv = planCsv([item({ name: "Radio", watts: 150, qty: 4 }), item({ name: "Laptop", volts: 120, amps: 1.5, qty: 2 })]);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Item,Qty,Volts,Amps,AC/DC,Power factor,Watts each,Total watts");
    expect(lines[1]).toBe("Radio,4,,,AC,1,150,600");
    expect(lines[2]).toBe("Laptop,2,120,1.5,AC,1,180,360");
    expect(csv).toContain("Total load (W),960");
  });

  it("leaves out the generator recommendation", () => {
    expect(planCsv([item({ name: "Radio", watts: 5000 })])).not.toMatch(/kW|generator|limit/i);
  });

  it("adds apparent power only when a power factor changes it", () => {
    expect(planCsv([item({ name: "Radio", watts: 100 })])).not.toContain("apparent");
    expect(planCsv([item({ name: "Air conditioner", watts: 800, powerFactor: 0.8 })])).toContain("Total apparent power (VA),1000");
  });

  it("leaves out empty rows", () => {
    expect(planCsv([item({}), item({ name: "Radio", watts: 50 })]).split("\r\n")[1]).toMatch(/^Radio,/);
  });
});

describe("saved equipment", () => {
  it("keeps the data plate details but not the quantity", () => {
    const [saved] = saveProfile([], item({ name: " Radio ", watts: 150, qty: 4 }));
    expect(saved).toEqual({ name: "Radio", watts: 150, ac: true, powerFactor: 1 });
  });

  it("replaces an entry with the same name, whatever the case, and sorts by name", () => {
    let list = saveProfile([], item({ name: "Laptop", volts: 120, amps: 1.5 }));
    list = saveProfile(list, item({ name: "Air conditioner", watts: 3500 }));
    list = saveProfile(list, item({ name: "laptop", volts: 120, amps: 2 }));
    expect(list.map((p) => [p.name, p.amps])).toEqual([["Air conditioner", undefined], ["laptop", 2]]);
  });

  it("removes by name", () => {
    expect(removeProfile([{ name: "Air conditioner", ac: true, powerFactor: 1, watts: 3500 }], "air conditioner")).toEqual([]);
  });

  it("reads back only well-formed, named entries", () => {
    expect(cleanProfiles([{ name: "Radio", watts: "50", ac: false }, { watts: 10 }, null, "x"])).toEqual([
      { name: "Radio", watts: undefined, volts: undefined, amps: undefined, ac: false, powerFactor: 1 },
    ]);
    expect(cleanProfiles({ name: "Radio" })).toEqual([]);
  });

  it("cleans a stored item", () => {
    expect(cleanPowerItem({ name: 5, qty: Infinity, watts: 20 })).toEqual({ name: "", qty: 1, watts: 20, volts: undefined, amps: undefined, ac: true, powerFactor: 1 });
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
