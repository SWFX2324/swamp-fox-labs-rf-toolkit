// The Irregular Terrain Model (ITM, also called Longley-Rice), point-to-point
// mode. Ported to TypeScript from NTIA's reference implementation,
// https://github.com/NTIA/itm (C++, version 1.4), by Swamp Fox Labs in
// November 2026. The port follows the reference function by function; names
// and equation references are kept so the two can be compared line by line.
// The area-prediction mode is not included.
//
// The reference software was developed by employees of the National
// Telecommunications and Information Administration (NTIA), an agency of the
// Federal Government, and is not subject to copyright protection in the
// United States. NTIA provides it "as is" and makes no warranty of any kind.
//
// ITM predicts the median basic transmission loss over irregular terrain from
// 20 MHz to 20 GHz, from free space, two-ray ground reflection, knife-edge and
// smooth-earth diffraction, and troposcatter, then adjusts it for how much the
// loss varies with time, location and situation (confidence).

/** Radio climates, numbered as in ITM. */
export enum Climate {
  Equatorial = 1,
  ContinentalSubtropical = 2,
  MaritimeSubtropical = 3,
  Desert = 4,
  ContinentalTemperate = 5,
  MaritimeTemperateOverLand = 6,
  MaritimeTemperateOverSea = 7,
}

/** Modes of variability. Add 10 to drop location variability, 20 to drop situation variability. */
export enum Mdvar {
  SingleMessage = 0,
  Accidental = 1,
  Mobile = 2,
  Broadcast = 3,
}

export enum PropMode {
  NotSet = 0,
  LineOfSight = 1,
  Diffraction = 2,
  Troposcatter = 3,
}

export const ItmWarning = {
  txTerminalHeight: 0x0001,
  rxTerminalHeight: 0x0002,
  frequency: 0x0004,
  pathDistanceTooBig1: 0x0008,
  pathDistanceTooBig2: 0x0010,
  pathDistanceTooSmall1: 0x0020,
  pathDistanceTooSmall2: 0x0040,
  txHorizonAngle: 0x0080,
  rxHorizonAngle: 0x0100,
  txHorizonDistance1: 0x0200,
  rxHorizonDistance1: 0x0400,
  txHorizonDistance2: 0x0800,
  rxHorizonDistance2: 0x1000,
  extremeVariabilities: 0x2000,
  surfaceRefractivity: 0x4000,
} as const;

/** Inputs that are out of ITM's range. */
export class ItmError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "ItmError";
  }
}

const PI = 3.1415926535897932384;
const SQRT2 = Math.sqrt(2);
const a_0__meter = 6370e3;
const a_9000__meter = 9000e3;
const THIRD = 1.0 / 3.0;
const MODE__P2P = 0;

const dim = (x: number, y: number) => (x > y ? x - y : 0);
const fdim = dim;
const trunc = Math.trunc;

// ---------------------------------------------------------------------------
// Complex numbers, just what ITM needs.

interface Complex {
  re: number;
  im: number;
}
const cx = (re: number, im = 0): Complex => ({ re, im });
const cAdd = (a: Complex, b: Complex): Complex => cx(a.re + b.re, a.im + b.im);
const cSub = (a: Complex, b: Complex): Complex => cx(a.re - b.re, a.im - b.im);
const cScale = (a: Complex, k: number): Complex => cx(a.re * k, a.im * k);
const cAbs = (a: Complex) => Math.hypot(a.re, a.im);
function cDiv(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im;
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
}
/** Principal square root, as std::sqrt. */
function cSqrt(a: Complex): Complex {
  const r = cAbs(a);
  const re = Math.sqrt((r + a.re) / 2);
  const im = Math.sqrt((r - a.re) / 2);
  return cx(re, a.im < 0 || Object.is(a.im, -0) ? -im : im);
}

// ---------------------------------------------------------------------------
// Terrain profile in ITM's PFL layout: [intervals, spacing m, elevations...].

type Pfl = ArrayLike<number>;

/** Build a PFL array from evenly spaced elevations over a path. */
export function toPfl(elevationsM: ArrayLike<number>, distanceM: number): Float64Array {
  const np = elevationsM.length - 1;
  const pfl = new Float64Array(np + 3);
  pfl[0] = np;
  pfl[1] = distanceM / np;
  for (let i = 0; i <= np; i++) pfl[i + 2] = elevationsM[i];
  return pfl;
}

// ---------------------------------------------------------------------------
// Helper functions

export function freeSpaceLoss(d__meter: number, f__mhz: number): number {
  return 32.45 + 20.0 * Math.log10(f__mhz) + 20.0 * Math.log10(d__meter / 1000.0);
}

function terrainRoughness(d__meter: number, delta_h__meter: number): number {
  // [ERL 79-ITS 67, Eqn 3], with distance in meters instead of kilometers
  return delta_h__meter * (1.0 - 0.8 * Math.exp(-d__meter / 50e3));
}

function sigmaHFunction(delta_h__meter: number): number {
  // [ERL 79-ITS 67, Eqn 3.6a]
  return 0.78 * delta_h__meter * Math.exp(-0.5 * delta_h__meter ** 0.25);
}

function fresnelIntegral(v2: number): number {
  // v2 is v^2, so 5.76 is comparing v to 2.4
  if (v2 < 5.76) return 6.02 + 9.11 * Math.sqrt(v2) - 1.27 * v2; // [TN101v2, Eqn III.24b]
  return 12.953 + 10 * Math.log10(v2); // [TN101v2, Eqn III.24c]
}

/** Inverse of the complementary normal distribution, Q⁻¹(q). */
export function inverseCcdf(q: number): number {
  const C_0 = 2.515516;
  const C_1 = 0.802853;
  const C_2 = 0.010328;
  const D_1 = 1.432788;
  const D_2 = 0.189269;
  const D_3 = 0.001308;

  let x = q;
  if (q > 0.5) x = 1.0 - x;
  const T_x = Math.sqrt(-2.0 * Math.log(x));
  const zeta_x = ((C_2 * T_x + C_1) * T_x + C_0) / (((D_3 * T_x + D_2) * T_x + D_1) * T_x + 1.0);
  let Q_q = T_x - zeta_x;
  if (q > 0.5) Q_q = -Q_q;
  return Q_q;
}

