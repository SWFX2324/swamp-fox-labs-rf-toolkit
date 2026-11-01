// A small handheld radio, the Mesh Planner's node marker. The same shapes draw
// the marker on the map and the icon inside exported KMZ files.

const WIDTH = 28;
const HEIGHT = 40;
const BODY = "M6 2.5a1.5 1.5 0 0 1 3 0V11h8V7.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V11a3 3 0 0 1 3 3v21a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V14a3 3 0 0 1 3-3z";
const SCREEN = "M8 15h12a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z";
const GRILLE = "M8 30h12M8 34h12";
const BLACK = "#0b0b0b";

/** Map marker with the node's number on the radio's screen. */
export function radioMarkerHtml(label: number): string {
  return `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${RADIO_SIZE[0]}" height="${RADIO_SIZE[1]}" aria-hidden="true">
    <path d="${BODY}" fill="${BLACK}" stroke="#fff" stroke-width="2" paint-order="stroke" stroke-linejoin="round"/>
    <path d="${SCREEN}" fill="#fff"/>
    <path d="${GRILLE}" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
    <text x="14" y="24.5" text-anchor="middle" fill="${BLACK}" font-size="12" font-weight="700" font-family="system-ui, sans-serif">${label}</text>
  </svg>`;
}

export const RADIO_SIZE: [number, number] = [22, 31];
export const RADIO_ANCHOR: [number, number] = [11, 31];

/** The radio as a PNG data URL for exports. Fixed colours: it sits on any map. */
export function radioIconUrl(): string {
  const scale = 2;
  // A margin keeps the white outline inside the image, with the base centred.
  const canvas = document.createElement("canvas");
  canvas.width = (WIDTH + 4) * scale;
  canvas.height = (HEIGHT + 2) * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
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
  return canvas.toDataURL("image/png");
}
