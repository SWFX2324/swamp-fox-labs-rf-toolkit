// Mesh Planner: drop nodes on a map and see every node-to-node link over
// real terrain with identical radios, plus whether the mesh holds together.

import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Calculator } from ".";
import { coordPlaceholder, formatCoordinates, parseCoordinates } from "../lib/coords";
import { ElevationRateLimitError, MAX_PER_REQUEST, fetchElevations } from "../lib/elevation";
import { type LatLon, distanceBetweenM, samplePath } from "../lib/geo";
import { type MeshLink, type MeshLinkStatus, connectedGroups, hopCounts, meshLink, pairs } from "../lib/mesh";
import { createPathStore, pathKey } from "../lib/pathStore";
import { sampleCount } from "../lib/profile";
import {
  type DistanceUnit,
  type FrequencyUnit,
  type PowerUnit,
  frequencyUnits,
  fromMetres,
  powerUnits,
  toDbm,
  toHz,
  toMetres,
} from "../lib/units";

const STORAGE_KEY = "rf-toolkit:mesh";
const MAX_NODES = 10;

interface MeshNode extends LatLon {
  name: string;
  /** Antenna height in the chosen height unit, as typed. */
  height: string;
}

const settingDefaults: Record<string, string> = {
  freq: "915",
  freqUnit: "MHz",
  power: "1",
  powerUnit: "W",
  gain: "3",
  cable: "1",
  sens: "-100",
  fade: "10",
  height: "30",
  heightUnit: "ft",
};

const statusText: Record<MeshLinkStatus, [string, string]> = {
  good: ["Solid", "s-good"],
  marginal: ["Marginal", "s-marginal"],
  fail: ["No link", "s-fail"],
};

function numberField(label: string, name: string, unit: string, attrs = ""): string {
  return `
    <label>${label}
      <span class="input-unit">
        <input name="${name}" type="number" inputmode="decimal" step="any" ${attrs} />
        <span class="unit">${unit}</span>
      </span>
    </label>`;
}

const template = `
  <div class="inputs">
    <section class="card">
      <div class="card-head"><h2>Radios</h2><span class="meta">The same at every node</span></div>
      <div class="fields">
        <label>Frequency
          <span class="input-unit">
            <input name="freq" type="number" inputmode="decimal" step="any" min="0" />
            <select name="freqUnit">${Object.keys(frequencyUnits).map((u) => `<option>${u}</option>`).join("")}</select>
          </span>
        </label>
        <label>TX power
          <span class="input-unit">
            <input name="power" type="number" inputmode="decimal" step="any" />
            <select name="powerUnit">${powerUnits.map((u) => `<option>${u}</option>`).join("")}</select>
          </span>
        </label>
        ${numberField("Antenna gain", "gain", "dBi")}
        ${numberField("Cable loss at each node", "cable", "dB", 'min="0"')}
        ${numberField("RX sensitivity", "sens", "dBm")}
        ${numberField("Fade margin wanted", "fade", "dB", 'min="0"')}
        <label>Default antenna height
          <span class="input-unit">
            <input name="height" type="number" inputmode="decimal" step="any" min="0" />
            <select name="heightUnit"><option>ft</option><option>m</option></select>
          </span>
        </label>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Nodes</h2><span class="meta" data-out="nodeCount"></span></div>
      <p class="note top">Tap the map to add a node (up to ${MAX_NODES}), or type coordinates. Drag a node to move it.</p>
      <div class="map mesh-map" data-out="map"></div>
      <div class="add-node">
        <input name="addLoc" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" />
        <button type="button" class="secondary" data-action="add">Add node</button>
      </div>
      <p class="note warn" data-out="status"></p>
      <div class="table-wrap">
        <table class="ledger node-list">
          <thead><tr><th></th><th>Name</th><th>Location</th><th>Height</th><th></th></tr></thead>
          <tbody data-out="nodes"></tbody>
        </table>
      </div>
      <div class="terrain-actions"><button type="button" class="secondary" data-action="clear">Remove all nodes</button></div>
    </section>
  </div>

  <aside class="results">
    <section class="card">
      <div class="card-head">
        <h2>Mesh</h2>
        <span class="pill" data-out="pill" hidden></span>
        <button type="button" class="secondary" data-action="reset">Reset radios</button>
      </div>
      <p class="note" data-out="empty">Add at least two nodes to see the links between them.</p>
      <div data-out="results" hidden>
        <p class="callout" data-out="split" hidden></p>
        <div class="tiles">
          <div class="tile"><span class="label">Links up</span><span class="value" data-out="up"></span><span class="sub" data-out="upSub"></span></div>
          <div class="tile"><span class="label">Most hops</span><span class="value" data-out="hops"></span><span class="sub" data-out="hopsSub"></span></div>
        </div>
        <div class="table-wrap">
          <table class="ledger links">
            <thead><tr><th>Link</th><th class="num">Distance</th><th class="num">Terrain</th><th class="num">Margin</th></tr></thead>
            <tbody data-out="links"></tbody>
          </table>
        </div>
        <p class="note">
          Solid links keep your fade margin; marginal ones connect with less.
          Terrain loss uses ITU-R P.526 Bullington diffraction on 90 m
          elevation data, so trees and buildings aren't counted.
        </p>
      </div>
    </section>
  </aside>
`;