function initializePointToPoint(f__mhz: number, h_sys__meter: number, N_0: number, pol: number, epsilon: number, sigma: number) {
  // gamma_a is the curvature of the actual earth, ~1 / 6370 km
  const gamma_a = 157e-9;
  // scale the refractivity based on the elevation above mean sea level
  const N_s = h_sys__meter === 0.0 ? N_0 : N_0 * Math.exp(-h_sys__meter / 9460.0); // [TN101, Eq 4.3]
  // gamma_e is the curvature of the effective earth
  const gamma_e = gamma_a * (1.0 - 0.04665 * Math.exp(N_s / 179.3)); // [TN101, Eq 4.4], reworked
  // complex relative permittivity
  const ep_r = cx(epsilon, (18000 * sigma) / f__mhz);
  let Z_g = cSqrt(cSub(ep_r, cx(1.0))); // ground impedance (horizontal polarization)
  if (pol === 1) Z_g = cDiv(Z_g, ep_r); // adjust for vertical polarization
  return { Z_g, gamma_e, N_s };
}

function findHorizons(pfl: Pfl, a_e__meter: number, h__meter: [number, number]) {
  const np = trunc(pfl[0]);
  const xi = pfl[1];
  const d__meter = pfl[0] * pfl[1];

  const z_tx__meter = pfl[2] + h__meter[0];
  const z_rx__meter = pfl[np + 2] + h__meter[1];

  // set the terminal horizon angles as if the terminals are line-of-sight [TN101, Eq 6.15]
  const theta_hzn: [number, number] = [
    (z_rx__meter - z_tx__meter) / d__meter - d__meter / (2 * a_e__meter),
    -(z_rx__meter - z_tx__meter) / d__meter - d__meter / (2 * a_e__meter),
  ];
  const d_hzn__meter: [number, number] = [d__meter, d__meter];

  let d_tx__meter = 0.0;
  let d_rx__meter = d__meter;
  for (let i = 1; i < np; i++) {
    d_tx__meter = d_tx__meter + xi;
    d_rx__meter = d_rx__meter - xi;
    const theta_tx = (pfl[i + 2] - z_tx__meter) / d_tx__meter - d_tx__meter / (2 * a_e__meter);
    const theta_rx = -(z_rx__meter - pfl[i + 2]) / d_rx__meter - d_rx__meter / (2 * a_e__meter);
    if (theta_tx > theta_hzn[0]) {
      theta_hzn[0] = theta_tx;
      d_hzn__meter[0] = d_tx__meter;
    }
    if (theta_rx > theta_hzn[1]) {
      theta_hzn[1] = theta_rx;
      d_hzn__meter[1] = d_rx__meter;
    }
  }
  return { theta_hzn, d_hzn__meter };
}

function linearLeastSquaresFit(pfl: Pfl, d_start: number, d_end: number): [number, number] {
  const np = trunc(pfl[0]);
  let i_start = trunc(fdim(d_start / pfl[1], 0.0));
  let i_end = np - trunc(fdim(np, d_end / pfl[1]));
  if (i_end <= i_start) {
    i_start = trunc(fdim(i_start, 1.0));
    i_end = np - trunc(fdim(np, i_end + 1.0));
  }
  const x_length = i_end - i_start;
  let mid_shifted_index = -0.5 * x_length;
  const mid_shifted_end = i_end + mid_shifted_index;

  let sum_y = 0.5 * (pfl[i_start + 2] + pfl[i_end + 2]);
  let scaled_sum_y = 0.5 * (pfl[i_start + 2] - pfl[i_end + 2]) * mid_shifted_index;
  for (let i = 2; i <= x_length; i++) {
    i_start++;
    mid_shifted_index++;
    sum_y += pfl[i_start + 2];
    scaled_sum_y += pfl[i_start + 2] * mid_shifted_index;
  }
  sum_y = sum_y / x_length;
  scaled_sum_y = (scaled_sum_y * 12.0) / ((x_length * x_length + 2.0) * x_length);
  return [sum_y - scaled_sum_y * mid_shifted_end, sum_y + scaled_sum_y * (np - mid_shifted_end)];
}

function computeDeltaH(pfl: Pfl, d_start__meter: number, d_end__meter: number): number {
  const np = trunc(pfl[0]);
  let x_start = d_start__meter / pfl[1]; // index to start considering terrain points
  let x_end = d_end__meter / pfl[1]; // index to stop considering terrain points

  // if there are less than 2 terrain points, return delta_h = 0
  if (x_end - x_start < 2.0) return 0;

  let p10 = trunc(0.1 * (x_end - x_start + 8.0));
  p10 = Math.min(Math.max(4, p10), 25); // 10% index
  const n = 10 * p10 - 5;
  const p90 = n - p10; // 90% index

  const np_s = n - 1;
  const s = new Float64Array(n + 2);
  s[0] = np_s;
  s[1] = 1.0;

  x_end = (x_end - x_start) / np_s;
  let i = trunc(x_start);
  x_start -= i + 1.0;
  for (let j = 0; j < n; j++) {
    while (x_start > 0.0 && i + 1 < np) {
      x_start--;
      i++;
    }
    s[j + 2] = pfl[i + 3] + (pfl[i + 3] - pfl[i + 2]) * x_start;
    x_start += x_end;
  }

  let [fit_y1, fit_y2] = linearLeastSquaresFit(s, 0.0, np_s);
  fit_y2 = (fit_y2 - fit_y1) / np_s;

  // differences between the fitted line and the data, largest first
  const diffs: number[] = [];
  for (let j = 0; j < n; j++) {
    diffs.push(s[j + 2] - fit_y1);
    fit_y1 += fit_y2;
  }
  diffs.sort((a, b) => b - a);
  const q10 = diffs[p10 - 1];
  const q90 = diffs[p90];
  const delta_h_d__meter = q10 - q90;

  // [ERL 79-ITS 67, Eqn 3], inverted
  return delta_h_d__meter / (1.0 - 0.8 * Math.exp(-(d_end__meter - d_start__meter) / 50e3));
}

