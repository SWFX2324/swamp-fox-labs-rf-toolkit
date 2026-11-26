import { rfIcon } from "../ui/rfIcons";
// Save, reopen, share, export and import a tool's plan. Shared by the Mesh
// Analysis and Coverage Analysis. Share links carry the plan in the URL fragment,
// which stays in the browser, and are validated when opened (see lib/plans.ts).
// Export writes a KMZ, or a TAK data package with each site as a marker; import
// reads sites from KML, KMZ, CoT or a data package (see lib/tak.ts).

import type { ExportPoint } from "../lib/export";
import { fileName } from "../lib/export";
import { type Plan, createPlanStore, decodePlan, encodePlan, planFromHash } from "../lib/plans";
import { type ImportedPoint, type PackageFile, MAX_IMPORT_BYTES, buildDataPackage, importPoints } from "../lib/tak";

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

/** Generic icons for share destinations and file actions. */
export const SHARE_ICONS = {
  tak: rfIcon("pin"),
  earth: rfIcon("globe"),
  file: rfIcon("file"),
  link: rfIcon("link"),
};

/** What the file picker for Import takes. */
export const IMPORT_ACCEPT = ".kml,.kmz,.zip,.cot,.xml";
/** Said when an imported file has no points. */
export const NO_POINTS = "No named points found in that file. Import reads points from KML, KMZ, CoT or a TAK data package.";

/** The bytes of a PNG data URL, for packing into a KMZ. */
export const pngBytes = (dataUrl: string) => Uint8Array.from(atob(dataUrl.split(",")[1]), (c) => c.charCodeAt(0));

export interface PlanBarOptions {
  toolId: string;
  settingNames: string[];
  getPlan(): Plan;
  applyPlan(plan: Plan): void;
  /** The export file (a KMZ), or a message if there's nothing to export yet. */
  buildExport(name: string): PackageFile | string;
  /** The sites or nodes, as TAK markers in a data package. */
  markers(): ExportPoint[];
  /** Points read from an imported file; returns what was done with them. */
  onImport(points: ImportedPoint[]): string;
}

/**
 * The Share card for a map-first page: export to TAK or Google Earth, send a
 * link, import from a file, and the saved plans, in the same plain style as
 * the Link Analysis Share card. Opens a plan arriving by share link, too.
 */
export function createPlanCard(o: PlanBarOptions): HTMLElement {
  const store = createPlanStore(storage, o.toolId, o.settingNames);
  const card = document.createElement("div");
  card.className = "plan-card";
  card.innerHTML = `
    <h3 class="share-head">Export</h3>
    <div class="share-grid">
      <button type="button" class="share-choice" data-p="tak">${SHARE_ICONS.tak}TAK</button>
      <button type="button" class="share-choice" data-p="kmz">${SHARE_ICONS.earth}Google Earth</button>
      <button type="button" class="share-choice" data-p="link">${SHARE_ICONS.link}Send link</button>
    </div>
    <h3 class="share-head">Import</h3>
    <div class="share-grid">
      <button type="button" class="share-choice" data-p="import" title="KML, KMZ, CoT or a TAK data package">${SHARE_ICONS.file}From file</button>
    </div>
    <input type="file" data-p="file" accept="${IMPORT_ACCEPT}" hidden />
    <h3 class="share-head">Saved plans</h3>
    <ul class="saved-list" data-p="list"></ul>
    <div class="save-row">
      <input data-p="name" type="text" placeholder="Name this plan" autocomplete="off" aria-label="Name for the saved plan" />
      <button type="button" class="secondary" data-p="save">Save</button>
    </div>
    <p class="note plan-status" data-p="status" role="status"></p>`;
  const el = <T extends HTMLElement>(name: string) => card.querySelector<T>(`[data-p="${name}"]`)!;
  const nameInput = el<HTMLInputElement>("name");
  const status = (text: string) => {
    el("status").textContent = text;
  };
  // These controls aren't part of the plan, so keep them from recalculating it.
  for (const type of ["input", "change"]) card.addEventListener(type, (e) => e.stopPropagation());

  const list = () => {
    const plans = store.list();
    // Names are user text, so they're set as text.
    el("list").replaceChildren(
      ...plans.map((p) => {
        const li = document.createElement("li");
        const open = document.createElement("button");
        open.type = "button";
        open.className = "saved-open";
        open.textContent = p.name;
        open.addEventListener("click", () => {
          nameInput.value = p.name;
          o.applyPlan(p);
          status(`Opened "${p.name}".`);
        });
        const del = document.createElement("button");
        del.type = "button";
        del.className = "secondary icon-btn saved-del";
        del.innerHTML = rfIcon("close");
        del.setAttribute("aria-label", `Delete ${p.name}`);
        del.addEventListener("click", () => {
          if (!confirm(`Delete the saved plan "${p.name}"?`)) return;
          store.remove(p.name);
          list();
          status(`Deleted "${p.name}".`);
        });
        li.append(open, del);
        return li;
      }),
    );
  };
  list();
  const save = () => {
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
    list();
    status(`Saved "${name}".`);
  };
  el("save").addEventListener("click", save);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    save();
  });

  const exportAs = (tak: boolean) => {
    const name = nameInput.value.trim() || o.toolId;
    const file = o.buildExport(name);
    if (typeof file === "string") {
      status(file);
      return;
    }
    if (tak) {
      downloadFile(fileName(name, "zip"), buildDataPackage(name, [file], o.markers()) as BlobPart, "application/zip");
      status("Exported. Import the .zip in ATAK, WinTAK or iTAK.");
    } else {
      downloadFile(file.name, file.data as BlobPart, "application/vnd.google-earth.kmz");
      status("Exported. Open it in Google Earth or TAK.");
    }
  };
  el("tak").addEventListener("click", () => exportAs(true));
  el("kmz").addEventListener("click", () => exportAs(false));
  // On a phone the share sheet offers Messages, email and the rest; elsewhere the link is copied.
  el("link").addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}#${o.toolId}?plan=${encodePlan(o.getPlan())}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "RF Toolkit plan", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      status("Link copied. Anyone you send it to sees these locations.");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      status("Couldn't copy the link automatically in this browser.");
    }
  });
  const fileInput = el<HTMLInputElement>("file");
  el("import").addEventListener("click", () => {
    fileInput.value = "";
    fileInput.click();
  });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      status("That file is over 20 MB, too large to import.");
      return;
    }
    status("Reading…");
    try {
      const points = await importPoints(file.name, new Uint8Array(await file.arrayBuffer()));
      status(points.length ? o.onImport(points) : NO_POINTS);
    } catch {
      status("That file couldn't be read.");
    }
  });

  // A plan arriving by share link.
  const encoded = planFromHash(location.hash, o.toolId);
  if (encoded) {
    const plan = decodePlan(encoded, o.settingNames);
    history.replaceState(null, "", `#${o.toolId}`);
    if (plan) {
      o.applyPlan(plan);
      status("Opened a shared plan. Save it to keep it.");
    } else {
      status("That share link couldn't be read.");
    }
  }
  return card;
}
