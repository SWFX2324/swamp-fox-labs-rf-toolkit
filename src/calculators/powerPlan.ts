// Power Plan: list the gear, its data plate watts (or volts and amps) and how
// many of each, and get the total load and the generator size to carry it.

import { enhanceFields } from "./fieldHelp";
import { powerGuide } from "./helpText";
import type { Calculator } from ".";
import { downloadFile } from "./planBar";
import { fileName } from "../lib/export";
import {
  type EquipmentProfile,
  type PowerItem,
  generatorSizes,
  cleanPowerItem,
  cleanProfiles,
  itemLoad,
  loadFraction,
  planCsv,
  planTotals,
  recommendGenerator,
  removeProfile,
  saveProfile,
} from "../lib/powerPlan";

const STORAGE_KEY = "rf-toolkit:power-plan";
const EQUIPMENT_KEY = "rf-toolkit:power-equipment";
const MAX_ITEMS = 100;

const defaults: Record<string, string> = { limit: "80" };

const blankItem = (): PowerItem => ({ name: "", qty: 1, ac: true, powerFactor: 1 });
const isBlank = (it: PowerItem) => !it.name.trim() && !it.watts && !it.volts && !it.amps;

const BOOKMARK =
  '<svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>';

const template = `
  <div class="inputs">
    <section class="card power-equipment">
      <div class="card-head"><h2>Equipment</h2><span class="meta" data-out="count"></span></div>
      <p class="note top">For each item, enter the watts from its data plate, or its volts and amps. Save gear you use often with ${BOOKMARK} to add it again later.</p>
      <div class="power-head" aria-hidden="true">
        <span>Item</span><span>Qty</span><span>Volts</span><span>Amps</span><span>Watts</span><span>AC/DC</span><span class="pf-col">PF</span><span class="num">Total</span><span></span><span></span>
      </div>
      <div class="power-items" data-out="items"></div>
      <div class="power-actions">
        <button type="button" class="secondary" data-action="add">Add item</button>
        <span class="input-unit power-saved" data-out="savedRow">
          <select data-out="saved" aria-label="Saved equipment"></select>
          <button type="button" class="secondary unit-btn" data-action="addSaved">Add</button>
          <button type="button" class="secondary unit-btn" data-action="deleteSaved">Delete</button>
        </span>
      </div>
      <p class="note" data-out="savedStatus" role="status"></p>
    </section>

    <section class="card">
      <div class="card-head"><h2>Planning</h2><span class="meta">Generators are usually rated at 0.8 power factor</span></div>
      <div class="fields">
        <label>Planning load limit
          <span class="input-unit">
            <input name="limit" type="number" inputmode="decimal" step="any" min="1" max="100" />
            <span class="unit">%</span>
          </span>
        </label>
      </div>
    </section>
  </div>

  <aside class="results">
    <section class="card">
      <div class="card-head">
        <h2>Generator</h2>
        <button type="button" class="secondary" data-action="reset">Reset</button>
      </div>
      <p class="note" data-out="prompt"></p>
      <div data-out="results">
        <div class="tiles">
          <div class="tile"><span class="label">Total load</span><span class="value" data-out="load"></span><span class="sub" data-out="loadSub"></span></div>
          <div class="tile"><span class="label">Generator</span><span class="value" data-out="gen"></span><span class="sub" data-out="genSub"></span></div>
        </div>
        <table class="ledger">
          <thead><tr><th>Generator size</th><th class="num">Load on it</th></tr></thead>
          <tbody data-out="sets"></tbody>
        </table>
        <details class="about"><summary>About this calculation</summary><p>Data plate ratings are maximums, so the real draw is usually lower and this errs on the safe side. Each item is watts × quantity; with volts and amps, watts are volts × amps × power factor. Power factor is 1 unless you change it in Advanced mode; a lower one means more current, which the generator's kVA rating (kW ÷ 0.8) has to carry too. The planning limit leaves room for startup surges and gear added later. Gear on a DC power supply draws about 10–20% more from the generator than its DC volts × amps; enter the supply's AC rating if you have it.</p></details>
      </div>
      <div class="power-export">
        <button type="button" class="plan-btn" data-action="export"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>Export CSV</button>
        <p class="note plan-status" data-out="exportStatus" role="status"></p>
      </div>
    </section>
  </aside>
`;

