import { rfIcon } from "../ui/rfIcons";
// The map-first page layout shared by the planning tabs: the map fills the
// page, settings cards float on the left, results on the right, and the map's
// tools sit in a taskbar along the bottom. On a phone the map comes first and
// the cards stack below it. The markup uses the lb-* classes in style.css.

export const PANE_ICONS = {
  tx: rfIcon("tx", "pane-icon"),
  rx: rfIcon("rx", "pane-icon"),
  relay: rfIcon("relay", "pane-icon"),
  sites: rfIcon("sites", "pane-icon"),
  mesh: rfIcon("mesh", "pane-icon"),
  radio: rfIcon("radio", "pane-icon"),
  env: rfIcon("env", "pane-icon"),
  mapping: rfIcon("mapping", "pane-icon"),
  terrain: rfIcon("terrain", "pane-icon"),
  share: rfIcon("share", "pane-icon"),
  dish: rfIcon("dish", "pane-icon"),
  compass: rfIcon("compass", "pane-icon"),
  pattern: rfIcon("pattern", "pane-icon"),
  budget: rfIcon("budget", "pane-icon"),
  plug: rfIcon("plug", "pane-icon"),
  gauge: rfIcon("gauge", "pane-icon"),
  bolt: rfIcon("bolt", "pane-icon"),
  swr: rfIcon("swr", "pane-icon"),
  ratio: rfIcon("ratio", "pane-icon"),
  pin: rfIcon("pin", "pane-icon"),
  satellite: rfIcon("satellite", "pane-icon"),
  weather: rfIcon("weather", "pane-icon"),
  coax: rfIcon("coax", "pane-icon"),
};

/** Band presets in rows by range: HF below 30 MHz, VHF to 300 MHz, UHF above. */
const BAND_GROUPS: [string, number, number][] = [
  ["HF", 0, 30],
  ["VHF", 30, 300],
  ["UHF", 300, Infinity],
];
export const bandButtons = (presets: { label: string; mhz: number }[]) => `
      <div class="band-groups" role="group" aria-label="Band presets">
        ${BAND_GROUPS.map(
          ([name, lo, hi]) =>
            `<span class="band-name">${name}</span>` +
            presets
              .filter((b) => b.mhz >= lo && b.mhz < hi)
              .map((b) => `<button type="button" class="chip" data-mhz="${b.mhz}">${b.label}</button>`)
              .join(""),
        ).join("")}
      </div>`;

/** An expandable card in the left pane. */
export const pane = (id: string, icon: keyof typeof PANE_ICONS, title: string, body: string, extraSummary = "") => `
    <details class="pane-card" data-pane="${id}">
      <summary>${PANE_ICONS[icon]}<span class="pane-title">${title}</span>${extraSummary}${rfIcon("chevronDown", "pane-chevron")}</summary>
      <div class="pane-body">${body}</div>
    </details>`;

/** The fold-away tabs for the two side panes; rightName says what the right pane holds. */
export const sideToggles = (rightName: string) => `
  <button type="button" class="side-toggle" data-side="left" aria-expanded="true" aria-label="Hide the settings pane">${rfIcon("chevronLeft")}</button>
  <button type="button" class="side-toggle" data-side="right" aria-expanded="true" aria-label="Hide the ${rightName}">${rfIcon("chevronRight")}</button>`;

const readJson = (key: string): Record<string, boolean> => {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? "null") as Record<string, boolean> | null) ?? {};
  } catch {
    return {};
  }
};
const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: remembered until the page closes.
  }
};

export interface MapFirstOptions {
  /** Where the open cards are remembered. Cards start closed. */
  panesKey: string;
  /** Where the folded side panes are remembered. */
  sidesKey: string;
  /** What the right pane holds, for its fold-away tab's label. */
  rightName: string;
  /** A card opened or closed. */
  onPaneToggle?(id: string, open: boolean): void;
}

/**
 * Wire up a map-first page: remembered cards, fold-away side panes, the
 * taskbar centred in the gap between the panes (icons only when the gap is
 * narrow), and the page sized to the window below the header.
 */