function quickPfl(pfl: Pfl, gamma_e: number, h__meter: [number, number]) {
  const d__meter = pfl[0] * pfl[1];
  const np = trunc(pfl[0]);
  const a_e__meter = 1 / gamma_e; // effective earth radius

  const { theta_hzn, d_hzn__meter } = findHorizons(pfl, a_e__meter, h__meter);
  const h_e__meter: [number, number] = [0, 0];

  // consider terrain from about 15 times the tower height [Hufford, 1982, p. 25]
  const d_start__meter = Math.min(15.0 * h__meter[0], 0.1 * d_hzn__meter[0]);
  const d_end__meter = d__meter - Math.min(15.0 * h__meter[1], 0.1 * d_hzn__meter[1]);

  const delta_h__meter = computeDeltaH(pfl, d_start__meter, d_end__meter);

  if (d_hzn__meter[0] + d_hzn__meter[1] > 1.5 * d__meter) {
    // well within line-of-sight range
    const [fit_tx, fit_rx] = linearLeastSquaresFit(pfl, d_start__meter, d_end__meter);
    h_e__meter[0] = h__meter[0] + fdim(pfl[2], fit_tx);
    h_e__meter[1] = h__meter[1] + fdim(pfl[np + 2], fit_rx);

    for (let i = 0; i < 2; i++)
      d_hzn__meter[i] = Math.sqrt(2.0 * h_e__meter[i] * a_e__meter) * Math.exp(-0.07 * Math.sqrt(delta_h__meter / Math.max(h_e__meter[i], 5.0)));

    const combined_horizons__meter = d_hzn__meter[0] + d_hzn__meter[1];
    if (combined_horizons__meter <= d__meter) {
      const q = (d__meter / combined_horizons__meter) ** 2;
      for (let i = 0; i < 2; i++) {
        h_e__meter[i] = h_e__meter[i] * q;
        d_hzn__meter[i] = Math.sqrt(2.0 * h_e__meter[i] * a_e__meter) * Math.exp(-0.07 * Math.sqrt(delta_h__meter / Math.max(h_e__meter[i], 5.0)));
      }
    }

    for (let i = 0; i < 2; i++) {
      const q = Math.sqrt(2.0 * h_e__meter[i] * a_e__meter);
      theta_hzn[i] = (0.65 * delta_h__meter * (q / d_hzn__meter[i] - 1.0) - 2.0 * h_e__meter[i]) / q;
    }
  } else {
    const [fit_tx] = linearLeastSquaresFit(pfl, d_start__meter, 0.9 * d_hzn__meter[0]);
    h_e__meter[0] = h__meter[0] + fdim(pfl[2], fit_tx);
    const [, fit_rx] = linearLeastSquaresFit(pfl, d__meter - 0.9 * d_hzn__meter[1], d_end__meter);
    h_e__meter[1] = h__meter[1] + fdim(pfl[np + 2], fit_rx);
  }

  return { theta_hzn, d_hzn__meter, h_e__meter, delta_h__meter, d__meter };
}

// ---------------------------------------------------------------------------
// Diffraction

function knifeEdgeDiffraction(d__meter: number, f__mhz: number, a_e__meter: number, theta_los: number, d_hzn__meter: [number, number]): number {
  const d_ML__meter = d_hzn__meter[0] + d_hzn__meter[1];
  const theta_nlos = d__meter / a_e__meter - theta_los; // [Algorithm, Eqn 4.12]
  const d_nlos__meter = d__meter - d_ML__meter;
  // 1 / (4 pi) = 0.0795775 [TN101, Eqn I.7]
  const v_1 = (0.0795775 * (f__mhz / 47.7) * theta_nlos ** 2 * d_hzn__meter[0] * d_nlos__meter) / (d_nlos__meter + d_hzn__meter[0]);
  const v_2 = (0.0795775 * (f__mhz / 47.7) * theta_nlos ** 2 * d_hzn__meter[1] * d_nlos__meter) / (d_nlos__meter + d_hzn__meter[1]);
  return fresnelIntegral(v_1) + fresnelIntegral(v_2); // [TN101, Eqn I.1]
}

function heightFunction(x__km: number, K: number): number {
  let result: number;
  if (x__km < 200.0) {
    const w = -Math.log(K);
    if (K < 1e-5 || x__km * w ** 3 > 5495.0) {
      result = -117.0;
      if (x__km > 1.0) result = 17.372 * Math.log(x__km) + result;
    } else result = (2.5e-5 * x__km ** 2) / K - 8.686 * w - 15.0;
  } else {
    result = 0.05751 * x__km - 4.343 * Math.log(x__km);
    if (x__km < 2000) {
      const w = 0.0134 * x__km * Math.exp(-0.005 * x__km);
      result = (1.0 - w) * result + w * (17.372 * Math.log(x__km) - 117.0);
    }
  }
  return result;
}

function smoothEarthDiffraction(
  d__meter: number,
  f__mhz: number,
  a_e__meter: number,
  theta_los: number,
  d_hzn__meter: [number, number],
  h_e__meter: [number, number],
  Z_g: Complex,
): number {
  const theta_nlos = d__meter / a_e__meter - theta_los; // [Algorithm, Eqn 4.12]
  const d_ML__meter = d_hzn__meter[0] + d_hzn__meter[1];

  const a__meter = [
    (d__meter - d_ML__meter) / (d__meter / a_e__meter - theta_los),
    (0.5 * d_hzn__meter[0] ** 2) / h_e__meter[0], // [Vogler 1964, Eqn 3] rearranged
    (0.5 * d_hzn__meter[1] ** 2) / h_e__meter[1],
  ];
  const d__km = [(a__meter[0] * theta_nlos) / 1000.0, d_hzn__meter[0] / 1000.0, d_hzn__meter[1] / 1000.0];

  const C_0: number[] = [];
  const K: number[] = [];
  const B_0: number[] = [];
  for (let i = 0; i < 3; i++) {
    C_0[i] = (((4.0 / 3.0) * a_0__meter) / a__meter[i]) ** THIRD; // [Vogler 1964, Eqn 2]
    K[i] = (0.017778 * C_0[i] * f__mhz ** -THIRD) / cAbs(Z_g); // [Vogler 1964, Eqn 6a / 7a]
    B_0[i] = 1.607 - K[i]; // [Vogler 1964, Fig 4]
  }

  const x__km: number[] = [];
  x__km[1] = B_0[1] * C_0[1] ** 2 * f__mhz ** THIRD * d__km[1];
  x__km[2] = B_0[2] * C_0[2] ** 2 * f__mhz ** THIRD * d__km[2];
  x__km[0] = B_0[0] * C_0[0] ** 2 * f__mhz ** THIRD * d__km[0] + x__km[1] + x__km[2];

  const F_x__db = [heightFunction(x__km[1], K[1]), heightFunction(x__km[2], K[2])];
  const G_x__db = 0.05751 * x__km[0] - 10.0 * Math.log10(x__km[0]); // [TN101, Eqn 8.4]

  return G_x__db - F_x__db[0] - F_x__db[1] - 20; // [Algorithm, Eqn 4.20]
}

