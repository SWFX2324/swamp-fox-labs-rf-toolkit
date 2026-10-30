// World Magnetic Model: the earth's main magnetic field at a place and date,
// following the WMM2025 Technical Report (NOAA NCEI / BGS). Used here for
// magnetic declination, the angle between true north and where a compass
// points.

import { WMM_COEFFICIENTS, WMM_EPOCH, WMM_VALID_UNTIL } from "./wmmCoefficients";

const WGS84_A = 6378.137; // km
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
/** Geomagnetic reference radius, km. */
const REF_RADIUS = 6371.2;
const MAX_N = 12;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export interface MagneticField {
  /** North, east and down components, nT. */
  x: number;
  y: number;
  z: number;
  /** Declination, degrees east of true north. */
  declination: number;
  /** Inclination (dip), degrees below horizontal. */
  inclination: number;
  /** Horizontal and total intensity, nT. */
  h: number;
  f: number;
}

/** Calendar date as a decimal year, like 2026.83. */
export function decimalYear(date: Date): number {
  const year = date.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  return year + (date.getTime() - start) / (end - start);
}

export function modelIsCurrent(year: number): boolean {
  return year >= WMM_EPOCH && year <= WMM_VALID_UNTIL;
}

const factorial = (n: number) => {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
};

// Schmidt semi-normalization factor for degree n, order m.
const schmidt = Array.from({ length: MAX_N + 1 }, (_, n) =>
  Array.from({ length: n + 1 }, (_, m) => Math.sqrt(((m === 0 ? 1 : 2) * factorial(n - m)) / factorial(n + m))),
);

/**
 * Field at a geodetic latitude/longitude (degrees), height above the WGS84
 * ellipsoid (km) and decimal year.
 */
export function magneticField(latDeg: number, lonDeg: number, heightKm: number, year: number): MagneticField {
  // Geodetic to geocentric spherical coordinates (report equations 7–8).
  const phi = rad(latDeg);
  const lambda = rad(lonDeg);
  const rc = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(phi) ** 2);
  const p = (rc + heightKm) * Math.cos(phi);
  const zc = (rc * (1 - WGS84_E2) + heightKm) * Math.sin(phi);
  const r = Math.hypot(p, zc);
  const phiC = Math.asin(zc / r);

  // Ferrers associated Legendre functions of x = sin φ′ and their
  // derivatives with respect to φ′, then Schmidt-normalized.
  const x = Math.sin(phiC);
  const c = Math.cos(phiC);
  const P: number[][] = Array.from({ length: MAX_N + 1 }, () => new Array<number>(MAX_N + 1).fill(0));
  for (let m = 0; m <= MAX_N; m++) {
    P[m][m] = m === 0 ? 1 : (2 * m - 1) * c * P[m - 1][m - 1];
    if (m < MAX_N) P[m + 1][m] = (2 * m + 1) * x * P[m][m];
    for (let n = m + 2; n <= MAX_N; n++) {
      P[n][m] = ((2 * n - 1) * x * P[n - 1][m] - (n + m - 1) * P[n - 2][m]) / (n - m);
    }
  }

  const dt = year - WMM_EPOCH;
  let X = 0;
  let Y = 0;
  let Z = 0;
  for (const [n, m, g0, h0, gd, hd] of WMM_COEFFICIENTS) {
    const g = g0 + dt * gd;
    const h = h0 + dt * hd;
    const ratio = (REF_RADIUS / r) ** (n + 2);
    const s = schmidt[n][m];
    const pnm = s * P[n][m];
    // (1 − x²) dP/dx = (n+m) P(n−1) − n x P(n), and dP/dφ′ = cos φ′ · dP/dx.
    const dpnm = (s * ((n + m) * (n > m ? P[n - 1][m] : 0) - n * x * P[n][m])) / c;
    const cos = Math.cos(m * lambda);
    const sin = Math.sin(m * lambda);
    X -= ratio * (g * cos + h * sin) * dpnm; // (10)
    Y += (ratio * m * (g * sin - h * cos) * pnm) / c; // (11)
    Z -= ratio * (n + 1) * (g * cos + h * sin) * pnm; // (12)
  }

  // Rotate from geocentric to geodetic (17).
  const psi = phiC - phi;
  const xg = X * Math.cos(psi) - Z * Math.sin(psi);
  const zg = X * Math.sin(psi) + Z * Math.cos(psi);
  const hh = Math.hypot(xg, Y);
  return {
    x: xg,
    y: Y,
    z: zg,
    declination: deg(Math.atan2(Y, xg)),
    inclination: deg(Math.atan2(zg, hh)),
    h: hh,
    f: Math.hypot(hh, zg),
  };
}

/** Magnetic declination in degrees (east positive) at ground level now. */
export function declinationDeg(latDeg: number, lonDeg: number, date = new Date(), heightKm = 0): number {
  return magneticField(latDeg, lonDeg, heightKm, decimalYear(date)).declination;
}