function loadEquipment(): EquipmentProfile[] {
  try {
    return cleanProfiles(JSON.parse(localStorage.getItem(EQUIPMENT_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

function loadState(): { settings: Record<string, string>; items: PowerItem[] } {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    const items = Array.isArray(v.items) ? v.items.slice(0, MAX_ITEMS).flatMap((i: unknown) => cleanPowerItem(i) ?? []) : [];
    const limit = typeof v.settings?.limit === "string" ? v.settings.limit : defaults.limit;
    return { settings: { limit }, items: items.length ? items : [blankItem()] };
  } catch {
    return { settings: { ...defaults }, items: [blankItem()] };
  }
}

const fmt = (v: number, digits = 0) => v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
const formatWatts = (w: number) => (w >= 10_000 ? `${fmt(w / 1000, 1)}<span class="unit">kW</span>` : `${fmt(w)}<span class="unit">W</span>`);
const inputValue = (v: number | undefined) => (v === undefined ? "" : String(v));

export const powerPlanCalculator: Calculator = {
  id: "power",
  title: "Power Plan",
  shortTitle: "Power",
  render() {
    const form = document.createElement("form");
    form.className = "calculator two-col power-plan";
    form.innerHTML = template;
    form.addEventListener("submit", (e) => e.preventDefault());

    const out = (name: string) => form.querySelector<HTMLElement>(`[data-out="${name}"]`)!;
    const limitInput = form.elements.namedItem("limit") as HTMLInputElement;
    const state = loadState();
    let items = state.items;
    limitInput.value = state.settings.limit;

    const limit = () => {
      const v = Number.parseFloat(limitInput.value);
      return v > 0 && v <= 100 ? v / 100 : Number(defaults.limit) / 100;
    };

    const save = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings: { limit: limitInput.value }, items }));
      } catch {
        // Storage blocked: the plan just won't be remembered.
      }
    };

    // One row per item. Inputs are found by data-f so they stay out of form.elements.
    const renderItems = () => {
      out("items").replaceChildren(
        ...items.map((it, idx) => {
          const row = document.createElement("div");
          row.className = "power-item";
          row.dataset.idx = String(idx);
          // Each box has a caption, shown when the row stacks on a narrow screen.
          const cell = (cap: string, control: string, cls = "") => `<label class="power-cell ${cls}"><span class="power-cap">${cap}</span>${control}</label>`;
          row.innerHTML = `
            ${cell("Item", `<input data-f="name" type="text" autocomplete="off" placeholder="Item" aria-label="Item ${idx + 1} name" />`, "c-name")}
            ${cell("Qty", '<input data-f="qty" type="number" inputmode="numeric" step="1" min="0" aria-label="Quantity" />', "c-qty")}
            ${cell("Volts", '<input data-f="volts" type="number" inputmode="decimal" step="any" min="0" placeholder="V" aria-label="Volts" />', "c-volts")}
            ${cell("Amps", '<input data-f="amps" type="number" inputmode="decimal" step="any" min="0" placeholder="A" aria-label="Amps" />', "c-amps")}
            ${cell("Watts", '<input data-f="watts" type="number" inputmode="decimal" step="any" min="0" placeholder="W" aria-label="Watts" title="Leave blank to use volts × amps" />', "c-watts")}
            ${cell("AC/DC", '<select data-f="ac" aria-label="AC or DC"><option value="ac">AC</option><option value="dc">DC</option></select>', "c-ac")}
            ${cell("PF", '<input data-f="pf" type="number" inputmode="decimal" step="0.05" min="0.1" max="1" aria-label="Power factor" title="Power factor (AC only)" />', "c-pf pf-col")}
            <span class="power-total mono" data-f="total"></span>
            <button type="button" class="secondary icon-btn" data-f="keep" aria-label="Save item ${idx + 1} to your equipment" title="Save to your equipment">${BOOKMARK}</button>
            <button type="button" class="secondary icon-btn" data-f="remove" aria-label="Remove item ${idx + 1}" title="Remove">✕</button>`;
          const f = <T extends HTMLElement>(name: string) => row.querySelector<T>(`[data-f="${name}"]`)!;
          f<HTMLInputElement>("name").value = it.name;
          f<HTMLInputElement>("qty").value = String(it.qty);
          f<HTMLInputElement>("volts").value = inputValue(it.volts);
          f<HTMLInputElement>("amps").value = inputValue(it.amps);
          f<HTMLInputElement>("watts").value = inputValue(it.watts);
          f<HTMLSelectElement>("ac").value = it.ac ? "ac" : "dc";
          f<HTMLInputElement>("pf").value = String(it.powerFactor);
          return row;
        }),
      );
      form.querySelector<HTMLButtonElement>('[data-action="add"]')!.disabled = items.length >= MAX_ITEMS;
    };

    const readRow = (row: HTMLElement): PowerItem => {
      const v = (name: string) => row.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-f="${name}"]`)!.value;
      const n = (name: string) => {
        const x = Number.parseFloat(v(name));
        return Number.isFinite(x) ? x : undefined;
      };
      return { name: v("name"), qty: n("qty") ?? 0, volts: n("volts"), amps: n("amps"), watts: n("watts"), ac: v("ac") === "ac", powerFactor: n("pf") ?? 1 };
    };

    const update = () => {
      items = [...out("items").querySelectorAll<HTMLElement>(".power-item")].map(readRow);
      save();

      for (const row of out("items").querySelectorAll<HTMLElement>(".power-item")) {
        const it = items[Number(row.dataset.idx)];
        const load = itemLoad(it);
        // Show what volts × amps works out to in the empty watts box.
        const fromVa = itemLoad({ ...it, watts: undefined });
        row.querySelector<HTMLInputElement>('[data-f="watts"]')!.placeholder = fromVa ? fmt(fromVa.watts, fromVa.watts < 10 ? 1 : 0) : "W";
        row.querySelector<HTMLInputElement>('[data-f="pf"]')!.disabled = !it.ac;
        row.querySelector<HTMLElement>('[data-f="total"]')!.textContent = load && it.qty > 0 ? `${fmt(load.watts * it.qty)} W` : "";
      }

      const totals = planTotals(items);
      out("count").textContent = `${items.length} ${items.length === 1 ? "line" : "lines"}`;
      const rec = recommendGenerator(totals, limit());
      out("prompt").textContent = rec ? "" : "Enter each item's watts, or its volts and amps, to size a generator.";
      out("results").hidden = !rec;
      if (!rec) return;

      const pct = (f: number) => `${fmt(f * 100)}%`;
      const lowPf = totals.va > totals.watts * 1.001;
      out("load").innerHTML = formatWatts(totals.watts);
      out("loadSub").textContent = `${totals.counted} ${totals.counted === 1 ? "line" : "lines"}${lowPf ? ` · ${fmt(totals.va / 1000, 1)} kVA with power factor` : ""}`;
      out("gen").innerHTML = `${rec.count > 1 ? `${rec.count} × ` : ""}${rec.set.kw}<span class="unit">kW</span>`;
      out("genSub").textContent = `${pct(rec.fraction)} loaded${rec.count > 1 ? ". Check the generators can run in parallel" : ""}`;
      out("sets").innerHTML = generatorSizes
        .map((set) => {
          const f = loadFraction(totals, set);
          const cls = set === rec.set && rec.count === 1 ? ' class="total recommended"' : "";
          const status = f > 1 ? "Over rating" : f > limit() ? `${pct(f)}, over limit` : pct(f);
          return `<tr${cls}><td>${set.kw} kW</td><td class="num mono">${status}</td></tr>`;
        })
        .join("");
    };

    // Saved equipment: data plate details kept on this device, to add again by name.
    let equipment = loadEquipment();
    const savedSelect = out("saved") as HTMLSelectElement;
    const savedStatus = (text: string) => {
      out("savedStatus").textContent = text;
    };
    const storeEquipment = () => {
      try {
        localStorage.setItem(EQUIPMENT_KEY, JSON.stringify(equipment));
        return true;
      } catch {
        return false;
      }
    };
    const renderEquipment = (selected = "") => {
      savedSelect.replaceChildren(new Option("Saved equipment…", ""));
      // Option() sets names as text, so they can't become markup.
      for (const p of equipment) savedSelect.append(new Option(p.name, p.name, false, p.name === selected));
      out("savedRow").hidden = !equipment.length;
    };

    const addFromEquipment = () => {
      const profile = equipment.find((p) => p.name === savedSelect.value);
      if (!profile) {
        savedStatus("Choose a saved item first.");
        return;
      }
      if (items.length >= MAX_ITEMS && !isBlank(items[items.length - 1])) return;
      // Fill an empty last line rather than leaving it above the new one.
      const item = { ...profile, qty: 1 };
      if (items.length && isBlank(items[items.length - 1])) items[items.length - 1] = item;
      else items.push(item);
      renderItems();
      update();
      savedSelect.value = "";
      savedStatus(`Added ${profile.name}. Set the quantity.`);
      const qty = out("items").querySelector<HTMLInputElement>(".power-item:last-child [data-f='qty']");
      qty?.focus();
      qty?.select();
    };
    form.querySelector('[data-action="addSaved"]')!.addEventListener("click", addFromEquipment);
    form.querySelector('[data-action="deleteSaved"]')!.addEventListener("click", () => {
      const name = savedSelect.value;
      if (!name) {
        savedStatus("Choose a saved item to delete.");
        return;
      }
      equipment = removeProfile(equipment, name);
      storeEquipment();
      renderEquipment();
      savedStatus(`Deleted ${name} from your equipment. Lines already in the plan stay.`);
    });
    // Keep the saved-equipment picker from recalculating the plan.
    for (const type of ["input", "change"]) out("savedRow").addEventListener(type, (e) => e.stopPropagation());

    out("items").addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const keep = target.closest<HTMLButtonElement>('[data-f="keep"]');
      if (keep) {
        const item = items[Number(keep.closest<HTMLElement>(".power-item")!.dataset.idx)];
        if (!item.name.trim()) savedStatus("Name the item before saving it.");
        else if (!itemLoad(item)) savedStatus("Enter its watts, or volts and amps, before saving it.");
        else {
          const replacing = equipment.some((p) => p.name.trim().toLowerCase() === item.name.trim().toLowerCase());
          equipment = saveProfile(equipment, item);
          if (!storeEquipment()) savedStatus("This browser wouldn't save it. Storage may be full or blocked.");
          else savedStatus(`${replacing ? "Updated" : "Saved"} ${item.name.trim()} in your equipment.`);
          renderEquipment();
        }
        return;
      }
      const button = target.closest<HTMLButtonElement>('[data-f="remove"]');
      if (!button) return;
      const idx = Number(button.closest<HTMLElement>(".power-item")!.dataset.idx);
      items.splice(idx, 1);
      if (!items.length) items.push(blankItem());
      renderItems();
      update();
    });
    form.querySelector('[data-action="add"]')!.addEventListener("click", () => {
      if (items.length >= MAX_ITEMS) return;
      items.push(blankItem());
      renderItems();
      update();
      out("items").querySelector<HTMLInputElement>(".power-item:last-child [data-f='name']")?.focus();
    });
    form.querySelector('[data-action="reset"]')!.addEventListener("click", () => {
      if (items.some((it) => it.name.trim() || itemLoad(it)) && !confirm("Clear every item from this power plan?")) return;
      items = [blankItem()];
      limitInput.value = defaults.limit;
      renderItems();
      update();
    });
    form.querySelector('[data-action="export"]')!.addEventListener("click", () => {
      const status = out("exportStatus");
      if (!planTotals(items).counted) {
        status.textContent = "Add at least one item with watts, or volts and amps, first.";
        return;
      }
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      // The byte-order mark tells Excel the file is UTF-8.
      downloadFile(fileName(`power-plan-${today}`, "csv"), `﻿${planCsv(items)}`, "text/csv;charset=utf-8");
      status.textContent = "Exported. Open it in Excel or share it with whoever is sizing the generators.";
    });

    form.addEventListener("input", update);
    form.addEventListener("change", update);
    renderItems();
    renderEquipment();
    update();
    enhanceFields(form, powerGuide, defaults);
    return form;
  },
};
