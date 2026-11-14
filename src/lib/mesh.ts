// Mesh planning: every pair of nodes as a two-way point-to-point link, over
// terrain when a profile is available, then which nodes can reach each other
// through usable links. Nodes share one radio unless a node has its own; a
// link is only as good as its weaker direction.

import { type Environment, clutterLossDb, effectiveHeightM } from "./environment";
import { linkBudget } from "./linkBudget";
import { type ProfileStatus, analyzeProfile } from "./profile";
import { type ModelSettings, defaultModel, terrainLoss } from "./propagation";

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
  /** Propagation model settings for terrain loss; the defaults if unset. */
  model?: ModelSettings;
  /** Effective earth radius factor for the line-of-sight check; 4/3 if unset. */
  k?: number;
}

/** One node's own radio, where it differs from the shared one. */
export interface EndRadio {
  txPowerDbm: number;
  gainDbi: number;
  cableLossDb: number;
  sensitivityDbm: number;
}

export type MeshLinkStatus = "good" | "marginal" | "fail";

export interface MeshLink {
  fsplDb: number;
  terrainLossDb: number;
  clutterLossDb: number;
  /** Loss below peak gain from the antenna patterns at both ends, dB. */
  antennaLossDb: number;
  /** Received level in the weaker direction, dBm. */
  rslDbm: number;
  /** The weaker direction's margin, dB: what rates the link. */
  marginDb: number;
  /** Margin from the first node to the second, and back, dB. */
  marginAbDb: number;
  marginBaDb: number;
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
  /** Loss below peak gain from the antenna patterns, both ends together, dB. */
  antennaLossDb = 0,
  /** What surrounds each end, from a land-cover map; radio.environment at both if unset. */
  ends?: [Environment, Environment],
  /** Each end's own radio; the shared radio at both if unset. */
  radios?: [EndRadio, EndRadio],
): MeshLink {
  // The path runs from the top of the clutter; the clutter loss covers the rest.
  const envA = ends?.[0] ?? radio.environment;
  const envB = ends?.[1] ?? radio.environment;
  const clutter = (envA ? clutterLossDb(envA, radio.freqHz, aHeightM) : 0) + (envB ? clutterLossDb(envB, radio.freqHz, bHeightM) : 0);
  const pathA = envA ? effectiveHeightM(envA, aHeightM) : aHeightM;
  const pathB = envB ? effectiveHeightM(envB, bHeightM) : bHeightM;
  let terrainLossDb = 0;
  let profile: ProfileStatus | undefined;
  if (elevationsM && elevationsM.length >= 3) {
    const path = { freqHz: radio.freqHz, distanceM, elevationsM, txHeightM: pathA, rxHeightM: pathB };
    terrainLossDb = terrainLoss(path, radio.model ?? defaultModel).lossDb;
    profile = analyzeProfile({ ...path, k: radio.k }).status;
  }
  // The same path both ways; only the radios at each end swap roles.
  const [ra, rb] = radios ?? [radio, radio];
  const oneWay = (tx: EndRadio, rx: EndRadio, txH: number, rxH: number) =>
    linkBudget({
      freqHz: radio.freqHz,
      distanceM,
      txPowerDbm: tx.txPowerDbm,
      txCableLossDb: tx.cableLossDb,
      txOtherLossDb: antennaLossDb,
      txGainDbi: tx.gainDbi,
      extraPathLossDb: 0,
      terrainLossDb,
      clutterLossDb: clutter,
      rxGainDbi: rx.gainDbi,
      rxCableLossDb: rx.cableLossDb,
      rxOtherLossDb: 0,
      rxSensitivityDbm: rx.sensitivityDbm,
      fadeMarginDb: radio.fadeMarginDb,
      txHeightM: txH,
      rxHeightM: rxH,
    });
  const ab = oneWay(ra, rb, aHeightM, bHeightM);
  const ba = oneWay(rb, ra, bHeightM, aHeightM);
  const r = ba.marginDb < ab.marginDb ? ba : ab;
  const status: MeshLinkStatus = r.marginDb >= radio.fadeMarginDb ? "good" : r.marginDb >= 0 ? "marginal" : "fail";
  return {
    fsplDb: r.fsplDb,
    terrainLossDb,
    clutterLossDb: clutter,
    antennaLossDb,
    rslDbm: r.rslDbm,
    marginDb: r.marginDb,
    marginAbDb: ab.marginDb,
    marginBaDb: ba.marginDb,
    status,
    profile,
  };
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
