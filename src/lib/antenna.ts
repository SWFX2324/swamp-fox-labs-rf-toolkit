// Antenna element lengths. Each element is a fraction of the free-space
// wavelength, times a factor for how much shorter (or longer) a real
// conductor resonates:
//
//   length = fraction × (c / f) × factor
//
// The default factors reproduce the familiar ARRL rules of thumb:
//   0.95  → 468/f ft for a half-wave dipole, 234/f ft for a quarter wave
//   1.02  → 1005/f ft for a full-wave loop
// They depend on conductor thickness and surroundings, so cut a little long
// and trim to resonance.

import { wavelengthM } from "./fspl";

export interface ElementSpec {
  name: string;
  /** Fraction of a free-space wavelength. */
  fraction: number;
  /** How many of this element the antenna has. */
  count?: number;
  /** False for parts not scaled by the factor, like ground-plane radials. */
  scaled?: boolean;
  note?: string;
}

export interface AntennaDesign {
  id: string;
  name: string;
  factorLabel: string;
  defaultFactor: number;
  elements: ElementSpec[];
  /** Typical feed-point impedance and how to match it. */
  feed: string;
  notes: string[];
}

export const designs: AntennaDesign[] = [
  {
    id: "dipole",
    name: "Half-wave dipole",
    factorLabel: "Shortening factor",
    defaultFactor: 0.95,
    elements: [
      { name: "Each leg", fraction: 0.25, count: 2 },
      { name: "Total length", fraction: 0.5 },
    ],
    feed: "About 50–75 Ω (73 Ω in free space). Feed with 50 Ω coax through a 1:1 choke or balun.",
    notes: ["Raising or lowering the ends into an inverted V lowers the impedance closer to 50 Ω."],
  },
  {
    id: "fullwave",
    name: "Full-wave dipole",
    factorLabel: "Shortening factor",
    defaultFactor: 0.95,
    elements: [
      { name: "Each leg", fraction: 0.5, count: 2 },
      { name: "Total length", fraction: 1 },
    ],
    feed: "Several thousand ohms at the centre, not 50 Ω. Feed with ladder line to a tuner, or a quarter-wave matching section.",
    notes: [
      "The pattern splits into two main lobes broadside to the wire, with about 1.8 dB more gain than a half-wave dipole.",
      "Stretching each leg to 0.64 λ makes an extended double Zepp, with a little more gain and an easier feed impedance.",
    ],
  },
  {
    id: "efhw",
    name: "End-fed half-wave",
    factorLabel: "Shortening factor",
    defaultFactor: 0.95,
    elements: [
      { name: "Radiator", fraction: 0.5 },
      { name: "Counterpoise (typical)", fraction: 0.05, scaled: false },
    ],
    feed: "2,000–5,000 Ω at the end. Needs a 49:1 or 64:1 transformer (unun).",
    notes: [
      "Many builds use the coax shield as the counterpoise; a short wire like this one is a common starting point.",
      "A half-wave on one band is also resonant on its even harmonics, which is why EFHWs work multiband.",
    ],
  },
  {
    id: "groundplane",
    name: "Quarter-wave ground plane",
    factorLabel: "Shortening factor",
    defaultFactor: 0.95,
    elements: [
      { name: "Radiator", fraction: 0.25 },
      { name: "Radials", fraction: 0.25, count: 4, scaled: false },
    ],
    feed: "About 36 Ω with flat radials, close to 50 Ω with radials drooped 30–45°.",
    notes: ["Radials are cut to a full quarter wave (246/f ft), about 5% longer than the radiator."],
  },
  {
    id: "fiveeighths",
    name: "5/8-wave vertical",
    factorLabel: "Shortening factor",
    defaultFactor: 0.95,
    elements: [
      { name: "Radiator", fraction: 0.625 },
      { name: "Radials", fraction: 0.25, count: 4, scaled: false },
    ],
    feed: "Not 50 Ω on its own. Needs a base matching coil or network.",
    notes: ["Gives about 3 dB more gain toward the horizon than a quarter wave."],
  },
  {
    id: "loop",
    name: "Full-wave loop",
    factorLabel: "Lengthening factor",
    defaultFactor: 1.02,
    elements: [
      { name: "Total wire", fraction: 1 },
      { name: "Each side (square / quad)", fraction: 0.25, count: 4 },
      { name: "Each side (triangle / delta)", fraction: 1 / 3, count: 3 },
    ],
    feed: "About 100–120 Ω. Use a 2:1 balun, or a quarter-wave section of 75 Ω coax.",
    notes: ["Loops resonate slightly longer than a wavelength, hence a factor above 1."],
  },
  {
    id: "jpole",
    name: "J-pole",
    factorLabel: "Shortening factor",
    defaultFactor: 0.95,
    elements: [
      { name: "Long element", fraction: 0.75, note: "Half-wave radiator on top of the stub" },
      { name: "Short element (stub)", fraction: 0.25 },
      { name: "Feed tap from the bottom", fraction: 0.02, note: "Starting point; slide it for lowest SWR" },
    ],
    feed: "Matched to 50 Ω by where the coax taps onto the stub.",
    notes: ["Keep the gap between the elements small, about 1–2 inches on 2 m and 70 cm."],
  },
  {
    id: "coaxstub",
    name: "Coax quarter-wave stub",
    factorLabel: "Velocity factor",
    defaultFactor: 0.66,
    elements: [
      { name: "Quarter wave", fraction: 0.25 },
      { name: "Half wave", fraction: 0.5 },
    ],
    feed: "Cut coax for matching sections, phasing lines and band-stop stubs.",
    notes: [
      "Pick the cable to fill in its velocity factor; the length is the electrical length inside the coax.",
      "Measure from the connector's reference plane, and check with an antenna analyzer if you have one.",
    ],
  },
];

export function findDesign(id: string): AntennaDesign | undefined {
  return designs.find((d) => d.id === id);
}

export interface ElementLength {
  name: string;
  count: number;
  lengthM: number;
  note?: string;
}

export function elementLengths(design: AntennaDesign, freqHz: number, factor: number): ElementLength[] {
  if (!(freqHz > 0)) throw new RangeError("Frequency must be above zero");
  if (!(factor > 0)) throw new RangeError("The factor must be above zero");
  const lambda = wavelengthM(freqHz);
  return design.elements.map((e) => ({
    name: e.name,
    count: e.count ?? 1,
    lengthM: e.fraction * lambda * (e.scaled === false ? 1 : factor),
    note: e.note,
  }));
}

export interface BandPreset {
  label: string;
  mhz: number;
}

/** Common frequencies for quick picks, mostly US amateur and personal radio. */
export const bandPresets: BandPreset[] = [
  { label: "80 m", mhz: 3.8 },
  { label: "40 m", mhz: 7.15 },
  { label: "20 m", mhz: 14.2 },
  { label: "10 m", mhz: 28.4 },
  { label: "6 m", mhz: 50.125 },
  { label: "2 m", mhz: 146.52 },
  { label: "MURS", mhz: 151.82 },
  { label: "1.25 m", mhz: 223.5 },
  { label: "70 cm", mhz: 446 },
  { label: "GMRS", mhz: 462.6 },
  { label: "915 MHz", mhz: 915 },
  { label: "2.4 GHz", mhz: 2440 },
];
