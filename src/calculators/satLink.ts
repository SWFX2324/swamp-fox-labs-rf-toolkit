// Satellite Link: a small portable terminal in a star network, talking through a
// geostationary satellite to a gateway. Two directions, each with its own
// carrier and Es/N0 margin for a DVB-S2 MODCOD: return (terminal to gateway) and
// forward (gateway to terminal).

import { enhanceFields, withoutKeys } from "./fieldHelp";
import { satLinkGuide } from "./helpText";
import type { Calculator } from ".";
import { coordPlaceholder, formatCoordinates, parseCoordinates } from "../lib/coords";
import { formatOrbitalSlot, lookAngles, parseOrbitalSlot } from "../lib/satPointing";
import { type DirectionResult, type Modcod, type StarLinkInputs, GOOD_MARGIN_DB, allModcods, bitsPerSymbolNet, fadeHeadroomDb, satBands, starLinkBudget } from "../lib/satLink";
import { aimTable, bestModcods, modcodList, rainBars } from "./satCharts";
import { type SceneInput, fitReadoutPanel, satScene } from "./satScene";
import { fromMeters } from "../lib/units";
import { locateButton, locateMe } from "./locate";
import { PANE_ICONS, fitStage, moveModeBar } from "./mapFirst";

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
  // Satellite downlink EIRP: the forward carrier toward you, your return carrier toward the gateway.
  satEirp: "42",
  retEirp: "30",
  gwGt: "35",
  gwEirp: "70",
  // The return carrier (kept under its old names, so saved values carry over) and the forward carrier.
  symbolRate: "2",
  modcod: "QPSK 3/4",
  fwdSymbolRate: "10",
  fwdModcod: "QPSK 3/4",
  implLoss: "0.5",
  upLoss: "0.3",
  downLoss: "0.3",
};

/** The modulation / FEC choices: DVB-S2, then DVB-S and BPSK (which add 7/8). */
const modcodOptions = [
  `<optgroup label="DVB-S2">${allModcods.filter((m) => m.family === "DVB-S2").map((m) => `<option>${m.name}</option>`).join("")}</optgroup>`,
  `<optgroup label="DVB-S and BPSK">${allModcods.filter((m) => m.family === "DVB-S").map((m) => `<option>${m.name}</option>`).join("")}</optgroup>`,
].join("");
const MODS = ["BPSK", "QPSK", "8PSK", "16APSK", "32APSK"];
/** An FEC rate written as "n/d" as a number, so the rates sort from lowest to highest. */
const rateValue = (r: string) => { const [n, d] = r.split("/").map(Number); return n / d; };
const RATES = [...new Set(allModcods.map((m) => m.rate))].sort((a, b) => rateValue(a) - rateValue(b));