function diffractionLoss(
  d__meter: number,
  d_hzn__meter: [number, number],
  h_e__meter: [number, number],
  Z_g: Complex,
  a_e__meter: number,
  delta_h__meter: number,
  h__meter: [number, number],
  mode: number,
  theta_los: number,
  d_sML__meter: number,
  f__mhz: number,
): number {
  const A_k__db = knifeEdgeDiffraction(d__meter, f__mhz, a_e__meter, theta_los, d_hzn__meter);
  const A_se__db = smoothEarthDiffraction(d__meter, f__mhz, a_e__meter, theta_los, d_hzn__meter, h_e__meter, Z_g);

  // Terrain clutter [ERL 79-ITS 67, page 3-13]
  const delta_h_dsML__meter = terrainRoughness(d_sML__meter, delta_h__meter);
  const sigma_h_d__meter = sigmaHFunction(delta_h_dsML__meter);
  // Clutter factor [ERL 79-ITS 67, Eqn 3.38c]
  const A_fo__db = Math.min(15.0, 5 * Math.log10(1.0 + 1e-5 * h__meter[0] * h__meter[1] * f__mhz * sigma_h_d__meter));

  // Combined diffraction losses
  const delta_h_d__meter = terrainRoughness(d__meter, delta_h__meter);
  let q = h__meter[0] * h__meter[1];
  const qk = h_e__meter[0] * h_e__meter[1] - q;
  // For low antennas with known path parameters, C ~= 10 [ERL 79-ITS 67, page 3-8]
  if (mode === MODE__P2P) q += 10.0;
  const term1 = Math.sqrt(1.0 + qk / q); // [ERL 79-ITS 67, Eqn 3.23]
  const d_ML__meter = d_hzn__meter[0] + d_hzn__meter[1];
  q = (term1 + (-theta_los * a_e__meter + d_ML__meter) / d__meter) * Math.min((delta_h_d__meter * f__mhz) / 47.7, 6283.2);
  // weighting factor [ERL 79-ITS 67, Eqn 3.23]
  const w = 25.1 / (25.1 + Math.sqrt(q));

  return w * A_se__db + (1.0 - w) * A_k__db + A_fo__db;
}

// ---------------------------------------------------------------------------
// Line of sight

function lineOfSightLoss(
  d__meter: number,
  h_e__meter: [number, number],
  Z_g: Complex,
  delta_h__meter: number,
  M_d: number,
  A_d0: number,
  d_sML__meter: number,
  f__mhz: number,
): number {
  const delta_h_d__meter = terrainRoughness(d__meter, delta_h__meter);
  const sigma_h_d__meter = sigmaHFunction(delta_h_d__meter);
  const wn = f__mhz / 47.7; // wavenumber

  // [Algorithm, Eqn 4.46]
  const sin_psi = (h_e__meter[0] + h_e__meter[1]) / Math.sqrt(d__meter ** 2 + (h_e__meter[0] + h_e__meter[1]) ** 2);
  // [Algorithm, Eqn 4.47]
  let R_e = cScale(cDiv(cSub(cx(sin_psi), Z_g), cAdd(cx(sin_psi), Z_g)), Math.exp(-Math.min(10.0, wn * sigma_h_d__meter * sin_psi)));
  // [Algorithm, Eqn 4.48]
  const q = R_e.re ** 2 + R_e.im ** 2;
  if (q < 0.25 || q < sin_psi) R_e = cScale(R_e, Math.sqrt(sin_psi / q));

  // phase difference between rays [Algorithm, Eqn 4.49]
  let delta_phi = (wn * 2.0 * h_e__meter[0] * h_e__meter[1]) / d__meter;
  // [Algorithm, Eqn 4.50]
  if (delta_phi > PI / 2.0) delta_phi = PI - (PI / 2.0) ** 2 / delta_phi;

  // Two-ray attenuation
  const rr = cAdd(cx(Math.cos(delta_phi), -Math.sin(delta_phi)), R_e);
  const A_t__db = -10 * Math.log10(rr.re ** 2 + rr.im ** 2);
  // Extended diffraction attenuation
  const A_d__db = M_d * d__meter + A_d0;
  // weighting factor
  const w = 1 / (1 + (f__mhz * delta_h__meter) / Math.max(10e3, d_sML__meter));

  return w * A_t__db + (1 - w) * A_d__db;
}

// ---------------------------------------------------------------------------
// Troposcatter

function fFunction(td: number): number {
  // constants from [Algorithm, 6.9]
  const a = [133.4, 104.6, 71.8];
  const b = [0.332e-3, 0.212e-3, 0.157e-3];
  const c = [-10, -2.5, 5];
  const i = td <= 10e3 ? 0 : td <= 70e3 ? 1 : 2;
  return a[i] + b[i] * td + c[i] * Math.log10(td); // [Algorithm, 6.9]
}

function h0Curve(j: number, r: number): number {
  // values from [Algorithm, 6.13]
  const a = [25.0, 80.0, 177.0, 395.0, 705.0];
  const b = [24.0, 45.0, 68.0, 80.0, 105.0];
  return 10 * Math.log10(1 + a[j] * (1 / r) ** 4 + b[j] * (1.0 / r) ** 2);
}

function h0Function(r: number, eta_s: number): number {
  eta_s = Math.min(Math.max(eta_s, 1), 5); // range 1 <= eta_s <= 5
  const i = trunc(eta_s);
  const q = eta_s - i;
  let result = h0Curve(i - 1, r);
  if (q !== 0.0) result = (1.0 - q) * result + q * h0Curve(i, r);
  return result;
}

