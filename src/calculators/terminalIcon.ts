// A small satellite terminal, the Sat Pointing tool's marker. Matches the radio
// marker's black and white look (see radioIcon.ts). The dish turns about its
// mount, so the feed horn sits on the map's azimuth line.

import * as L from "leaflet";

const BLACK = "#0b0b0b";
const SIZE = 30;
const MOUNT: [number, number] = [10, 22];
// As drawn, the dish faces up and to the right.
const DRAWN_AZIMUTH = 45;
const DISH = "M5 9A14 14 0 0 0 23 27Z";
const ARM = "M14 18 23 9";
const FEED = { cx: 23.5, cy: 8.5, r: 3 };
const STAND = "M10 22 11 30M11 26 5 30M11 26 17 30";

/** The site marker, facing the azimuth if there is one. The dish's mount marks the spot. */
export function terminalMarker(azimuthDeg = DRAWN_AZIMUTH): L.DivIcon {
  const turn = `rotate(${(azimuthDeg - DRAWN_AZIMUTH).toFixed(1)} ${MOUNT[0]} ${MOUNT[1]})`;
  const feed = `cx="${FEED.cx}" cy="${FEED.cy}" r="${FEED.r}"`;
  const html = `<svg viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" aria-hidden="true" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="${STAND}" stroke="#fff" stroke-width="5"/>
    <g transform="${turn}">
      <path d="${DISH}" stroke="#fff" stroke-width="4"/>
      <path d="${ARM}" stroke="#fff" stroke-width="5"/>
      <circle ${feed} fill="#fff" stroke="#fff" stroke-width="4"/>
    </g>
    <path d="${STAND}" stroke="${BLACK}" stroke-width="2.5"/>
    <g transform="${turn}">
      <path d="${ARM}" stroke="${BLACK}" stroke-width="2.5"/>
      <path d="${DISH}" fill="${BLACK}"/>
      <circle ${feed} fill="${BLACK}"/>
    </g>
  </svg>`;
  return L.divIcon({ className: "radio-pin", html, iconSize: [SIZE, SIZE], iconAnchor: MOUNT });
}
