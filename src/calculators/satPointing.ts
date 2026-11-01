// Sat Pointing: azimuth, elevation and polarization skew from a ground site
// to a geostationary orbital slot, with magnetic azimuth from the World
// Magnetic Model and a bearing line on the map.

import { enhanceFields } from "./fieldHelp";
import { satPointingGuide } from "./helpText";
import * as L from "leaflet";
import { terminalMarker } from "./terminalIcon";
import { createMap, showDefaultView } from "./mapKit";
import type { Calculator } from ".";
import { coordPlaceholder, formatCoordinates, parseCoordinates } from "../lib/coords";
import { type LatLon, destinationPoint } from "../lib/geo";
import {
  compassPoint,
  formatOrbitalSlot,
  lookAngles,
  oneWayDelayS,
  parseOrbitalSlot,
  reflectorTiltDeg,
} from "../lib/satPointing";
import { fromMetres } from "../lib/units";
import { decimalYear, magneticField, modelIsCurrent } from "../lib/wmm";

const STORAGE_KEY = "rf-toolkit:sat-pointing";

const defaults: Record<string, string> = {
  site: "",
  slot: "",
  offset: "0",
};

const template = `
  <div class="inputs">
    <section class="card">
      <div class="card-head"><h2>Site and satellite</h2><span class="meta">Geostationary</span></div>
      <div class="fields">
        <label>Your location
          <span class="input-unit">
            <input name="site" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" />
            <button type="button" class="secondary unit-btn" data-action="locate" title="Use my location">Me</button>
          </span>
        </label>
        <label>Orbital slot
          <input name="slot" type="text" placeholder="101W or 28.2E" autocomplete="off" />
        </label>
        <label>Dish offset angle
          <span class="input-unit">
            <input name="offset" type="number" inputmode="decimal" step="0.1" min="0" max="45" />
            <span class="unit">°</span>
          </span>
        </label>
      </div>
      <p class="note warn" data-out="status"></p>
      <div class="map sat-map" data-out="map"></div>
      <p class="note">Tap the map or drag the pin. The blue line is the true azimuth.</p>
    </section>
  </div>

  <aside class="results">
    <section class="card">
      <div class="card-head">
        <h2 data-out="title">Pointing</h2>
        <span class="pill" data-out="pill" hidden></span>
        <button type="button" class="secondary" data-action="reset">Reset</button>
      </div>
      <p class="callout" data-out="warn" hidden></p>
      <p class="note" data-out="empty">Enter your location and the satellite's orbital slot.</p>
      <div data-out="results" hidden>
        <div class="pointing-diagram" data-out="diagram"></div>
        <div class="tiles">
          <div class="tile"><span class="label">Azimuth (true)</span><span class="value" data-out="azTrue"></span><span class="sub" data-out="azTrueSub"></span></div>
          <div class="tile"><span class="label">Azimuth (compass)</span><span class="value" data-out="azMag"></span><span class="sub" data-out="azMagSub"></span></div>
          <div class="tile"><span class="label">Elevation</span><span class="value" data-out="el"></span><span class="sub" data-out="elSub"></span></div>
          <div class="tile"><span class="label">Polarization skew</span><span class="value" data-out="skew"></span><span class="sub" data-out="skewSub"></span></div>
          <div class="tile" data-out="tiltTile"><span class="label">Reflector tilt</span><span class="value" data-out="tilt"></span><span class="sub" data-out="tiltSub"></span></div>
          <div class="tile"><span class="label">Slant range</span><span class="value" data-out="range"></span><span class="sub" data-out="rangeSub"></span></div>
        </div>
        <ol class="notes steps">
          <li>Set the elevation, then aim at the compass azimuth (or follow the line on the map to a landmark).</li>
          <li>Sweep azimuth slowly a few degrees either side while watching the beacon or signal meter, then peak elevation.</li>
          <li>Set the feed skew, peak again, and call the satellite controller to fine-tune cross-pol.</li>
        </ol>
        <p class="note">Keep the compass away from the vehicle, mount and other steel.</p>
        <details class="about"><summary>About this calculation</summary><p>Compass azimuth uses the NOAA/BGS World Magnetic Model (WMM2025), built in so it works offline.</p></details>
      </div>
    </section>
  </aside>
`;

