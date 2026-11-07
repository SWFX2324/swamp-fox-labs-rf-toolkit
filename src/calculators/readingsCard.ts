// Field readings card for the Coverage Map: log the signal your radio actually
// got at a spot, see it next to the map's prediction there, and optionally
// correct the map by the average error.

import * as L from "leaflet";
import type { LatLon } from "../lib/geo";
import { MIN_FOR_CORRECTION, errorStats, loadReadings, readingsCsv, sameSite, saveReadings, statsByCover } from "../lib/readings";
import { formatCoordinates } from "../lib/coords";
import { locateMe } from "./locate";
import { downloadFile } from "./planBar";

const CORRECT_KEY = "rf-toolkit:readings-correct";

export interface ReadingsHost {
  site(): LatLon | undefined;
  /** Predicted signal at a point from the current map, uncorrected, dBm; undefined if not mapped there. */
  predict(p: LatLon): number | undefined;
  /** What surrounds a point, an Environment profile name, when known. */
  coverAt(p: LatLon): string | undefined;
  map(): L.Map | undefined;
  /** The correction was switched on or off, or its value changed. */
  onCorrectionChange(): void;
}

export interface ReadingsCard {
  element: HTMLElement;
  /** Redraw predictions, errors and markers (after the map changes). */
  refresh(): void;
  /** dB to add to the map's margins; 0 unless switched on with enough readings. */
  correctionDb(): number;
  /** A map tap: true if it was taken to place a reading. */
  takeMapTap(p: LatLon): boolean;
}

const storage = {
  getItem: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // Storage blocked: readings last until the page closes.
    }
  },
};

const fmt = (v: number, digits = 1) =>
  v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace("-", "−");
const signed = (v: number) => `${v > 0 ? "+" : ""}${fmt(v)}`;

const template = `
  <div class="card-head"><h2>Field readings</h2><span class="meta" data-r="count"></span></div>
  <p class="note top">Log the signal strength your radio shows (RSSI, in dBm) at a spot. Each reading is set against what the map predicts there, so you can see how far off it runs on your ground. Readings stay on this device.</p>
  <div class="fields">
    <label>Measured signal
      <span class="input-unit">
        <input name="readingDbm" type="number" inputmode="decimal" step="any" max="0" placeholder="−95" />
        <span class="unit">dBm</span>
      </span>
    </label>
    <label>Note
      <input name="readingNote" type="text" autocomplete="off" maxlength="200" placeholder="Optional, e.g. car roof" />
    </label>
  </div>
  <div class="run-row">
    <button type="button" data-r="here">Log at my location</button>
    <button type="button" class="secondary" data-r="pick">Pick on map</button>
    <span class="note" data-r="status"></span>
  </div>
  <div data-r="body" hidden>
    <div class="tiles">
      <div class="tile"><span class="label">Average error</span><span class="value" data-r="mean"></span><span class="sub" data-r="meanSub"></span></div>
      <div class="tile"><span class="label">Spread</span><span class="value" data-r="sd"></span><span class="sub">Standard deviation</span></div>
    </div>
    <p class="note" data-r="groups" hidden></p>
    <label class="check"><input type="checkbox" data-r="correct" /> Correct the map by the average error</label>
    <div class="table-wrap">
      <table class="ledger readings">
        <thead><tr><th>#</th><th class="num">Measured</th><th class="num">Predicted</th><th class="num">Error</th><th>Cover</th><th></th></tr></thead>
        <tbody data-r="rows"></tbody>
      </table>
    </div>
    <p class="note" data-r="other" hidden></p>
    <div class="run-row">
      <button type="button" class="secondary" data-r="csv">Export CSV</button>
      <button type="button" class="secondary" data-r="clear">Clear this site's readings</button>
    </div>
  </div>
  <details class="about"><summary>About field readings</summary><p>Error is measured minus predicted: positive means the signal was stronger than the map expected, negative weaker. An average error near 0 dB with a spread of 6–8 dB is typical for a good propagation model. A steady offset usually means a setting is off (antenna gain, cable loss, the radio's real sensitivity, or the Environment); correcting the map shifts every point by the average. Take readings in the open, standing still, and average a few seconds of RSSI: one reading can swing 10 dB from fading alone. The prediction comes from the nearest point the map checked.</p></details>
`;

