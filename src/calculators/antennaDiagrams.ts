// Simple, not-to-scale drawings of each antenna type, with each part named
// and the calculated lengths on tags. Lengths arrive in the order the design
// lists its elements (see src/lib/antenna.ts).

import type { ElementLength } from "../lib/antenna";
import { formatFeetInches } from "../lib/units";

const W = 420;
const H = 250;

type Anchor = "start" | "middle" | "end";

/** A length in meters to two decimal places, or in centimeters below a meter. */
const metric = (m: number) => (m >= 1 ? `${m.toFixed(2)} m` : `${(m * 100).toFixed(1)} cm`);

/** A length on a rounded tag: feet and inches, then metric, kept inside the drawing. */
function tag(x: number, y: number, m: number, anchor: Anchor = "middle", prefix = ""): string {
  const main = formatFeetInches(m);
  const sub = metric(m);
  // Rough text widths: monospace 11.5px for the length, 10px for the rest.
  const w = (prefix ? prefix.length * 5.6 + 6 : 0) + main.length * 7 + 6 + sub.length * 5.6 + 18;
  let left = anchor === "middle" ? x - w / 2 : anchor === "start" ? x : x - w;
  left = Math.max(4, Math.min(W - 4 - w, left));
  return (
    `<g class="len"><rect x="${left}" y="${y - 10}" width="${w}" height="20" rx="10"/>` +
    `<text x="${left + 9}" y="${y + 4}">` +
    (prefix ? `<tspan class="len-sub">${prefix}</tspan><tspan class="len-main" dx="6">${main}</tspan>` : `<tspan class="len-main">${main}</tspan>`) +
    `<tspan class="len-sub" dx="6">${sub}</tspan></text></g>`
  );
}

/** A part's name, with an optional leader line to the part (ending in a dot). */
function part(x: number, y: number, text: string, anchor: Anchor = "middle", leader?: [number, number, number, number]): string {
  const line = leader
    ? `<line class="leader" x1="${leader[0]}" y1="${leader[1]}" x2="${leader[2]}" y2="${leader[3]}"/><circle class="leader-dot" cx="${leader[2]}" cy="${leader[3]}" r="2"/>`
    : "";
  return `${line}<text class="part" x="${x}" y="${y}" text-anchor="${anchor}">${text}</text>`;
}

/** A dimension line with arrowheads at both ends. */
const dim = (x1: number, y1: number, x2: number, y2: number) =>
  `<line class="dim" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-start="url(#arr)" marker-end="url(#arr)"/>`;

/** A wire, drawn along an SVG path. */
const wire = (d: string) => `<path class="wire" d="${d}"/>`;
/** Coax: a thick jacket with a thin core showing down the middle. */
const coax = (d: string) => `<path class="coax" d="${d}"/><path class="coax-core-line" d="${d}"/>`;
/** A small insulator centered on a point. */
const insulator = (x: number, y: number) => `<rect class="insulator" x="${x - 5}" y="${y - 4}" width="10" height="8" rx="3"/>`;
/** The feed point: a small box where the coax connects. */
const feed = (x: number, y: number, w = 14, h = 10) =>
  `<rect class="feed" x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="3"/>`;

/** A center-fed dipole; a full-wave one is drawn with ladder line, not coax. */
function dipole([leg, total]: ElementLength[], ladderLine = false): string {
  const feedLine = ladderLine
    ? `<path class="ladder" d="M205 117 V232 M215 117 V232"/>` +
      Array.from({ length: 8 }, (_, i) => `<line class="ladder" x1="205" x2="215" y1="${126 + i * 14}" y2="${126 + i * 14}"/>`).join("")
    : coax("M210 117 V232");
  return [
    wire("M50 110 H200 M220 110 H370"),
    insulator(50, 110),
    insulator(370, 110),
    feed(210, 110, 22, 13),
    feedLine,
    dim(50, 72, 200, 72),
    dim(220, 72, 370, 72),
    tag(125, 72, leg.lengthM),
    tag(295, 72, leg.lengthM),
    part(125, 101, "Leg"),
    part(295, 101, "Leg"),
    part(210, 40, "Feed point", "middle", [210, 46, 210, 103]),
    part(50, 146, "Insulator", "middle", [50, 136, 50, 115]),
    part(370, 146, "Insulator", "middle", [370, 136, 370, 115]),
    dim(50, 180, 370, 180),
    tag(300, 180, total.lengthM, "middle", "Total"),
    part(224, 226, ladderLine ? "Ladder line to tuner" : "Coax to radio", "start"),
  ].join("");
}

