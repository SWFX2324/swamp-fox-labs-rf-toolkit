// Mesh planning: every pair of nodes as a point-to-point link with the same
// radios, over terrain when a profile is available, then which nodes can
// reach each other through usable links.

import { bullingtonLoss } from "./diffraction";
import { type Environment, clutterLossDb, effectiveHeightM } from "./environment";
import { linkBudget } from "./linkBudget";
import { type ProfileStatus, analyzeProfile } from "./profile";

export interface MeshRadio {
  freqHz: number;
  txPowerDbm: number;
  gainDbi: number;
  /** Cable and connector loss at each end, dB. */
  cableLossDb: number;
  sensitivityDbm: number;
  /** Margin a link needs to count as solid, dB. */
  fadeMarginDb: number;
  /** What surrounds the nodes; adds clutter loss at both ends of each link. */
  environment?: Environment;
}

export type MeshLinkStatus = "good" | "marginal" | "fail";

export interface MeshLink {
  fsplDb: number;
  terrainLossDb: number;
  clutterLossDb: number;
  rslDbm: number;
  marginDb: number;
  status: MeshLinkStatus;
  /** Clearance verdict when terrain was available, else undefined. */
  profile?: ProfileStatus;
}

export function meshLink(
  radio: MeshRadio,
  distanceM: number,
  aHeightM: number,
  bHeightM: number,
  elevationsM?: number[],
): MeshLink {
  // The path runs from the top of the clutter; the clutter loss covers the rest.
  const env = radio.environment;
  const clutter = env ? clutterLossDb(env, radio.freqHz, aHeightM) + clutterLossDb(env, radio.freqHz, bHeightM) : 0;
  const pathA = env ? effectiveHeightM(env, aHeightM) : aHeightM;
  const pathB = env ? effectiveHeightM(env, bHeightM) : bHeightM;
  let terrainLossDb = 0;
  let profile: ProfileStatus | undefined;
  if (elevationsM && elevationsM.length >= 3) {
    const path = { freqHz: radio.freqHz, distanceM, elevationsM, txHeightM: pathA, rxHeightM: pathB };
    terrainLossDb = bullingtonLoss(path).lossDb;
    profile = analyzeProfile(path).status;
  }
  const r = linkBudget({
    freqHz: radio.freqHz,
    distanceM,
    txPowerDbm: radio.txPowerDbm,
    txCableLossDb: radio.cableLossDb,
    txOtherLossDb: 0,
    txGainDbi: radio.gainDbi,
    extraPathLossDb: 0,
    terrainLossDb,
    clutterLossDb: clutter,
    rxGainDbi: radio.gainDbi,
    rxCableLossDb: radio.cableLossDb,
    rxOtherLossDb: 0,
    rxSensitivityDbm: radio.sensitivityDbm,
    fadeMarginDb: radio.fadeMarginDb,
    txHeightM: aHeightM,
    rxHeightM: bHeightM,
  });
  const status: MeshLinkStatus = r.marginDb >= radio.fadeMarginDb ? "good" : r.marginDb >= 0 ? "marginal" : "fail";
  return { fsplDb: r.fsplDb, terrainLossDb, clutterLossDb: clutter, rslDbm: r.rslDbm, marginDb: r.marginDb, status, profile };
}

/** Every unordered pair of n items, as index pairs. */
export function pairs(n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out.push([i, j]);
  return out;
}

/** Groups of nodes that can reach each other over the given links. */
export function connectedGroups(n: number, links: [number, number][]): number[][] {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const [a, b] of links) parent[find(a)] = find(b);
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length || a[0] - b[0]);
}

/** Fewest hops between every pair over the given links (Infinity if none). */
export function hopCounts(n: number, links: [number, number][]): number[][] {
  const adj = Array.from({ length: n }, () => [] as number[]);
  for (const [a, b] of links) {
    adj[a].push(b);
    adj[b].push(a);
  }
  return Array.from({ length: n }, (_, start) => {
    const dist = new Array<number>(n).fill(Number.POSITIVE_INFINITY);
    dist[start] = 0;
    const queue = [start];
    while (queue.length) {
      const u = queue.shift()!;
      for (const v of adj[u]) {
        if (dist[v] === Number.POSITIVE_INFINITY) {
          dist[v] = dist[u] + 1;
          queue.push(v);
        }
      }
    }
    return dist;
  });
}
