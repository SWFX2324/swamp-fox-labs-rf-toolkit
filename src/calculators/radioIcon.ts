// A small handheld radio, the marker on every map. The same shapes draw the
// marker in the app and the icon inside exported KMZ files.

import * as L from "leaflet";
import { pngBytes } from "./planBar";

const WIDTH = 28;
const HEIGHT = 40;
const BODY = "M6 2.5a1.5 1.5 0 0 1 3 0V11h8V7.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V11a3 3 0 0 1 3 3v21a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V14a3 3 0 0 1 3-3z";
const SCREEN = "M8 15h12a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z";
const GRILLE = "M8 30h12M8 34h12";
const BLACK = "#0b0b0b";

/** The HTML for a marker with a short label on the radio's screen. */
function radioMarkerHtml(label: string): string {
  return `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" width="22" height="31" aria-hidden="true">
    <path d="${BODY}" fill="${BLACK}" stroke="#fff" stroke-width="2" paint-order="stroke" stroke-linejoin="round"/>
    <path d="${SCREEN}" fill="#fff"/>
    <path d="${GRILLE}" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
    <text x="14" y="24.5" text-anchor="middle" fill="${BLACK}" font-size="${label.length > 1 ? 9.5 : 12}" font-weight="700" font-family="system-ui, sans-serif">${label}</text>
  </svg>`;
}

/** A map marker labelled with a node number, TX, RX or similar. Its base marks the spot. */
export const radioMarker = (label: string | number) =>
  L.divIcon({ className: "radio-pin", html: radioMarkerHtml(String(label)), iconSize: [22, 31], iconAnchor: [11, 31] });

/** The file name exported KML uses for the icon. */
export const RADIO_FILE = "radio.png";

/** The icon as a file for a KMZ. Fixed colours: it sits on any map. */
export function radioIconFile(): { name: string; data: Uint8Array } {
  // Drawn at its display size, because WinTAK sizes the icon from the image.
  // A margin keeps the white outline inside it.
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH + 4;
  canvas.height = HEIGHT + 2;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(2, 0);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const body = new Path2D(BODY);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.stroke(body);
  ctx.fillStyle = BLACK;
  ctx.fill(body);
  ctx.fillStyle = "#ffffff";
  ctx.fill(new Path2D(SCREEN));
  ctx.stroke(new Path2D(GRILLE));
  return { name: RADIO_FILE, data: pngBytes(canvas.toDataURL("image/png")) };
}
