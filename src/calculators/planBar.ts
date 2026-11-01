// Save, reopen, share and export a tool's plan. Shared by the Mesh Planner and
// Coverage Map. Share links carry the plan in the URL fragment, which stays in
// the browser, and are validated when opened (see lib/plans.ts).

import { type Plan, createPlanStore, decodePlan, encodePlan, planFromHash } from "../lib/plans";

const storage = {
  getItem: (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
};

/** Hand the user a file through the browser's normal download. */
export function downloadFile(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Set form fields from a plan. A dropdown keeps its current choice when the
 * plan names an option it doesn't have, so a bad value can't blank a unit.
 */
export function applySettings(form: HTMLFormElement, settings: Record<string, string>): void {
  for (const [name, value] of Object.entries(settings)) {
    const el = form.elements.namedItem(name);
    if (el instanceof HTMLSelectElement) {
      if ([...el.options].some((o) => o.value === value)) el.value = value;
    } else if (el instanceof HTMLInputElement) {
      el.value = value;
    }
  }
}

export interface PlanBarOptions {
  toolId: string;
  settingNames: string[];
  getPlan(): Plan;
  applyPlan(plan: Plan): void;
  exportLabel: string;
  /** Do the export; returns a message if it can't yet. */
  onExport(name: string): string | undefined;
}

export function createPlanBar(o: PlanBarOptions): HTMLElement {
  const store = createPlanStore(storage, o.toolId, o.settingNames);
  const bar = document.createElement("details");
  bar.className = "plan-bar";
  bar.innerHTML = `
    <summary>Save, share or export</summary>
    <div class="fields">
      <label>Saved plans
        <span class="input-unit">
          <select data-p="list"></select>
          <button type="button" class="secondary unit-btn" data-p="delete">Delete</button>
        </span>
      </label>
      <label>Save this plan as
        <span class="input-unit">
          <input data-p="name" type="text" autocomplete="off" placeholder="Plan name" />
          <button type="button" class="secondary unit-btn" data-p="save">Save</button>
        </span>
      </label>
    </div>
    <div class="plan-actions">
      <button type="button" class="secondary" data-p="share">Share link</button>
      <button type="button" class="secondary" data-p="export">${o.exportLabel}</button>
      <span class="note" data-p="status"></span>
    </div>`;
  const el = <T extends HTMLElement>(name: string) => bar.querySelector<T>(`[data-p="${name}"]`)!;
  const list = el<HTMLSelectElement>("list");
  const nameInput = el<HTMLInputElement>("name");
  const status = (text: string) => {
    el("status").textContent = text;
  };

  // These controls aren't part of the plan, so keep them from recalculating it.
  for (const type of ["input", "change"]) bar.addEventListener(type, (e) => e.stopPropagation());

  const refresh = (selected = "") => {
    const plans = store.list();
    list.replaceChildren(new Option(plans.length ? "Choose a saved plan…" : "No saved plans yet", ""));
    // Option() sets names as text, so plan names can't become markup.
    for (const p of plans) list.append(new Option(p.name, p.name, false, p.name === selected));
    el<HTMLButtonElement>("delete").disabled = !selected;
  };
  refresh();

  list.addEventListener("change", () => {
    const plan = store.list().find((p) => p.name === list.value);
    el<HTMLButtonElement>("delete").disabled = !plan;
    if (!plan) return;
    nameInput.value = plan.name;
    o.applyPlan(plan);
    status(`Opened "${plan.name}".`);
  });
  el("save").addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!name) {
      status("Give the plan a name first.");
      nameInput.focus();
      return;
    }
    if (!store.save(name, o.getPlan())) {
      status("This browser wouldn't save it. Storage may be full or blocked.");
      return;
    }
    refresh(name);
    status(`Saved "${name}".`);
  });
  el("delete").addEventListener("click", () => {
    const name = list.value;
    if (!name) return;
    store.remove(name);
    refresh();
    status(`Deleted "${name}".`);
  });
  el("share").addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}#${o.toolId}?plan=${encodePlan(o.getPlan())}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "RF Toolkit plan", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      status("Link copied. Anyone you send it to sees these locations.");
    } catch (err) {
      if ((err as Error).name === "AbortError") return; // Share sheet dismissed.
      status("Couldn't copy the link automatically in this browser.");
    }
  });
  el("export").addEventListener("click", () => {
    const problem = o.onExport(nameInput.value.trim() || o.toolId);
    status(problem ?? "Exported. Import the file in ATAK, WinTAK or Google Earth.");
  });

  // A plan arriving by share link.
  const encoded = planFromHash(location.hash, o.toolId);
  if (encoded) {
    const plan = decodePlan(encoded, o.settingNames);
    history.replaceState(null, "", `#${o.toolId}`);
    if (plan) {
      o.applyPlan(plan);
      bar.open = true;
      status("Opened a shared plan. Save it to keep it.");
    } else {
      bar.open = true;
      status("That share link couldn't be read.");
    }
  }
  return bar;
}