/** An end-fed half-wave: the radiator, the matching transformer at the fed end, and a short counterpoise. */
function efhw([radiator, counterpoise]: ElementLength[]): string {
  return [
    wire("M92 110 H375"),
    insulator(375, 110),
    `<rect class="feed" x="48" y="97" width="44" height="26" rx="4"/>`,
    `<text class="feed-text" x="70" y="114" text-anchor="middle">49:1</text>`,
    coax("M60 123 V232"),
    wire("M82 123 L150 190"),
    dim(92, 72, 375, 72),
    tag(234, 72, radiator.lengthM),
    part(234, 101, "Radiator"),
    part(70, 40, "Transformer", "middle", [70, 46, 70, 96]),
    part(375, 146, "Insulator", "middle", [375, 136, 375, 115]),
    tag(158, 196, counterpoise.lengthM, "start"),
    part(160, 222, "Counterpoise", "start"),
    part(72, 228, "Coax to radio", "start"),
  ].join("");
}

/** A vertical over radials (a ground plane), with a loading coil at the base for the 5/8-wave version. */
function vertical([radiator, radials]: ElementLength[], withCoil: boolean): string {
  const base = 170;
  const top = 26;
  const radiatorBottom = withCoil ? 140 : base;
  const coil = withCoil
    ? `<path class="wire coil" d="M210 ${base} l-7 -3 l14 -4 l-14 -4 l14 -4 l-14 -4 l14 -4 l-14 -4 l7 -3"/>`
    : "";
  const mid = (top + radiatorBottom) / 2;
  return [
    `<path class="radial back" d="M210 ${base} L160 ${base - 12} M210 ${base} L260 ${base - 12}"/>`,
    wire(`M210 ${radiatorBottom} V${top}`),
    coil,
    wire(`M210 ${base} L90 210 M210 ${base} L330 210`),
    feed(210, base + 2, 14, 9),
    coax(`M210 ${base + 7} V242`),
    dim(290, top, 290, radiatorBottom),
    tag(290, mid, radiator.lengthM),
    part(200, 64, "Radiator", "end"),
    withCoil ? part(222, 150, "Matching coil", "start") : "",
    part(196, 150, "Feed point", "end", [198, 153, 206, base - 2]),
    tag(100, 232, radials.lengthM),
    part(330, 230, `Radials ×${radials.count}`, "middle"),
    part(222, 240, "Coax to radio", "start"),
  ].join("");
}

/** A full-wave loop, drawn both as a square (a quad) and as a triangle (a delta), with the total wire length. */
function loop([total, square, triangle]: ElementLength[]): string {
  return [
    wire("M50 50 H170 V170 H50 Z"),
    feed(110, 170, 14, 9),
    coax("M110 175 V200"),
    tag(110, 28, square.lengthM, "middle", "Side"),
    part(110, 114, "Square / quad"),
    part(102, 214, "Coax to radio", "end"),
    wire("M315 50 L385 170 H245 Z"),
    feed(315, 170, 14, 9),
    coax("M315 175 V200"),
    tag(315, 28, triangle.lengthM, "middle", "Side"),
    part(315, 140, "Delta"),
    part(307, 214, "Coax to radio", "end"),
    part(210, 194, "Feed point", "middle", [181, 189, 118, 173]),
    `<line class="leader" x1="239" y1="189" x2="307" y2="173"/><circle class="leader-dot" cx="307" cy="173" r="2"/>`,
    tag(210, 236, total.lengthM, "middle", "Total wire"),
  ].join("");
}