/** A labeled number box with its unit. */
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
  <div class="lb-shell stage-page">
  <div class="lb-left">
    <section class="card">
      <div class="card-head"><h2 class="with-icon">${PANE_ICONS.pin}Site and satellite</h2><span class="meta" data-out="geo"></span></div>
      <div class="fields">
        <label>Your location
          <span class="input-unit">
            <input name="site" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" />
            ${locateButton('data-action="locate"')}
          </span>
        </label>
        <label>Orbital slot
          <input name="slot" type="text" placeholder="101W or 28.2E" autocomplete="off" />
        </label>
      </div>
      <p class="note" data-out="status"></p>
    </section>

    <section class="card">
      <div class="card-head"><h2 class="with-icon">${PANE_ICONS.dish}Terminal</h2></div>
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
      <div class="card-head"><h2 class="with-icon">${PANE_ICONS.satellite}Satellite</h2></div>
      <div class="fields">
        ${field("Satellite G/T toward you", "satGt", "dB/K")}
        ${field("Downlink EIRP toward you", "satEirp", "dBW")}
        ${field("Downlink EIRP toward the gateway", "retEirp", "dBW")}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2 class="with-icon">${PANE_ICONS.dish}Gateway</h2></div>
      <div class="fields">
        ${field("Gateway G/T", "gwGt", "dB/K")}
        ${field("Gateway EIRP", "gwEirp", "dBW")}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2 class="with-icon">${PANE_ICONS.budget}Carriers</h2></div>
      <div class="fields">
        ${field("Return symbol rate", "symbolRate", "Msps", 'min="0"')}
        <label>Return modulation / FEC
          <select name="modcod">${modcodOptions}</select>
        </label>
        ${field("Forward symbol rate", "fwdSymbolRate", "Msps", 'min="0"')}
        <label>Forward modulation / FEC
          <select name="fwdModcod">${modcodOptions}</select>
        </label>
        ${field("Modem implementation loss", "implLoss", "dB", 'min="0"')}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2 class="with-icon">${PANE_ICONS.weather}Weather at your site</h2></div>
      <div class="fields">
        ${field("Uplink loss", "upLoss", "dB", 'min="0"')}
        ${field("Downlink loss", "downLoss", "dB", 'min="0"')}
      </div>
    </section>
  </div>

  <div class="lb-map lb-stage">
    <div class="card-head"><h2 class="with-icon">${PANE_ICONS.budget}Link budget</h2></div>
    <p class="note" data-out="budgetPrompt"></p>
    <div class="sat-chain" data-out="chain" hidden></div>
    <div class="sat-ledgers" data-out="budget">
      <section class="sat-ledger">
        <header><h3>Return <small>you → satellite → gateway</small></h3><span class="pill" data-out="retPill"></span></header>
        <table class="ledger" data-out="retRows"></table>
      </section>
      <section class="sat-ledger">
        <header><h3>Forward <small>gateway → satellite → you</small></h3><span class="pill" data-out="fwdPill"></span></header>
        <table class="ledger" data-out="fwdRows"></table>
      </section>
    </div>
  </div>

  <aside class="results lb-right">
    <section class="card">
      <div class="card-head">
        <h2 class="with-icon">${PANE_ICONS.compass}Link margin</h2>
        <span class="pill" data-out="pill" hidden></span>
        <button type="button" class="secondary" data-action="reset">Reset</button>
      </div>
      <p class="note" data-out="prompt"></p>
      <p class="error" data-out="error" hidden></p>
      <div data-out="results">
        <div class="tiles">
          <div class="tile"><span class="label">Return · you → gateway</span><span class="value" data-out="retMargin"></span><span class="sub" data-out="retSub"></span></div>
          <div class="tile"><span class="label">Forward · gateway → you</span><span class="value" data-out="fwdMargin"></span><span class="sub" data-out="fwdSub"></span></div>
          <div class="tile"><span class="label">Return speed</span><span class="value" data-out="retRate"></span></div>
          <div class="tile"><span class="label">Forward speed</span><span class="value" data-out="fwdRate"></span></div>
          <div class="tile"><span class="label">Transmit power (EIRP)</span><span class="value" data-out="eirp"></span></div>
          <div class="tile"><span class="label">How well you hear (G/T)</span><span class="value" data-out="gt"></span></div>
          <div class="tile wide-tile chart-tile">
            <span class="label">Rain</span>
            <span class="tile-q">How much rain before the link drops?</span>
            <div data-out="rainChart"></div>
          </div>
          <div class="tile wide-tile chart-tile">
            <div class="chart-head">
              <span class="label">Modulation / FEC</span>
              <div class="seg" role="group" aria-label="Carrier"><button type="button" data-mc-dir="ret">Return</button><button type="button" data-mc-dir="fwd">Forward</button></div>
            </div>
            <span class="tile-q">What could this link carry?</span>
            <p class="mc-auth">For planning only. Your terminal runs the modulation and FEC in your access authorization; using a different one needs the gateway's approval first.</p>
            <div class="mc-best" data-out="mcBest"></div>
            <details class="mc-all">
              <summary>All settings</summary>
              <div class="mc-chips" data-out="mcMods" role="group" aria-label="Modulation"></div>
              <div class="mc-chips" data-out="mcRates" role="group" aria-label="FEC rate"></div>
              <div data-out="mcChart"></div>
            </details>
          </div>
          <div class="tile wide-tile chart-tile">
            <span class="label">Dish aim</span>
            <span class="tile-q">How much does aiming matter?</span>
            <div data-out="pgChart"></div>
          </div>
        </div>
        <details class="about"><summary>About this calculation</summary><p>A star network: your terminal works the gateway through the satellite. The return (you to the gateway) is nearly always set by your uplink, and the forward (the gateway to you) by your downlink. The gateway is taken in clear sky at your range from the satellite. Interference from adjacent satellites and transponder intermodulation aren't included, so real margins run a little lower. Required Es/N0 is the ETSI DVB-S2 ideal plus the implementation loss.</p></details>
      </div>
    </section>
  </aside>
  </div>
