// Export plans for TAK and mapping apps: KML for pins and link lines, and KMZ
// (a zip holding KML plus an image) for a coverage overlay. Both import into
// ATAK, WinTAK and Google Earth.

import type { LatLon } from "./geo";

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface ExportPoint extends LatLon {
  name: string;
  description?: string;
}

export interface ExportLine {
  name: string;
  from: LatLon;
  to: LatLon;
  /** Style: solid, marginal or none. */
  status: "good" | "marginal" | "fail";
  description?: string;
}

// KML colours are aabbggrr.
const lineStyles: Record<ExportLine["status"], string> = {
  good: "ff0ca30c",
  marginal: "ff19b2fa",
  fail: "803b3bd0",
};

/** A point style using an icon inside the KMZ, so it shows offline; the icon's base marks the point. */
const iconStyle = (id: string, iconFile: string, scale: number) =>
  `    <Style id="${id}"><IconStyle><scale>${scale}</scale><Icon><href>${escapeXml(iconFile)}</href></Icon><hotSpot x="0.5" y="0" xunits="fraction" yunits="fraction"/></IconStyle></Style>`;

const coordinate = (p: LatLon) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)},0`;

function placemark(name: string, description: string | undefined, geometry: string, style?: string): string {
  return `    <Placemark>
      <name>${escapeXml(name)}</name>${description ? `\n      <description>${escapeXml(description)}</description>` : ""}${style ? `\n      <styleUrl>#${style}</styleUrl>` : ""}
      ${geometry}
    </Placemark>`;
}

/** A KML document of named points and rated link lines. */
export function buildKml(title: string, points: ExportPoint[], lines: ExportLine[] = [], iconFile?: string): string {
  const styles = Object.entries(lineStyles)
    .map(([id, colour]) => `    <Style id="${id}"><LineStyle><color>${colour}</color><width>${id === "fail" ? 1 : 3}</width></LineStyle></Style>`)
    .concat(iconFile ? [iconStyle("node", iconFile, 0.9)] : [])
    .join("\n");
  const body = [
    ...lines.map((l) =>
      placemark(l.name, l.description, `<LineString><tessellate>1</tessellate><coordinates>${coordinate(l.from)} ${coordinate(l.to)}</coordinates></LineString>`, l.status),
    ),
    ...points.map((p) => placemark(p.name, p.description, `<Point><coordinates>${coordinate(p)}</coordinates></Point>`, iconFile ? "node" : undefined)),
  ].join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(title)}</name>
${styles}
${body}
  </Document>
</kml>
`;
}

export interface OverlayBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

/** KML that drapes an image file over the map, plus optional points. */
export function buildOverlayKml(title: string, imageFile: string, bounds: OverlayBounds, points: ExportPoint[] = [], iconFile?: string): string {
  const overlay = `    <GroundOverlay>
      <name>${escapeXml(title)}</name>
      <Icon><href>${escapeXml(imageFile)}</href></Icon>
      <LatLonBox>
        <north>${bounds.north.toFixed(6)}</north>
        <south>${bounds.south.toFixed(6)}</south>
        <east>${bounds.east.toFixed(6)}</east>
        <west>${bounds.west.toFixed(6)}</west>
      </LatLonBox>
    </GroundOverlay>`;
  const marks = points.map((p) => placemark(p.name, p.description, `<Point><coordinates>${coordinate(p)}</coordinates></Point>`, iconFile ? "site" : undefined));
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(title)}</name>
${[...(iconFile ? [iconStyle("site", iconFile, 1.2)] : []), overlay, ...marks].join("\n")}
  </Document>
</kml>
`;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A minimal zip with stored (uncompressed) files, which is all KMZ needs. */
export function buildZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const header = (size: number) => {
      const bytes = new Uint8Array(size);
      return { bytes, view: new DataView(bytes.buffer) };
    };
    // Fields shared by the local and central records, starting at "version needed".
    const common = (view: DataView, at: number) => {
      view.setUint16(at, 20, true); // version needed
      view.setUint16(at + 2, 0x0800, true); // UTF-8 names
      view.setUint16(at + 4, 0, true); // stored
      view.setUint16(at + 6, 0, true); // time
      view.setUint16(at + 8, 0x21, true); // date: 1980-01-01
      view.setUint32(at + 10, crc, true);
      view.setUint32(at + 14, file.data.length, true);
      view.setUint32(at + 18, file.data.length, true);
      view.setUint16(at + 22, name.length, true);
    };
    const local = header(30);
    local.view.setUint32(0, 0x04034b50, true);
    common(local.view, 4);
    locals.push(local.bytes, name, file.data);

    const central = header(46);
    central.view.setUint32(0, 0x02014b50, true);
    central.view.setUint16(4, 20, true); // version made by
    common(central.view, 6);
    central.view.setUint32(42, offset, true);
    centrals.push(central.bytes, name);

    offset += 30 + name.length + file.data.length;
  }
  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((sum, b) => sum + b.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A safe file name from a plan's name. */
export function fileName(name: string, extension: string): string {
  const base = name.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "rf-toolkit";
  return `${base}.${extension}`;
}