/** Troposcatter loss; h0 carries H_0 between the two calls, as in the reference. */
function troposcatterLoss(
  d__meter: number,
  theta_hzn: [number, number],
  d_hzn__meter: [number, number],
  h_e__meter: [number, number],
  a_e__meter: number,
  N_s: number,
  f__mhz: number,
  theta_los: number,
  h0: { value: number },
): number {
  let H_0: number;
  const wn = f__mhz / 47.7;

  if (h0.value > 15.0) H_0 = h0.value;
  else {
    let ad = d_hzn__meter[0] - d_hzn__meter[1];
    let rr = h_e__meter[1] / h_e__meter[0];
    if (ad < 0.0) {
      ad = -ad;
      rr = 1.0 / rr;
    }

    const theta = theta_hzn[0] + theta_hzn[1] + d__meter / a_e__meter; // angular distance, radians

    // [TN101, Eqn 9.4a]
    const r_1 = 2.0 * wn * theta * h_e__meter[0];
    const r_2 = 2.0 * wn * theta * h_e__meter[1];

    if (r_1 < 0.2 && r_2 < 0.2) return 1001; // A_scat not defined [Algorithm, page 11]

    let s = (d__meter - ad) / (d__meter + ad); // asymmetry parameter
    const q = Math.min(Math.max(0.1, rr / s), 10.0); // TN101, Eqn 9.5
    s = Math.max(0.1, s);

    const h_0__meter = ((d__meter - ad) * (d__meter + ad) * theta * 0.25) / d__meter; // [Algorithm, 4.66]

    const Z_0__meter = 1.7556e3; // [Algorithm, 4.67]
    const Z_1__meter = 8.0e3;
    const eta_s = (h_0__meter / Z_0__meter) * (1.0 + (0.031 - N_s * 2.32e-3 + N_s ** 2 * 5.67e-6) * Math.exp(-(Math.min(1.7, h_0__meter / Z_1__meter) ** 6))); // [TN101 Eqn 9.3a]

    const H_00 = (h0Function(r_1, eta_s) + h0Function(r_2, eta_s)) / 2;
    const Delta_H_0 = Math.min(H_00, 6.0 * (0.6 - Math.log10(Math.max(eta_s, 1.0))) * Math.log10(s) * Math.log10(q));

    H_0 = H_00 + Delta_H_0; // TN101, Eqn 9.5
    H_0 = Math.max(H_0, 0.0);

    if (eta_s < 1.0)
      H_0 = eta_s * H_0 + (1.0 - eta_s) * 10 * Math.log10(((1.0 + SQRT2 / r_1) * (1.0 + SQRT2 / r_2)) ** 2 * (r_1 + r_2) / (r_1 + r_2 + 2 * SQRT2));

    // if H_0 exceeds 15 dB at d_5, use its value at d_6 [Algorithm, page 12]
    if (H_0 > 15.0 && h0.value >= 0.0) H_0 = h0.value;
  }

  h0.value = H_0;
  const th = d__meter / a_e__meter - theta_los;

  const D_0__meter = 40e3; // [Algorithm, 6.8]
  const H__meter = 47.7; // [Algorithm, 4.63]
  return fFunction(th * d__meter) + 10 * Math.log10(wn * H__meter * th ** 4) - 0.1 * (N_s - 301.0) * Math.exp((-th * d__meter) / D_0__meter) + H_0; // [Algorithm, 4.63]
}

// ---------------------------------------------------------------------------
// Reference attenuation

