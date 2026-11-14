import { describe, expect, it } from "vitest";
import { bestRoutes, cleanPreset, cleanPresets, formatRate, hopLimit, ladder, rateAt, samePreset } from "./radioPresets";

const preset = {
  id: "p-1",
  name: "Test radio",
  rateUnit: "kbps" as const,
  rates: [
    { rate: "1000", sens: "-90" },
    { rate: "250", sens: "-100" },
    { rate: "50", sens: "-110" },
  ],
  hopLimit: "3",
  sharedChannel: true,
};

describe("cleanPreset", () => {
  it("keeps a valid preset", () => {
    expect(cleanPreset(preset)).toEqual(preset);
  });

  it("drops what isn't a preset or a number", () => {
    expect(cleanPreset({ name: "" })).toBeUndefined();
    expect(cleanPreset("x")).toBeUndefined();
    const c = cleanPreset({ name: "R", power: "lots", rates: [{ rate: "1", sens: "abc" }, { rate: "2", sens: "-90" }], rateUnit: "Gbps" })!;
    expect(c.power).toBeUndefined();
    expect(c.rates).toEqual([{ rate: "2", sens: "-90" }]);
    expect(c.rateUnit).toBe("kbps");
    expect(c.sharedChannel).toBe(true);
  });

  it("makes duplicate ids unique", () => {
    const list = cleanPresets([preset, preset]);
    expect(list).toHaveLength(2);
    expect(list[0].id).not.toBe(list[1].id);
    expect(samePreset(list[0], list[1])).toBe(true);
  });
});

describe("ladder and rateAt", () => {
  it("sorts fastest first and applies the derating", () => {
    const rungs = ladder({ ...preset, rateUnit: "Mbps", rates: [{ rate: "0.5", sens: "-100" }, { rate: "2", sens: "-90" }] }, (x) => x + 3);
    expect(rungs).toEqual([
      { kbps: 2000, sensDbm: -87 },
      { kbps: 500, sensDbm: -97 },
    ]);
  });

  it("picks the fastest rate that keeps the fade margin, and the fastest that decodes", () => {
    const rungs = ladder(preset);
    // −95 dBm: 5 dB short of the 1000 kbps step, 5 over 250, 15 over 50.
    const r = rateAt(-95, rungs, 10);
    expect(r.solid?.kbps).toBe(50);
    expect(r.any?.kbps).toBe(250);
    expect(rateAt(-89, rungs, 10).any?.kbps).toBe(1000);
    expect(rateAt(-115, rungs, 10)).toEqual({ solid: undefined, any: undefined });
  });

  it("reads the hop limit", () => {
    expect(hopLimit(preset)).toBe(3);
    expect(hopLimit({ ...preset, hopLimit: "" })).toBeUndefined();
    expect(hopLimit(undefined)).toBeUndefined();
  });
});

describe("bestRoutes", () => {
  // A line 0 – 1 – 2 – 3, each hop 300 kbps, plus a slow direct 0 – 3 at 50 kbps.
  const links = [
    { a: 0, b: 1, kbps: 300 },
    { a: 1, b: 2, kbps: 300 },
    { a: 2, b: 3, kbps: 300 },
    { a: 0, b: 3, kbps: 50 },
  ];

  it("adds up airtime hop by hop on a shared channel", () => {
    const r = bestRoutes(4, links);
    // Three 300 kbps hops carry 100 kbps end to end, better than the 50 kbps direct link.
    expect(r[0][3]!.kbps).toBeCloseTo(100, 9);
    expect(r[0][3]!.hops).toBe(3);
    expect(r[0][1]!.kbps).toBeCloseTo(300, 9);
    expect(r[0][0]).toBeUndefined();
  });

  it("is limited by the slowest hop when relays don't share a channel", () => {
    const r = bestRoutes(4, links, 3, false);
    expect(r[0][3]!.kbps).toBe(300);
  });

  it("keeps within the hop limit", () => {
    const r = bestRoutes(4, links, 2);
    // Three hops aren't allowed, so 0 to 3 takes the direct link.
    expect(r[0][3]).toEqual({ kbps: 50, hops: 1 });
    const cut = bestRoutes(4, links.slice(0, 3), 2);
    expect(cut[0][3]).toBeUndefined();
    expect(cut[0][2]!.hops).toBe(2);
  });
});

describe("formatRate", () => {
  it("switches to Mbps from 1000 kbps", () => {
    expect(formatRate(250)).toBe("250 kbps");
    expect(formatRate(1500)).toBe("1.5 Mbps");
    expect(formatRate(5.47)).toBe("5.47 kbps");
  });
});