`;

/** The saved inputs over the defaults, with the site and slot carried over from the Terminal Pointing Tool when these are empty. */
function loadState(): Record<string, string> {
  // A saved object from storage, or an empty one.
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
    ...saved,
    // An empty location or slot here takes the one last used in the Terminal
    // Pointing Tool, so a site entered there carries over. (A saved empty value
    // used to win and block it for good.)
    site: saved.site || pointing.site || "",
    slot: saved.slot || pointing.slot || "",
  };
}

/** Remembers the inputs. */
function saveState(state: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked: inputs just won't be remembered.
  }
}

/** A number to the given decimal places, with a true minus sign for negatives. */
const fmt = (v: number, digits = 1) =>
  v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace("-", "−");
/** A decibel figure to one decimal place with a true minus sign. */
const sdb = (v: number) => `${v < 0 ? "−" : ""}${fmt(Math.abs(v))}`;

/** A data rate in Mbps, or kbps below 1 Mbps. */
function formatRate(bps: number): string {
  if (bps >= 1e6) return `${fmt(bps / 1e6, 2)} Mbps`;
  return `${fmt(bps / 1e3, 0)} kbps`;
}

/** The app's three words: Good with GOOD_MARGIN_DB to spare, Marginal down to 0 dB. */
function rateMargin(db: number): { text: string; cls: string } {
  if (db >= GOOD_MARGIN_DB) return { text: "Good", cls: "s-good" };
  if (db >= 0) return { text: "Marginal", cls: "s-marginal" };
  return { text: "Won't connect", cls: "s-fail" };
}

export const satLinkCalculator: Calculator = {
  id: "satlink",
  title: "Satellite Link Analysis",
  shortTitle: "Sat Link",
  // Builds the page and recalculates the whole link on every change.
  render() {
    const form = document.createElement("form");
    form.className = "calculator sat-link map-first";
    form.innerHTML = template;
    form.addEventListener("submit", (e) => e.preventDefault());

    // A field in the form by its name.
    const el = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
    // A result element by its data-out name.
    const out = (name: string) => form.querySelector<HTMLElement>(`[data-out="${name}"]`)!;
    // A field's value as a number (NaN when blank or not a number).
    const num = (name: string) => Number.parseFloat(el(name).value);
    // Puts saved or default values into the form's fields.
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

    // Modulation and FEC chart: which direction it shows, and the chip filters.
    let mcDir: "ret" | "fwd" = "ret";
    let mcMod: string | undefined;
    let mcRate: string | undefined;
    /** Use a MODCOD on the chart's direction: its carrier field changes and everything follows. */
    const useModcod = (m: Modcod) => {
      el(mcDir === "ret" ? "modcod" : "fwdModcod").value = m.name;
      update();
    };
    form.addEventListener("click", (e) => {
      const t = e.target as Element;
      const dirBtn = t.closest<HTMLElement>("[data-mc-dir]");
      if (dirBtn) {
        mcDir = dirBtn.dataset.mcDir as "ret" | "fwd";
        mcMod = mcRate = undefined;
        update();
        return;
      }
      const chipBtn = t.closest<HTMLElement>("[data-mc-mod], [data-mc-rate]");
      if (chipBtn) {
        // A chip's value, where "All" means no filter.
        const val = (s: string | undefined) => (s === "All" ? undefined : s);
        if (chipBtn.dataset.mcMod !== undefined) mcMod = val(chipBtn.dataset.mcMod);
        else mcRate = val(chipBtn.dataset.mcRate);
        // A modulation and a rate together pick that setting (DVB-S2 where both exist).
        const match = mcMod && mcRate ? allModcods.find((m) => m.mod === mcMod && m.rate === mcRate) : undefined;
        if (match) useModcod(match);
        else update();
        return;
      }
      const pt = t.closest<SVGElement>("[data-modcod]");
      if (pt && !pt.classList.contains("dim")) {
        const m = allModcods.find((x) => x.name === pt.dataset.modcod);
        if (m) useModcod(m);
      }
    });
    form.addEventListener("keydown", (e) => {
      const pt = (e.target as Element).closest<SVGElement>("[data-modcod]");
      if (!pt || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      const m = allModcods.find((x) => x.name === pt.dataset.modcod);
      if (m) useModcod(m);
    });

    // The picture: wide (2:1) or, in a narrow pane, a taller frame.
    let scene: Omit<SceneInput, "wide"> | undefined;
    let sceneWide: boolean | undefined;
    // Redraws the picture when its shape changes (wide or narrow pane), or always when force is set.
    const drawScene = (force = false) => {
      const chain = out("chain");
      if (!scene || chain.hidden) return;
      const wide = chain.clientWidth >= 520 || chain.clientWidth === 0;
      if (!force && wide === sceneWide) return;
      sceneWide = wide;
      const { svg, ratio } = satScene({ ...scene, wide });
      chain.style.aspectRatio = ratio;
      chain.innerHTML = svg;
      fitPanel();
    };
    // The readout panel is measured from its text, which needs the SVG laid out.
    const fitPanel = () =>
      requestAnimationFrame(() => {
        const svgEl = out("chain").querySelector("svg");
        if (svgEl && out("chain").clientWidth > 0) fitReadoutPanel(svgEl);
      });
    new ResizeObserver(() => {
      drawScene();
      fitPanel();
    }).observe(out("chain"));

    // Reads every input, saves them, works out the link and redraws every result,
    // or says what's missing when the inputs aren't usable yet.
    const update = () => {
      const state: Record<string, string> = {};
      for (const name of Object.keys(defaults)) state[name] = el(name).value;
      saveState(state);

      const site = parseCoordinates(el("site").value);
      const slot = parseOrbitalSlot(el("slot").value);
      const look = site && slot !== undefined ? lookAngles(site, slot) : undefined;
      out("geo").textContent = look
        ? `${formatOrbitalSlot(slot!)} · ${fmt(look.elevation)}° up · ${Math.round(fromMeters(look.rangeM, "mi")).toLocaleString()} mi`
        : "Geostationary";

      // The modulation and FEC chosen in a dropdown, or QPSK 3/4 when the saved choice no longer exists.
      const pick = (name: string) => allModcods.find((m) => m.name === el(name).value) ?? allModcods[6];
      const retModcod = pick("modcod");
      const fwdModcod = pick("fwdModcod");
      const v = {
        uplinkHz: num("upGHz") * 1e9,
        downlinkHz: num("downGHz") * 1e9,
        dishM: num("dish"),
        efficiency: num("efficiency") / 100,
        txPowerW: num("power"),
        retRate: num("symbolRate") * 1e6,
        fwdRate: num("fwdSymbolRate") * 1e6,
      };
      // Something still to fill in is a prompt. Only a value that can't work is an error.
      const invalid =
        look && look.elevation <= 0 ? `${formatOrbitalSlot(slot!)} is below your horizon.`
        : !(v.efficiency > 0 && v.efficiency <= 1) ? "Dish efficiency is between 1 and 100%."
        : "";
      const missing =
        !look ? "Enter your location and the orbital slot."
        : !(v.uplinkHz > 0 && v.downlinkHz > 0) ? "Enter the uplink and downlink frequencies."
        : !(v.dishM > 0) ? "Enter the dish diameter."
        : !(v.txPowerW > 0) ? "Enter the BUC power."
        : !(v.retRate > 0 && v.fwdRate > 0) ? "Enter the return and forward symbol rates."
        : !["satGt", "satEirp", "retEirp"].every((n) => Number.isFinite(num(n))) ? "Enter the satellite's G/T and its downlink EIRP toward you and toward the gateway."
        : !["gwGt", "gwEirp"].every((n) => Number.isFinite(num(n))) ? "Enter the gateway's G/T and EIRP."
        : "";
      const problem = invalid || missing;
      out("error").hidden = !invalid;
      out("error").textContent = invalid;
      out("prompt").textContent = invalid ? "" : missing;
      out("results").hidden = !!problem;
      out("budget").hidden = !!problem;
      out("chain").hidden = !!problem;
      out("budgetPrompt").hidden = !problem;
      out("budgetPrompt").textContent = invalid || missing;
      out("pill").hidden = !!problem;
      if (problem || !look) return;

      const inputs: StarLinkInputs = {
        rangeM: look.rangeM,
        uplinkHz: v.uplinkHz,
        downlinkHz: v.downlinkHz,
        dishM: v.dishM,
        efficiency: v.efficiency,
        txPowerW: v.txPowerW,
        txFeedLossDb: num("txFeed") || 0,
        pointingErrorDeg: num("pointing") || 0,
        clearSkyAntennaK: num("antK") || 0,
        rxFeedLossDb: num("rxFeed") || 0,
        lnbK: num("lnbK") || 0,
        uplinkLossDb: num("upLoss") || 0,
        downlinkLossDb: num("downLoss") || 0,
        satGtDbK: num("satGt"),
        fwdEirpDbw: num("satEirp"),
        retEirpDbw: num("retEirp"),
        gatewayGtDbK: num("gwGt"),
        gatewayEirpDbw: num("gwEirp"),
        ret: { symbolRate: v.retRate, modcod: retModcod },
        fwd: { symbolRate: v.fwdRate, modcod: fwdModcod },
        implementationLossDb: num("implLoss") || 0,
      };
      const r = starLinkBudget(inputs);
      const retR = rateMargin(r.ret.marginDb);
      const fwdR = rateMargin(r.fwd.marginDb);

      // The badge: the weaker direction's rating.
      const weaker: "ret" | "fwd" = r.ret.marginDb <= r.fwd.marginDb ? "ret" : "fwd";
      const worst = weaker === "ret" ? retR : fwdR;
      const pill = out("pill");
      pill.className = `pill ${worst.cls}`;
      pill.textContent = worst.text;

      // Fills one direction's margin tile with its margin and rating word.
      const marginTile = (d: DirectionResult, rating: { text: string; cls: string }, name: string) => {
        out(`${name}Margin`).innerHTML = `${sdb(d.marginDb)}<span class="unit">dB</span>`;
        out(`${name}Sub`).innerHTML = `<span class="rating-word ${rating.cls}">${rating.text}</span>`;
      };
      marginTile(r.ret, retR, "ret");
      marginTile(r.fwd, fwdR, "fwd");
      out("retRate").textContent = formatRate(r.ret.infoRateBps);
      out("fwdRate").textContent = formatRate(r.fwd.infoRateBps);
      out("eirp").innerHTML = `${sdb(r.eirpDbw)}<span class="unit">dBW</span>`;
      out("gt").innerHTML = `${sdb(r.terminalGtDbK)}<span class="unit">dB/K</span>`;
      // Pointing: how far off the satellite the dish can be, and what each step costs in signal.
      const bwDeg = r.beamwidthUp;
      out("pgChart").innerHTML = aimTable(bwDeg, inputs.dishM, inputs.pointingErrorDeg, r.pointingLossUp);

      // Rain: how much each direction rides out, against light, moderate and heavy rain.
      const retAt = r.ret.marginDb > 0 ? fadeHeadroomDb(inputs, "ret") : undefined;
      const fwdAt = r.fwd.marginDb > 0 ? fadeHeadroomDb(inputs, "fwd") : undefined;
      out("rainChart").innerHTML = rainBars(el("band").value, retAt, fwdAt);

      // Modulation and FEC: the best choice in a sentence, every option in a list.
      for (const b of form.querySelectorAll<HTMLButtonElement>("[data-mc-dir]")) b.setAttribute("aria-pressed", String(b.dataset.mcDir === mcDir));
      const dirR = mcDir === "ret" ? r.ret : r.fwd;
      const dirRate = mcDir === "ret" ? v.retRate : v.fwdRate;
      const dirMc = mcDir === "ret" ? retModcod : fwdModcod;
      const view = { esn0: dirR.esn0, implLossDb: inputs.implementationLossDb, symbolRate: dirRate, selected: dirMc.name, mod: mcMod, rate: mcRate };
      const best = bestModcods(view);
      // The data rate a modulation and FEC would give on this direction's carrier.
      const speedOf = (m: Modcod) => formatRate(dirRate * bitsPerSymbolNet(m));
      // "Try" runs the numbers with it; it doesn't mean the terminal can switch.
      const useBtn = (m: Modcod) => (m.name === dirMc.name ? '<span class="mc-inuse">Your setting</span>' : `<button type="button" class="secondary mc-use" data-modcod="${m.name}">Try it</button>`);
      out("mcBest").innerHTML = [
        best.good
          ? `<div class="mc-pick s-good"><div><span class="mc-pick-k">Best fit for this link</span><b>${best.good.name}</b><span>${speedOf(best.good)} · ${GOOD_MARGIN_DB} dB+ to spare</span></div>${useBtn(best.good)}</div>`
          : `<div class="mc-pick s-fail"><div><span class="mc-pick-k">Best fit for this link</span><b>None holds well</b><span>Try a lower symbol rate</span></div></div>`,
        best.any && best.any.name !== best.good?.name
          ? `<div class="mc-pick s-marginal"><div><span class="mc-pick-k">Faster, but risky</span><b>${best.any.name}</b><span>${speedOf(best.any)} · ${(() => { const sp = view.esn0 - best.any.esn0 - view.implLossDb; return sp < 0.1 ? "almost no spare" : `only ${fmt(sp)} dB spare`; })()}</span></div>${useBtn(best.any)}</div>`
          : "",
      ].join("");
      // One filter chip, grayed out when no setting matches it with the other filter.
      const chip = (kind: "mod" | "rate", value: string, on: boolean, ok: boolean) =>
        `<button type="button" class="chip mc-chip" data-mc-${kind}="${value}" aria-pressed="${on}"${ok ? "" : " disabled"}>${value}</button>`;
      out("mcMods").innerHTML =
        chip("mod", "All", !mcMod, true) + MODS.map((m) => chip("mod", m, mcMod === m, allModcods.some((x) => x.mod === m && (!mcRate || x.rate === mcRate)))).join("");
      out("mcRates").innerHTML =
        chip("rate", "All", !mcRate, true) + RATES.map((t) => chip("rate", t, mcRate === t, allModcods.some((x) => x.rate === t && (!mcMod || x.mod === mcMod)))).join("");
      out("mcChart").innerHTML = modcodList(view);

      // The picture: margins for both directions, the weaker one marked.
      scene = {
        ret: { marginDb: r.ret.marginDb, rating: retR.text, ratingCls: retR.cls },
        fwd: { marginDb: r.fwd.marginDb, rating: fwdR.text, ratingCls: fwdR.cls },
        weaker,
        azimuth: look.azimuthTrue,
        elevation: look.elevation,
        slot: formatOrbitalSlot(slot!),
      };
      drawScene(true);

      // One row of the link budget table; total rows are set apart.
      const row = (k: string, val: string, total = false) =>
        `<tr${total ? ' class="total"' : ""}><td>${k}</td><td class="num mono">${val}</td></tr>`;
      /** A titled section of the budget; the last one is the result, set apart. */
      const section = (title: string, rows: string[], result = false) =>
        `<tbody class="bseg${result ? " bseg-result" : ""}"><tr class="bseg-head"><th colspan="2">${title}</th></tr>${rows.join("")}</tbody>`;
      // The Result section of a direction's budget: combined C/N0 down to its margin.
      const result = (d: DirectionResult, rate: number, name: string) =>
        section("Result", [
          row("Combined C/N0", `${fmt(d.cn0Total)} dB-Hz`),
          row("Symbol rate", `−${fmt(10 * Math.log10(rate))} dB-Hz`),
          row("Es/N0", `${sdb(d.esn0)} dB`),
          row("Required", `${sdb(d.requiredEsn0)} dB`),
          row(`${name} margin`, `${sdb(d.marginDb)} dB`, true),
        ], true);
      // Sets a direction's rating pill.
      const pillFor = (name: string, rating: { text: string; cls: string }) => {
        out(name).className = `pill ${rating.cls}`;
        out(name).textContent = rating.text;
      };
      pillFor("retPill", retR);
      pillFor("fwdPill", fwdR);
      out("retRows").innerHTML = [
        section("Your terminal", [
          row("BUC power", `${sdb(10 * Math.log10(v.txPowerW))} dBW`),
          row("Feed loss", `−${fmt(num("txFeed") || 0)} dB`),
          row("Dish gain", `+${fmt(r.txGainDbi)} dBi`),
          row("Pointing loss", `−${fmt(r.pointingLossUp, 2)} dB`),
          row("Terminal EIRP", `${sdb(r.eirpDbw)} dBW`, true),
        ]),
        section("Up to the satellite", [
          row("Free-space loss", `−${fmt(r.fsplUp)} dB`),
          row("Atmosphere and rain", `−${fmt(num("upLoss") || 0)} dB`),
          row("Satellite G/T", `${sdb(num("satGt"))} dB/K`),
          row("Your uplink C/N0", `${fmt(r.ret.cn0Up)} dB-Hz`, true),
        ]),
        section("Down to the gateway", [
          row("Satellite EIRP to gateway", `${sdb(num("retEirp"))} dBW`),
          row("Free-space loss", `−${fmt(r.fsplDown)} dB`),
          row("Gateway G/T", `${sdb(num("gwGt"))} dB/K`),
          row("Gateway downlink C/N0", `${fmt(r.ret.cn0Down)} dB-Hz`, true),
        ]),
        result(r.ret, v.retRate, "Return"),
      ].join("");
      out("fwdRows").innerHTML = [
        section("Gateway up to the satellite", [
          row("Gateway EIRP", `${sdb(num("gwEirp"))} dBW`),
          row("Free-space loss", `−${fmt(r.fsplUp)} dB`),
          row("Satellite G/T", `${sdb(num("satGt"))} dB/K`),
          row("Gateway uplink C/N0", `${fmt(r.fwd.cn0Up)} dB-Hz`, true),
        ]),
        section("Down to your terminal", [
          row("Satellite EIRP to you", `${sdb(num("satEirp"))} dBW`),
          row("Free-space loss", `−${fmt(r.fsplDown)} dB`),
          row("Atmosphere and rain", `−${fmt(num("downLoss") || 0)} dB`),
          row("Terminal G/T", `${sdb(r.terminalGtDbK)} dB/K`),
          row("Your downlink C/N0", `${fmt(r.fwd.cn0Down)} dB-Hz`, true),
        ]),
        result(r.fwd, v.fwdRate, "Forward"),
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
    // Shows a message under the location box, in warning colors when warn is set.
    const setStatus = (text: string, warn = false) => {
      out("status").textContent = text;
      out("status").classList.toggle("warn", warn);
    };
    form.querySelector('[data-action="locate"]')!.addEventListener("click", () => {
      locateMe(setStatus, (p) => {
        el("site").value = formatCoordinates(p);
        setStatus("");
        update();
      });
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
    moveModeBar(form);
    fitStage(form);
    return form;
  },
};
