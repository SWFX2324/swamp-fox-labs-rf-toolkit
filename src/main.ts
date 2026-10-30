import "./style.css";
import { registerSW } from "virtual:pwa-register";
import { calculators } from "./calculators";

registerSW({ immediate: true });

const tabs = document.querySelector<HTMLElement>("#tabs")!;
const app = document.querySelector<HTMLElement>("#app")!;

for (const calc of calculators) {
  const link = document.createElement("a");
  link.href = `#${calc.id}`;
  link.textContent = calc.title;
  link.dataset.id = calc.id;
  tabs.append(link);
}

function show(): void {
  const id = location.hash.slice(1);
  const calc = calculators.find((c) => c.id === id) ?? calculators[0];
  for (const link of tabs.querySelectorAll<HTMLAnchorElement>("a")) {
    link.toggleAttribute("aria-current", link.dataset.id === calc.id);
  }
  app.replaceChildren(calc.render());
  document.title = `${calc.title} · RF Toolkit`;
}

window.addEventListener("hashchange", show);
show();
