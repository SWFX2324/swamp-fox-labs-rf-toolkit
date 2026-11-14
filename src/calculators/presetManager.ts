// Radio presets: stored on this device, and the dialog to make, edit, delete,
// import and export them. The app ships no presets; each user enters the
// numbers for the radios they know. Each tab keeps its own list: a mesh radio
// and a coverage site radio are different things to plan with.

import { RATE_UNITS, type RadioPreset, cleanPreset, cleanPresets, newPresetId, samePreset } from "../lib/radioPresets";
import { frequencyUnits, powerUnits } from "../lib/units";
import { downloadFile } from "./planBar";

/** Which tab's presets: each has its own list. */
export type PresetScope = "mesh" | "coverage";
// The mesh list keeps the original key, so presets made before the split stay there.
const STORAGE_KEYS: Record<PresetScope, string> = { mesh: "rf-toolkit:radio-presets", coverage: "rf-toolkit:coverage-presets" };
const SCOPE_NAMES: Record<PresetScope, string> = { mesh: "Mesh Analysis", coverage: "Coverage Analysis" };
/** Fired on window when presets change (detail: the scope), so an open tab can refresh its list. */
export const PRESETS_EVENT = "rf-toolkit:presets";

export function loadPresets(scope: PresetScope): RadioPreset[] {
  try {
    return cleanPresets(JSON.parse(localStorage.getItem(STORAGE_KEYS[scope]) ?? "[]"));
  } catch {
    return [];
  }
}

function savePresets(list: RadioPreset[], scope: PresetScope): void {
  try {
    localStorage.setItem(STORAGE_KEYS[scope], JSON.stringify(list));
  } catch {
    // Storage blocked: presets last until the page closes.
  }
  window.dispatchEvent(new CustomEvent(PRESETS_EVENT, { detail: scope }));
}

/** True when a presets-changed event is about this scope. */
export const presetsEventFor = (e: Event, scope: PresetScope) => !(e instanceof CustomEvent) || e.detail === scope;

/**
 * Keep a preset that arrived from elsewhere (a shared plan): the existing one
 * if this device already has the same, otherwise added. Returns its id here.
 */
