// Sat Link: uplink and downlink budget for a GEO terminal, ending in Es/N0
// margin for a DVB-S2 MODCOD.

import { enhanceFields, withoutKeys } from "./fieldHelp";
import { satLinkGuide } from "./helpText";
import type { Calculator } from ".";
import { coordPlaceholder, formatCoordinates, parseCoordinates } from "../lib/coords";
import { formatOrbitalSlot, lookAngles, parseOrbitalSlot } from "../lib/satPointing";
import { dvbs2Modcods, satBands, satLinkBudget } from "../lib/satLink";
import { fromMetres } from "../lib/units";

const STORAGE_KEY = "rf-toolkit:sat-link";
const POINTING_KEY = "rf-toolkit:sat-pointing";

const defaults: Record<string, string> = {
  site: "",
  slot: "",
  band: "Ku",
  upGHz: "14.25",
  downGHz: "11.95",
  dish: "1.2",
  efficiency: "65",
  power: "4",
  txFeed: "0.5",
  pointing: "0.2",
  lnbK: "60",
  antK: "35",
  rxFeed: "0.2",
  satGt: "2",
  satEirp: "42",
  symbolRate: "2",
  modcod: "QPSK 3/4",
  implLoss: "0.5",
  upLoss: "0.3",
  downLoss: "0.3",
};

