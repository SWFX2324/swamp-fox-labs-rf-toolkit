import { twoTap } from "./twoTap";
import { escapeHtml } from "../lib/html";
// Imported antenna patterns: kept on this device, offered in the Antenna
// pattern dropdowns of the Coverage Analysis and the Mesh Planner, and managed
// in a dialog like the radio presets. A site or node using one plans with the
// file's measured cuts and the file's own gain. Plans refer to a pattern by its
// id; a device without the file uses the built-in shape named in the id.

import { type ImportedPattern, MAX_PATTERNS, cleanPatterns, fallbackOf, isFilePatternId, parseMsi } from "../lib/antennaFile";
import { type Beam, beam, findPattern, patterns } from "../lib/pattern";
import { downloadFile } from "./planBar";

const STORAGE_KEY = "rf-toolkit:antenna-patterns";
/** Fired on window when the imported patterns change, so open pages refresh their dropdowns. */
export const PATTERNS_EVENT = "rf-toolkit:patterns";
/** The largest pattern file read: real ones are about 10 KB. */
const MAX_FILE_BYTES = 512 * 1024;

// The list as last read, so the maths can look a pattern up for every link
// without parsing storage each time. Another tab changing the list clears it.
let cached: ImportedPattern[] | undefined;
window.addEventListener("storage", (e) => {
  if (e.key === STORAGE_KEY || e.key === null) {
    cached = undefined;
    window.dispatchEvent(new Event(PATTERNS_EVENT));
  }
});

/** The imported patterns on this device, checked one by one; none when storage can't be read. */
export function loadPatterns(): ImportedPattern[] {
  if (cached) return cached;
  try {
    cached = cleanPatterns(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"));
  } catch {
    cached = [];
  }
  return cached;
}

/** Stores the imported patterns and tells open pages. False when storage refused them. */
function savePatterns(list: ImportedPattern[]): boolean {
  cached = list;
  let ok = true;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    ok = false;
  }
  window.dispatchEvent(new Event(PATTERNS_EVENT));
  return ok;
}

/** The imported pattern with this id, if this device has it. */
export function importedPattern(id: string | undefined): ImportedPattern | undefined {
  return isFilePatternId(id) ? loadPatterns().find((p) => p.id === id) : undefined;
}

/** A built-in shape's name for the dropdowns ("Sector, 90°"). */
const shapeName = (id: string) => findPattern(id).name;

/**
 * The options for an Antenna pattern dropdown: the built-in shapes, then the
 * imported patterns. current, when it is an imported pattern this device
 * doesn't have, gets an option of its own, so a shared plan's choice is kept
 * (and says what stands in for it). label renames a built-in shape, for the
 * Mesh node rows' shorter names.
 */
export function patternOptionsHtml(current?: string, label: (id: string, name: string) => string = (_, n) => n): string {
  const imported = loadPatterns();
  const builtIn = patterns.map((p) => `<option value="${p.id}">${escapeHtml(label(p.id, p.name))}</option>`).join("");
  const missing =
    isFilePatternId(current) && !imported.some((p) => p.id === current)
      ? `<option value="${current}">Pattern not on this device (${escapeHtml(shapeName(fallbackOf(current)))} used)</option>`
      : "";
  const mine = imported.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  return mine || missing ? `${builtIn}<optgroup label="Imported">${mine}${missing}</optgroup>` : builtIn;
}

/** The same choices as patternOptionsHtml, as value and label pairs for the 3D view's editor. */
export function patternChoices(current?: string, label: (id: string, name: string) => string = (_, n) => n): { value: string; label: string }[] {
  const imported = loadPatterns();
  const missing = isFilePatternId(current) && !imported.some((p) => p.id === current);
  return [
    ...patterns.map((p) => ({ value: p.id, label: label(p.id, p.name) })),
    ...imported.map((p) => ({ value: p.id, label: p.name })),
    ...(missing ? [{ value: current, label: `Pattern not on this device (${shapeName(fallbackOf(current))} used)` }] : []),
  ];
}

/** Refills an Antenna pattern dropdown after the imported patterns change, keeping its choice. */
export function refillPatternSelect(select: HTMLSelectElement, current = select.value, label?: (id: string, name: string) => string): void {
  select.innerHTML = patternOptionsHtml(current, label);
  select.value = [...select.options].some((o) => o.value === current) ? current : "omni";
}

/** The beam for a pattern choice: an imported pattern's measured cuts when this device has them. */
export function patternBeam(id: string | undefined, gainDbi: number, azimuthDeg = 0, downtiltDeg = 0): Beam {
  return beam(id, gainDbi, azimuthDeg, downtiltDeg, importedPattern(id));
}

/** The antenna gain to plan with: an imported pattern's own gain, otherwise the gain given. */
export function patternGain(id: string | undefined, otherwise: number): number {
  return importedPattern(id)?.gainDbi ?? otherwise;
}

/**
 * A warning about a pattern choice, or "" when there's none: an imported
 * pattern this device doesn't have, or one measured at a frequency far from
 * the one being planned (more than 15% away), where its shape may differ.
 * who names the site or node, such as "Site A".
 */
export function patternWarning(id: string | undefined, who: string, freqMhz: number): string {
  if (!isFilePatternId(id)) return "";
  const p = importedPattern(id);
  if (!p) return `${who}'s antenna pattern isn't on this device, so ${shapeName(fallbackOf(id))} stands in. Import its file under Antenna patterns.`;
  if (p.freqMhz && freqMhz > 0 && Math.abs(freqMhz - p.freqMhz) / p.freqMhz > 0.15) {
    return `${who}'s pattern was measured at ${Math.round(p.freqMhz)} MHz, far from ${Math.round(freqMhz)} MHz, so its real shape may differ.`;
  }
  return "";
}

