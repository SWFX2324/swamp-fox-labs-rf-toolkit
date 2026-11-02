// The "Me" button's location request, shared by every tool that has one.

import type { LatLon } from "../lib/geo";
import { LOCATION_UNSUPPORTED, locationErrorMessage } from "../lib/locationError";

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
