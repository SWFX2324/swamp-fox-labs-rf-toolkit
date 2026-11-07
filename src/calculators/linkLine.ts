// Draw a link line in the app's standard style (see lib/linkLines.ts), and the
// legend that explains the styles.

import * as L from "leaflet";
import type { LatLon } from "../lib/geo";
import { type LinkLineStyle, linkLineLabels, linkLineOrder, linkLineShortLabels } from "../lib/linkLines";

/**
 * A link between two points: a dark casing under the coloured line, so it
 * stays readable over streets, satellite imagery and terrain alike.
 */
export function drawLinkLine(map: L.Map, from: LatLon, to: LatLon, style: LinkLineStyle): L.LayerGroup {
  const points: L.LatLngExpression[] = [
    [from.lat, from.lon],
    [to.lat, to.lon],
  ];
  const group = L.layerGroup([
    L.polyline(points, { className: `link-casing link-${style}`, interactive: false }),
    L.polyline(points, { className: `link-line link-${style}`, interactive: false }),
  ]).addTo(map);
  // Weak links go underneath, so they never cover a good one.
  if (style === "fail") group.eachLayer((l) => (l as L.Polyline).bringToBack());
  return group;
}

/** A key to the line styles, for under a map. */
export function linkLegend(styles: LinkLineStyle[] = linkLineOrder): HTMLElement {
  const legend = document.createElement("ul");
  legend.className = "link-legend";
  legend.setAttribute("aria-label", "Link line key");
  legend.innerHTML = styles
    .map(
      (s) =>
        `<li title="${linkLineLabels[s]}"><svg viewBox="0 0 46 10" aria-hidden="true"><line class="link-casing link-${s}" x1="3" y1="5" x2="43" y2="5"/><line class="link-line link-${s}" x1="3" y1="5" x2="43" y2="5"/></svg><span aria-label="${linkLineLabels[s]}">${linkLineShortLabels[s]}</span></li>`,
    )
    .join("");
  return legend;
}
