// Plain-language charts for the Satellite Link results, made for anyone to
// read at a glance: how much rain each direction rides out, which modulation
// and FEC to use, and how carefully to point. HTML and SVG strings, coloured by
// CSS so they follow the theme.

import { type Modcod, GOOD_MARGIN_DB, allModcods, bitsPerSymbolNet } from "../lib/satLink";

const fmt = (v: number, digits = 1) =>
  `${v < 0 ? "−" : ""}${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/**
 * Rough rain loss on one leg, dB, for light, moderate and heavy rain at moderate
 * elevation, by band. A guide for the bars only: real rain loss depends on the
 * rain rate, elevation and climate, which aren't modelled.
 */
const RAIN_DB: Record<string, [number, number, number]> = {
  C: [0.1, 0.3, 0.8],
  X: [0.3, 1, 2.5],
  Ku: [1, 3, 6],
  Ka: [3, 8, 16],
};
const RAIN_WORDS = ["light", "moderate", "heavy"];

/** The heaviest rain a direction holds through, in words. */
function rainWord(at: number | undefined, tiers: [number, number, number]): string {
  if (at === undefined) return "Doesn't connect even in clear sky";
  let held = -1;
  tiers.forEach((t, i) => {
    if (at >= t) held = i;
  });
  if (held < 0) return "Drops in light rain";
  return held === 2 ? "Holds through heavy rain" : `Holds through ${RAIN_WORDS[held]} rain, drops in ${RAIN_WORDS[held + 1]}`;
}

/**
 * Two bars, return and forward, filled to how much rain each rides out, over
 * marks for light, moderate and heavy rain in this band.
 */
export function rainBars(band: string, retAt: number | undefined, fwdAt: number | undefined): string {
  const tiers = RAIN_DB[band] ?? RAIN_DB.Ku;
  const max = Math.max(tiers[2] * 1.35, (retAt ?? 0) * 1.1, (fwdAt ?? 0) * 1.1);
  const pct = (v: number) => `${Math.min(100, (v / max) * 100).toFixed(1)}%`;
  const ticks = tiers.map((t, i) => `<span class="rb-tick" style="left:${pct(t)}"><span>${RAIN_WORDS[i][0].toUpperCase()}${RAIN_WORDS[i].slice(1)}</span></span>`).join("");
  const bar = (name: string, cls: string, at: number | undefined) => `
    <div class="rb-row">
      <div class="rb-head"><b>${name}</b><span class="rb-word">${rainWord(at, tiers)}</span></div>
      <div class="rb-track">
        <div class="rb-fill ${cls}" style="width:${at === undefined ? "0%" : pct(at)}"></div>
        ${ticks}
      </div>
    </div>`;
  return `<div class="rain-bars">
    ${bar("Return", "rb-ret", retAt)}
    ${bar("Forward", "rb-fwd", fwdAt)}
  </div>`;
}

export interface ModcodView {
  /** Es/N0 the chosen direction delivers, dB. */
  esn0: number;
  implLossDb: number;
  symbolRate: number;
  selected: string;
  /** Chip filters; undefined shows all. */
  mod?: string;
  rate?: string;
}

/** Margin a MODCOD would have on this link, dB. */
export const modcodMargin = (m: Modcod, v: Pick<ModcodView, "esn0" | "implLossDb">) => v.esn0 - (m.esn0 + v.implLossDb);

/** The fastest setting that keeps a good margin, and the fastest that connects at all. */
export function bestModcods(v: Pick<ModcodView, "esn0" | "implLossDb">): { good?: Modcod; any?: Modcod } {
  const bySpeed = [...allModcods].sort((a, b) => bitsPerSymbolNet(b) - bitsPerSymbolNet(a));
  return {
    good: bySpeed.find((m) => modcodMargin(m, v) >= GOOD_MARGIN_DB),
    any: bySpeed.find((m) => modcodMargin(m, v) >= 0),
  };
}

const ratingOf = (mg: number) => (mg >= GOOD_MARGIN_DB ? ["Good", "s-good"] : mg >= 0 ? ["Marginal", "s-marginal"] : ["Won't connect", "s-fail"]);

/**
 * Every setting as a row, fastest first: its speed on your carrier as a bar, and
 * whether it works on your link. Tap a row to use it.
 */
export function modcodList(v: ModcodView): string {
  const rows = allModcods
    .filter((m) => (!v.mod || m.mod === v.mod) && (!v.rate || m.rate === v.rate))
    // Settings that work first, fastest at the top; the ones that don't, after.
    .sort((a, b) => Number(modcodMargin(b, v) >= 0) - Number(modcodMargin(a, v) >= 0) || bitsPerSymbolNet(b) - bitsPerSymbolNet(a));
  const fastest = Math.max(...allModcods.map(bitsPerSymbolNet));
  if (!rows.length) return `<p class="note">No setting matches those filters.</p>`;
  return `<div class="mc-list" role="listbox" aria-label="Modulation and FEC settings">${rows
    .map((m) => {
      const mg = modcodMargin(m, v);
      const [word, cls] = ratingOf(mg);
      const speed = (v.symbolRate * bitsPerSymbolNet(m)) / 1e6;
      const sel = m.name === v.selected;
      return `<button type="button" class="mc-row ${cls}${sel ? " sel" : ""}" data-modcod="${esc(m.name)}" role="option" aria-selected="${sel}">
        <span class="mc-name">${esc(m.name)}</span>
        <span class="mc-speed"><span class="mc-bar" style="width:${((bitsPerSymbolNet(m) / fastest) * 100).toFixed(1)}%"></span><span class="mc-mbps">${fmt(speed, 2)} Mbps</span></span>
        <span class="mc-spare">${mg >= 0 ? `+${fmt(mg)}` : fmt(mg)} dB</span>
        <span class="pill ${cls}">${word}</span>
      </button>`;
    })
    .join("")}</div>`;
}

/**
 * Dish aim in plain terms: how far off the satellite the dish is, what that
 * looks like at the dish's edge, and how much signal it costs, with the row
 * nearest your setting marked.
 */
export function aimTable(beamwidthDeg: number, dishM: number, errorDeg: number, youLossDb: number): string {
  const offFor = (lossDb: number) => beamwidthDeg * Math.sqrt(lossDb / 12);
  /** How far the dish's rim moves for an aim change, mm. */
  const rimMm = (deg: number) => (dishM / 2) * Math.tan((deg * Math.PI) / 180) * 1000;
  const mm = (deg: number) => {
    const v = rimMm(deg);
    return v < 1 ? "<1 mm" : `${fmt(v, v < 10 ? 1 : 0)} mm`;
  };
  const rows: [number, string, string][] = [
    [0, "Nothing", "aim-good"],
    [offFor(0.1), "Barely (0.1 dB)", "aim-good"],
    [offFor(0.5), "A little (0.5 dB)", "aim-ok"],
    [offFor(1.5), "Noticeable (1.5 dB)", "aim-poor"],
    [beamwidthDeg / 2, "Half (3 dB)", "aim-bad"],
  ];
  return `<div class="aim">
    <div class="aim-row aim-head"><span>Off by</span><span>Edge moves</span><span>Signal lost</span></div>
    ${rows
      .map(
        ([deg, lost, cls], k) =>
          `<div class="aim-row ${cls}"><span class="mono">${k === 0 ? "Dead on" : `${fmt(deg, 2)}°`}</span><span>${k === 0 ? "—" : mm(deg)}</span><span>${lost}</span></div>`,
      )
      .join("")}
    <p class="aim-you">You: <b>${fmt(errorDeg, 2)}° off</b> · ${fmt(rimMm(errorDeg), 1)} mm · <b>−${fmt(youLossDb, 1)} dB</b></p>
  </div>`;
}