function loadState(): Record<string, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return { ...defaults, ...(typeof saved === "object" && saved ? saved : {}) };
  } catch {
    return { ...defaults };
  }
}

function saveState(state: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked: inputs just won't be remembered.
  }
}

const fmt = (v: number, digits = 1) =>
  v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace("-", "−");
const angle = (v: number) => `${fmt(v)}°`;
const signedAngle = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt(Math.abs(v))}°`;

/** Compass rose with the azimuth, and a quarter circle with the elevation. */
function drawPointing(azTrue: number, declination: number, elevation: number): string {
  const cx = 80;
  const cy = 80;
  const r = 62;
  const at = (bearing: number, radius: number) => {
    const a = ((bearing - 90) * Math.PI) / 180;
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
  };
  const [ax, ay] = at(azTrue, r - 6);
  const [mx, my] = at(declination, r + 2);
  const [mx2, my2] = at(declination, r - 10);
  const ticks = Array.from({ length: 36 }, (_, i) => {
    const [x1, y1] = at(i * 10, r);
    const [x2, y2] = at(i * 10, i % 9 === 0 ? r - 9 : r - 4);
    return `<line class="tick" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }).join("");
  const letters = (["N", "E", "S", "W"] as const)
    .map((l, i) => {
      const [x, y] = at(i * 90, r - 18);
      return `<text class="cardinal" x="${x}" y="${y + 4}" text-anchor="middle">${l}</text>`;
    })
    .join("");

  // Elevation quadrant: horizon along the bottom, zenith straight up.
  const ex = 200;
  const ey = 142;
  const er = 110;
  const elClamped = Math.max(0, Math.min(90, elevation));
  const ea = (elClamped * Math.PI) / 180;
  const [px, py] = [ex + er * Math.cos(ea), ey - er * Math.sin(ea)];
  return `
    <svg viewBox="0 0 330 160" role="img" aria-label="Azimuth on a compass and elevation above the horizon">
      <circle class="rose" cx="${cx}" cy="${cy}" r="${r}"/>
      ${ticks}${letters}
      <line class="mag-north" x1="${mx2}" y1="${my2}" x2="${mx}" y2="${my}"/>
      <line class="az-line" x1="${cx}" y1="${cy}" x2="${ax}" y2="${ay}" marker-end="url(#satArrow)"/>
      <circle class="hub" cx="${cx}" cy="${cy}" r="3"/>
      <text class="caption" x="${cx}" y="156" text-anchor="middle">${angle(azTrue)} true</text>

      <path class="quadrant" d="M${ex} ${ey} H${ex + er} A${er} ${er} 0 0 0 ${ex} ${ey - er} Z"/>
      <line class="el-line" x1="${ex}" y1="${ey}" x2="${px}" y2="${py}" marker-end="url(#satArrow)"/>
      <text class="cardinal" x="${ex + er - 4}" y="${ey - 5}" text-anchor="end">horizon</text>
      <text class="caption" x="${ex + 55}" y="156" text-anchor="middle">${angle(elevation)} up</text>
      <defs>
        <marker id="satArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path class="arrowhead" d="M0 0 L10 5 L0 10 z"/>
        </marker>
      </defs>
    </svg>
    <p class="legend-line"><span class="sw-mag"></span> magnetic north (${fmt(Math.abs(declination))}° ${declination >= 0 ? "E" : "W"})</p>`;
}

