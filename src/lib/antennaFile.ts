// Antenna pattern files in the MSI / Planet format, the format most antenna
// manufacturers publish: a few header lines (NAME, FREQUENCY, GAIN and so on),
// then a HORIZONTAL section and a VERTICAL section, each a list of
// "angle loss" pairs. The conventions, from the format's definition:
//
// - Losses are dB below the strongest direction, written without a minus sign.
// - Horizontal angles start at boresight (0°) and run clockwise, as on a compass.
// - Vertical angles start at the horizon (0°) and run downward: 90° points at
//   the ground and 270° at the sky. A downtilted antenna peaks a few degrees in.
// - GAIN is in dBd unless the file says dBi.
//
// Imported patterns are kept on the device (see patternLibrary.ts). Each gets an
// id that also names the closest built-in shape, so a plan shared to a device
// without the file still opens with a sensible stand-in.

import { dbdToDbi } from "./convert";
import type { PatternId } from "./pattern";

/** A pattern's two cuts: dB below the peak at each whole degree, 360 values each. */
export interface PatternTable {
  /** Horizontal cut, clockwise from boresight. */
  h: number[];
  /** Vertical cut, downward from the horizon. */
  v: number[];
}

export interface ImportedPattern extends PatternTable {
  id: string;
  name: string;
  /** The frequency the pattern was measured at, MHz, when the file says. */
  freqMhz?: number;
  /** Peak gain, dBi. */
  gainDbi: number;
}

/** The most patterns kept on one device. */
export const MAX_PATTERNS = 30;
const MAX_NAME = 40;
/** Deeper nulls than this are measurement noise for planning, so values are capped here. */
const MAX_LOSS_DB = 60;

const FILE_ID = /^file-(omni|sector120|sector90|sector60|directional)-[a-z0-9]{4,12}$/;

/** True for the id of an imported pattern (as opposed to a built-in shape). */
export const isFilePatternId = (id: string | undefined): id is string => typeof id === "string" && FILE_ID.test(id);

/** The built-in shape that stands in for an imported pattern this device doesn't have. */
export function fallbackOf(id: string): PatternId {
  return (FILE_ID.exec(id)?.[1] as PatternId | undefined) ?? "omni";
}

/**
 * The built-in shape closest to a horizontal cut, by its half-power width:
 * the number of degrees within 3 dB of the peak.
 */
export function closestShape(h: number[]): PatternId {
  const width = h.filter((loss) => loss <= 3).length;
  return width >= 300 ? "omni" : width >= 105 ? "sector120" : width >= 75 ? "sector90" : width >= 45 ? "sector60" : "directional";
}

/** A new id for an imported pattern, carrying its stand-in shape. */
export function newPatternId(h: number[]): string {
  return `file-${closestShape(h)}-${Math.floor(Math.random() * 36 ** 8).toString(36).padStart(8, "0")}`;
}

/**
 * Values at every whole degree from 0 to 359, from points at any angles,
 * by straight-line interpolation around the circle. Losses are made positive,
 * capped at MAX_LOSS_DB, and shifted so the smallest is 0 (the peak).
 */
function resample(points: [number, number][]): number[] {
  const sorted = points
    .map(([a, loss]): [number, number] => [((a % 360) + 360) % 360, Math.min(MAX_LOSS_DB, Math.abs(loss))])
    .sort((x, y) => x[0] - y[0]);
  const out: number[] = [];
  for (let d = 0; d < 360; d++) {
    // The points either side of this degree, wrapping past 359 back to 0.
    let i = sorted.findIndex(([a]) => a >= d);
    if (i < 0) i = sorted.length;
    const [a1, l1] = sorted[(i - 1 + sorted.length) % sorted.length];
    const [a2, l2] = sorted[i % sorted.length];
    const span = ((a2 - a1 + 360) % 360) || 360;
    const t = ((d - a1 + 360) % 360) / span;
    out.push(a1 === a2 ? l1 : l1 + (l2 - l1) * t);
  }
  const peak = Math.min(...out);
  return out.map((v) => Math.round((v - peak) * 100) / 100);
}

