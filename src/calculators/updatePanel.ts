// The Update button in the top bar and its release notes panel. When a new
// version has downloaded, the button appears; tapping it opens a panel with
// what changed, by category, and an Update now button. Nothing reloads until
// the user chooses to. The notes come from the new build (release-notes.json),
// so they describe the version that's waiting, not the one running.

import { CATEGORIES, CATEGORY_NAMES, type Category, cleanReleases, notesSince } from "../lib/releaseNotes";
import { rfIcon } from "../ui/rfIcons";

/** Each category's icon in the panel. */
const CATEGORY_ICONS: Record<Category, string> = {
  feature: rfIcon("sparkle"),
  fix: rfIcon("wrench"),
  security: rfIcon("shield"),
  dependencies: rfIcon("package"),
};

/** The waiting version's notes, newer than currentVersion: fetched fresh from the server each time. */
async function fetchNotes(currentVersion: string) {
  const res = await fetch(`${import.meta.env.BASE_URL}release-notes.json?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Notes returned ${res.status}`);
  return notesSince(cleanReleases(await res.json()), currentVersion);
}

/** An element with a class and, optionally, text (set as text, never as markup). */
function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * Shows the Update button in the top bar, once. update switches to the waiting
 * version and reloads; currentVersion is the version this page runs, so the
 * notes can show only what's new to it.
 */
export function showUpdateButton(update: () => Promise<void>, currentVersion: string): void {
  if (document.querySelector(".update-btn")) return;
  const actions = document.querySelector(".top-actions");
  if (!actions) return;
  const button = make("button", "update-btn");
  button.type = "button";
  button.innerHTML = `<span class="update-dot" aria-hidden="true"></span>${rfIcon("refresh")}<span class="update-label">Update</span>`;
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-label", "Update available: see what's new");
  actions.prepend(button);

  let panel: HTMLElement | undefined;

  // Closes the panel and stops listening for outside taps and Escape.
  const close = () => {
    panel?.remove();
    panel = undefined;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onKey);
  };
  // A tap outside the panel and the button closes it.
  const onOutside = (e: Event) => {
    const t = e.target as Node;
    if (panel && !panel.contains(t) && !button.contains(t)) close();
  };
  // Escape closes it and puts focus back on the button.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    close();
    button.focus();
  };

  // Places the panel just under the top bar: lined up with the button's right
  // edge on a wide screen, across the full width (less a margin) on a phone.
  const place = () => {
    if (!panel) return;
    const bar = document.querySelector(".topbar")!.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    panel.style.top = `${Math.max(bar.bottom, b.bottom) + 8}px`;
    if (window.innerWidth <= 600) {
      panel.style.left = panel.style.right = "12px";
    } else {
      panel.style.left = "auto";
      panel.style.right = `${Math.max(12, window.innerWidth - b.right)}px`;
    }
  };

  // Builds the panel: a header, the notes (loading first), and the buttons.
  const open = async () => {
    panel = make("div", "update-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Update available");
    const head = make("div", "up-head");
    const badge = make("span", "up-badge");
    badge.innerHTML = rfIcon("refresh");
    const titles = make("div", "up-titles");
    const sub = make("span", "up-sub", "Loading what's new…");
    titles.append(make("b", "up-title", "Update available"), sub);
    const shut = make("button", "up-close");
    shut.type = "button";
    shut.setAttribute("aria-label", "Close");
    shut.innerHTML = rfIcon("close");
    shut.addEventListener("click", close);
    head.append(badge, titles, shut);
    const body = make("div", "up-body");
    const foot = make("div", "up-foot");
    const later = make("button", "secondary", "Later");
    later.type = "button";
    later.addEventListener("click", close);
    const now = make("button", "up-now", "Update now");
    now.type = "button";
    now.addEventListener("click", () => {
      now.disabled = later.disabled = true;
      now.textContent = "Updating…";
      void update();
    });
    foot.append(later, now);
    panel.append(head, body, foot);
    document.body.append(panel);
    button.setAttribute("aria-expanded", "true");
    place();
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey);
    now.focus();

    const mine = panel;
    try {
      const { notes, latest, empty } = await fetchNotes(currentVersion);
      if (panel !== mine) return;
      sub.textContent = latest ? `Version ${latest}` : "A new version is ready";
      if (empty) body.append(make("p", "up-empty", "This update has no notes."));
      for (const c of CATEGORIES) {
        if (!notes[c].length) continue;
        const section = make("section", `up-cat up-${c}`);
        const h = make("h3", "up-cat-head");
        const chip = make("span", "up-chip");
        chip.innerHTML = CATEGORY_ICONS[c];
        h.append(chip, document.createTextNode(CATEGORY_NAMES[c]));
        const list = make("ul", "up-list");
        for (const n of notes[c]) list.append(make("li", "", n));
        section.append(h, list);
        body.append(section);
      }
    } catch {
      if (panel !== mine) return;
      sub.textContent = "A new version is ready";
      body.append(make("p", "up-empty", "The notes couldn't load. You can still update."));
    }
    place();
  };

  button.addEventListener("click", () => (panel ? close() : void open()));
  window.addEventListener("resize", place);
}
