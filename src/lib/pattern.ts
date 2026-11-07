// Antenna patterns: how much less than the peak gain an antenna gives off
// its main beam. The shape is the parabolic model of 3GPP TR 36.814
// (Table A.2.1.1-2), used across cellular planning:
//
//   horizontal  A_h(φ) = min(12 (φ / φ_3dB)², A_m)
//   vertical    A_v(θ) = min(12 ((θ + tilt) / θ_3dB)², SLA_v)
//   combined    A(φ, θ) = min(A_h + A_v, A_m)
//
// φ_3dB and θ_3dB are the half-power beamwidths. Where a datasheet isn't to
// hand, the vertical (and for "Directional" the horizontal) beamwidth comes
// from the gain by Kraus's rule, G ≈ 32 400 / (φ_3dB θ_3dB) in degrees, so a
// higher-gain antenna has a narrower beam, as real ones do.

export type PatternId = "omni" | "sector120" | "sector90" | "sector60" | "directional";

export interface AntennaPattern {
  id: PatternId;
  name: string;
  /** Horizontal half-power beamwidth, degrees; 360 for omni, 0 to derive it from gain. */
  hBeamwidthDeg: number;
  /** How far down the back is from the peak, dB (A_m). */
  frontToBackDb: number;
}

export const patterns: AntennaPattern[] = [
  { id: "omni", name: "Omni", hBeamwidthDeg: 360, frontToBackDb: 0 },
  { id: "sector120", name: "Sector, 120°", hBeamwidthDeg: 120, frontToBackDb: 25 },
  { id: "sector90", name: "Sector, 90°", hBeamwidthDeg: 90, frontToBackDb: 25 },
  { id: "sector60", name: "Sector, 60°", hBeamwidthDeg: 60, frontToBackDb: 25 },
  { id: "directional", name: "Directional (Yagi, panel or dish)", hBeamwidthDeg: 0, frontToBackDb: 20 },
];

export function findPattern(id: string | undefined): AntennaPattern {
  return patterns.find((p) => p.id === id) ?? patterns[0];
}

/** Kraus's beam area: G (linear) × φ × θ ≈ 32 400 square degrees. */
const BEAM_AREA_DEG2 = 32_400;
/** Vertical sidelobe floor for omni antennas, dB. */
const OMNI_VERTICAL_FLOOR_DB = 20;
const MAX_VERTICAL_BW = 90;

export interface Beam {
  pattern: AntennaPattern;
  hBeamwidthDeg: number;
  vBeamwidthDeg: number;
  /** Degrees clockwise from true north the antenna points. */
  azimuthDeg: number;
  /** Degrees below the horizon the beam points (electrical plus mechanical). */
  downtiltDeg: number;
}

/** Beamwidths for a pattern at this peak gain. */
export function beam(patternId: string | undefined, gainDbi: number, azimuthDeg = 0, downtiltDeg = 0): Beam {
  const pattern = findPattern(patternId);
  const g = 10 ** (Math.max(0, gainDbi) / 10);
  let h = pattern.hBeamwidthDeg;
  let v: number;
  if (h === 0) {
    // Directional: a round beam, as for a Yagi or dish.
    h = v = Math.min(MAX_VERTICAL_BW, Math.sqrt(BEAM_AREA_DEG2 / g));
  } else {
    v = Math.min(MAX_VERTICAL_BW, BEAM_AREA_DEG2 / (h * g));
  }
  return {
    pattern,
    hBeamwidthDeg: h,
    vBeamwidthDeg: v,
    azimuthDeg: Number.isFinite(azimuthDeg) ? azimuthDeg : 0,
    downtiltDeg: Number.isFinite(downtiltDeg) ? downtiltDeg : 0,
  };
}

/** Signed angle from a to b, −180 to 180 degrees. */
export function angleOff(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

/**
 * Loss below the peak gain toward a bearing and elevation angle (degrees,
 * positive above the horizon), dB, zero or more.
 */
export function patternLossDb(b: Beam, bearingDeg: number, elevationDeg: number): number {
  const omni = b.pattern.id === "omni";
  const cap = omni ? OMNI_VERTICAL_FLOOR_DB : b.pattern.frontToBackDb;
  const h = omni ? 0 : Math.min(12 * (angleOff(b.azimuthDeg, bearingDeg) / b.hBeamwidthDeg) ** 2, cap);
  const v = Math.min(12 * ((elevationDeg + b.downtiltDeg) / b.vBeamwidthDeg) ** 2, cap);
  return Math.min(h + v, cap);
}

/**
 * Elevation angle from one antenna top to another, degrees, allowing for the
 * earth's curve with an effective radius of k × 6371 km.
 */
export function elevationAngleDeg(fromTopM: number, toTopM: number, distanceM: number, k = 4 / 3): number {
  if (!(distanceM > 0)) return 0;
  return ((Math.atan2(toTopM - fromTopM, distanceM) - distanceM / (2 * k * 6_371_000)) * 180) / Math.PI;
}