function longleyRice(
  theta_hzn: [number, number],
  f__mhz: number,
  Z_g: Complex,
  d_hzn__meter: [number, number],
  h_e__meter: [number, number],
  gamma_e: number,
  N_s: number,
  delta_h__meter: number,
  h__meter: [number, number],
  d__meter: number,
  mode: number,
  warn: { flags: number },
): { A_ref__db: number; propmode: PropMode } {
  const a_e__meter = 1 / gamma_e;

  const d_hzn_s__meter = [Math.sqrt(2.0 * h_e__meter[0] * a_e__meter), Math.sqrt(2.0 * h_e__meter[1] * a_e__meter)];
  const d_sML__meter = d_hzn_s__meter[0] + d_hzn_s__meter[1]; // max LOS distance, smooth earth
  const d_ML__meter = d_hzn__meter[0] + d_hzn__meter[1]; // max LOS distance, actual path
  const theta_los = -Math.max(theta_hzn[0] + theta_hzn[1], -d_ML__meter / a_e__meter);

  if (Math.abs(theta_hzn[0]) > 200e-3) warn.flags |= ItmWarning.txHorizonAngle;
  if (Math.abs(theta_hzn[1]) > 200e-3) warn.flags |= ItmWarning.rxHorizonAngle;
  if (d_hzn__meter[0] < 0.1 * d_hzn_s__meter[0]) warn.flags |= ItmWarning.txHorizonDistance1;
  if (d_hzn__meter[1] < 0.1 * d_hzn_s__meter[1]) warn.flags |= ItmWarning.rxHorizonDistance1;
  if (d_hzn__meter[0] > 3.0 * d_hzn_s__meter[0]) warn.flags |= ItmWarning.txHorizonDistance2;
  if (d_hzn__meter[1] > 3.0 * d_hzn_s__meter[1]) warn.flags |= ItmWarning.rxHorizonDistance2;

  if (N_s < 150) throw new ItmError(1021, "Surface refractivity is too small.");
  if (N_s > 400) throw new ItmError(1022, "Surface refractivity is too large.");
  if (N_s < 250) warn.flags |= ItmWarning.surfaceRefractivity;

  if (a_e__meter < 4000000 || a_e__meter > 13333333) throw new ItmError(1016, "Effective earth radius is out of range.");
  if (Z_g.re <= Math.abs(Z_g.im)) throw new ItmError(1013, "Ground constants give an invalid ground impedance.");

  // two distances far in the diffraction region
  const scale = (a_e__meter ** 2 / f__mhz) ** (1.0 / 3.0);
  const d_3__meter = Math.max(d_sML__meter, d_ML__meter + 5.0 * scale);
  const d_4__meter = d_3__meter + 10.0 * scale;

  const A_3__db = diffractionLoss(d_3__meter, d_hzn__meter, h_e__meter, Z_g, a_e__meter, delta_h__meter, h__meter, mode, theta_los, d_sML__meter, f__mhz);
  const A_4__db = diffractionLoss(d_4__meter, d_hzn__meter, h_e__meter, Z_g, a_e__meter, delta_h__meter, h__meter, mode, theta_los, d_sML__meter, f__mhz);

  // slope and intercept of the diffraction line
  const M_d = (A_4__db - A_3__db) / (d_4__meter - d_3__meter);
  const A_d0__db = A_3__db - M_d * d_3__meter;

  const d_min__meter = Math.abs(h_e__meter[0] - h_e__meter[1]) / 200e-3;
  if (d__meter < d_min__meter) warn.flags |= ItmWarning.pathDistanceTooSmall1;
  if (d__meter < 1e3) warn.flags |= ItmWarning.pathDistanceTooSmall2;
  if (d__meter > 1000e3) warn.flags |= ItmWarning.pathDistanceTooBig1;
  if (d__meter > 2000e3) warn.flags |= ItmWarning.pathDistanceTooBig2;

  let A_ref__db: number;
  let propmode: PropMode;

  if (d__meter < d_sML__meter) {
    const A_sML__db = d_sML__meter * M_d + A_d0__db;

    // [ERL 79-ITS 67, Eqn 3.16a]
    let d_0__meter = 0.04 * f__mhz * h_e__meter[0] * h_e__meter[1];
    let d_1__meter: number;
    if (A_d0__db >= 0.0) {
      d_0__meter = Math.min(d_0__meter, 0.5 * d_ML__meter);
      d_1__meter = d_0__meter + 0.25 * (d_ML__meter - d_0__meter); // [ERL 79-ITS 67, Eqn 3.16d]
    } else d_1__meter = Math.max(-A_d0__db / M_d, 0.25 * d_ML__meter);

    const A_1__db = lineOfSightLoss(d_1__meter, h_e__meter, Z_g, delta_h__meter, M_d, A_d0__db, d_sML__meter, f__mhz);

    let flag = false;
    let kHat_1__db_per_meter = 0;
    let kHat_2__db_per_meter = 0;

    if (d_0__meter < d_1__meter) {
      const A_0__db = lineOfSightLoss(d_0__meter, h_e__meter, Z_g, delta_h__meter, M_d, A_d0__db, d_sML__meter, f__mhz);
      const q = Math.log(d_sML__meter / d_0__meter);

      // [ERL 79-ITS 67, Eqn 3.20]
      kHat_2__db_per_meter = Math.max(
        0.0,
        ((d_sML__meter - d_0__meter) * (A_1__db - A_0__db) - (d_1__meter - d_0__meter) * (A_sML__db - A_0__db)) /
          ((d_sML__meter - d_0__meter) * Math.log(d_1__meter / d_0__meter) - (d_1__meter - d_0__meter) * q),
      );

      flag = A_d0__db > 0.0 || kHat_2__db_per_meter > 0.0;
      if (flag) {
        // [ERL 79-ITS 67, Eqn 3.21]
        kHat_1__db_per_meter = (A_sML__db - A_0__db - kHat_2__db_per_meter * q) / (d_sML__meter - d_0__meter);
        if (kHat_1__db_per_meter < 0.0) {
          kHat_1__db_per_meter = 0.0;
          kHat_2__db_per_meter = dim(A_sML__db, A_0__db) / q;
          if (kHat_2__db_per_meter === 0.0) kHat_1__db_per_meter = M_d;
        }
      }
    }

    if (!flag) {
      kHat_1__db_per_meter = dim(A_sML__db, A_1__db) / (d_sML__meter - d_1__meter);
      kHat_2__db_per_meter = 0.0;
      if (kHat_1__db_per_meter === 0.0) kHat_1__db_per_meter = M_d;
    }

    const A_o__db = A_sML__db - kHat_1__db_per_meter * d_sML__meter - kHat_2__db_per_meter * Math.log(d_sML__meter);

    // [ERL 79-ITS 67, Eqn 3.19]
    A_ref__db = A_o__db + kHat_1__db_per_meter * d__meter + kHat_2__db_per_meter * Math.log(d__meter);
    propmode = PropMode.LineOfSight;
  } else {
    // trans-horizon path: two points far into the troposcatter region
    const d_5__meter = d_ML__meter + 200e3;
    const d_6__meter = d_ML__meter + 400e3;

    const h0 = { value: -1 };
    const A_6__db = troposcatterLoss(d_6__meter, theta_hzn, d_hzn__meter, h_e__meter, a_e__meter, N_s, f__mhz, theta_los, h0);
    const A_5__db = troposcatterLoss(d_5__meter, theta_hzn, d_hzn__meter, h_e__meter, a_e__meter, N_s, f__mhz, theta_los, h0);

    let M_s: number;
    let A_s0__db: number;
    let d_x__meter: number;
    if (A_5__db < 1000.0) {
      M_s = (A_6__db - A_5__db) / 200e3;
      // diffraction-troposcatter transition distance
      d_x__meter = Math.max(
        Math.max(d_sML__meter, d_ML__meter + 1.088 * (a_e__meter ** 2 / f__mhz) ** (1.0 / 3.0) * Math.log(f__mhz)),
        (A_5__db - A_d0__db - M_s * d_5__meter) / (M_d - M_s),
      );
      A_s0__db = (M_d - M_s) * d_x__meter + A_d0__db;
    } else {
      // troposcatter gives no real results, so use the diffraction line
      M_s = M_d;
      A_s0__db = A_d0__db;
      d_x__meter = 10e6;
    }

    if (d__meter > d_x__meter) {
      A_ref__db = M_s * d__meter + A_s0__db;
      propmode = PropMode.Troposcatter;
    } else {
      A_ref__db = M_d * d__meter + A_d0__db;
      propmode = PropMode.Diffraction;
    }
  }

  // Don't allow a negative loss
  return { A_ref__db: Math.max(A_ref__db, 0.0), propmode };
}

// ---------------------------------------------------------------------------
// Variability

function curve(c1: number, c2: number, x1: number, x2: number, x3: number, d_e__meter: number): number {
  return ((c1 + c2 / (1.0 + ((d_e__meter - x2) / x3) ** 2)) * (d_e__meter / x1) ** 2) / (1.0 + (d_e__meter / x1) ** 2);
}