export function setupMapFirst(form: HTMLElement, o: MapFirstOptions): void {
  const shell = form.querySelector<HTMLElement>(".lb-shell")!;
  const panes = [...form.querySelectorAll<HTMLDetailsElement>("details.pane-card")];
  const openPanes = readJson(o.panesKey);
  for (const p of panes) {
    p.open = !!openPanes[p.dataset.pane!];
    p.addEventListener("toggle", () => {
      openPanes[p.dataset.pane!] = p.open;
      writeJson(o.panesKey, openPanes);
      o.onPaneToggle?.(p.dataset.pane!, p.open);
    });
  }

  const sides = readJson(o.sidesKey);
  const syncSides = () => {
    for (const side of ["left", "right"]) {
      const closed = !!sides[side];
      shell.classList.toggle(`${side}-closed`, closed);
      const b = form.querySelector<HTMLButtonElement>(`.side-toggle[data-side="${side}"]`)!;
      b.setAttribute("aria-expanded", String(!closed));
      b.setAttribute("aria-label", `${closed ? "Show" : "Hide"} the ${side === "left" ? "settings pane" : o.rightName}`);
    }
  };
  for (const b of form.querySelectorAll<HTMLButtonElement>(".side-toggle")) {
    b.addEventListener("click", () => {
      sides[b.dataset.side!] = !sides[b.dataset.side!];
      writeJson(o.sidesKey, sides);
      syncSides();
    });
  }
  syncSides();

  // With the panes floating on the map, its taskbar, key and messages centre
  // in the gap between them, and the taskbar drops its labels when that gap
  // is too narrow for them.
  const floating = window.matchMedia("(min-width: 1100px)");
  const fitTaskbar = () => {
    const bar = form.querySelector<HTMLElement>(".map-taskbar");
    if (!shell.isConnected) return;
    const creditsLine = form.querySelector<HTMLElement>(".lb-map .leaflet-control-attribution");
    if (creditsLine) shell.style.setProperty("--attr-h", `${creditsLine.offsetHeight}px`);
    if (!floating.matches) {
      shell.style.removeProperty("--gap-center");
      bar?.classList.remove("compact");
      return;
    }
    const box = shell.getBoundingClientRect();
    const left = form.querySelector<HTMLElement>(".lb-left")!.getBoundingClientRect();
    const right = form.querySelector<HTMLElement>(".lb-right")!.getBoundingClientRect();
    const from = left.width ? left.right - box.left : 0;
    const to = right.width ? right.left - box.left : box.width;
    shell.style.setProperty("--gap-center", `${(from + to) / 2}px`);
    if (!bar) return;
    bar.classList.remove("compact");
    if (bar.offsetWidth > to - from - 24) bar.classList.add("compact");
  };
  new ResizeObserver(fitTaskbar).observe(shell);
  for (const p of panes) p.addEventListener("toggle", fitTaskbar);
  for (const b of form.querySelectorAll(".side-toggle")) b.addEventListener("click", fitTaskbar);
  // The taskbar arrives with the map, a moment after the page.
  const waitForBar = () => {
    const credits = form.querySelector(".lb-map .leaflet-control-attribution");
    if (form.querySelector(".map-taskbar") && credits) {
      // Credits change with the base map, so follow their height.
      new ResizeObserver(fitTaskbar).observe(credits);
      fitTaskbar();
    }
    else if (form.isConnected) setTimeout(waitForBar, 100);
  };
  setTimeout(waitForBar, 0);

  // The page fills the window below the header, so the map gets all the height.
  const fitShell = () => {
    if (!shell.isConnected) return;
    shell.style.setProperty("--lb-top", `${Math.max(0, shell.getBoundingClientRect().top + window.scrollY)}px`);
  };
  new ResizeObserver(fitShell).observe(document.body);
  window.addEventListener("resize", fitShell);
  requestAnimationFrame(fitShell);
}

/**
 * Size a page whose middle is a graphic rather than a map: it fills the window
 * below the header on a wide screen, like the map pages.
 */
export function fitStage(form: HTMLElement): void {
  const shell = form.querySelector<HTMLElement>(".lb-shell")!;
  const fit = () => {
    if (!shell.isConnected) return;
    shell.style.setProperty("--lb-top", `${Math.max(0, shell.getBoundingClientRect().top + window.scrollY)}px`);
  };
  new ResizeObserver(fit).observe(document.body);
  window.addEventListener("resize", fit);
  requestAnimationFrame(fit);
}

/** The Simple/Advanced switch (with Reset) heads the left pane. Call after enhanceFields. */
export function moveModeBar(form: HTMLElement): void {
  const modeBar = form.querySelector(".mode-bar");
  if (modeBar) form.querySelector(".lb-left")!.prepend(modeBar);
}
