// The crosshair button and its location request, shared by every tool that has one.

import type { LatLon } from "../lib/geo";
import { LOCATION_UNSUPPORTED, locationErrorMessage } from "../lib/locationError";

export const CROSSHAIR_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

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