export const satPointingCalculator: Calculator = {
  id: "sat",
  title: "Sat Pointing",
  shortTitle: "Pointing",
  render() {
    const form = document.createElement("form");
    form.className = "calculator two-col sat-pointing";
    form.innerHTML = template;
    form.addEventListener("submit", (e) => e.preventDefault());

    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
    const out = (name: string) => form.querySelector<HTMLElement>(`[data-out="${name}"]`)!;
    const fill = (values: Record<string, string>) => {
      // Skip names that no longer exist, such as a renamed field in old saved state.
      for (const [name, value] of Object.entries(values)) {
        const el = form.elements.namedItem(name);
        if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.value = value;
      }
    };
    fill(loadState());
    field("site").placeholder = coordPlaceholder();
    // Show a saved location in the current lat/lon or MGRS format.
    const savedSite = parseCoordinates(field("site").value);
    if (savedSite) field("site").value = formatCoordinates(savedSite);

    let map: L.Map | undefined;
    let marker: L.Marker | undefined;
    let bearing: L.Polyline | undefined;

    const setStatus = (text: string) => {
      out("status").textContent = text;
    };

    const placeOnMap = (site: LatLon | undefined, azTrue: number | undefined, recenter: boolean) => {
      if (!map) return;
      if (!site) {
        marker?.remove();
        bearing?.remove();
        marker = bearing = undefined;
        return;
      }
      if (!marker) {
        marker = L.marker([site.lat, site.lon], {
          icon: terminalMarker(),
          draggable: true,
        }).addTo(map);
        marker.on("dragend", () => {
          const p = marker!.getLatLng();
          field("site").value = formatCoordinates({ lat: p.lat, lon: p.lng });
          update();
        });
      } else {
        marker.setLatLng([site.lat, site.lon]);
      }
      bearing?.remove();
      bearing = undefined;
      if (azTrue !== undefined) {
        // A great-circle line long enough to run off any street-level view.
        const pts = Array.from({ length: 21 }, (_, i) => destinationPoint(site, azTrue, i * 5000));
        bearing = L.polyline(
          pts.map((p) => [p.lat, p.lon] as [number, number]),
          { className: "bearing-line" },
        ).addTo(map);
      }
      if (recenter) map.setView([site.lat, site.lon], Math.max(map.getZoom(), 15));
    };

    let lastSiteText = "";
    const update = () => {
      const state: Record<string, string> = {};
      for (const name of Object.keys(defaults)) state[name] = field(name).value;
      saveState(state);

      const siteText = field("site").value.trim();
      const site = siteText ? parseCoordinates(siteText) : undefined;
      const slotText = field("slot").value.trim();
      const slot = slotText ? parseOrbitalSlot(slotText) : undefined;
      const offset = Number.parseFloat(field("offset").value) || 0;

      setStatus(
        siteText && !site ? "Enter decimal degrees like 35.22710, -80.84310, or MGRS like 17S NU 14277 98239."
        : slotText && slot === undefined ? "Enter the orbital slot like 101W, 101.0° W or 28.2E."
        : "",
      );

      const ready = site && slot !== undefined;
      out("empty").hidden = !!ready;
      out("results").hidden = !ready;
      out("pill").hidden = !ready;
      out("warn").hidden = true;
      out("title").textContent = slot !== undefined ? `Pointing to ${formatOrbitalSlot(slot)}` : "Pointing";

      const recenter = siteText !== lastSiteText;
      lastSiteText = siteText;
      if (!ready) {
        placeOnMap(site, undefined, recenter && !!site);
        return;
      }

      const look = lookAngles(site, slot);
      const year = decimalYear(new Date());
      const declination = magneticField(site.lat, site.lon, 0, year).declination;
      const azMag = (((look.azimuthTrue - declination) % 360) + 360) % 360;
      placeOnMap(site, look.elevation > 0 ? look.azimuthTrue : undefined, recenter);

      const pill = out("pill");
      if (look.elevation <= 0) {
        pill.className = "pill s-fail";
        pill.textContent = "Below horizon";
      } else if (look.elevation < 10) {
        pill.className = "pill s-marginal";
        pill.textContent = "Low elevation";
      } else {
        pill.className = "pill s-good";
        pill.textContent = "Visible";
      }
      const warn = out("warn");
      if (look.elevation <= 0) {
        warn.textContent = `${formatOrbitalSlot(slot)} is below your horizon. It can't be reached from this location.`;
        warn.hidden = false;
      } else if (look.elevation < 10) {
        warn.textContent =
          "Under 10° elevation, terrain, trees and buildings block easily and the atmosphere adds loss and fading. Check the view toward this azimuth.";
        warn.hidden = false;
      }
      if (!modelIsCurrent(year)) {
        warn.textContent = `${warn.textContent ?? ""} The built-in magnetic model covers 2025–2030; compass azimuth may be off by more than usual.`.trim();
        warn.hidden = false;
      }

      out("diagram").innerHTML = drawPointing(look.azimuthTrue, declination, look.elevation);
      out("azTrue").textContent = angle(look.azimuthTrue);
      out("azTrueSub").textContent = `${compassPoint(look.azimuthTrue)} · from true north`;
      out("azMag").textContent = angle(azMag);
      out("azMagSub").textContent = `Declination ${fmt(Math.abs(declination))}° ${declination >= 0 ? "E" : "W"}`;
      out("el").textContent = angle(look.elevation);
      out("elSub").textContent = look.elevation > 0 ? "Above the horizon" : "Below the horizon";
      out("skew").textContent = signedAngle(look.skew);
      out("skewSub").textContent =
        Math.abs(look.skew) < 0.05
          ? "No rotation needed"
          : `Turn the feed ${look.skew > 0 ? "clockwise" : "counter-clockwise"}, seen from behind the dish`;

      out("tiltTile").hidden = !(offset > 0);
      if (offset > 0) {
        const tilt = reflectorTiltDeg(look.elevation, offset);
        out("tilt").textContent = angle(Math.abs(tilt));
        out("tiltSub").textContent =
          `${tilt >= 0 ? "Back" : "Forward"} from vertical for a ${fmt(offset)}° offset dish. A mount scale marked in look elevation is set to ${angle(look.elevation)}.`;
      }

      const oneWayMs = oneWayDelayS(look.rangeM) * 1000;
      out("range").textContent = `${Math.round(fromMetres(look.rangeM, "mi")).toLocaleString()} mi`;
      out("rangeSub").textContent = `${Math.round(look.rangeM / 1000).toLocaleString()} km · ${fmt(oneWayMs, 0)} ms one way · about ${fmt(oneWayMs * 4, 0)} ms for a request and reply through the satellite`;
    };

    const initMap = () => {
      if (map || !form.isConnected) return;
      map = createMap(out("map"), (m) => {
        const site = parseCoordinates(field("site").value);
        if (site) m.setView([site.lat, site.lon], Math.max(m.getZoom() || 0, 15));
        else showDefaultView(m);
      });
      map.on("click", (e: L.LeafletMouseEvent) => {
        field("site").value = formatCoordinates({ lat: e.latlng.lat, lon: e.latlng.lng });
        update();
      });
      lastSiteText = "";
      update();
    };
    const waitForPage = () => (form.isConnected ? initMap() : setTimeout(waitForPage, 50));
    setTimeout(waitForPage, 0);

    form.querySelector('[data-action="locate"]')!.addEventListener("click", () => {
      if (!navigator.geolocation) {
        setStatus("This browser can't share its location.");
        return;
      }
      setStatus("Finding your location…");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          field("site").value = formatCoordinates({ lat: pos.coords.latitude, lon: pos.coords.longitude });
          setStatus("");
          update();
        },
        (err) => setStatus(`Couldn't get your location: ${err.message}`),
        { enableHighAccuracy: true, timeout: 15000 },
      );
    });
    form.querySelector('[data-action="reset"]')!.addEventListener("click", () => {
      fill(defaults);
      update();
    });

    form.addEventListener("input", update);
    form.addEventListener("change", update);
    update();
    enhanceFields(form, satPointingGuide, defaults);
    return form;
  },
};
