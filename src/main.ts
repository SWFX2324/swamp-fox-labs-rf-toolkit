import "./style.css";
import { registerSW } from "virtual:pwa-register";
import { calculators } from "./calculators";
import { type CoordFormat, getCoordFormat, setCoordFormat } from "./lib/coords";

registerSW({ immediate: true });

const tabs = document.querySelector<HTMLElement>("#tabs")!;
const app = document.querySelector<HTMLElement>("#app")!;

for (const calc of calculators) {
  const link = document.createElement("a");
  link.href = `#${calc.id}`;
  link.innerHTML = `<span class="long"></span><span class="short"></span>`;
  link.querySelector(".long")!.textContent = calc.title;
  link.querySelector(".short")!.textContent = calc.shortTitle ?? calc.title;
  link.setAttribute("aria-label", calc.title);
  link.dataset.id = calc.id;
  tabs.append(link);
}

function show(): void {
  // A share link looks like "#mesh?plan=…"; the page reads the plan itself.
  const id = location.hash.slice(1).split("?")[0];
  const calc = calculators.find((c) => c.id === id || c.aliases?.includes(id)) ?? calculators[0];
  for (const link of tabs.querySelectorAll<HTMLAnchorElement>("a")) {
    link.toggleAttribute("aria-current", link.dataset.id === calc.id);
  }
  // On phones the tab row scrolls sideways; keep the current tab in view.
  const current = tabs.querySelector<HTMLAnchorElement>("a[aria-current]");
  if (current && tabs.scrollWidth > tabs.clientWidth) {
    tabs.scrollLeft = current.offsetLeft - (tabs.clientWidth - current.offsetWidth) / 2;
  }
  app.replaceChildren(calc.render());
  document.title = `${calc.title} · RF Toolkit`;
}

// Coordinate display format, shared by every page with a location box.
const coordToggle = document.querySelector<HTMLElement>("#coordToggle")!;
const markFormat = () => {
  for (const button of coordToggle.querySelectorAll<HTMLButtonElement>("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.format === getCoordFormat()));
  }
};
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
const SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1"/></svg>';
const isDark = () => {
  const picked = document.documentElement.dataset.theme;
  return picked ? picked === "dark" : deviceTheme.matches;
};
const markTheme = () => {
  const dark = isDark();
  // The icon shows the theme a press switches to.
  themeToggle.innerHTML = dark ? SUN : MOON;
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  themeToggle.title = label;
  themeToggle.setAttribute("aria-label", label);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#111110" : "#f4f4f2");
  window.dispatchEvent(new Event("rf-toolkit:theme"));
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

window.addEventListener("hashchange", show);
show();