// Asymptotic values from TN101, Fig 10.13, per climate
const all_year = [
  [-9.67, -0.62, 1.26, -9.21, -0.62, -0.39, 3.15],
  [12.7, 9.19, 15.5, 9.05, 9.19, 2.86, 857.9],
  [144.9e3, 228.9e3, 262.6e3, 84.1e3, 228.9e3, 141.7e3, 2222e3],
  [190.3e3, 205.2e3, 185.2e3, 101.1e3, 205.2e3, 315.9e3, 164.8e3],
  [133.8e3, 143.6e3, 99.8e3, 98.6e3, 143.6e3, 167.4e3, 116.3e3],
];
const bsm1 = [2.13, 2.66, 6.11, 1.98, 2.68, 6.86, 8.51];
const bsm2 = [159.5, 7.67, 6.65, 13.11, 7.16, 10.38, 169.8];
const xsm1 = [762.2e3, 100.4e3, 138.2e3, 139.1e3, 93.7e3, 187.8e3, 609.8e3];
const xsm2 = [123.6e3, 172.5e3, 242.2e3, 132.7e3, 186.8e3, 169.6e3, 119.9e3];
const xsm3 = [94.5e3, 136.4e3, 178.6e3, 193.5e3, 133.5e3, 108.9e3, 106.6e3];
const bsp1 = [2.11, 6.87, 10.08, 3.68, 4.75, 8.58, 8.43];
const bsp2 = [102.3, 15.53, 9.6, 159.3, 8.12, 13.97, 8.19];
const xsp1 = [636.9e3, 138.7e3, 165.3e3, 464.4e3, 93.2e3, 216.0e3, 136.2e3];
const xsp2 = [134.8e3, 143.7e3, 225.7e3, 93.1e3, 135.9e3, 152.0e3, 188.5e3];
const xsp3 = [95.6e3, 98.6e3, 129.7e3, 94.2e3, 113.4e3, 122.7e3, 122.9e3];
const C_D = [1.224, 0.801, 1.38, 1.0, 1.224, 1.518, 1.518]; // [Algorithm, Table 5.1]
const z_D = [1.282, 2.161, 1.282, 20.0, 1.282, 1.282, 1.282]; // [Algorithm, Table 5.1]
const bfm1 = [1.0, 1.0, 1.0, 1.0, 0.92, 1.0, 1.0];
const bfm2 = [0.0, 0.0, 0.0, 0.0, 0.25, 0.0, 0.0];
const bfm3 = [0.0, 0.0, 0.0, 0.0, 1.77, 0.0, 0.0];
const bfp1 = [1.0, 0.93, 1.0, 0.93, 0.93, 1.0, 1.0];
const bfp2 = [0.0, 0.31, 0.0, 0.19, 0.31, 0.0, 0.0];
const bfp3 = [0.0, 2.0, 0.0, 1.79, 2.0, 0.0, 0.0];

/** Everything Variability needs from the path, so the loss at other percentages is quick to find. */
export interface VariabilityPath {
  h_e__meter: [number, number];
  delta_h__meter: number;
  f__mhz: number;
  d__meter: number;
  A_ref__db: number;
  climate: Climate;
  mdvar: number;
}

function variability(time: number, location: number, situation: number, p: VariabilityPath, warn: { flags: number }): number {
  const { h_e__meter, delta_h__meter, f__mhz, d__meter, A_ref__db, climate, mdvar } = p;
  let z_T = inverseCcdf(time / 100);
  let z_L = inverseCcdf(location / 100);
  const z_S = inverseCcdf(situation / 100);

  const c = climate - 1; // 0-based index
  const wn = f__mhz / 47.7;

  // effective distance [Algorithm, Eqn 5.3]
  const d_ex__meter = Math.sqrt(2 * a_9000__meter * h_e__meter[0]) + Math.sqrt(2 * a_9000__meter * h_e__meter[1]) + (575.7e12 / wn) ** THIRD;
  const d_e__meter = d__meter < d_ex__meter ? (130e3 * d__meter) / d_ex__meter : 130e3 + d__meter - d_ex__meter;

  // situation variability: mdvar >= 20 drops direct situation variability [Hufford, 1982]
  let mdvar_internal = mdvar;
  const plus20 = mdvar_internal >= 20;
  if (plus20) mdvar_internal -= 20;
  const sigma_S = plus20 ? 0.0 : 5.0 + 3.0 * Math.exp(-d_e__meter / 100e3); // [Algorithm, Eqn 5.10]

  const plus10 = mdvar_internal >= 10;
  if (plus10) mdvar_internal -= 10;

  const V_med__db = curve(all_year[0][c], all_year[1][c], all_year[2][c], all_year[3][c], all_year[4][c], d_e__meter);

  if (mdvar_internal === Mdvar.SingleMessage) {
    z_T = z_S;
    z_L = z_S;
  } else if (mdvar_internal === Mdvar.Accidental) z_L = z_S;
  else if (mdvar_internal === Mdvar.Mobile) z_L = z_T;
  // else Broadcast: no change

  if (Math.abs(z_T) > 3.1 || Math.abs(z_L) > 3.1 || Math.abs(z_S) > 3.1) warn.flags |= ItmWarning.extremeVariabilities;

  // location variability [Algorithm, Eqn 5.9]
  let sigma_L = 0.0;
  if (!plus10) {
    const delta_h_d__meter = terrainRoughness(d__meter, delta_h__meter);
    sigma_L = (10.0 * wn * delta_h_d__meter) / (wn * delta_h_d__meter + 13.0);
  }
  const Y_L = sigma_L * z_L;

  // time variability
  const q = Math.log(0.133 * wn);
  const g_minus = bfm1[c] + bfm2[c] / ((bfm3[c] * q) ** 2 + 1.0);
  const g_plus = bfp1[c] + bfp2[c] / ((bfp3[c] * q) ** 2 + 1.0);
  const sigma_T_minus = curve(bsm1[c], bsm2[c], xsm1[c], xsm2[c], xsm3[c], d_e__meter) * g_minus;
  const sigma_T_plus = curve(bsp1[c], bsp2[c], xsp1[c], xsp2[c], xsp3[c], d_e__meter) * g_plus;
  const sigma_TD = C_D[c] * sigma_T_plus;
  const tgtd = (sigma_T_plus - sigma_TD) * z_D[c];

  let sigma_T: number;
  if (z_T < 0.0) sigma_T = sigma_T_minus;
  else if (z_T <= z_D[c]) sigma_T = sigma_T_plus;
  else sigma_T = sigma_TD + tgtd / z_T;
  const Y_T = sigma_T * z_T;

  const Y_S_temp = sigma_S ** 2 + Y_T ** 2 / (7.8 + z_S ** 2) + Y_L ** 2 / (24.0 + z_S ** 2); // part of [Algorithm, Eqn 5.11]

  let Y_R: number;
  let Y_S: number;
  if (mdvar_internal === Mdvar.SingleMessage) {
    Y_R = 0.0;
    Y_S = Math.sqrt(sigma_T ** 2 + sigma_L ** 2 + Y_S_temp) * z_S;
  } else if (mdvar_internal === Mdvar.Accidental) {
    Y_R = Y_T;
    Y_S = Math.sqrt(sigma_L ** 2 + Y_S_temp) * z_S;
  } else if (mdvar_internal === Mdvar.Mobile) {
    Y_R = Math.sqrt(sigma_T ** 2 + sigma_L ** 2) * z_T;
    Y_S = Math.sqrt(Y_S_temp) * z_S;
  } else {
    Y_R = Y_T + Y_L;
    Y_S = Math.sqrt(Y_S_temp) * z_S;
  }

  let result = A_ref__db - V_med__db - Y_R - Y_S;
  // [Algorithm, Eqn 52]
  if (result < 0.0) result = (result * (29.0 - result)) / (29.0 - 10.0 * result);
  return result;
}