function field(label: string, name: string, unit: string, attrs = ""): string {
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
      <div class="card-head"><h2>Site and satellite</h2><span class="meta" data-out="geo"></span></div>
      <div class="fields">
        <label>Your location
          <input name="site" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" />
        </label>
        <label>Orbital slot
          <input name="slot" type="text" placeholder="101W or 28.2E" autocomplete="off" />
        </label>
      </div>
      <p class="note">Filled in from Sat Pointing if you've used it. The distance to the satellite sets the path loss.</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>Terminal</h2><span class="meta">Your dish and radio</span></div>
      <div class="fields">
        <label>Band
          <select name="band">${satBands.map((b) => `<option>${b.label}</option>`).join("")}</select>
        </label>
        ${field("Uplink", "upGHz", "GHz", 'min="0"')}
        ${field("Downlink", "downGHz", "GHz", 'min="0"')}
        ${field("Dish diameter", "dish", "m", 'min="0"')}
        ${field("Dish efficiency", "efficiency", "%", 'min="1" max="100"')}
        ${field("BUC power", "power", "W", 'min="0"')}
        ${field("TX feed loss", "txFeed", "dB", 'min="0" title="Cable or waveguide between the BUC and the feed"')}
        ${field("Pointing error", "pointing", "°", 'min="0"')}
        ${field("LNB noise temperature", "lnbK", "K", 'min="0" title="From the LNB datasheet; noise figure 0.8 dB is about 59 K"')}
        ${field("Antenna noise, clear sky", "antK", "K", 'min="0" title="About 30–50 K for Ku at moderate elevation"')}
        ${field("RX feed loss", "rxFeed", "dB", 'min="0"')}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Satellite and carrier</h2><span class="meta">From your access documents</span></div>
      <div class="fields">
        ${field("Satellite G/T toward you", "satGt", "dB/K")}
        ${field("Downlink EIRP for your carrier", "satEirp", "dBW")}
        ${field("Symbol rate", "symbolRate", "Msps", 'min="0"')}
        <label>MODCOD (DVB-S2)
          <select name="modcod">${dvbs2Modcods.map((m) => `<option>${m.name}</option>`).join("")}</select>
        </label>
        ${field("Modem implementation loss", "implLoss", "dB", 'min="0"')}
      </div>
      <p class="note">
        Use the downlink EIRP your carrier gets, not the transponder's
        saturated figure from the footprint map; the satellite controller can
        give it to you.
      </p>
    </section>

    <section class="card">
      <div class="card-head"><h2>Weather</h2><span class="meta">Atmosphere and rain</span></div>
      <div class="fields">
        ${field("Uplink loss", "upLoss", "dB", 'min="0"')}
        ${field("Downlink loss", "downLoss", "dB", 'min="0"')}
      </div>
      <p class="note">
        Defaults are clear sky for the band. Add rain fade to plan for bad
        weather: heavy rain can take 3–6 dB at Ku and 10 dB or more at Ka.
        Downlink rain also raises the noise the dish sees, which is included.
      </p>
    </section>
  </div>

  <aside class="results">
    <section class="card">
      <div class="card-head">
        <h2>Link margin</h2>
        <span class="pill" data-out="pill" hidden></span>
        <button type="button" class="secondary" data-action="reset">Reset</button>
      </div>
      <p class="error" data-out="error" hidden></p>
      <div data-out="results">
        <div class="tiles">
          <div class="tile"><span class="label">Margin</span><span class="value" data-out="margin"></span><span class="sub" data-out="marginSub"></span></div>
          <div class="tile"><span class="label">Es/N0</span><span class="value" data-out="esn0"></span><span class="sub" data-out="esn0Sub"></span></div>
          <div class="tile"><span class="label">Information rate</span><span class="value" data-out="rate"></span><span class="sub" data-out="rateSub"></span></div>
          <div class="tile"><span class="label">Terminal EIRP</span><span class="value" data-out="eirp"></span><span class="sub">Compare with the uplink EIRP you're assigned</span></div>
          <div class="tile"><span class="label">Terminal G/T</span><span class="value" data-out="gt"></span><span class="sub" data-out="gtSub"></span></div>
          <div class="tile"><span class="label">Beamwidth</span><span class="value" data-out="bw"></span><span class="sub" data-out="bwSub"></span></div>
        </div>
        <table class="ledger">
          <thead><tr><th>Uplink</th><th class="num"></th></tr></thead>
          <tbody data-out="up"></tbody>
          <thead><tr><th>Downlink</th><th class="num"></th></tr></thead>
          <tbody data-out="down"></tbody>
          <tbody data-out="total"></tbody>
        </table>
        <p class="note">
          Interference from adjacent satellites and transponder intermodulation
          aren't included, so real margins run a little lower. Required Es/N0 is
          the ETSI DVB-S2 ideal plus the implementation loss.
        </p>
      </div>
    </section>
  </aside>
`;

function loadState(): Record<string, string> {
  const read = (key: string) => {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? "{}");
      return typeof v === "object" && v ? v : {};
    } catch {
      return {};
    }
  };
  const saved = read(STORAGE_KEY);
  const pointing = read(POINTING_KEY);
  return {
    ...defaults,
    // Start from the site and slot used in Sat Pointing.
    site: pointing.site ?? "",
    slot: pointing.slot ?? "",
    ...saved,
  };
}

function saveState(state: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked: inputs just won't be remembered.
  }
}

const fmt = (v: number, digits = 1) =>
  v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
const sdb = (v: number) => `${v < 0 ? "−" : ""}${fmt(Math.abs(v))}`;

function formatRate(bps: number): string {
  if (bps >= 1e6) return `${fmt(bps / 1e6, 2)} Mbps`;
  return `${fmt(bps / 1e3, 0)} kbps`;
}

function rateMargin(db: number): { text: string; cls: string } {
  if (db >= 3) return { text: "Solid", cls: "s-good" };
  if (db >= 1) return { text: "Workable", cls: "s-fair" };
  if (db >= 0) return { text: "Marginal", cls: "s-marginal" };
  return { text: "Won't close", cls: "s-fail" };
}

export const satLinkCalculator: Calculator = {
  id: "satlink",
  title: "Sat Link",
  shortTitle: "Sat Link",
  render() {
    const form = document.createElement("form");
    form.className = "calculator two-col sat-link";
    form.innerHTML = template;
    form.addEventListener("submit", (e) => e.preventDefault());

    const el = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
    const out = (name: string) => form.querySelector<HTMLElement>(`[data-out="${name}"]`)!;
    const num = (name: string) => Number.parseFloat(el(name).value);
    const fill = (values: Record<string, string>) => {
      for (const [name, value] of Object.entries(values)) {
        const f = form.elements.namedItem(name);
        if (f instanceof HTMLInputElement || f instanceof HTMLSelectElement) f.value = value;
      }
    };
    fill(loadState());
    el("site").setAttribute("placeholder", coordPlaceholder());
    const savedSite = parseCoordinates(el("site").value);
    if (savedSite) el("site").value = formatCoordinates(savedSite);

    const update = () => {
      const state: Record<string, string> = {};
      for (const name of Object.keys(defaults)) state[name] = el(name).value;
      saveState(state);

      const site = parseCoordinates(el("site").value);
      const slot = parseOrbitalSlot(el("slot").value);
      const look = site && slot !== undefined ? lookAngles(site, slot) : undefined;
      out("geo").textContent = look
        ? `${formatOrbitalSlot(slot!)} · ${fmt(look.elevation)}° up · ${Math.round(fromMetres(look.rangeM, "mi")).toLocaleString()} mi`
        : "Geostationary";

      const modcod = dvbs2Modcods.find((m) => m.name === el("modcod").value) ?? dvbs2Modcods[6];
      const v = {
        uplinkHz: num("upGHz") * 1e9,
        downlinkHz: num("downGHz") * 1e9,
        dishM: num("dish"),
        efficiency: num("efficiency") / 100,
        txPowerW: num("power"),
        symbolRate: num("symbolRate") * 1e6,
      };
      const problem =
        !look ? "Enter your location and the orbital slot."
        : look.elevation <= 0 ? `${formatOrbitalSlot(slot!)} is below your horizon.`
        : !(v.uplinkHz > 0 && v.downlinkHz > 0) ? "Enter the uplink and downlink frequencies."
        : !(v.dishM > 0) ? "Enter the dish diameter."
        : !(v.efficiency > 0 && v.efficiency <= 1) ? "Dish efficiency is between 1 and 100%."
        : !(v.txPowerW > 0) ? "Enter the BUC power."
        : !(v.symbolRate > 0) ? "Enter the symbol rate."
        : !Number.isFinite(num("satGt")) || !Number.isFinite(num("satEirp")) ? "Enter the satellite's G/T and your carrier's downlink EIRP."
        : "";
      out("error").hidden = !problem;
      out("error").textContent = problem;
      out("results").hidden = !!problem;
      out("pill").hidden = !!problem;
      if (problem || !look) return;

      const r = satLinkBudget({
        rangeM: look.rangeM,
        ...v,
        txFeedLossDb: num("txFeed") || 0,
        pointingErrorDeg: num("pointing") || 0,
        uplinkLossDb: num("upLoss") || 0,
        satGtDbK: num("satGt"),
        satEirpDbw: num("satEirp"),
        downlinkLossDb: num("downLoss") || 0,
        clearSkyAntennaK: num("antK") || 0,
        rxFeedLossDb: num("rxFeed") || 0,
        lnbK: num("lnbK") || 0,
        modcod,
        implementationLossDb: num("implLoss") || 0,
      });

      const rating = rateMargin(r.marginDb);
      const pill = out("pill");
      pill.className = `pill ${rating.cls}`;
      pill.textContent = rating.text;
      out("margin").innerHTML = `${sdb(r.marginDb)}<span class="unit">dB</span>`;
      out("marginSub").textContent = r.cn0Up < r.cn0Down - 3 ? "Uplink is the weaker side" : r.cn0Down < r.cn0Up - 3 ? "Downlink is the weaker side" : "Uplink and downlink about even";
      out("esn0").innerHTML = `${sdb(r.esn0)}<span class="unit">dB</span>`;
      out("esn0Sub").textContent = `${modcod.name} needs ${sdb(r.requiredEsn0)} dB`;
      out("rate").textContent = formatRate(r.infoRateBps);
      out("rateSub").textContent = `${fmt(v.symbolRate / 1e6, 2)} Msps × ${modcod.bitsPerSymbol} bits × ${modcod.name.split(" ")[1]} code, before framing`;
      out("eirp").innerHTML = `${sdb(r.eirpDbw)}<span class="unit">dBW</span>`;
      out("gt").innerHTML = `${sdb(r.terminalGtDbK)}<span class="unit">dB/K</span>`;
      out("gtSub").textContent = `System noise ${Math.round(r.systemTempK)} K`;
      out("bw").innerHTML = `${fmt(r.beamwidthUp, 2)}<span class="unit">°</span>`;
      out("bwSub").textContent = `Uplink half-power beam (${fmt(r.beamwidthDown, 2)}° down). Peak to well under a tenth of this.`;

      const row = (k: string, val: string, total = false) =>
        `<tr${total ? ' class="total"' : ""}><td>${k}</td><td class="num mono">${val}</td></tr>`;
      out("up").innerHTML = [
        row("BUC power", `${sdb(10 * Math.log10(v.txPowerW))} dBW`),
        row("Feed loss", `−${fmt(num("txFeed") || 0)} dB`),
        row("Dish gain", `+${fmt(r.txGainDbi)} dBi`),
        row("Pointing loss", `−${fmt(r.pointingLossUp, 2)} dB`),
        row("Terminal EIRP", `${sdb(r.eirpDbw)} dBW`, true),
        row("Free-space loss", `−${fmt(r.fsplUp)} dB`),
        row("Atmosphere and rain", `−${fmt(num("upLoss") || 0)} dB`),
        row("Satellite G/T", `${sdb(num("satGt"))} dB/K`),
        row("Uplink C/N0", `${fmt(r.cn0Up)} dB-Hz`, true),
      ].join("");
      out("down").innerHTML = [
        row("Carrier EIRP", `${sdb(num("satEirp"))} dBW`),
        row("Free-space loss", `−${fmt(r.fsplDown)} dB`),
        row("Atmosphere and rain", `−${fmt(num("downLoss") || 0)} dB`),
        row("Terminal G/T", `${sdb(r.terminalGtDbK)} dB/K`),
        row("Downlink C/N0", `${fmt(r.cn0Down)} dB-Hz`, true),
      ].join("");
      out("total").innerHTML = [
        row("Combined C/N0", `${fmt(r.cn0Total)} dB-Hz`, true),
        row("Symbol rate", `−${fmt(10 * Math.log10(v.symbolRate))} dB-Hz`),
        row("Es/N0", `${sdb(r.esn0)} dB`, true),
        row("Required", `${sdb(r.requiredEsn0)} dB`),
        row("Margin", `${sdb(r.marginDb)} dB`, true),
      ].join("");
    };

    // Picking a band fills in its typical frequencies and clear-sky losses.
    el("band").addEventListener("change", () => {
      const band = satBands.find((b) => b.label === el("band").value);
      if (!band) return;
      el("upGHz").value = String(band.uplinkGHz);
      el("downGHz").value = String(band.downlinkGHz);
      el("upLoss").value = el("downLoss").value = String(band.clearSkyLossDb);
    });
    form.querySelector('[data-action="reset"]')!.addEventListener("click", () => {
      const { site, slot } = { site: el("site").value, slot: el("slot").value };
      fill({ ...defaults, site, slot });
      update();
    });

    form.addEventListener("input", update);
    form.addEventListener("change", update);
    update();
    enhanceFields(form, satLinkGuide, withoutKeys(defaults, "upGHz", "downGHz"));
    return form;
  },
};
