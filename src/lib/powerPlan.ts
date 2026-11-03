// Power plan: each item's draw from its data plate (watts, or volts × amps),
// times how many of it, summed into the load a generator has to carry, and
// the smallest AMMPS set that carries it inside a planning limit.

export interface PowerItem {
  name: string;
  qty: number;
  /** Data plate watts. When set, volts and amps are ignored. */
  watts?: number;
  volts?: number;
  amps?: number;
  ac: boolean;
  /** AC only: real power ÷ apparent power, 0–1. DC is always 1. */
  powerFactor: number;
}

export interface ItemLoad {
  /** Real power for one of the item, W. */
  watts: number;
  /** Apparent power for one, VA. Equal to watts for DC or a power factor of 1. */
  va: number;
}

const positive = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v) && v > 0;

/** One item's draw, or undefined until it has watts or both volts and amps. */
export function itemLoad(item: PowerItem): ItemLoad | undefined {
  const pf = item.ac && item.powerFactor > 0 && item.powerFactor <= 1 ? item.powerFactor : 1;
  if (positive(item.watts)) return { watts: item.watts, va: item.watts / pf };
  if (positive(item.volts) && positive(item.amps)) {
    const va = item.volts * item.amps;
    return { watts: va * pf, va };
  }
  return undefined;
}

export interface PlanTotals {
  watts: number;
  va: number;
  /** Items with a usable load and a quantity above zero. */
  counted: number;
}

export function planTotals(items: PowerItem[]): PlanTotals {
  let watts = 0;
  let va = 0;
  let counted = 0;
  for (const item of items) {
    const load = itemLoad(item);
    if (!load || !positive(item.qty)) continue;
    watts += load.watts * item.qty;
    va += load.va * item.qty;
    counted++;
  }
  return { watts, va, counted };
}

/** AMMPS generator sets, rated in kW at 0.8 power factor. */
export const AMMPS_POWER_FACTOR = 0.8;
export const ammpsSets = [
  { model: "MEP-1030", kw: 5 },
  { model: "MEP-1040", kw: 10 },
  { model: "MEP-1050", kw: 15 },
  { model: "MEP-1060", kw: 30 },
  { model: "MEP-1070", kw: 60 },
] as const;

export type AmmpsSet = (typeof ammpsSets)[number];

/** Share of a set's rating a load uses, by real power or apparent power, whichever is higher. */
export function loadFraction(totals: Pick<PlanTotals, "watts" | "va">, set: AmmpsSet, count = 1): number {
  const kw = set.kw * count * 1000;
  return Math.max(totals.watts / kw, totals.va / (kw / AMMPS_POWER_FACTOR));
}

export interface Recommendation {
  set: AmmpsSet;
  count: number;
  /** Load as a share of the set's (or sets') rating. */
  fraction: number;
}

/**
 * The smallest single AMMPS set that keeps the load at or under the limit
 * (0.8 for 80%). Past the largest set, the fewest 60 kW sets that do.
 */
export function recommendGenerator(totals: Pick<PlanTotals, "watts" | "va">, limit: number): Recommendation | undefined {
  if (!(totals.watts > 0) || !(limit > 0)) return undefined;
  for (const set of ammpsSets) {
    const fraction = loadFraction(totals, set);
    if (fraction <= limit) return { set, count: 1, fraction };
  }
  const largest = ammpsSets[ammpsSets.length - 1];
  const count = Math.ceil(loadFraction(totals, largest) / limit);
  return { set: largest, count, fraction: loadFraction(totals, largest, count) };
}

/** A CSV cell: quoted when needed, and never read by a spreadsheet as a formula. */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text) && typeof value === "string") text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const round = (v: number, digits = 0) => Number(v.toFixed(digits));

/** The plan as CSV, one row per item and the totals underneath, for Excel. */
export function planCsv(items: PowerItem[], limit: number): string {
  const rows: (string | number)[][] = [["Item", "Qty", "Volts", "Amps", "AC/DC", "Power factor", "Watts each", "Total watts"]];
  for (const item of items) {
    const load = itemLoad(item);
    if (!load && !item.name.trim()) continue;
    rows.push([
      item.name.trim(),
      positive(item.qty) ? item.qty : 0,
      positive(item.volts) ? item.volts : "",
      positive(item.amps) ? item.amps : "",
      item.ac ? "AC" : "DC",
      item.ac ? item.powerFactor : "",
      load ? round(load.watts, 1) : "",
      load && positive(item.qty) ? round(load.watts * item.qty, 1) : "",
    ]);
  }
  const totals = planTotals(items);
  const rec = recommendGenerator(totals, limit);
  rows.push(
    [],
    ["Total load (W)", round(totals.watts)],
    ["Total apparent power (VA)", round(totals.va)],
    ["Planning limit", `${round(limit * 100)}% of rating`],
    ["Recommended AMMPS", rec ? `${rec.count > 1 ? `${rec.count} x ` : ""}${rec.set.kw} kW ${rec.set.model}` : ""],
    ["Load on generator", rec ? `${round(rec.fraction * 100)}%` : ""],
  );
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