// ---------------------------------------------------------------------------
// Point-to-point entry point

export interface ItmP2PInputs {
  txHeightM: number;
  rxHeightM: number;
  /** Ground elevations above sea level, TX first, evenly spaced. */
  elevationsM: ArrayLike<number>;
  distanceM: number;
  freqMhz: number;
  climate: Climate;
  /** Surface refractivity at sea level, N-units (301 is a typical value). */
  refractivityN: number;
  polarization: "horizontal" | "vertical";
  /** Ground relative permittivity. */
  permittivity: number;
  /** Ground conductivity, S/m. */
  conductivity: number;
  mdvar: number;
  /** Percent of time, locations and situations, each 0–100 exclusive. */
  time: number;
  location: number;
  situation: number;
}

export interface ItmP2PResult {
  /** Basic transmission loss, dB: free space plus everything else. */
  lossDb: number;
  /** Free-space loss over the path, dB. */
  freeSpaceDb: number;
  /** Median loss beyond free space before variability, dB. */
  referenceDb: number;
  mode: PropMode;
  /** ItmWarning flags. */
  warnings: number;
  deltaHM: number;
  effectiveHeightsM: [number, number];
  horizonDistancesM: [number, number];
  horizonAnglesRad: [number, number];
  surfaceRefractivityN: number;
  /** For lossAtPercentages. */
  path: VariabilityPath;
}

function validateInputs(i: ItmP2PInputs, warn: { flags: number }): void {
  const { txHeightM: h_tx, rxHeightM: h_rx, climate, refractivityN: N_0, freqMhz: f, permittivity, conductivity, mdvar } = i;
  if (h_tx < 1.0 || h_tx > 1000.0) warn.flags |= ItmWarning.txTerminalHeight;
  if (!(h_tx >= 0.5 && h_tx <= 3000.0)) throw new ItmError(1000, "Transmit antenna height must be 0.5–3000 m.");
  if (h_rx < 1.0 || h_rx > 1000.0) warn.flags |= ItmWarning.rxTerminalHeight;
  if (!(h_rx >= 0.5 && h_rx <= 3000.0)) throw new ItmError(1001, "Receive antenna height must be 0.5–3000 m.");
  if (!(climate >= 1 && climate <= 7 && Number.isInteger(climate))) throw new ItmError(1002, "Invalid radio climate.");
  if (!(N_0 >= 250 && N_0 <= 400)) throw new ItmError(1008, "Surface refractivity must be 250–400 N-units.");
  if (f < 40.0 || f > 10000.0) warn.flags |= ItmWarning.frequency;
  if (!(f >= 20 && f <= 20000)) throw new ItmError(1009, "ITM covers 20 MHz to 20 GHz.");
  if (!(permittivity >= 1)) throw new ItmError(1011, "Ground permittivity must be at least 1.");
  if (!(conductivity > 0)) throw new ItmError(1012, "Ground conductivity must be above 0.");
  if (mdvar < 0 || (mdvar > 3 && mdvar < 10) || (mdvar > 13 && mdvar < 20) || (mdvar > 23 && mdvar < 30) || mdvar > 33)
    throw new ItmError(1014, "Invalid mode of variability.");
  if (!(i.situation > 0 && i.situation < 100)) throw new ItmError(1005, "Situation percentage must be between 0 and 100.");
  if (!(i.time > 0 && i.time < 100)) throw new ItmError(1003, "Time percentage must be between 0 and 100.");
  if (!(i.location > 0 && i.location < 100)) throw new ItmError(1004, "Location percentage must be between 0 and 100.");
}

/** ITM point-to-point, time/location/situation variability (ITM_P2P_TLS_Ex). Throws ItmError for inputs out of range. */
export function itmP2P(i: ItmP2PInputs): ItmP2PResult {
  const warn = { flags: 0 };
  validateInputs(i, warn);
  if (i.elevationsM.length < 3) throw new ItmError(1017, "The terrain profile needs at least 3 points.");

  const pfl = toPfl(i.elevationsM, i.distanceM);
  const np = trunc(pfl[0]);

  // average path height, ignoring the first and last 10%
  const p10 = trunc(0.1 * np);
  let h_sys__meter = 0;
  for (let k = p10; k <= np - p10; k++) h_sys__meter += pfl[k + 2];
  h_sys__meter = h_sys__meter / (np - 2 * p10 + 1);

  const { Z_g, gamma_e, N_s } = initializePointToPoint(i.freqMhz, h_sys__meter, i.refractivityN, i.polarization === "vertical" ? 1 : 0, i.permittivity, i.conductivity);

  const h__meter: [number, number] = [i.txHeightM, i.rxHeightM];
  const q = quickPfl(pfl, gamma_e, h__meter);

  const { A_ref__db, propmode } = longleyRice(q.theta_hzn, i.freqMhz, Z_g, q.d_hzn__meter, q.h_e__meter, gamma_e, N_s, q.delta_h__meter, h__meter, q.d__meter, MODE__P2P, warn);

  const A_fs__db = freeSpaceLoss(q.d__meter, i.freqMhz);
  const path: VariabilityPath = {
    h_e__meter: q.h_e__meter,
    delta_h__meter: q.delta_h__meter,
    f__mhz: i.freqMhz,
    d__meter: q.d__meter,
    A_ref__db,
    climate: i.climate,
    mdvar: i.mdvar,
  };
  const lossDb = variability(i.time, i.location, i.situation, path, warn) + A_fs__db;

  return {
    lossDb,
    freeSpaceDb: A_fs__db,
    referenceDb: A_ref__db,
    mode: propmode,
    warnings: warn.flags,
    deltaHM: q.delta_h__meter,
    effectiveHeightsM: q.h_e__meter,
    horizonDistancesM: q.d_hzn__meter,
    horizonAnglesRad: q.theta_hzn,
    surfaceRefractivityN: N_s,
    path,
  };
}

/** Basic transmission loss for the same path at other percentages, without redoing the terrain work. */
export function lossAtPercentages(r: Pick<ItmP2PResult, "freeSpaceDb" | "path">, time: number, location: number, situation: number): number {
  return variability(time, location, situation, r.path, { flags: 0 }) + r.freeSpaceDb;
}
