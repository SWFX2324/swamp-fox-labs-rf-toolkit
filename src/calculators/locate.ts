import { rfIcon } from "../ui/rfIcons";
// The crosshair button and its location request, shared by every tool that has one.

import type { LatLon } from "../lib/geo";
import { LOCATION_UNSUPPORTED, locationErrorMessage } from "../lib/locationError";

export const CROSSHAIR_ICON =
  rfIcon("locate");

/** The location button. attrs is how the page finds it, such as data-action="locate". */
export function locateButton(attrs: string, label = "Use my location", cls = "unit-btn"): string {
  return `<button type="button" class="secondary ${cls} locate-btn" ${attrs} title="${label}" aria-label="${label}">${CROSSHAIR_ICON}</button>`;
}

export function locateMe(setStatus: (text: string, warn?: boolean) => void, onFound: (p: LatLon) => void): void {
  if (!navigator.geolocation) {
    setStatus(LOCATION_UNSUPPORTED, true);
    return;
  }
  setStatus("Finding your location…");
  navigator.geolocation.getCurrentPosition(
    (pos) => onFound({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
    (err) => setStatus(locationErrorMessage(err.code, navigator.userAgent.includes("Windows")), true),
    { enableHighAccuracy: true, timeout: 15000 },
  );
}
