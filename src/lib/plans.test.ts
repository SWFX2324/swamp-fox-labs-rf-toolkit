import { describe, expect, it } from "vitest";
import { buildKml, buildOverlayKml, buildZip, crc32, escapeXml, fileName } from "./export";
import { type PlanNode, createPlanStore, decodePlan, encodePlan, planFromHash } from "./plans";

const names = ["freq", "power"];
const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

describe("share links", () => {
  it("round-trips a plan, including non-ASCII names", () => {
    const plan = { settings: { freq: "915" }, nodes: [{ name: "Höhe ↔ 2", lat: 35.2, lon: -80.8, height: "30" }] };
    expect(decodePlan(encodePlan(plan), names)).toEqual(plan);
  });

  it("keeps only known settings and short strings", () => {
    const encoded = encodePlan({ settings: { freq: "915", evil: "x", power: "y".repeat(500) } });
    expect(decodePlan(encoded, names)).toEqual({ settings: { freq: "915" } });
  });

  it("drops invalid nodes and caps the count", () => {
    const nodes = [
      { name: "ok", lat: 1, lon: 2, height: "3" },
      { name: "far", lat: 95, lon: 2, height: "" },
      { name: "text", lat: "1", lon: 2, height: "" },
      ...Array.from({ length: 20 }, () => ({ name: "n", lat: 1, lon: 1, height: "" })),
    ];
    const plan = decodePlan(encodePlan({ settings: {}, nodes: nodes as PlanNode[] }), names)!;
    expect(plan.nodes!.length).toBeLessThanOrEqual(8);
    expect(plan.nodes![0].name).toBe("ok");
    expect(plan.nodes!.some((n) => n.name === "far" || n.name === "text")).toBe(false);
  });

  it("rejects malformed and oversized links", () => {
    expect(decodePlan("", names)).toBeUndefined();
    expect(decodePlan("not base64!", names)).toBeUndefined();
    expect(decodePlan("bm90IGpzb24", names)).toBeUndefined();
    expect(decodePlan("A".repeat(9000), names)).toBeUndefined();
  });

  it("reads the plan only for the matching tool", () => {
    expect(planFromHash("#mesh?plan=abc", "mesh")).toBe("abc");
    expect(planFromHash("#mesh?plan=abc", "coverage")).toBeUndefined();
    expect(planFromHash("#mesh", "mesh")).toBeUndefined();
  });
});

describe("plan store", () => {
  it("saves, replaces by name, sorts and removes", () => {
    const store = createPlanStore(memory(), "mesh", names);
    store.save("Ridge", { settings: { freq: "915" } });
    store.save("Base", { settings: { freq: "146" } });
    store.save("Ridge", { settings: { freq: "450" } });
    expect(store.list().map((p) => p.name)).toEqual(["Base", "Ridge"]);
    expect(store.list()[1].settings.freq).toBe("450");
    store.remove("Base");
    expect(store.list().map((p) => p.name)).toEqual(["Ridge"]);
  });

  it("keeps each tool's plans apart and survives junk", () => {
    const storage = memory();
    createPlanStore(storage, "mesh", names).save("A", { settings: {} });
    expect(createPlanStore(storage, "coverage", names).list()).toEqual([]);
    storage.setItem("rf-toolkit:plans:mesh", "{bad");
    expect(createPlanStore(storage, "mesh", names).list()).toEqual([]);
  });

  it("reports a full store", () => {
    const store = createPlanStore({ getItem: () => null, setItem: () => { throw new Error("full"); } }, "mesh", names);
    expect(store.save("x", { settings: {} })).toBe(false);
  });
});

describe("KML", () => {
  it("escapes user text", () => {
    expect(escapeXml(`<a & "b">'`)).toBe("&lt;a &amp; &quot;b&quot;&gt;&apos;");
    expect(buildKml("T", [{ name: "<x>&", lat: 1, lon: 2 }])).toContain("<name>&lt;x&gt;&amp;</name>");
  });

  it("writes coordinates as lon,lat,alt and styles lines by status", () => {
    const kml = buildKml("T", [{ name: "A", lat: 35.2, lon: -80.8 }], [
      { name: "A-B", from: { lat: 35.2, lon: -80.8 }, to: { lat: 35.3, lon: -80.7 }, status: "marginal" },
    ]);
    expect(kml).toContain("<coordinates>-80.800000,35.200000,0</coordinates>");
    expect(kml).toContain("<styleUrl>#marginal</styleUrl>");
    expect(kml).toContain("-80.800000,35.200000,0 -80.700000,35.300000,0");
  });

  it("styles points with an icon from the KMZ, and leaves plain KML unstyled", () => {
    const point = { name: "A", lat: 1, lon: 2 };
    const kml = buildKml("T", [point], [], "radio.png");
    expect(kml).toContain("<href>radio.png</href>");
    expect(kml).toContain("<styleUrl>#node</styleUrl>");
    expect(buildKml("T", [point])).not.toContain("<IconStyle>");
  });

  it("writes a ground overlay with its bounds", () => {
    const kml = buildOverlayKml("Cov", "coverage.png", { north: 1, south: -1, east: 2, west: -2 });
    expect(kml).toContain("<href>coverage.png</href>");
    expect(kml).toContain("<north>1.000000</north>");
    expect(kml).not.toContain("<Style");
  });

  it("styles overlay points with an icon from the KMZ", () => {
    const kml = buildOverlayKml("Cov", "coverage.png", { north: 1, south: -1, east: 2, west: -2 }, [{ name: "TX site", lat: 1, lon: 2 }], "radio.png");
    expect(kml).toContain("<href>radio.png</href>");
    expect(kml).toContain("<styleUrl>#node</styleUrl>");
    expect(kml.indexOf("<Style")).toBeLessThan(kml.indexOf("<GroundOverlay>"));
  });
});

describe("zip", () => {
  it("computes the standard CRC-32 check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("has the local, central and end records in place", () => {
    const data = new TextEncoder().encode("hello");
    const zip = buildZip([{ name: "doc.kml", data }]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(zip.length - 22 + 10, true)).toBe(1);
    expect(view.getUint32(14, true)).toBe(crc32(data));
    expect(new TextDecoder().decode(zip.slice(30, 37))).toBe("doc.kml");
    expect(new TextDecoder().decode(zip.slice(37, 42))).toBe("hello");
  });
});

describe("fileName", () => {
  it("makes safe names", () => {
    expect(fileName("Ridge to base / camp!", "kml")).toBe("Ridge-to-base-camp.kml");
    expect(fileName("***", "kmz")).toBe("rf-toolkit.kmz");
  });
});
