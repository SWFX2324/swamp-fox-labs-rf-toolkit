// Radio presets the user makes: the numbers for a radio and waveform they
// know, from their own datasheets. The app ships none, so it stays neutral
// about whose radio does what; getting the numbers right is the user's part.
//
// A preset can carry a rate ladder (the data rates a radio steps between, each
// with the signal it needs), a hop limit, and whether relays share one channel.
// From those, each link gets the fastest rate it holds, and each pair of nodes
// the best end-to-end throughput the mesh can carry between them.

export const RATE_UNITS = ["kbps", "Mbps"] as const;
export type RateUnit = (typeof RATE_UNITS)[number];

export interface RateStep {
  /** Data rate, in the preset's rate unit, as typed. */
  rate: string;
  /** The weakest signal that rate decodes at, dBm, as typed. */
  sens: string;
}

export interface RadioPreset {
  id: string;
  name: string;
  /** Optional: filled into the frequency field when picked. */
  freq?: string;
  freqUnit?: string;
  power?: string;
  powerUnit?: string;
  gain?: string;
  cable?: string;
  rateUnit: RateUnit;
  rates: RateStep[];
  /** Most hops a message may take; blank for no limit. */
  hopLimit?: string;
  /** True when every hop takes turns on one channel, so each hop costs airtime. */
  sharedChannel: boolean;
}

const MAX_PRESETS = 40;
const MAX_RATES = 16;
const MAX_TEXT = 40;
const MAX_NUMBER_TEXT = 12;

const str = (v: unknown, max = MAX_NUMBER_TEXT) => (typeof v === "string" ? v.slice(0, max) : undefined);
const numText = (v: unknown) => {
  const s = str(v);
  return s !== undefined && (s === "" || Number.isFinite(Number(s))) ? s : undefined;
};

/** A preset from untrusted data (storage, a file, a shared link), or undefined if it isn't one. */
export function cleanPreset(raw: unknown): RadioPreset | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const name = str(r.name, MAX_TEXT)?.trim();
  if (!name) return undefined;
  const rates = (Array.isArray(r.rates) ? r.rates : [])
    .slice(0, MAX_RATES)
    .flatMap((s): RateStep[] => {
      const rate = numText((s as Record<string, unknown>)?.rate);
      const sens = numText((s as Record<string, unknown>)?.sens);
      return rate !== undefined && sens !== undefined && rate !== "" && sens !== "" ? [{ rate, sens }] : [];
    });
  const out: RadioPreset = {
    id: typeof r.id === "string" && /^[a-z0-9-]{1,40}$/.test(r.id) ? r.id : newPresetId(),
    name,
    rateUnit: RATE_UNITS.find((u) => u === r.rateUnit) ?? "kbps",
    rates,
    sharedChannel: r.sharedChannel !== false,
  };
  for (const k of ["freq", "power", "gain", "cable", "hopLimit"] as const) {
    const v = numText(r[k]);
    if (v) out[k] = v;
  }
  for (const k of ["freqUnit", "powerUnit"] as const) {
    const v = str(r[k], 4);
    if (v && /^[a-zA-Z]+$/.test(v)) out[k] = v;
  }
  return out;
}

