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

window.addEventListener("hashchange", show);
show();
