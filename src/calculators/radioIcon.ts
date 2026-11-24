// A small handheld radio, the marker on every map. The same shapes draw the
// marker in the app and the icon inside exported KMZ files.

import * as L from "leaflet";
import { pngBytes } from "./planBar";

const WIDTH = 28;
const HEIGHT = 40;
const BODY = "M6 13V3a1.5 1.5 0 0 1 3 0v10h7V9a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4h1a3 3 0 0 1 3 3v19a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V17a4 4 0 0 1 2-4Z";
const SCREEN = "M8.5 16h11a1.5 1.5 0 0 1 1.5 1.5V25a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 7 25v-7.5A1.5 1.5 0 0 1 8.5 16Z";
const GRILLE = "M9 30h10m-10 4h10";
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
