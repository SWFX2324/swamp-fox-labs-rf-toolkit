// The home page: a card for each tool, with what it's for. A card opens its tool;
// every tool has an "All tools" button in the top bar back to here.

import { calculators } from ".";
import { rfIcon } from "../ui/rfIcons";
import linkArt from "../assets/tool-icons/linkAnalysis.webp";
import coverageArt from "../assets/tool-icons/mapping.webp";
import meshArt from "../assets/tool-icons/mesh.webp";
import satLinkArt from "../assets/tool-icons/satellite.webp";
import pointingArt from "../assets/tool-icons/dish.webp";
import antennaArt from "../assets/tool-icons/antennaLength.webp";
import coaxArt from "../assets/tool-icons/coax.webp";
import powerArt from "../assets/tool-icons/powerPlan.webp";
import converterArt from "../assets/tool-icons/unitConverter.webp";

/** Each tool's card: its picture and a line on what it's for. */
const CARDS: Record<string, { icon: string; blurb: string }> = {
  link: { icon: linkArt, blurb: "Check whether two radios can reach each other over real terrain, and find a relay spot when they can't." },
  coverage: { icon: coverageArt, blurb: "Map the area one site, or up to five, can reach and be heard from." },
  mesh: { icon: meshArt, blurb: "Place up to 10 nodes and see which links hold and whether the mesh stays connected." },
  antenna: { icon: antennaArt, blurb: "Cut lengths for common wire and vertical antennas, with a drawing and its radiation pattern." },
  coax: { icon: coaxArt, blurb: "See how much power a cable run loses, and compare cables for the same run." },
  sat: { icon: pointingArt, blurb: "Azimuth, elevation and skew to aim a dish at a geostationary satellite." },
  satlink: { icon: satLinkArt, blurb: "Uplink and downlink budget for a satellite terminal, and the margin it leaves." },
  power: { icon: powerArt, blurb: "Add up your equipment's power draw and size a generator to carry it." },
  convert: { icon: converterArt, blurb: "Convert watts and dBm, SWR and return loss, dBi and dBd, and decibel ratios." },
};

const ARROW = rfIcon("chevronRight");

/** The home page: a card for each tool, with its picture, name and a one-line description. */
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
          <img class="tool-art" src="${CARDS[c.id].icon}" width="64" height="64" alt="" decoding="async" />
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
