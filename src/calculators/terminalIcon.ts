// A small satellite terminal, the Sat Pointing tool's marker. Matches the radio
// marker's black and white look (see radioIcon.ts).

import * as L from "leaflet";

const BLACK = "#0b0b0b";
const DISH = "M5 9A14 14 0 0 0 23 27Z";
const FRAME = "M14 18 23 9M10 22 11 30M11 26 5 30M11 26 17 30";

const html = `<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" fill="none" stroke-linecap="round" stroke-linejoin="round">
  <path d="${DISH}" stroke="#fff" stroke-width="4"/>
  <path d="${FRAME}" stroke="#fff" stroke-width="5"/>
  <circle cx="23.5" cy="8.5" r="3" fill="#fff" stroke="#fff" stroke-width="4"/>
  <path d="${FRAME}" stroke="${BLACK}" stroke-width="2.5"/>
  <path d="${DISH}" fill="${BLACK}"/>
  <circle cx="23.5" cy="8.5" r="3" fill="${BLACK}"/>
</svg>`;

/** The site marker. The middle of its feet marks the spot. */
export const terminalMarker = () => L.divIcon({ className: "radio-pin", html, iconSize: [30, 30], iconAnchor: [10, 28] });