export function newPresetId(): string {
  return `p-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Presets from stored or imported JSON: the valid ones, ids made unique. */
export function cleanPresets(raw: unknown): RadioPreset[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  return list.slice(0, MAX_PRESETS).flatMap((p) => {
    const c = cleanPreset(p);
    if (!c) return [];
    if (seen.has(c.id)) c.id = newPresetId();
    seen.add(c.id);
    return [c];
  });
}

/** Two presets that say the same thing, ignoring their ids. */
export function samePreset(a: RadioPreset, b: RadioPreset): boolean {
  const strip = ({ id: _id, ...rest }: RadioPreset) => JSON.stringify(rest);
  return strip(a) === strip(b);
}

/** A ladder step ready for the math: rate in kbps and the sensitivity it needs, dBm. */
export interface Rung {
  kbps: number;
  sensDbm: number;
}

/**
 * The preset's ladder as numbers, fastest first. `derate` turns a typed
 * sensitivity into the one to plan with (Settings' derating).
 */
export function ladder(p: RadioPreset | undefined, derate: (dbm: number) => number = (x) => x): Rung[] {
  if (!p) return [];
  const scale = p.rateUnit === "Mbps" ? 1000 : 1;
  return p.rates
    .map((s) => ({ kbps: Number(s.rate) * scale, sensDbm: derate(Number(s.sens)) }))
    .filter((r) => r.kbps > 0 && Number.isFinite(r.sensDbm))
    .sort((a, b) => b.kbps - a.kbps || a.sensDbm - b.sensDbm);
}

/** The hop limit as a number, or undefined for none. */
export function hopLimit(p: RadioPreset | undefined): number | undefined {
  const n = Math.floor(Number(p?.hopLimit));
  return n >= 1 ? n : undefined;
}

export interface LinkRate {
  /** Fastest rate that keeps the fade margin, if any. */
  solid?: Rung;
  /** Fastest rate that decodes at all (may be under the fade margin), if any. */
  any?: Rung;
}

/** The rates a link holds at this received level, in its weaker direction. */
export function rateAt(rslDbm: number, rungs: Rung[], fadeMarginDb: number): LinkRate {
  return {
    solid: rungs.find((r) => rslDbm - r.sensDbm >= fadeMarginDb),
    any: rungs.find((r) => rslDbm - r.sensDbm >= 0),
  };
}

export interface Route {
  /** End-to-end throughput, kbps. */
  kbps: number;
  hops: number;
}

/**
 * The best route between every pair of nodes, using only the given links (each
 * with the rate it holds) and at most `maxHops` hops.
 *
 * On a shared channel every hop takes turns on the air, so a message's time on
 * the air adds up hop by hop: throughput is 1 / Σ(1/rate). Otherwise relays
 * forward at once and the slowest hop sets the pace: throughput is min(rate).
 * Both ignore protocol overhead and other traffic, so real throughput is lower.
 */
export function bestRoutes(
  n: number,
  links: { a: number; b: number; kbps: number }[],
  maxHops: number = n - 1,
  sharedChannel = true,
): (Route | undefined)[][] {
  const hopsAllowed = Math.max(1, Math.min(maxHops, Math.max(1, n - 1)));
  // Bellman-Ford limited to k edges: best[k][s][t] after k rounds.
  // Shared channel: minimise total airtime per kbit (Σ 1/rate).
  // Separate channels: maximise the bottleneck rate.
  type Cell = { score: number; hops: number } | undefined;
  const better = (x: number, y: number) => (sharedChannel ? x < y : x > y);
  const combine = (path: number, edge: number) => (sharedChannel ? path + 1 / edge : Math.min(path, edge));
  const start = sharedChannel ? 0 : Number.POSITIVE_INFINITY;
  const result: (Route | undefined)[][] = [];
  for (let s = 0; s < n; s++) {
    let cur: Cell[] = Array.from({ length: n }, (_, i) => (i === s ? { score: start, hops: 0 } : undefined));
    const best: Cell[] = [...cur];
    for (let k = 0; k < hopsAllowed; k++) {
      const next: Cell[] = [...cur];
      for (const { a, b, kbps } of links) {
        if (!(kbps > 0)) continue;
        for (const [u, v] of [
          [a, b],
          [b, a],
        ]) {
          const from = cur[u];
          if (!from) continue;
          const score = combine(from.score, kbps);
          const there = next[v];
          if (!there || better(score, there.score) || (score === there.score && from.hops + 1 < there.hops)) {
            next[v] = { score, hops: from.hops + 1 };
          }
        }
      }
      cur = next;
      for (let i = 0; i < n; i++) {
        const c = cur[i];
        const b = best[i];
        if (c && (!b || better(c.score, b.score) || (c.score === b.score && c.hops < b.hops))) best[i] = c;
      }
    }
    result.push(
      best.map((c, t) => {
        if (!c || t === s) return undefined;
        const kbps = sharedChannel ? 1 / c.score : c.score;
        return Number.isFinite(kbps) && kbps > 0 ? { kbps, hops: c.hops } : undefined;
      }),
    );
  }
  return result;
}

/** A rate for people: kbps under 1000, Mbps above, to three significant figures. */
export function formatRate(kbps: number): string {
  const [v, unit] = kbps >= 1000 ? [kbps / 1000, "Mbps"] : [kbps, "kbps"];
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${Number(v.toFixed(digits)).toLocaleString()} ${unit}`;
}
