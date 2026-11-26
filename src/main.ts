import { rfIcon } from "./ui/rfIcons";
import "./style.css";
import { registerSW } from "virtual:pwa-register";
import { calculators } from "./calculators";
import { renderHome } from "./calculators/home";
import { THEME_EVENT, isDarkTheme } from "./calculators/theme";
import { type CoordFormat, getCoordFormat, setCoordFormat } from "./lib/coords";
import { COORD_EVENT } from "./calculators/settings";

// The dev branch's build lives under /beta/: mark it in the header and in the
// tab title, so it can't be mistaken for the stable site.
const beta = import.meta.env.BASE_URL.endsWith("/beta/");
const APP_NAME = beta ? "RF Toolkit Beta" : "RF Toolkit";
if (beta) document.querySelector(".brand")?.insertAdjacentHTML("beforeend", '<span class="beta-badge">Beta</span>');

// When a new version has downloaded, offer it instead of reloading on our own:
// a reload in the middle of planning would throw away what's on screen. The
// button stays until tapped; tapping it switches to the new version and reloads.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    if (document.querySelector(".update-prompt")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "update-prompt";
    button.textContent = "Update available. Tap to reload.";
    button.addEventListener("click", () => {
      button.disabled = true;
      void updateSW(true);
    });
    document.body.append(button);
  },
});

const app = document.querySelector<HTMLElement>("#app")!;
const toolNav = document.querySelector<HTMLElement>("#toolNav")!;
const toolName = document.querySelector<HTMLElement>("#toolName")!;

/**
 * Shows the page the address names after the "#", or the home page of tool
 * cards when it names none (or a tool that no longer exists), and updates the
 * header and the tab title to match. Runs on load and whenever the address changes.
 */
function show(): void {
  // A share link looks like "#mesh?plan=…"; the page reads the plan itself.
  const id = location.hash.slice(1).split("?")[0];
  // No tool named (or one that no longer exists): the home page of tool cards.
  const calc = calculators.find((c) => c.id === id || c.aliases?.includes(id));
  document.body.classList.toggle("at-home", !calc);
  toolNav.hidden = !calc;
  toolName.textContent = calc?.title ?? "";
  document.querySelector("#settingsLink")?.toggleAttribute("aria-current", calc?.id === "settings");
  document.querySelector("#aboutLink")?.toggleAttribute("aria-current", calc?.id === "about");
  app.replaceChildren(calc ? calc.render() : renderHome());
  document.title = calc ? `${calc.title} · ${APP_NAME}` : APP_NAME;
  if (!calc) window.scrollTo(0, 0);
}

// Coordinate display format, shared by every page with a location box.
const coordToggle = document.querySelector<HTMLElement>("#coordToggle")!;
// Shows which coordinate format is chosen on the header switch.
const markFormat = () => {
  for (const button of coordToggle.querySelectorAll<HTMLButtonElement>("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.format === getCoordFormat()));
  }
};
// The Settings tab changes the same format; keep the switch showing it.
window.addEventListener(COORD_EVENT, markFormat);
coordToggle.addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-format]");
  if (!button) return;
  setCoordFormat(button.dataset.format as CoordFormat);
  markFormat();
  show();
});
markFormat();

// Light or dark. Follows the device until the user picks one.
const THEME_KEY = "rf-toolkit:theme";
const themeToggle = document.querySelector<HTMLButtonElement>("#themeToggle")!;
const deviceTheme = window.matchMedia("(prefers-color-scheme: dark)");
const SUN = rfIcon("sun");
const MOON = rfIcon("moon");
const isDark = isDarkTheme;
// Brings the header's theme button and the browser's toolbar color in line with
// the current light or dark theme, and tells the open page, so its map can switch
// to that theme's default layer and the antenna pattern can redraw in its colors.
const markTheme = () => {
  const dark = isDark();
  // The icon shows the theme a press switches to.
  themeToggle.innerHTML = dark ? SUN : MOON;
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  themeToggle.title = label;
  themeToggle.setAttribute("aria-label", label);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#111110" : "#f4f4f2");
  window.dispatchEvent(new Event(THEME_EVENT));
};
themeToggle.addEventListener("click", () => {
  const next = isDark() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
  markTheme();
});
deviceTheme.addEventListener("change", markTheme);
markTheme();

// iPhones show a decimal keypad with no minus key for inputmode="decimal", so a
// number box that can take a negative (antenna gain, sensitivity, dBm) drops it
// and gets the number-and-symbol keyboard instead. Boxes that can't go below
// zero keep the plain keypad. Watching the page covers boxes added later (node
// rows, the 3D site editor).
const allowNegatives = (root: ParentNode) => {
  for (const input of root.querySelectorAll<HTMLInputElement>('input[type="number"][inputmode]')) {
    const min = input.getAttribute("min");
    if (min === null || Number(min) < 0) input.removeAttribute("inputmode");
  }
};
new MutationObserver((records) => {
  for (const r of records) for (const n of r.addedNodes) if (n instanceof HTMLElement) allowNegatives(n);
}).observe(document.body, { childList: true, subtree: true });

window.addEventListener("hashchange", show);
show();
