// The map-first page layout shared by the planning tabs: the map fills the
// page, settings cards float on the left, results on the right, and the map's
// tools sit in a taskbar along the bottom. On a phone the map comes first and
// the cards stack below it. The markup uses the lb-* classes in style.css.

export const svgIcon = (paths: string) =>
  `<svg class="pane-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

export const PANE_ICONS = {
  tx: svgIcon('<path d="M12 12v9M9 21h6"/><circle cx="12" cy="10" r="2"/><path d="M8.5 6.5a5 5 0 0 0 0 7M15.5 6.5a5 5 0 0 1 0 7M5.6 3.6a9 9 0 0 0 0 12.8M18.4 3.6a9 9 0 0 1 0 12.8"/>'),
  rx: svgIcon('<path d="M4 20h16"/><path d="M6 20 12 6l6 14"/><path d="M8.5 15h7"/><path d="M12 3v3"/>'),
  relay: svgIcon('<circle cx="5" cy="17" r="2"/><circle cx="19" cy="17" r="2"/><circle cx="12" cy="6" r="2"/><path d="m6.5 15.5 4-7.5M17.5 15.5l-4-7.5"/>'),
  sites: svgIcon('<path d="M7 14v7M5 21h4"/><circle cx="7" cy="12" r="1.5"/><path d="M17 10v11M15 21h4"/><circle cx="17" cy="8" r="1.5"/><path d="M14.5 5.5a4 4 0 0 1 5 0M4.5 9.5a4 4 0 0 1 5 0"/>'),
  // A mesh: scattered nodes, each linked to several others.
  mesh: svgIcon('<circle cx="4.5" cy="8" r="2"/><circle cx="13" cy="3.5" r="2"/><circle cx="20" cy="10" r="2"/><circle cx="11.5" cy="12.5" r="2"/><circle cx="6" cy="20" r="2"/><circle cx="17.5" cy="19.5" r="2"/><path d="M6.4 7.1 11.1 4.4M14.9 4.6l3.4 3.8M6.4 9.1l3.3 2.4M13 5.5l-1.2 5M13.5 12.2l4.6-1.4M11 14.4 7 18.3M13.1 13.8l3.3 4.2M8 20h7.5M19.5 12l-1.6 5.6M4.8 10l.9 8"/>'),
  // A small rugged box radio: squarish body, a display, an antenna at each top corner.
  radio: svgIcon('<rect x="4.5" y="9" width="15" height="12" rx="1.5"/><path d="M7.5 9V3.5M16.5 9V5"/><circle cx="7.5" cy="3" r=".6" fill="currentColor"/><circle cx="16.5" cy="4.5" r=".6" fill="currentColor"/><rect x="7.5" y="12" width="9" height="3.5" rx=".5"/><path d="M8 18.5h2M12 18.5h.01M15 18.5h1"/>'),
  env: svgIcon('<path d="M12 21v-5"/><path d="m12 3-6 9h3l-3 4h12l-3-4h3z"/>'),
  mapping: svgIcon('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
  terrain: svgIcon('<path d="m3 19 6-9 4 5 3-4 5 8z"/>'),
  share: svgIcon('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/>'),
  // A dish on a short mast: the bowl facing up and right, its feed arm, and the mast.
  dish: svgIcon('<path d="M4 7a10 10 0 0 0 10 10z"/><path d="M9 12l5-5"/><circle cx="15" cy="6" r="1.2"/><path d="M7 15.5V21M4 21h6"/>'),
  // A compass rose, for pointing.
  compass: svgIcon('<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>'),
  // A radiation pattern: two lobes either side of an antenna.
  pattern: svgIcon('<path d="M12 12c-3-5-9-5-9 0s6 5 9 0zM12 12c3-5 9-5 9 0s-6 5-9 0z"/><path d="M12 4v16"/>'),
  budget: svgIcon('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  // A plug, for equipment drawing power.
  plug: svgIcon('<path d="M9 3v5M15 3v5"/><path d="M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>'),
  // A gauge, for a planning limit.
  gauge: svgIcon('<path d="M4 17a8 8 0 1 1 16 0"/><path d="m12 17 4-5"/><circle cx="12" cy="17" r="1" fill="currentColor"/>'),
  // A lightning bolt, for power and generators.
  bolt: svgIcon('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  // Two arrows meeting and turning back, for reflection (SWR).
  swr: svgIcon('<path d="M3 8h13M12 4l4 4-4 4"/><path d="M21 16H8M12 12l-4 4 4 4"/>'),
  // A dB ratio: a rising log curve over an axis.
  ratio: svgIcon('<path d="M4 20V4M4 20h16"/><path d="M6 18c2-8 6-11 13-12"/>'),
  // A map pin, for a place.
  pin: svgIcon('<path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
  // A satellite: body and two solar panels.
  satellite: svgIcon('<rect x="9.5" y="9.5" width="5" height="5" rx="1" transform="rotate(45 12 12)"/><path d="m4 8 3-3 3.5 3.5-3 3zM20 16l-3 3-3.5-3.5 3-3z"/><path d="M16.5 3.5a4 4 0 0 1 4 4"/>'),
  // A rain cloud, for weather.
  weather: svgIcon('<path d="M7 15a4 4 0 1 1 1-7.9A5 5 0 0 1 17.6 9 3.5 3.5 0 0 1 17 15z"/><path d="m8 18-1 2.5M12 18l-1 2.5M16 18l-1 2.5"/>'),
  // A coax lead ending in a connector.
  coax: svgIcon('<path d="M3 17c4 0 4-7 9-7h2"/><rect x="14" y="7" width="4.5" height="6" rx="1"/><path d="M18.5 10H21"/>'),
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
      <summary>${PANE_ICONS[icon]}<span class="pane-title">${title}</span>${extraSummary}</summary>
      <div class="pane-body">${body}</div>
    </details>`;

/** The fold-away tabs for the two side panes; rightName says what the right pane holds. */
export const sideToggles = (rightName: string) => `
  <button type="button" class="side-toggle" data-side="left" aria-expanded="true" aria-label="Hide the settings pane"></button>
  <button type="button" class="side-toggle" data-side="right" aria-expanded="true" aria-label="Hide the ${rightName}"></button>`;

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
