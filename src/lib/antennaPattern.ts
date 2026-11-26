// Idealized radiation patterns for the Antenna Length designs, to show the
// shape each one radiates: thin straight wires with a sinusoidal current, in
// free space, or over a perfect ground for the verticals with radials. Real
// patterns change with height, ground, feed line and anything nearby, so these
// are shapes to plan with, not site predictions.
//

const deg = Math.PI / 180;

/** A thin center-fed wire of the given length (in wavelengths), against the angle from its axis. */
export function wireField(lengthWl: number, fromAxisDeg: number): number {
  const kl2 = Math.PI * lengthWl; // k·L/2
  const t = fromAxisDeg * deg;
  const s = Math.sin(t);
  if (Math.abs(s) < 1e-6) return 0;
  return Math.abs((Math.cos(kl2 * Math.cos(t)) - Math.cos(kl2)) / s);
}

/** Field strength as dB below the peak, floored at floorDb. */
export const toDb = (field: number, floorDb = -30): number => (field > 0 ? Math.max(floorDb, 20 * Math.log10(field)) : floorDb);

/**
 * The full 3D pattern: relative field (0–1, not normalized) at an angle from
 * straight up (theta, 0–180°) and an azimuth (phi, from the +x axis toward +y).
 * Wire antennas lie along x, as drawn; verticals stand along z; the loop
 * stands in the x–z plane, strongest along y. Undefined for the coax stub.
 */
export function pattern3d(designId: string): ((thetaDeg: number, phiDeg: number) => number) | undefined {
  // The angle from the x axis, for wires lying along x.
  const fromX = (t: number, p: number) => (Math.acos(Math.max(-1, Math.min(1, Math.sin(t * deg) * Math.cos(p * deg)))) / deg);
  switch (designId) {
    case "dipole":
    case "efhw":
      return (t, p) => wireField(0.5, fromX(t, p));
    case "fullwave":
      return (t, p) => wireField(1, fromX(t, p));
    case "groundplane":
    case "fiveeighths": {
      const h = designId === "fiveeighths" ? 0.625 : 0.25;
      // Over ground: nothing below the horizon.
      return (t) => (t > 90 ? 0 : wireField(2 * h, t));
    }
    case "jpole":
      return (t) => wireField(0.5, t);
    case "loop":
      // Two horizontal half-wave wires a quarter wave apart, one above the other.
      return (t, p) => wireField(0.5, fromX(t, p)) * Math.abs(Math.cos((Math.PI / 4) * Math.cos(t * deg)));
    default:
      return undefined;
  }
}