/** A number written with an optional unit, such as "14.5 dBd" or "1.92 GHz". */
function numberAndUnit(value: string): [number, string] {
  const m = /^([-+]?\d+(?:\.\d+)?)\s*([a-z]*)/i.exec(value.trim());
  return m ? [Number(m[1]), m[2].toLowerCase()] : [Number.NaN, ""];
}

/**
 * Reads an MSI / Planet pattern file. Returns the pattern, or a plain sentence
 * saying why the file can't be used.
 */
export function parseMsi(text: string, fileName = ""): ImportedPattern | string {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const header = new Map<string, string>();
  const sections: Record<"HORIZONTAL" | "VERTICAL", [number, number][]> = { HORIZONTAL: [], VERTICAL: [] };
  let section: "HORIZONTAL" | "VERTICAL" | undefined;
  for (const [n, line] of lines.entries()) {
    const [first, ...rest] = line.split(/\s+/);
    const key = first.toUpperCase();
    if (key === "HORIZONTAL" || key === "VERTICAL") {
      section = key;
      continue;
    }
    const nums = line.split(/[\s,;]+/).map(Number);
    if (section && nums.length >= 2 && nums.every(Number.isFinite)) {
      sections[section].push([nums[0], nums[1]]);
      continue;
    }
    // Some files leave out the NAME key and put the name alone on the first line.
    if (n === 0 && !/^[A-Z_]+$/.test(first)) header.set("NAME", line);
    else header.set(key, rest.join(" "));
  }
  if (sections.HORIZONTAL.length < 4 || sections.VERTICAL.length < 4) {
    return "That file isn't an MSI antenna pattern: it needs a HORIZONTAL and a VERTICAL section of angles and losses.";
  }
  const [gain, gainUnit] = numberAndUnit(header.get("GAIN") ?? "");
  if (!Number.isFinite(gain)) return "That pattern file has no usable GAIN line, so its gain is unknown.";
  const gainDbi = gainUnit === "dbi" ? gain : dbdToDbi(gain);
  if (gainDbi < -10 || gainDbi > 45) return "That pattern file's gain is outside what an antenna has.";
  const [freq, freqUnit] = numberAndUnit(header.get("FREQUENCY") ?? "");
  const freqMhz = freq > 0 ? (freqUnit === "ghz" ? freq * 1000 : freqUnit === "khz" ? freq / 1000 : freq) : undefined;
  const h = resample(sections.HORIZONTAL);
  const v = resample(sections.VERTICAL);
  const fromFile = fileName.replace(/\.[^.]*$/, "").trim();
  const name = (header.get("NAME") || header.get("MAKE") || fromFile || "Imported antenna").replace(/\s+/g, " ").slice(0, MAX_NAME);
  return { id: newPatternId(h), name, ...(freqMhz ? { freqMhz } : {}), gainDbi: Math.round(gainDbi * 100) / 100, h, v };
}

/** A cut from untrusted data: exactly 360 finite losses from 0 to MAX_LOSS_DB, or undefined. */
function cleanCut(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw) || raw.length !== 360) return undefined;
  return raw.every((x) => typeof x === "number" && x >= 0 && x <= MAX_LOSS_DB) ? (raw as number[]) : undefined;
}

/** Imported patterns from storage or an exported list: the valid ones, at most MAX_PATTERNS, ids unique. */
export function cleanPatterns(raw: unknown): ImportedPattern[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.slice(0, MAX_PATTERNS).flatMap((p): ImportedPattern[] => {
    const r = (p ?? {}) as Record<string, unknown>;
    const h = cleanCut(r.h);
    const v = cleanCut(r.v);
    const name = typeof r.name === "string" ? r.name.trim().slice(0, MAX_NAME) : "";
    const gainDbi = typeof r.gainDbi === "number" && r.gainDbi >= -10 && r.gainDbi <= 45 ? r.gainDbi : undefined;
    if (!h || !v || !name || gainDbi === undefined) return [];
    const id = isFilePatternId(r.id as string) && !seen.has(r.id as string) ? (r.id as string) : newPatternId(h);
    seen.add(id);
    const freqMhz = typeof r.freqMhz === "number" && r.freqMhz > 0 && r.freqMhz < 1e6 ? r.freqMhz : undefined;
    return [{ id, name, ...(freqMhz ? { freqMhz } : {}), gainDbi, h, v }];
  });
}