/** A pattern's details in a few words: frequency, gain and beamwidth. */
function patternWords(p: ImportedPattern): string {
  const width = p.h.filter((loss) => loss <= 3).length;
  return [p.freqMhz ? `${Math.round(p.freqMhz)} MHz` : "", `${p.gainDbi.toFixed(1)} dBi`, width >= 300 ? "omni" : `${width}° wide`].filter(Boolean).join(" · ");
}

/** The pattern manager's markup: the list of imported patterns and the import and export buttons. */
const template = `
  <div class="preset-head">
    <h2>Antenna patterns</h2>
    <button type="button" class="secondary" data-p="close">Close</button>
  </div>
  <p class="note top">Measured patterns from antenna datasheets, in MSI / Planet format (.msi, .pln or .txt), saved on this device only. Coverage sites and Mesh nodes can use them, with the file's own gain.</p>
  <ul class="preset-list" data-p="list"></ul>
  <p class="note" data-p="empty">No patterns yet.</p>
  <div class="preset-actions">
    <button type="button" data-p="import">Import file</button>
    <button type="button" class="secondary" data-p="export">Export all</button>
    <input type="file" accept=".msi,.pln,.txt,.json" data-p="file" multiple hidden />
  </div>
  <p class="note" data-p="status"></p>`;

/** Opens the Antenna patterns dialog: import pattern files (or an exported list), delete patterns, export them all. */
export function openPatternManager(): void {
  const dialog = document.createElement("dialog");
  dialog.className = "preset-dialog";
  dialog.setAttribute("aria-label", "Antenna patterns");
  dialog.innerHTML = template;
  // An element of the dialog by its data-p name.
  const el = <T extends HTMLElement = HTMLElement>(name: string) => dialog.querySelector<T>(`[data-p="${name}"]`)!;
  document.body.append(dialog);
  dialog.showModal();
  dialog.addEventListener("close", () => dialog.remove());
  // Events inside the dialog aren't changes to the page's own form.
  for (const type of ["input", "change", "submit"]) dialog.addEventListener(type, (e) => e.stopPropagation());
  el("close").addEventListener("click", () => dialog.close());
  // Shows a message under the list.
  const setStatus = (text: string) => (el("status").textContent = text);

  // Redraws the list: each pattern's name and details, with a Delete button.
  const renderList = () => {
    const list = loadPatterns();
    el("empty").hidden = list.length > 0;
    el("export").toggleAttribute("disabled", list.length === 0);
    el("list").replaceChildren(
      ...list.map((p) => {
        const li = document.createElement("li");
        const info = document.createElement("span");
        info.className = "preset-info";
        const name = document.createElement("b");
        name.textContent = p.name; // From a file, so set as text.
        const words = document.createElement("span");
        words.className = "note";
        words.textContent = patternWords(p);
        info.append(name, words);
        const del = document.createElement("button");
        del.type = "button";
        del.className = "secondary";
        del.textContent = "Delete";
        twoTap(del, "Tap again to delete", () => {
          savePatterns(loadPatterns().filter((q) => q.id !== p.id));
          setStatus(`Deleted "${p.name}". Sites and nodes that used it now use ${shapeName(fallbackOf(p.id))}.`);
          renderList();
        });
        li.append(info, del);
        return li;
      }),
    );
  };

  el("import").addEventListener("click", () => el<HTMLInputElement>("file").click());
  el<HTMLInputElement>("file").addEventListener("change", async () => {
    const files = [...(el<HTMLInputElement>("file").files ?? [])];
    el<HTMLInputElement>("file").value = "";
    if (!files.length) return;
    const list = loadPatterns();
    const notes: string[] = [];
    let added = 0;
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        notes.push(`${file.name} is too large to be a pattern file.`);
        continue;
      }
      const text = await file.text();
      // An exported list (JSON), or a single pattern file.
      let incoming: ImportedPattern[];
      if (/^\s*[[{]/.test(text)) {
        try {
          const data = JSON.parse(text);
          incoming = cleanPatterns(Array.isArray(data) ? data : data?.antennaPatterns);
        } catch {
          incoming = [];
        }
        if (!incoming.length) notes.push(`No patterns found in ${file.name}.`);
      } else {
        const p = parseMsi(text, file.name);
        if (typeof p === "string") {
          notes.push(`${file.name}: ${p}`);
          continue;
        }
        incoming = [p];
      }
      for (const p of incoming) {
        if (list.some((q) => q.id === p.id)) continue;
        if (list.length >= MAX_PATTERNS) {
          notes.push(`No room for ${p.name} (up to ${MAX_PATTERNS} patterns). Delete one first.`);
          continue;
        }
        list.push(p);
        added++;
      }
    }
    if (added && !savePatterns(list)) notes.unshift("This browser wouldn't save them. Storage may be full or blocked.");
    setStatus([added ? `Imported ${added} pattern${added === 1 ? "" : "s"}.` : "", ...notes].filter(Boolean).join(" "));
    renderList();
  });
  el("export").addEventListener("click", () => {
    const list = loadPatterns();
    if (!list.length) return;
    downloadFile("antenna-patterns.json", JSON.stringify({ antennaPatterns: list }), "application/json");
    setStatus(`Exported ${list.length} pattern${list.length === 1 ? "" : "s"}. Import the file on another device to use them there.`);
  });

  renderList();
}