function loadState(): { settings: Record<string, string>; nodes: MeshNode[] } {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    const nodes = Array.isArray(saved.nodes)
      ? saved.nodes.filter((n: MeshNode) => Number.isFinite(n?.lat) && Number.isFinite(n?.lon)).slice(0, MAX_NODES)
      : [];
    return { settings: { ...settingDefaults, ...(saved.settings ?? {}) }, nodes };
  } catch {
    return { settings: { ...settingDefaults }, nodes: [] };
  }
}

const fmt = (v: number, digits = 1) =>
  v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const meshCalculator: Calculator = {
  id: "mesh",
  title: "Mesh Planner",
  shortTitle: "Mesh",
  render() {
    const form = document.createElement("form");
    form.className = "calculator two-col mesh";
    form.innerHTML = template;
    form.addEventListener("submit", (e) => e.preventDefault());

    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
    const out = (name: string) => form.querySelector<HTMLElement>(`[data-out="${name}"]`)!;
    const num = (name: string) => Number.parseFloat(field(name).value);

    const store = createPathStore({
      getItem: (k) => {
        try {
          return localStorage.getItem(k);
        } catch {
          return null;
        }
      },
      setItem: (k, v) => localStorage.setItem(k, v),
    });

    const state = loadState();
    let nodes = state.nodes;
    for (const [name, value] of Object.entries(state.settings)) {
      const el = form.elements.namedItem(name);
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.value = value;
    }
    field("addLoc").setAttribute("placeholder", coordPlaceholder());

    const save = () => {
      const settings: Record<string, string> = {};
      for (const name of Object.keys(settingDefaults)) settings[name] = field(name).value;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings, nodes }));
      } catch {
        // Storage blocked: the plan just won't be remembered.
      }
    };
    const setStatus = (text: string, warn = false) => {
      out("status").textContent = text;
      out("status").classList.toggle("warn", warn);
    };

    // Terrain per pair, keyed by the two node positions (A to B, A first).
    const terrain = new Map<string, number[] | "error">();
    let loading: AbortController | undefined;
    let map: L.Map | undefined;
    let markers: L.Marker[] = [];
    let lines: L.Polyline[] = [];

    const heightM = (n: MeshNode) =>
      toMetres(Number.parseFloat(n.height) || Number.parseFloat(field("height").value) || 0, field("heightUnit").value as DistanceUnit);

    const renderNodes = () => {
      out("nodeCount").textContent = `${nodes.length} of ${MAX_NODES}`;
      const body = out("nodes");
      body.replaceChildren(
        ...nodes.map((n, idx) => {
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td><span class="node-badge">${idx + 1}</span></td>
            <td><input class="node-name" type="text" autocomplete="off" /></td>
            <td class="mono node-loc"></td>
            <td><span class="input-unit node-height"><input type="number" inputmode="decimal" step="any" min="0" /><span class="unit"></span></span></td>
            <td><button type="button" class="secondary icon-btn" title="Remove node" aria-label="Remove node ${idx + 1}">✕</button></td>`;
          const name = tr.querySelector<HTMLInputElement>(".node-name")!;
          name.value = n.name;
          name.addEventListener("input", (e) => {
            e.stopPropagation();
            n.name = name.value;
            save();
            recompute();
          });
          tr.querySelector(".node-loc")!.textContent = formatCoordinates(n);
          const h = tr.querySelector<HTMLInputElement>(".node-height input")!;
          h.value = n.height;
          h.placeholder = field("height").value;
          tr.querySelector(".node-height .unit")!.textContent = field("heightUnit").value;
          h.addEventListener("input", (e) => {
            e.stopPropagation();
            n.height = h.value;
            save();
            recompute();
          });
          tr.querySelector("button")!.addEventListener("click", () => {
            nodes.splice(idx, 1);
            nodesChanged();
          });
          return tr;
        }),
      );
    };

    const drawMarkers = () => {
      if (!map) return;
      for (const m of markers) m.remove();
      markers = nodes.map((n, idx) => {
        const m = L.marker([n.lat, n.lon], {
          icon: L.divIcon({ className: "pin", html: `<span><b>${idx + 1}</b></span>`, iconSize: [30, 30], iconAnchor: [15, 30] }),
          draggable: true,
          title: n.name,
        }).addTo(map!);
        m.on("dragend", () => {
          const p = m.getLatLng();
          n.lat = p.lat;
          n.lon = p.lng;
          nodesChanged(false);
        });
        return m;
      });
    };

    const recompute = () => {
      for (const l of lines) l.remove();
      lines = [];
      const ready = nodes.length >= 2;
      out("empty").hidden = ready;
      out("results").hidden = !ready;
      out("pill").hidden = !ready;
      if (!ready) return;

      const radio = {
        freqHz: toHz(num("freq"), field("freqUnit").value as FrequencyUnit),
        txPowerDbm: toDbm(num("power"), field("powerUnit").value as PowerUnit),
        gainDbi: num("gain") || 0,
        cableLossDb: num("cable") || 0,
        sensitivityDbm: num("sens"),
        fadeMarginDb: num("fade") || 0,
      };
      if (!(radio.freqHz > 0) || !Number.isFinite(radio.txPowerDbm) || !Number.isFinite(radio.sensitivityDbm)) {
        out("pill").hidden = true;
        out("links").replaceChildren();
        return;
      }

      const results = pairs(nodes.length).map(([a, b]) => {
        const elev = terrain.get(pathKey(nodes[a], nodes[b]));
        const link: MeshLink = meshLink(
          radio,
          Math.max(1, distanceBetweenM(nodes[a], nodes[b])),
          heightM(nodes[a]),
          heightM(nodes[b]),
          Array.isArray(elev) ? elev : undefined,
        );
        return { a, b, link, distanceM: distanceBetweenM(nodes[a], nodes[b]), terrainState: elev === undefined ? "pending" : elev === "error" ? "error" : "ok" };
      });

      const up = results.filter((r) => r.link.status !== "fail");
      const solid = results.filter((r) => r.link.status === "good");
      const groups = connectedGroups(nodes.length, up.map((r) => [r.a, r.b]));
      const solidGroups = connectedGroups(nodes.length, solid.map((r) => [r.a, r.b]));
      const hops = hopCounts(nodes.length, up.map((r) => [r.a, r.b]));
      const maxHops = Math.max(0, ...hops.flat().filter(Number.isFinite));

      const pill = out("pill");
      const split = out("split");
      if (solidGroups.length === 1) {
        pill.className = "pill s-good";
        pill.textContent = "Solid mesh";
        split.hidden = true;
      } else if (groups.length === 1) {
        pill.className = "pill s-marginal";
        pill.textContent = "Connected, some marginal";
        split.hidden = false;
        split.textContent = "Every node is reachable, but only through at least one marginal link. Add a relay or raise antennas to firm it up.";
      } else {
        pill.className = "pill s-fail";
        pill.textContent = `Split into ${groups.length} groups`;
        split.hidden = false;
        const named = groups.map((g) => (g.length === 1 ? `node ${g[0] + 1} on its own` : `nodes ${g.map((i) => i + 1).join(", ")}`));
        split.textContent = `The mesh splits into ${groups.length} groups that can't reach each other: ${named.join("; ")}. A relay between groups, or taller antennas, would join them.`;
      }
      out("up").textContent = `${up.length} of ${results.length}`;
      out("upSub").textContent = `${solid.length} solid, ${up.length - solid.length} marginal`;
      out("hops").textContent = groups.length === 1 ? String(maxHops) : "—";
      out("hopsSub").textContent = groups.length === 1 ? "Between the farthest two nodes" : "The mesh is split";

      const distUnit: DistanceUnit = field("heightUnit").value === "m" ? "km" : "mi";
      const label = (i: number) => `${i + 1}${nodes[i].name ? ` ${nodes[i].name}` : ""}`;
      out("links").innerHTML = [...results]
        .sort((x, y) => y.link.marginDb - x.link.marginDb)
        .map((r) => {
          const [text, cls] = statusText[r.link.status];
          const terrainCell =
            r.terrainState === "ok" ? `${fmt(r.link.terrainLossDb)} dB`
            : r.terrainState === "pending" ? "waiting"
            : "free space";
          return `<tr>
            <td class="link-name"></td>
            <td class="num mono">${fmt(fromMetres(r.distanceM, distUnit), 2)} ${distUnit}</td>
            <td class="num mono">${terrainCell}</td>
            <td class="num"><span class="mono">${fmt(r.link.marginDb)} dB</span> <span class="pill ${cls}">${text}</span></td>
          </tr>`;
        })
        .join("");
      // Names are user text: set them as text, not markup.
      [...results]
        .sort((x, y) => y.link.marginDb - x.link.marginDb)
        .forEach((r, idx) => {
          (out("links") as HTMLTableSectionElement).rows[idx].querySelector(".link-name")!.textContent = `${label(r.a)} ↔ ${label(r.b)}`;
        });

      if (map) {
        lines = results.map((r) =>
          L.polyline(
            [
              [nodes[r.a].lat, nodes[r.a].lon],
              [nodes[r.b].lat, nodes[r.b].lon],
            ],
            { className: `mesh-line mesh-${r.link.status}` },
          ).addTo(map!),
        );
        for (const l of lines) if (l.options.className?.includes("mesh-fail")) l.bringToBack();
      }
    };

    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const loadTerrain = async () => {
      loading?.abort();
      clearTimeout(retryTimer);
      const controller = new AbortController();
      loading = controller;
      // Paths not loaded yet, plus any that failed before.
      const todo = pairs(nodes.length)
        .map(([a, b]) => [nodes[a], nodes[b]] as const)
        .filter(([a, b]) => {
          const t = terrain.get(pathKey(a, b));
          return (t === undefined || t === "error") && distanceBetweenM(a, b) >= 50;
        });
      let fetched = 0;
      let lastError = "";
      for (const [a, b] of todo) {
        const key = pathKey(a, b);
        const kept = store.lookup(a, b);
        if (kept) {
          terrain.set(key, kept);
          continue;
        }
        setStatus(`Loading terrain ${++fetched} of ${todo.length}…`);
        try {
          // One request per path keeps a 10-node plan inside the free API's
          // per-minute limit.
          const count = Math.min(MAX_PER_REQUEST, sampleCount(distanceBetweenM(a, b)));
          const elev = await fetchElevations(samplePath(a, b, count), { signal: controller.signal });
          if (controller.signal.aborted) return;
          terrain.set(key, elev);
          store.remember(a, b, elev);
        } catch (err) {
          if (controller.signal.aborted) return;
          if (err instanceof ElevationRateLimitError) {
            setStatus("The free elevation service is rate-limiting requests. Trying the rest again in a minute…");
            recompute();
            retryTimer = setTimeout(() => {
              if (form.isConnected && loading === controller) void loadTerrain();
            }, 61_000);
            return;
          }
          terrain.set(key, "error");
          lastError = (err as Error).message;
        }
        recompute();
      }
      if (controller.signal.aborted) return;
      const failed = [...terrain.values()].some((v) => v === "error");
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      setStatus(
        failed
          ? `Some terrain couldn't load (${offline ? "no connection" : lastError || "service error"}), so those links use free-space loss only.`
          : "",
        failed,
      );
      recompute();
    };

    const nodesChanged = (fit = true) => {
      save();
      renderNodes();
      drawMarkers();
      if (fit && map && nodes.length) map.fitBounds(L.latLngBounds(nodes.map((n) => [n.lat, n.lon] as [number, number])), { padding: [40, 40], maxZoom: 14 });
      recompute();
      void loadTerrain();
    };

    const addNode = (p: LatLon) => {
      if (nodes.length >= MAX_NODES) {
        setStatus(`The planner takes up to ${MAX_NODES} nodes.`, true);
        return;
      }
      nodes.push({ ...p, name: "", height: "" });
      setStatus("");
      nodesChanged(false);
    };

    const initMap = () => {
      if (map || !form.isConnected) return;
      map = L.map(out("map"));
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      if (nodes.length) map.fitBounds(L.latLngBounds(nodes.map((n) => [n.lat, n.lon] as [number, number])), { padding: [40, 40], maxZoom: 14 });
      else map.setView([37.5, -96], 4);
      map.on("click", (e: L.LeafletMouseEvent) => addNode({ lat: e.latlng.lat, lon: e.latlng.lng }));
      new ResizeObserver(() => map?.invalidateSize()).observe(out("map"));
      drawMarkers();
      recompute();
    };
    const waitForPage = () => (form.isConnected ? initMap() : setTimeout(waitForPage, 50));
    setTimeout(waitForPage, 0);

    form.querySelector('[data-action="add"]')!.addEventListener("click", () => {
      const p = parseCoordinates(field("addLoc").value);
      if (!p) {
        setStatus("Enter decimal degrees like 35.22710, -80.84310, or MGRS like 17S NU 14277 98239.", true);
        return;
      }
      field("addLoc").value = "";
      addNode(p);
      map?.setView([p.lat, p.lon], Math.max(map.getZoom(), 12));
    });
    for (const type of ["input", "change"]) field("addLoc").addEventListener(type, (e) => e.stopPropagation());
    form.querySelector('[data-action="clear"]')!.addEventListener("click", () => {
      nodes = [];
      setStatus("");
      nodesChanged(false);
    });
    form.querySelector('[data-action="reset"]')!.addEventListener("click", () => {
      for (const [name, value] of Object.entries(settingDefaults)) field(name).value = value;
      save();
      renderNodes();
      recompute();
    });

    // Radio settings: recalculate; a height unit change also relabels nodes.
    form.addEventListener("input", () => {
      save();
      recompute();
    });
    form.addEventListener("change", (e) => {
      save();
      if ((e.target as HTMLElement).getAttribute("name")?.startsWith("height")) renderNodes();
      recompute();
    });

    renderNodes();
    recompute();
    if (nodes.length >= 2) void loadTerrain();
    return form;
  },
};