export function adoptPreset(p: RadioPreset, scope: PresetScope): string {
  const list = loadPresets(scope);
  const same = list.find((q) => samePreset(q, p));
  if (same) return same.id;
  const added = { ...p, id: list.some((q) => q.id === p.id) ? newPresetId() : p.id };
  savePresets([...list, added], scope);
  return added.id;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const options = (list: readonly string[]) => list.map((u) => `<option>${u}</option>`).join("");

const template = (scope: PresetScope) => `
  <div class="preset-head">
    <h2>Radio presets <span class="meta">${SCOPE_NAMES[scope]}</span></h2>
    <button type="button" class="secondary" data-p="close">Close</button>
  </div>
  <div data-p="listView">
    <p class="note top">Your own radios for ${SCOPE_NAMES[scope]}, saved on this device only. Enter the numbers from the radio's datasheet for the waveform or mode you use; the app has no built-in radios.</p>
    <ul class="preset-list" data-p="list"></ul>
    <p class="note" data-p="empty">No presets yet.</p>
    <div class="preset-actions">
      <button type="button" data-p="new">New preset</button>
      <button type="button" class="secondary" data-p="import">Import</button>
      <button type="button" class="secondary" data-p="export">Export all</button>
      <input type="file" accept=".json,application/json" data-p="file" hidden />
    </div>
    <p class="note" data-p="status"></p>
  </div>
  <form data-p="editor" hidden>
    <div class="fields">
      <label class="wide">Name
        <input name="name" type="text" maxlength="40" autocomplete="off" required placeholder="What you call this radio and mode" />
      </label>
      <label>Frequency
        <span class="input-unit"><input name="freq" type="number" inputmode="decimal" step="any" min="0" placeholder="Leave as is" /><select name="freqUnit">${options(Object.keys(frequencyUnits))}</select></span>
      </label>
      <label>TX power
        <span class="input-unit"><input name="power" type="number" inputmode="decimal" step="any" min="0" /><select name="powerUnit">${options(powerUnits)}</select></span>
      </label>
      <label>Antenna gain
        <span class="input-unit"><input name="gain" type="number" step="any" /><span class="unit">dBi</span></span>
      </label>
      <label>Cable loss
        <span class="input-unit"><input name="cable" type="number" inputmode="decimal" step="any" min="0" /><span class="unit">dB</span></span>
      </label>
      <label data-mesh-only>Hop limit
        <input name="hopLimit" type="number" inputmode="numeric" step="1" min="1" max="20" placeholder="None" />
      </label>
      <label class="check wide" data-mesh-only><input name="sharedChannel" type="checkbox" /> Relays share one channel (each hop takes its turn on the air)</label>
    </div>
    <h3 class="preset-sub">Rate ladder</h3>
    <p class="note">Each data rate the radio uses and the weakest signal it decodes at. Leave it empty to use one sensitivity from the Radios card.</p>
    <div class="preset-rates">
      <div class="preset-rate-head"><span>Rate <select name="rateUnit" aria-label="Rate unit">${options(RATE_UNITS)}</select></span><span>Sensitivity</span><span></span></div>
      <div data-p="rates"></div>
      <button type="button" class="secondary" data-p="addRate">Add rate</button>
    </div>
    <div class="preset-actions">
      <button type="submit">Save preset</button>
      <button type="button" class="secondary" data-p="cancel">Cancel</button>
      <button type="button" class="secondary danger" data-p="delete" hidden>Delete</button>
    </div>
  </form>
`;

/**
 * Open the preset dialog. onPicked gets the id of a preset just saved, to
 * select it; editId opens straight into that preset's editor.
 */
export function openPresetManager(scope: PresetScope, onPicked?: (id: string) => void, editId?: string): void {
  const dialog = document.createElement("dialog");
  dialog.className = "preset-dialog";
  dialog.setAttribute("aria-label", "Radio presets");
  dialog.innerHTML = template(scope);
  // Hop limit and shared channel only mean something in a mesh.
  if (scope !== "mesh") for (const el of dialog.querySelectorAll<HTMLElement>("[data-mesh-only]")) el.hidden = true;
  const el = <T extends HTMLElement = HTMLElement>(name: string) => dialog.querySelector<T>(`[data-p="${name}"]`)!;
  const form = el<HTMLFormElement>("editor");
  const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
  document.body.append(dialog);
  dialog.showModal();
  dialog.addEventListener("close", () => dialog.remove());
  // A form inside the page's form would otherwise send its events to the page.
  for (const type of ["input", "change", "submit"]) dialog.addEventListener(type, (e) => e.stopPropagation());
  el("close").addEventListener("click", () => dialog.close());
  const setStatus = (text: string) => (el("status").textContent = text);

  let editing: RadioPreset | undefined;

  const renderList = () => {
    const list = loadPresets(scope);
    el("empty").hidden = list.length > 0;
    el("export").toggleAttribute("disabled", list.length === 0);
    el("list").innerHTML = list
      .map((p, i) => {
        const bits = [p.rates.length ? `${p.rates.length} rate${p.rates.length === 1 ? "" : "s"}` : "single sensitivity", p.hopLimit ? `${p.hopLimit} hops max` : ""].filter(Boolean);
        const name = escapeHtml(p.name);
        return `<li>
          <span class="preset-order">
            <button type="button" class="secondary icon-btn" data-up="${p.id}" aria-label="Move ${name} up"${i === 0 ? " disabled" : ""}>▲</button>
            <button type="button" class="secondary icon-btn" data-down="${p.id}" aria-label="Move ${name} down"${i === list.length - 1 ? " disabled" : ""}>▼</button>
          </span>
          <span class="preset-info"><b>${name}</b><span class="note">${bits.join(" · ")}</span></span>
          <span class="preset-row-actions"><button type="button" class="secondary" data-edit="${p.id}">Edit</button><button type="button" class="secondary" data-copy="${p.id}">Copy</button></span>
        </li>`;
      })
      .join("");
  };
  // Swap a preset with its neighbour; the pickers everywhere follow this order.
  const move = (id: string, step: -1 | 1) => {
    const list = loadPresets(scope);
    const i = list.findIndex((p) => p.id === id);
    const j = i + step;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    savePresets(list, scope);
    renderList();
    // Keep the focus on the button that moved, so pressing it again keeps going.
    el("list").querySelector<HTMLButtonElement>(`[data-${step < 0 ? "up" : "down"}="${id}"]:not([disabled])`)?.focus();
  };

  const rateRow = (rate = "", sens = "") => {
    const row = document.createElement("div");
    row.className = "preset-rate";
    row.innerHTML = `<input type="number" inputmode="decimal" step="any" min="0" aria-label="Data rate" /><span class="input-unit"><input type="number" step="any" aria-label="Sensitivity" /><span class="unit">dBm</span></span><button type="button" class="secondary icon-btn" aria-label="Remove this rate">✕</button>`;
    const [r, s] = row.querySelectorAll("input");
    r.value = rate;
    s.value = sens;
    row.querySelector("button")!.addEventListener("click", () => row.remove());
    el("rates").append(row);
  };

  const showEditor = (p: RadioPreset | undefined) => {
    editing = p;
    el("listView").hidden = true;
    form.hidden = false;
    form.reset();
    el("rates").replaceChildren();
    input("name").value = p?.name ?? "";
    input("freq").value = p?.freq ?? "";
    input("freqUnit").value = p?.freqUnit ?? "MHz";
    input("power").value = p?.power ?? "";
    input("powerUnit").value = p?.powerUnit ?? "W";
    input("gain").value = p?.gain ?? "";
    input("cable").value = p?.cable ?? "";
    input("hopLimit").value = p?.hopLimit ?? "";
    (input("sharedChannel") as HTMLInputElement).checked = p?.sharedChannel ?? true;
    input("rateUnit").value = p?.rateUnit ?? "kbps";
    for (const s of p?.rates ?? []) rateRow(s.rate, s.sens);
    if (!p?.rates.length) rateRow();
    el("delete").hidden = !p || !loadPresets(scope).some((q) => q.id === p.id);
    input("name").focus();
  };
  const showList = () => {
    form.hidden = true;
    el("listView").hidden = false;
    renderList();
  };

  el("addRate").addEventListener("click", () => rateRow());
  el("cancel").addEventListener("click", showList);
  el("new").addEventListener("click", () => showEditor(undefined));
  el("list").addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("button");
    if (!t) return;
    if (t.dataset.up) return move(t.dataset.up, -1);
    if (t.dataset.down) return move(t.dataset.down, 1);
    const list = loadPresets(scope);
    const edit = list.find((p) => p.id === t.dataset.edit);
    if (edit) showEditor(edit);
    const copy = list.find((p) => p.id === t.dataset.copy);
    if (copy) showEditor({ ...copy, id: newPresetId(), name: `${copy.name} copy`.slice(0, 40) });
  });
  el("delete").addEventListener("click", () => {
    if (!editing || !confirm(`Delete the preset "${editing.name}"?`)) return;
    savePresets(loadPresets(scope).filter((p) => p.id !== editing!.id), scope);
    setStatus(`Deleted "${editing.name}".`);
    showList();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const rates = [...el("rates").querySelectorAll(".preset-rate")].map((row) => {
      const [r, s] = row.querySelectorAll("input");
      return { rate: r.value.trim(), sens: s.value.trim() };
    });
    const preset = cleanPreset({
      id: editing?.id ?? newPresetId(),
      name: input("name").value,
      freq: input("freq").value.trim(),
      freqUnit: input("freqUnit").value,
      power: input("power").value.trim(),
      powerUnit: input("powerUnit").value,
      gain: input("gain").value.trim(),
      cable: input("cable").value.trim(),
      hopLimit: input("hopLimit").value.trim(),
      sharedChannel: (input("sharedChannel") as HTMLInputElement).checked,
      rateUnit: input("rateUnit").value,
      rates,
    });
    if (!preset) {
      input("name").focus();
      return;
    }
    const list = loadPresets(scope);
    const at = list.findIndex((p) => p.id === preset.id);
    if (at >= 0) list[at] = preset;
    else list.push(preset);
    savePresets(list, scope);
    setStatus(`Saved "${preset.name}".`);
    showList();
    onPicked?.(preset.id);
  });

  el("export").addEventListener("click", () => {
    const list = loadPresets(scope);
    if (!list.length) return;
    downloadFile(`${scope}-radio-presets.json`, JSON.stringify({ tool: scope, radioPresets: list }, null, 2), "application/json");
    setStatus(`Exported ${list.length} preset${list.length === 1 ? "" : "s"}. Import the file on another device to use them there.`);
  });
  el("import").addEventListener("click", () => el<HTMLInputElement>("file").click());
  el<HTMLInputElement>("file").addEventListener("change", async () => {
    const file = el<HTMLInputElement>("file").files?.[0];
    el<HTMLInputElement>("file").value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = cleanPresets(Array.isArray(data) ? data : data?.radioPresets);
      if (!incoming.length) {
        setStatus("No presets found in that file.");
        return;
      }
      const list = loadPresets(scope);
      let added = 0;
      for (const p of incoming) {
        if (list.some((q) => samePreset(q, p))) continue;
        list.push({ ...p, id: list.some((q) => q.id === p.id) ? newPresetId() : p.id });
        added++;
      }
      savePresets(list, scope);
      setStatus(added ? `Imported ${added} preset${added === 1 ? "" : "s"}.` : "Those presets are already here.");
      renderList();
    } catch {
      setStatus("That file couldn't be read as presets.");
    }
  });

  renderList();
  const start = editId ? loadPresets(scope).find((p) => p.id === editId) : undefined;
  if (start) showEditor(start);
}
