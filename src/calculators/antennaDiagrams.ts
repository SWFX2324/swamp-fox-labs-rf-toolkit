// Simple, not-to-scale drawings of each antenna type, labelled with the
// calculated lengths. Lengths arrive in the order the design lists its
// elements (see src/lib/antenna.ts).

import type { ElementLength } from "../lib/antenna";
import { formatFeetInches } from "../lib/units";

const W = 340;
const H = 210;

const metric = (m: number) => (m >= 1 ? `${m.toFixed(2)} m` : `${(m * 100).toFixed(1)} cm`);

/** Two-line length label: feet and inches, then metric underneath. */
function label(x: number, y: number, m: number, anchor: "start" | "middle" | "end" = "middle"): string {
  return (
    `<text class="label" x="${x}" y="${y}" text-anchor="${anchor}">${formatFeetInches(m)}</text>` +
    `<text class="sub" x="${x}" y="${y + 12}" text-anchor="${anchor}">${metric(m)}</text>`
  );
}

/** A dimension line with arrowheads at both ends. */
function dim(x1: number, y1: number, x2: number, y2: number): string {
  return `<line class="dim" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-start="url(#arr)" marker-end="url(#arr)"/>`;
}

const wire = (d: string) => `<path class="wire" d="${d}"/>`;
const coax = (d: string) => `<path class="coax" d="${d}"/>`;
const insulator = (x: number, y: number) => `<circle class="insulator" cx="${x}" cy="${y}" r="3.5"/>`;
const feed = (x: number, y: number, w = 14, h = 10) =>
  `<rect class="feed" x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="2"/>`;
const note = (x: number, y: number, text: string, anchor: "start" | "middle" | "end" = "middle") =>
  `<text class="note-text" x="${x}" y="${y}" text-anchor="${anchor}">${text}</text>`;

/** A centre-fed dipole; a full-wave one is drawn with ladder line, not coax. */
function dipole([leg, total]: ElementLength[], ladderLine = false): string {
  const feedLine = ladderLine
    ? `<path class="ladder" d="M166 96 V175 M174 96 V175"/>` +
      Array.from({ length: 6 }, (_, i) => `<line class="ladder" x1="166" x2="174" y1="${104 + i * 13}" y2="${104 + i * 13}"/>`).join("")
    : coax("M170 96 V175");
  return [
    wire("M30 90 H160 M180 90 H310"),
    insulator(30, 90),
    insulator(310, 90),
    feed(170, 90, 20, 12),
    feedLine,
    dim(30, 62, 160, 62),
    dim(180, 62, 310, 62),
    label(95, 40, leg.lengthM),
    label(245, 40, leg.lengthM),
    dim(30, 122, 310, 122),
    label(245, 142, total.lengthM),
    note(180, 170, ladderLine ? "ladder line to tuner" : "coax to radio", "start"),
  ].join("");
}

function efhw([radiator, counterpoise]: ElementLength[]): string {
  return [
    wire("M50 90 H315"),
    insulator(315, 90),
    `<rect class="feed" x="22" y="80" width="28" height="20" rx="3"/>`,
    `<text class="feed-text" x="36" y="94" text-anchor="middle">49:1</text>`,
    coax("M30 100 V185"),
    wire("M44 100 L96 150"),
    dim(50, 62, 315, 62),
    label(182, 40, radiator.lengthM),
    label(102, 162, counterpoise.lengthM, "start"),
    note(102, 186, "counterpoise", "start"),
  ].join("");
}

function vertical([radiator, radials]: ElementLength[], withCoil: boolean): string {
  const top = withCoil ? 22 : 40;
  const coil = withCoil
    ? `<path class="wire coil" d="M170 150 l-6 -3 l12 -3 l-12 -3 l12 -3 l-12 -3 l12 -3 l-6 -3"/>`
    : "";
  const radiatorBottom = withCoil ? 129 : 150;
  return [
    `<path class="radial back" d="M170 150 L112 138 M170 150 L228 138"/>`,
    wire(`M170 ${radiatorBottom} V${top}`),
    coil,
    wire("M170 150 L70 180 M170 150 L270 180"),
    feed(170, 152, 12, 8),
    coax("M170 156 V205"),
    dim(205, top, 205, radiatorBottom),
    label(214, (top + radiatorBottom) / 2 - 2, radiator.lengthM, "start"),
    label(276, 174, radials.lengthM, "start"),
    note(276, 198, `radials ×${radials.count}`, "start"),
    withCoil ? note(160, 122, "matching coil", "end") : "",
  ].join("");
}

function loop([total, square, triangle]: ElementLength[]): string {
  return [
    wire("M40 45 H150 V155 H40 Z"),
    feed(95, 155, 12, 8),
    coax("M95 159 V180"),
    label(95, 26, square.lengthM),
    note(95, 100, "square / quad", "middle"),
    wire("M252 45 L312 155 H192 Z"),
    feed(252, 155, 12, 8),
    coax("M252 159 V180"),
    label(290, 84, triangle.lengthM, "start"),
    note(252, 128, "delta", "middle"),
    `<text class="label" x="${W / 2}" y="${H - 6}" text-anchor="middle">Total wire ${formatFeetInches(total.lengthM)} · ${metric(total.lengthM)}</text>`,
  ].join("");
}

function jpole([long, short, tap]: ElementLength[]): string {
  const bottom = 185;
  const top = 18;
  const shortTop = bottom - (bottom - top) / 3;
  const tapY = 170;
  // Coax comes up between the elements: shield to the long element, center
  // conductor to the stub, both at the tap height.
  return [
    coax(`M165 208 V${tapY + 4}`),
    wire(`M150 ${top} V${bottom} H180 V${shortTop}`),
    `<path class="tap" d="M150 ${tapY} H180"/>`,
    `<circle class="feed" cx="150" cy="${tapY}" r="3.5"/><circle class="feed" cx="180" cy="${tapY}" r="3.5"/>`,
    dim(128, top, 128, bottom),
    label(120, (top + bottom) / 2 - 2, long.lengthM, "end"),
    dim(205, shortTop, 205, bottom),
    label(212, shortTop + 18, short.lengthM, "start"),
    dim(232, tapY, 232, bottom),
    label(240, tapY + 12, tap.lengthM, "start"),
    note(120, 202, "coax", "end"),
  ].join("");
}

function coaxStub([quarter, half]: ElementLength[]): string {
  const stub = (y: number, x2: number) =>
    `<rect class="connector" x="38" y="${y - 9}" width="22" height="18" rx="3"/>` +
    `<rect class="coax-body" x="60" y="${y - 6}" width="${x2 - 60}" height="12" rx="6"/>` +
    `<line class="coax-core" x1="60" y1="${y}" x2="${x2 - 4}" y2="${y}"/>`;
  return [
    stub(70, 180),
    dim(60, 50, 180, 50),
    label(120, 28, quarter.lengthM),
    note(188, 74, "λ/4", "start"),
    stub(150, 300),
    dim(60, 130, 300, 130),
    label(180, 108, half.lengthM),
    note(180, 180, "λ/2 · length measured inside the coax", "middle"),
  ].join("");
}

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
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Drawing of the antenna with its lengths">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path class="arrow" d="M0 1 L10 5 L0 9 z"/>
        </marker>
      </defs>
      ${body}
      <text class="scale-note" x="${W - 4}" y="12" text-anchor="end">not to scale</text>
    </svg>`;
}