export function createReadingsCard(host: ReadingsHost): ReadingsCard {
  const card = document.createElement("section");
  card.className = "card readings-card";
  card.innerHTML = template;
  const el = <T extends HTMLElement = HTMLElement>(name: string) => card.querySelector<T>(`[data-r="${name}"]`)!;
  const dbm = card.querySelector<HTMLInputElement>('input[name="readingDbm"]')!;
  const note = card.querySelector<HTMLInputElement>('input[name="readingNote"]')!;
  const correct = el<HTMLInputElement>("correct");
  correct.checked = storage.getItem(CORRECT_KEY) === "1";

  // These inputs aren't plan settings: keep their events away from the page form.
  for (const input of [dbm, note, correct]) {
    for (const type of ["input", "change"]) input.addEventListener(type, (e) => e.stopPropagation());
  }

  let readings = loadReadings(storage);
  let picking = false;
  let markers: L.LayerGroup | undefined;
  let lastCorrection = 0;

  const setStatus = (text: string, warn = false) => {
    el("status").textContent = text;
    el("status").classList.toggle("warn", warn);
  };
  const setPicking = (on: boolean) => {
    picking = on;
    el("pick").textContent = on ? "Cancel" : "Pick on map";
    if (on) setStatus("Tap the spot on the map where you took the reading.");
  };

  const mine = () => {
    const site = host.site();
    return site ? readings.filter((r) => sameSite(r, site)) : [];
  };

  const correctionFor = (rows: { errorDb: number }[]) =>
    correct.checked && rows.length >= MIN_FOR_CORRECTION ? errorStats(rows.map((r) => r.errorDb)).meanDb : 0;

  const refresh = () => {
    const here = mine();
    const rows = here.map((reading, i) => {
      const predicted = host.predict(reading);
      return { reading, i, predicted, errorDb: predicted === undefined ? Number.NaN : reading.measuredDbm - predicted, cover: reading.cover };
    });
    const scored = rows.filter((r) => Number.isFinite(r.errorDb));
    el("count").textContent = here.length ? `${here.length} at this site` : "";
    el("body").hidden = here.length === 0;

    const s = errorStats(scored.map((r) => r.errorDb));
    el("mean").textContent = s.count ? `${signed(s.meanDb)} dB` : "—";
    el("meanSub").textContent = !s.count
      ? "Press Map coverage to compare"
      : Math.abs(s.meanDb) < 1
        ? `The map is about right (${s.count} compared)`
        : `The map runs ${s.meanDb > 0 ? "pessimistic" : "optimistic"} (${s.count} compared)`;
    el("sd").textContent = s.count > 1 ? `${fmt(s.sdDb)} dB` : "—";

    const groups = statsByCover(scored);
    el("groups").hidden = groups.length < 2;
    el("groups").textContent = `By cover: ${groups.map((g) => `${g.cover} ${signed(g.stats.meanDb)} dB (${g.stats.count})`).join("; ")}.`;

    correct.disabled = scored.length < MIN_FOR_CORRECTION;
    correct.parentElement!.title = correct.disabled ? `Needs ${MIN_FOR_CORRECTION} readings inside the mapped area` : "";

    const body = el("rows");
    body.replaceChildren(
      ...rows.map((r) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${r.i + 1}</td>
          <td class="num mono">${fmt(r.reading.measuredDbm)}</td>
          <td class="num mono">${r.predicted === undefined ? "—" : fmt(r.predicted)}</td>
          <td class="num mono">${Number.isFinite(r.errorDb) ? signed(r.errorDb) : "—"}</td>
          <td class="reading-cover"></td>
          <td><button type="button" class="secondary icon-btn" title="Remove reading" aria-label="Remove reading ${r.i + 1}">✕</button></td>`;
        // User text: set as text, not markup.
        tr.querySelector(".reading-cover")!.textContent = r.reading.cover ?? "";
        tr.title = [r.reading.note, formatCoordinates(r.reading), r.reading.takenAt ? new Date(r.reading.takenAt).toLocaleString() : ""].filter(Boolean).join(" · ");
        tr.querySelector("button")!.addEventListener("click", () => {
          readings = readings.filter((x) => x.id !== r.reading.id);
          saveReadings(storage, readings);
          refresh();
        });
        return tr;
      }),
    );

    const others = readings.length - here.length;
    el("other").hidden = others === 0;
    el("other").textContent = `${others} reading${others === 1 ? "" : "s"} from other sites ${others === 1 ? "is" : "are"} kept and included in the CSV.`;

    markers?.remove();
    const map = host.map();
    if (map) {
      markers = L.layerGroup(
        rows.map((r) =>
          L.circleMarker([r.reading.lat, r.reading.lon], { radius: 6, className: "reading-dot" }).bindTooltip(
            `#${r.i + 1}: ${fmt(r.reading.measuredDbm)} dBm${Number.isFinite(r.errorDb) ? `, ${signed(r.errorDb)} dB vs map` : ""}`,
          ),
        ),
      ).addTo(map);
    }

    const next = correctionFor(scored);
    if (next !== lastCorrection) {
      lastCorrection = next;
      host.onCorrectionChange();
    }
  };

  const log = (p: LatLon) => {
    const measured = Number.parseFloat(dbm.value);
    const site = host.site();
    if (!site) {
      setStatus("Place the site first.", true);
      return;
    }
    if (!Number.isFinite(measured) || measured > 0 || measured < -200) {
      setStatus("Enter the measured signal in dBm, such as −95.", true);
      return;
    }
    readings.push({
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      lat: p.lat,
      lon: p.lon,
      measuredDbm: measured,
      site: { lat: site.lat, lon: site.lon },
      ...(host.coverAt(p) ? { cover: host.coverAt(p) } : {}),
      note: note.value.trim(),
      takenAt: new Date().toISOString(),
    });
    saveReadings(storage, readings);
    dbm.value = "";
    note.value = "";
    const predicted = host.predict(p);
    setStatus(
      predicted === undefined
        ? "Logged. It's outside the mapped area, so press Map coverage (or widen the radius) to compare it."
        : `Logged: ${signed(measured - predicted)} dB against the map's ${fmt(predicted)} dBm.`,
    );
    refresh();
  };

  el("here").addEventListener("click", () => {
    setPicking(false);
    locateMe(setStatus, log);
  });
  el("pick").addEventListener("click", () => setPicking(!picking));
  correct.addEventListener("change", () => {
    storage.setItem(CORRECT_KEY, correct.checked ? "1" : "0");
    refresh();
  });
  el("csv").addEventListener("click", () => {
    const csv = readingsCsv(
      readings.map((reading) => {
        const site = host.site();
        return { reading, predictedDbm: site && sameSite(reading, site) ? host.predict(reading) : undefined };
      }),
    );
    downloadFile(`field-readings-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv");
  });
  el("clear").addEventListener("click", () => {
    const here = mine();
    if (!here.length || !confirm(`Delete all ${here.length} readings for this site? This can't be undone.`)) return;
    const ids = new Set(here.map((r) => r.id));
    readings = readings.filter((r) => !ids.has(r.id));
    saveReadings(storage, readings);
    setStatus("");
    refresh();
  });

  return {
    element: card,
    refresh,
    correctionDb: () => lastCorrection,
    takeMapTap(p) {
      if (!picking) return false;
      setPicking(false);
      log(p);
      return true;
    },
  };
}
