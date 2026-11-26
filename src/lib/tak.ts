// TAK data packages out, and map points in.
//
// A data package is a zip with MANIFEST/manifest.xml listing its contents.
// TAK clients (ATAK, WinTAK, iTAK) import it in one step: KML/KMZ files as
// overlays, and CoT (.cot) files as map markers. There's no public official
// spec; this follows the layout TAK clients export and community tools use.
//
// Import reads named points from KML, KMZ, CoT files and data packages, so
// sites marked in a TAK client don't have to be typed in again. Files are
// untrusted: only names and finite coordinates come out, with size limits.

import { type ExportPoint, buildZip, escapeXml } from "./export";
import type { LatLon } from "./geo";

/** A name for ids and file names: letters, digits and dashes. */
const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "plan";

/**
 * A CoT event for a plain spot marker. Ids come from the plan name and the
 * point's place in it, so importing a newer export of the same plan updates
 * those markers instead of adding copies.
 */
export function buildCot(p: ExportPoint, uid: string, now: Date = new Date()): string {
  const time = now.toISOString();
  // Markers this app makes are planning marks, not live positions: keep them a year.
  const stale = new Date(now.getTime() + 365 * 24 * 3600 * 1000).toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<event version="2.0" uid="${escapeXml(uid)}" type="b-m-p-s-m" time="${time}" start="${time}" stale="${stale}" how="h-g-i-g-o">
  <point lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}" hae="9999999.0" ce="9999999.0" le="9999999.0"/>
  <detail>
    <contact callsign="${escapeXml(p.name)}"/>
    <usericon iconsetpath="COT_MAPPING_SPOTMAP/b-m-p-s-m/-16711681"/>
    <color argb="-16711681"/>${p.description ? `\n    <remarks>${escapeXml(p.description)}</remarks>` : ""}
    <archive/>
  </detail>
</event>
`;
}

export interface PackageFile {
  name: string;
  data: Uint8Array;
}

/**
 * A TAK data package: the given files (a KMZ overlay, say) plus a CoT spot
 * marker for each point, and the manifest that lists them.
 */
export function buildDataPackage(name: string, files: PackageFile[], markers: ExportPoint[], now: Date = new Date()): Uint8Array {
  const base = slug(name);
  const encoder = new TextEncoder();
  const cots = markers.map((p, i) => {
    const uid = `rf-toolkit-${base}-${i + 1}`;
    return { uid, file: { name: `${uid}/${uid}.cot`, data: encoder.encode(buildCot(p, uid, now)) } };
  });
  const contents = [
    ...files.map((f) => `    <Content ignore="false" zipEntry="${escapeXml(f.name)}"/>`),
    ...cots.map((c) => `    <Content ignore="false" zipEntry="${escapeXml(c.file.name)}"><Parameter name="uid" value="${escapeXml(c.uid)}"/></Content>`),
  ];
  const manifest = `<MissionPackageManifest version="2">
  <Configuration>
    <Parameter name="uid" value="rf-toolkit-${base}"/>
    <Parameter name="name" value="${escapeXml(name)}"/>
    <Parameter name="onReceiveDelete" value="false"/>
  </Configuration>
  <Contents>
${contents.join("\n")}
  </Contents>
