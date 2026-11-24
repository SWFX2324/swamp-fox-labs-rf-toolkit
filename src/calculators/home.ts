// The home page: a card for each tool, with what it's for. A card opens its tool;
// every tool has an "All tools" button in the top bar back to here.

import { calculators } from ".";
import { PANE_ICONS } from "./mapFirst";

/** Each tool's card: its icon and a line on what it's for. */
const CARDS: Record<string, { icon: keyof typeof PANE_ICONS; blurb: string }> = {
  link: { icon: "terrain", blurb: "Check whether two radios can reach each other over real terrain, and find a relay spot when they can't." },
  coverage: { icon: "mapping", blurb: "Map the area one site, or up to five, can reach and be heard from." },
  mesh: { icon: "mesh", blurb: "Place up to 10 nodes and see which links hold and whether the mesh stays connected." },
  antenna: { icon: "pattern", blurb: "Cut lengths for common wire and vertical antennas, with a drawing and its radiation pattern." },
  coax: { icon: "coax", blurb: "See how much power a cable run loses, and compare cables for the same run." },
  sat: { icon: "dish", blurb: "Azimuth, elevation and skew to aim a dish at a geostationary satellite." },
  satlink: { icon: "satellite", blurb: "Uplink and downlink budget for a satellite terminal, and the margin it leaves." },
  power: { icon: "bolt", blurb: "Add up your equipment's power draw and size a generator to carry it." },
  convert: { icon: "ratio", blurb: "Convert watts and dBm, SWR and return loss, dBi and dBd, and decibel ratios." },
};

const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';

export function renderHome(): HTMLElement {
  const page = document.createElement("div");
  page.className = "home";
  page.innerHTML = `
    <h2 class="visually-hidden">Tools</h2>
    <div class="home-grid">
      ${calculators
        .filter((c) => c.inTabBar !== false && CARDS[c.id])
        .map(
          (c) => `
        <a class="tool-card" href="#${c.id}">
          <span class="tool-icon">${PANE_ICONS[CARDS[c.id].icon]}</span>
          <span class="tool-text">
            <span class="tool-title">${c.title}</span>
            <span class="tool-blurb">${CARDS[c.id].blurb}</span>
          </span>
          <span class="tool-go">${ARROW}</span>
        </a>`,
        )
        .join("")}
    </div>`;
  return page;
}
