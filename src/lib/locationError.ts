// What to tell someone when the browser can't get their location. The browser
// only reports the kind of failure, not the cause, so these name likely causes.

const FALLBACK = "You can also enter coordinates or pick the spot on the map.";
const WINDOWS_HINT = "On Windows, check Settings > Privacy & security > Location, and that the Geolocation Service isn't disabled.";

export const LOCATION_UNSUPPORTED = `This browser can't share its location. ${FALLBACK}`;

// GeolocationPositionError codes.
const PERMISSION_DENIED = 1;
const TIMEOUT = 3;

export function locationErrorMessage(code: number, windows: boolean): string {
  const problem =
    code === PERMISSION_DENIED ? "Location is blocked. Allow it for this site in your browser, and check that location is on in your device's settings."
    : code === TIMEOUT ? "Finding your location took too long. Try again, on Wi-Fi or with a clear view of the sky."
    : "Your device couldn't work out where it is. Check that location and Wi-Fi are on.";
  return [problem, windows ? WINDOWS_HINT : "", FALLBACK].filter(Boolean).join(" ");
}
