import { rfIcon } from "./ui/rfIcons";
import "./style.css";
import { registerSW } from "virtual:pwa-register";
import { calculators } from "./calculators";
import { renderHome } from "./calculators/home";
import { THEME_EVENT, isDarkTheme } from "./calculators/theme";
import { type CoordFormat, getCoordFormat, setCoordFormat } from "./lib/coords";
import { COORD_EVENT } from "./calculators/settings";

registerSW({ immediate: true });

const app = document.querySelector<HTMLElement>("#app")!;
const toolNav = document.querySelector<HTMLElement>("#toolNav")!;
const toolName = document.querySelector<HTMLElement>("#toolName")!;

function show(): void {
  // A share link looks like "#mesh?plan=…"; the page reads the plan itself.
  const id = location.hash.slice(1).split("?")[0];
  // No tool named (or one that no longer exists): the home page of tool cards.
  const calc = calculators.find((c) => c.id === id || c.aliases?.includes(id));
  document.body.classList.toggle("at-home", !calc);
  toolNav.hidden = !calc;
  toolName.textContent = calc?.title ?? "";
  document.querySelector("#settingsLink")?.toggleAttribute("aria-current", calc?.id === "settings");
  app.replaceChildren(calc ? calc.render() : renderHome());
  document.title = calc ? `${calc.title} · RF Toolkit` : "RF Toolkit";
  if (!calc) window.scrollTo(0, 0);
}

// Coordinate display format, shared by every page with a location box.
const coordToggle = document.querySelector<HTMLElement>("#coordToggle")!;
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