/** A J-pole: the long radiator, the short matching stub beside it, and where the coax taps on. */
function jpole([long, short, tap]: ElementLength[]): string {
  const x = 220;
  const xs = 250;
  const bottom = 205;
  const top = 20;
  const shortTop = bottom - (bottom - top) / 3;
  const tapY = 188;
  // Coax comes up between the elements: shield to the long element, center
  // conductor to the stub, both at the tap height.
  return [
    coax(`M${(x + xs) / 2} 246 V${tapY + 4}`),
    wire(`M${x} ${top} V${bottom} H${xs} V${shortTop}`),
    `<path class="tap" d="M${x} ${tapY} H${xs}"/>`,
    `<circle class="feed" cx="${x}" cy="${tapY}" r="3.5"/><circle class="feed" cx="${xs}" cy="${tapY}" r="3.5"/>`,
    dim(150, top, 150, bottom),
    tag(142, (top + bottom) / 2, long.lengthM, "end"),
    part(230, 64, "Long element", "start"),
    dim(275, shortTop, 275, bottom),
    tag(283, shortTop + 10, short.lengthM, "start"),
    part(xs, shortTop - 10, "Stub"),
    dim(300, tapY, 300, bottom),
    tag(308, bottom + 2, tap.lengthM, "start"),
    part(212, tapY + 4, "Tap point", "end"),
    part(245, 240, "Coax to radio", "start"),
  ].join("");
}

/** Quarter-wave and half-wave coax stubs, measured inside the coax. */
function coaxStub([quarter, half]: ElementLength[]): string {
  // One stub: a connector and a length of coax with its core showing.
  const stub = (y: number, x2: number) =>
    `<rect class="connector" x="40" y="${y - 9}" width="22" height="18" rx="3"/>` +
    `<rect class="coax-body" x="62" y="${y - 6}" width="${x2 - 62}" height="12" rx="6"/>` +
    `<line class="coax-core" x1="62" y1="${y}" x2="${x2 - 4}" y2="${y}"/>`;
  return [
    stub(80, 200),
    dim(62, 56, 200, 56),
    tag(131, 56, quarter.lengthM),
    part(208, 84, "λ/4", "start"),
    part(51, 108, "Connector"),
    part(131, 104, "Coax"),
    stub(170, 360),
    dim(62, 146, 360, 146),
    tag(211, 146, half.lengthM),
    part(368, 174, "λ/2", "start"),
    `<text class="note-text" x="${W / 2}" y="214" text-anchor="middle">Length measured inside the coax</text>`,
  ].join("");
}

/** The drawing for an antenna design, with its lengths on tags, or nothing for a design without one. */
export function drawAntenna(designId: string, lengths: ElementLength[]): string {
  const body =
    designId === "dipole" ? dipole(lengths)
    : designId === "fullwave" ? dipole(lengths, true)
    : designId === "efhw" ? efhw(lengths)
    : designId === "groundplane" ? vertical(lengths, false)
    : designId === "fiveeighths" ? vertical(lengths, true)
    : designId === "loop" ? loop(lengths)
    : designId === "jpole" ? jpole(lengths)
    : designId === "coaxstub" ? coaxStub(lengths)
    : "";
  if (!body) return "";
  return `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Drawing of the antenna with its parts and lengths">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path class="arrow" d="M0 1 L10 5 L0 9 z"/>
        </marker>
        <pattern id="ant-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path class="grid" d="M20 0 H0 V20"/>
        </pattern>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#ant-grid)"/>
      ${body}
      <text class="scale-note" x="${W - 6}" y="14" text-anchor="end">not to scale</text>
    </svg>`;
}
