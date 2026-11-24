import { describe, expect, it } from "vitest";
import { buildCot, buildDataPackage, importPoints, pointsFromCot, pointsFromKml, readZip } from "./tak";
import { buildKml, buildZip, crc32 } from "./export";

const text = (b: Uint8Array) => new TextDecoder().decode(b);
const now = new Date("2026-01-01T00:00:00Z");

/** A one-file zip with the file deflated, as TAK clients and Google Earth write them. */
async function deflatedZip(name: string, content: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(content);
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const packed = new Uint8Array(await new Response(stream).arrayBuffer());
  const n = new TextEncoder().encode(name);
  const local = new Uint8Array(30);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(8, 8, true);
  lv.setUint32(14, crc32(data), true);
  lv.setUint32(18, packed.length, true);
  lv.setUint32(22, data.length, true);
  lv.setUint16(26, n.length, true);
  const central = new Uint8Array(46);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(10, 8, true);
  cv.setUint32(16, crc32(data), true);
  cv.setUint32(20, packed.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, n.length, true);
  cv.setUint32(42, 0, true);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, 46 + n.length, true);
  ev.setUint32(16, 30 + n.length + packed.length, true);
  const parts = [local, n, packed, central, n, end];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe("TAK data package", () => {
  it("writes a spot marker CoT event", () => {
    const cot = buildCot({ name: "Ridge <A>", lat: 35.2271, lon: -80.8431 }, "uid-1", now);
    expect(cot).toContain('type="b-m-p-s-m"');
    expect(cot).toContain('uid="uid-1"');
    expect(cot).toContain('callsign="Ridge &lt;A&gt;"');
    expect(cot).toContain('lat="35.2271000"');
    expect(cot).toContain("<archive/>");
    expect(pointsFromCot(cot)).toEqual([{ name: "Ridge <A>", lat: 35.2271, lon: -80.8431 }]);
  });

  it("packs a manifest, the files and a marker per point", async () => {
    const zip = buildDataPackage("Hill net", [{ name: "hill-net.kmz", data: new Uint8Array([1, 2, 3]) }], [
      { name: "Site A", lat: 35, lon: -80 },
      { name: "Site A2", lat: 35.1, lon: -80.1 },
    ], now);
    const files = (await readZip(zip))!;
    const names = files.map((f) => f.name);
    expect(names).toEqual(["MANIFEST/manifest.xml", "hill-net.kmz", "rf-toolkit-hill-net-1/rf-toolkit-hill-net-1.cot", "rf-toolkit-hill-net-2/rf-toolkit-hill-net-2.cot"]);
    const manifest = text(files[0].data);
    expect(manifest).toContain('<MissionPackageManifest version="2">');
    expect(manifest).toContain('<Parameter name="name" value="Hill net"/>');
    expect(manifest).toContain('zipEntry="hill-net.kmz"');
    expect(manifest).toContain('zipEntry="rf-toolkit-hill-net-2/rf-toolkit-hill-net-2.cot"><Parameter name="uid" value="rf-toolkit-hill-net-2"/>');
    // Importing the package gives the markers back.
    expect(await importPoints("hill-net.zip", zip)).toEqual([
      { name: "Site A", lat: 35, lon: -80 },
      { name: "Site A2", lat: 35.1, lon: -80.1 },
    ]);
  });
});

describe("importing points", () => {
  it("reads named points from KML and skips lines", () => {
    const kml = buildKml("Plan", [{ name: "Tower & mast", lat: 35.5, lon: -80.5 }], [{ name: "Link", from: { lat: 35, lon: -80 }, to: { lat: 36, lon: -81 } }]);
    expect(pointsFromKml(kml)).toEqual([{ name: "Tower & mast", lat: 35.5, lon: -80.5 }]);
    expect(pointsFromKml("<Placemark><name>Bad</name><Point><coordinates>200,95,0</coordinates></Point></Placemark>")).toEqual([]);
  });

  it("reads units and map points from CoT, not shapes", () => {
    const xml = `<event type="a-f-G-U-C" uid="1"><point lat="34.1" lon="-79.2"/><detail><contact callsign="Team 2"/></detail></event>
      <event type="u-d-r" uid="2"><point lat="34" lon="-79"/></event>`;
    expect(pointsFromCot(xml)).toEqual([{ name: "Team 2", lat: 34.1, lon: -79.2 }]);
  });

  it("reads a deflated KMZ, and keeps repeated points once", async () => {
    const kml = buildKml("Plan", [
      { name: "North", lat: 35.33, lon: -80.8 },
      { name: "North", lat: 35.33, lon: -80.8 },
    ]);
    const kmz = await deflatedZip("doc.kml", kml);
    expect(await importPoints("plan.kmz", kmz)).toEqual([{ name: "North", lat: 35.33, lon: -80.8 }]);
    // A stored KMZ, as this app writes, reads too.
    expect(await importPoints("plan.kmz", buildZip([{ name: "doc.kml", data: new TextEncoder().encode(kml) }]))).toHaveLength(1);
  });

  it("ignores files that aren't map data", async () => {
    expect(await importPoints("notes.txt", new TextEncoder().encode("hello"))).toEqual([]);
    expect(await readZip(new Uint8Array([0x50, 0x4b, 1, 2]))).toBeUndefined();
  });
});