</MissionPackageManifest>
`;
  return buildZip([{ name: "MANIFEST/manifest.xml", data: encoder.encode(manifest) }, ...files, ...cots.map((c) => c.file)]);
}

// ------------------------------------------------------------ import

export interface ImportedPoint extends LatLon {
  name: string;
}

/** The largest file the import accepts. Callers check this before reading the file into memory. */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_ENTRY = 20 * 1024 * 1024;
const MAX_ENTRIES = 500;
const MAX_POINTS = 200;
/**
 * The most one import may decompress in total, across every file in a package
 * and any package inside it. Without it, a small crafted file could expand to
 * gigabytes and crash the page.
 */
const MAX_INFLATED_TOTAL = 40 * 1024 * 1024;

/** What is left of an import's decompression allowance, shared by nested packages. */
interface InflateBudget {
  bytesLeft: number;
}

/** The files in a zip (stored or deflated), or undefined if it isn't one. */
export async function readZip(bytes: Uint8Array, budget: InflateBudget = { bytesLeft: MAX_INFLATED_TOTAL }): Promise<PackageFile[] | undefined> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record is in the last 64 KB.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return undefined;
  const count = Math.min(view.getUint16(end + 10, true), MAX_ENTRIES);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const files: PackageFile[] = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || size > MAX_ENTRY || size > budget.bytesLeft || local + 30 > bytes.length) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + compressed);
    let data: Uint8Array | undefined;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflate(raw, size);
    if (!data) continue;
    budget.bytesLeft -= data.length;
    files.push({ name, data });
  }
  return files;
}

/**
 * Decompresses one zip entry. The entry states its own size, and decompression
 * stops as soon as the output passes it (with a little slack), so a file that
 * lies about its size can't fill memory. Undefined for a bad or oversized entry.
 */
async function inflate(raw: Uint8Array, expected: number): Promise<Uint8Array | undefined> {
  const limit = Math.max(expected, 1) * 1.01 + 16;
  try {
    const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  } catch {
    return undefined;
  }
}

/** The character for a numeric XML reference, or nothing when the number isn't a valid character. */
const fromCodePoint = (code: number) => (Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "");

/** XML text with the five standard entities and numeric ones decoded. */
function unescapeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Markup inside a name (HTML in a CDATA block, say) goes first. One pass of
// tag removal can leave a tag behind ("<<b>script>" becomes "script>", and
// other shapes leave "<script"), so any raw angle bracket still there is
// dropped too: in XML text a real "<" is always escaped. The entities are
// decoded last, so an escaped "<" in a name survives as text.
const cleanName = (s: string) =>
  unescapeXml(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, "").replace(/[<>]/g, ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
/** True when a latitude and longitude are real numbers inside their valid ranges. */
const validPoint = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/** Named points (Placemarks with a Point) from KML. Lines and areas are skipped. */
export function pointsFromKml(kml: string): ImportedPoint[] {
  const out: ImportedPoint[] = [];
  for (const m of kml.matchAll(/<Placemark\b[\s\S]*?<\/Placemark>/gi)) {
    const block = m[0];
    const point = /<Point\b[\s\S]*?<coordinates>\s*([^<]+?)\s*<\/coordinates>/i.exec(block);
    if (!point) continue;
    const [lon, lat] = point[1].split(/[\s,]+/).map(Number);
    if (!validPoint(lat, lon)) continue;
    const name = /<name>([\s\S]*?)<\/name>/i.exec(block);
    out.push({ name: name ? cleanName(name[1]) : "", lat, lon });
  }
  return out;
}

/** Points from CoT events: units (a-…) and map points (b-m-p…). Shapes and routes are skipped. */
export function pointsFromCot(xml: string): ImportedPoint[] {
  const out: ImportedPoint[] = [];
  for (const m of xml.matchAll(/<event\b([^>]*)>([\s\S]*?)<\/event>/gi)) {
    const type = /\btype="([^"]*)"/.exec(m[1])?.[1] ?? "";
    if (!type.startsWith("a-") && !type.startsWith("b-m-p")) continue;
    const point = /<point\b([^>]*)\/?>/i.exec(m[2]);
    if (!point) continue;
    const lat = Number(/\blat="([^"]*)"/.exec(point[1])?.[1]);
    const lon = Number(/\blon="([^"]*)"/.exec(point[1])?.[1]);
    if (!validPoint(lat, lon)) continue;
    const callsign = /<contact\b[^>]*\bcallsign="([^"]*)"/i.exec(m[2])?.[1];
    out.push({ name: callsign ? cleanName(callsign) : "", lat, lon });
  }
  return out;
}

/**
 * Named points from a file: KML, KMZ, a CoT file or a TAK data package (and
 * the KML, KMZ and CoT files inside it). Points that repeat are kept once.
 */
export async function importPoints(name: string, bytes: Uint8Array): Promise<ImportedPoint[]> {
  if (bytes.length > MAX_IMPORT_BYTES) return [];
  const points = await pointsIn(name, bytes, 0, { bytesLeft: MAX_INFLATED_TOTAL });
  const seen = new Set<string>();
  return points
    .filter((p) => {
      const key = `${p.name}|${p.lat.toFixed(6)}|${p.lon.toFixed(6)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_POINTS);
}

/**
 * The points in one file: from a zip (a KMZ or TAK data package), the points in
 * every map file inside it, one level of nesting deep; otherwise KML or CoT by
 * its content. Files of any other kind give no points.
 */
async function pointsIn(name: string, bytes: Uint8Array, depth: number, budget: InflateBudget): Promise<ImportedPoint[]> {
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip) {
    if (depth > 1) return [];
    const files = (await readZip(bytes, budget)) ?? [];
    const found: ImportedPoint[] = [];
    for (const f of files) {
      if (/\.(kml|kmz|cot|xml|zip)$/i.test(f.name) && !/manifest\.xml$/i.test(f.name)) found.push(...(await pointsIn(f.name, f.data, depth + 1, budget)));
    }
    return found;
  }
  const text = new TextDecoder().decode(bytes);
  if (/<kml\b/i.test(text) || /\.kml$/i.test(name)) return pointsFromKml(text);
  if (/<event\b/i.test(text)) return pointsFromCot(text);
  return [];
}
