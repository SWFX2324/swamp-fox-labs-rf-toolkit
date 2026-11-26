// The Satellite Link picture: a small portable terminal and a gateway on the
// ground, the satellite in a night sky between them, and the two directions
// through it: return (terminal → satellite → gateway) and forward (gateway →
// satellite → terminal). Only what an operator reads first: each direction's
// margin and rating, and which one is weaker.
//
// Drawn as one SVG so the art and the text scale together. Two layouts: wide
// (2:1) and narrow (a taller frame for phones and narrow panes).

export interface DirectionView {
  marginDb: number;
  /** "Good", "Marginal" or "Won't connect", and its status class (s-good...). */
  rating: string;
  ratingCls: string;
}

export interface SceneInput {
  wide: boolean;
  ret: DirectionView;
  fwd: DirectionView;
  weaker: "ret" | "fwd";
  /** Where your dish points, and the satellite's orbital slot, as text. */
  azimuth: number;
  elevation: number;
  slot: string;
}

type Pt = { x: number; y: number };

interface Layout {
  w: number;
  h: number;
  ground: number;
  term: Pt & { s: number };
  sat: Pt & { s: number };
  gw: Pt & { s: number };
  readout: Pt & { gap: number; big: number };
  bow: number;
  label: number;
}

const WIDE: Layout = {
  w: 800,
  h: 400,
  ground: 340,
  term: { x: 150, y: 296, s: 0.62 },
  sat: { x: 420, y: 92, s: 0.9 },
  gw: { x: 628, y: 262, s: 1.15 },
  readout: { x: 30, y: 50, gap: 66, big: 34 },
  bow: 22,
  label: 13,
};

const NARROW: Layout = {
  w: 400,
  h: 480,
  ground: 418,
  term: { x: 66, y: 386, s: 0.46 },
  sat: { x: 208, y: 236, s: 0.62 },
  gw: { x: 280, y: 362, s: 0.74 },
  readout: { x: 34, y: 58, gap: 62, big: 30 },
  bow: 16,
  label: 12,
};

const fmt = (v: number, digits = 1) =>
  `${v < 0 ? "−" : ""}${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

/** Fixed pseudo-random stars, so the sky doesn't shimmer between redraws. */
function stars(w: number, h: number, n: number): string {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  let out = "";
  for (let i = 0; i < n; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 0.5 + rnd() * 1.1;
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" opacity="${(0.25 + rnd() * 0.6).toFixed(2)}"/>`;
  }
  return out;
}

/** A ridge line across the frame: points as fractions of the width, heights in px above `base`. */
function ridge(w: number, base: number, bottom: number, pts: [number, number][]): string {
  const p = pts.map(([fx, hy]) => [fx * w, base - hy] as const);
  let d = `M0 ${bottom} L0 ${p[0][1]}`;
  for (let i = 1; i < p.length; i++) {
    const [x0, y0] = p[i - 1];
    const [x1, y1] = p[i];
    d += ` Q${x0.toFixed(1)} ${y0.toFixed(1)} ${((x0 + x1) / 2).toFixed(1)} ${((y0 + y1) / 2).toFixed(1)}`;
  }
  const last = p[p.length - 1];
  d += ` T${last[0].toFixed(1)} ${last[1].toFixed(1)} L${w} ${last[1].toFixed(1)} L${w} ${bottom} Z`;
  return d;
}

/** Feed point of a dish drawn by `reflector`: 60 units in front of its centre, after the tilt. */
const feedPoint = (x: number, y: number, s: number, tilt: number, lift: number): Pt => {
  const rad = (tilt * Math.PI) / 180;
  return { x: x + 60 * Math.sin(rad) * s, y: y - lift * s - 60 * Math.cos(rad) * s };
};

/** A parabolic reflector opening upward before the tilt; a feed horn, or a sub-reflector for a large dish. */
function reflector(tilt: number, big: boolean): string {
  return `
    <g transform="rotate(${tilt})">
      <path class="ss-dish-back" d="M-58 -2 Q0 52 58 -2 Q0 18 -58 -2 Z"/>
      <ellipse class="ss-dish-face" cx="0" cy="-2" rx="58" ry="15"/>
      <ellipse class="ss-dish-inner" cx="0" cy="0" rx="40" ry="9"/>
      ${
        big
          ? `<path class="ss-strut" d="M-40 -4 L0 -56 M40 -4 L0 -56 M0 10 L0 -56"/><ellipse class="ss-feed" cx="0" cy="-58" rx="11" ry="3.5"/>`
          : `<path class="ss-strut" d="M0 12 L0 -60 M-36 -4 L0 -60 M36 -4 L0 -60"/><path class="ss-feed" d="M-5 -56 L5 -56 L8 -66 L-8 -66 Z"/><rect class="ss-buc" x="8" y="-74" width="16" height="11" rx="2"/>`
      }
    </g>`;
}

/** A small portable terminal: a dish on a tripod, its transit case beside it. */
function terminal(x: number, y: number, s: number, tilt: number): string {
  return `
  <g class="ss-term" transform="translate(${x} ${y}) scale(${s})">
    <ellipse class="ss-shadow" cx="10" cy="74" rx="62" ry="7"/>
    <path class="ss-leg" d="M0 8 L-40 74 M0 8 L36 74 M0 8 L4 76"/>
    <rect class="ss-mount" x="-6" y="-6" width="12" height="18" rx="3"/>
    ${reflector(tilt, false)}
    <rect class="ss-case" x="44" y="50" width="46" height="26" rx="4"/>
    <path class="ss-case-line" d="M44 61 L90 61 M60 50 L60 46 L74 46 L74 50"/>
    <rect class="ss-latch" x="50" y="58" width="6" height="6" rx="1"/><rect class="ss-latch" x="78" y="58" width="6" height="6" rx="1"/>
  </g>`;
}

/** The gateway: a large dish on a concrete pedestal and the building where the network lives. */
function gateway(x: number, y: number, s: number, tilt: number): string {
  let windows = "";
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) windows += `<rect class="ss-window" x="${62 + c * 20}" y="${30 + r * 20}" width="10" height="8" rx="1"/>`;
  return `
  <g transform="translate(${x} ${y}) scale(${s})">
    <rect class="ss-building" x="52" y="14" width="96" height="66" rx="2"/>
    <rect class="ss-roof" x="48" y="8" width="104" height="8" rx="2"/>
    ${windows}
    <rect class="ss-door" x="128" y="56" width="12" height="24" rx="1"/>
    <path class="ss-mast" d="M140 8 L140 -22 M134 -14 L146 -14 M136 -6 L144 -6"/>
    <circle class="ss-beacon" cx="140" cy="-24" r="2.2"/>
    <ellipse class="ss-shadow" cx="0" cy="80" rx="60" ry="7"/>
    <path class="ss-pedestal" d="M-22 80 L-14 4 L14 4 L22 80 Z"/>
    <rect class="ss-mount-dark" x="-16" y="-4" width="32" height="12" rx="3"/>
    ${reflector(tilt, true)}
  </g>`;
}

/** A geostationary communications satellite: bus, two solar wings, a dish toward Earth. */
function satellite(x: number, y: number, s: number): string {
  const cells = (x0: number) => {
    let g = "";
    for (let i = 1; i < 5; i++) g += `<line x1="${x0 + i * 14}" y1="-15" x2="${x0 + i * 14}" y2="15"/>`;
    return `${g}<line x1="${x0}" y1="0" x2="${x0 + 70}" y2="0"/>`;
  };
  return `
  <g transform="translate(${x} ${y}) scale(${s})">
    <circle class="ss-reticle" r="66"/>
    <path class="ss-reticle-tick" d="M0 -76 V-62 M0 62 V76 M-76 0 H-62 M62 0 H76"/>
    <line class="ss-boom" x1="-96" y1="0" x2="96" y2="0"/>
    <rect class="ss-panel" x="-100" y="-16" width="72" height="32" rx="2"/>
    <g class="ss-cells">${cells(-100)}</g>
    <rect class="ss-panel" x="28" y="-16" width="72" height="32" rx="2"/>
    <g class="ss-cells">${cells(28)}</g>
    <rect class="ss-bus" x="-17" y="-22" width="34" height="44" rx="3"/>
    <rect class="ss-bus-band" x="-17" y="-6" width="34" height="8"/>
    <line class="ss-boom" x1="0" y1="-22" x2="0" y2="-36"/>
    <circle class="ss-tip" cx="0" cy="-37" r="2.5"/>
    <path class="ss-sat-dish" d="M-16 26 Q0 44 16 26 Q0 32 -16 26 Z"/>
    <line class="ss-boom" x1="0" y1="22" x2="0" y2="28"/>
  </g>`;
}

/**
 * Fit the readout panel around its text, once the SVG is on the page: font
 * widths vary, so it's measured rather than guessed.
 */
export function fitReadoutPanel(svg: SVGSVGElement): void {
  const groups = [...svg.querySelectorAll<SVGGElement>(".ss-readout")];
  const bg = svg.querySelector<SVGRectElement>(".ss-panel-bg");
  const edge = svg.querySelector<SVGPathElement>(".ss-panel-edge");
  if (!groups.length || !bg || !edge) return;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const g of groups) {
    const b = g.getBBox();
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  const pad = 12;
  const x = x0 - pad;
  const y = y0 - pad;
  const w = x1 - x0 + pad * 2;
  const h = y1 - y0 + pad * 2;
  bg.setAttribute("x", String(x));
  bg.setAttribute("y", String(y));
  bg.setAttribute("width", String(w));
  bg.setAttribute("height", String(h));
  const t = 8;
  edge.setAttribute("d", `M${x} ${y + t} V${y} H${x + t} M${x + w - t} ${y} H${x + w} V${y + t} M${x + w} ${y + h - t} V${y + h} H${x + w - t} M${x + t} ${y + h} H${x} V${y + h - t}`);
}

export function satScene(i: SceneInput): { svg: string; ratio: string } {
  const L = i.wide ? WIDE : NARROW;
  const { w, h } = L;
  const termTilt = 38;
  const gwTilt = -34;
  const termFeed = feedPoint(L.term.x, L.term.y, L.term.s, termTilt, 0);
  const gwFeed = feedPoint(L.gw.x, L.gw.y, L.gw.s, gwTilt, 0);
  // Both pairs meet the satellite's dish, a little apart.
  const satL = { x: L.sat.x - 8 * L.sat.s, y: L.sat.y + 36 * L.sat.s };
  const satR = { x: L.sat.x + 8 * L.sat.s, y: L.sat.y + 36 * L.sat.s };

  /** Two arcs between a ground station and the satellite, bowed apart. */
  const pair = (ground: Pt, sat: Pt) => {
    const dx = sat.x - ground.x;
    const dy = sat.y - ground.y;
    const len = Math.hypot(dx, dy);
    const px = -dy / len;
    const py = dx / len;
    const mid = { x: (ground.x + sat.x) / 2, y: (ground.y + sat.y) / 2 };
    const arc = (from: Pt, to: Pt, side: number) => {
      const o = (p: Pt) => ({ x: p.x + px * 5 * side, y: p.y + py * 5 * side });
      const a = o(from);
      const b = o(to);
      return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${(mid.x + px * L.bow * side).toFixed(1)} ${(mid.y + py * L.bow * side).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    };
    return { arc, mid, px, py };
  };
  const left = pair(termFeed, satL);
  const right = pair(gwFeed, satR);
  // Terminal side: return goes up on the upper-left arc, forward comes down the other.
  const retUp = left.arc(termFeed, satL, -1);
  const fwdDown = left.arc(satL, termFeed, 1);
  // Gateway side: return comes down on the upper-right arc, forward goes up the other.
  const retDown = right.arc(satR, gwFeed, 1);
  const fwdUp = right.arc(gwFeed, satR, -1);

  const pathCls = (dir: "ret" | "fwd") => {
    const v = i[dir];
    return `ss-path ss-${dir}${v.ratingCls === "s-good" ? "" : v.ratingCls === "s-marginal" ? " marginal" : " fail"}`;
  };
  const paths = (dir: "ret" | "fwd", ds: string[]) =>
    ds.map((d) => `<path class="${pathCls(dir)} ss-glow" d="${d}"/>`).join("") + ds.map((d) => `<path class="${pathCls(dir)} ss-flow" d="${d}"/>`).join("");

  // Names beside the terminal's two arcs, so the colours read without a key.
  const tag = (p: Pt, anchor: string, text: string, dir: "ret" | "fwd") =>
    `<text class="ss-tag ss-${dir}-text" x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" text-anchor="${anchor}" font-size="${L.label}">${text}</text>`;
  const gap = L.bow / 2 + (i.wide ? 22 : 18);
  const retTag = { x: left.mid.x - left.px * gap, y: left.mid.y - left.py * gap };
  const fwdTag = { x: left.mid.x + left.px * gap, y: left.mid.y + left.py * gap + L.label };

  const r = L.readout;
  const different = Math.abs(i.ret.marginDb - i.fwd.marginDb) >= 0.5;
  const block = (dir: "ret" | "fwd", y: number) => {
    const v = i[dir];
    const weaker = different && i.weaker === dir;
    return `
    <g class="ss-readout ${v.ratingCls}">
      <text x="${r.x}" y="${y}" class="ss-dir ss-${dir}-text" font-size="${r.big * 0.38}">${dir === "ret" ? "RETURN" : "FORWARD"}${weaker ? `<tspan class="ss-weaker" dx="8">WEAKER</tspan>` : ""}</text>
      <text x="${r.x}" y="${y + r.big * 1.02}" class="ss-big" font-size="${r.big}">${fmt(v.marginDb)}<tspan class="ss-unit" font-size="${r.big * 0.45}" dx="5">dB</tspan><tspan class="ss-rating" font-size="${r.big * 0.42}" dx="10">${v.rating.toUpperCase()}</tspan></text>
    </g>`;
  };

  // Corner brackets on the frame, and a panel behind the readout.
  const b = 22;
  const m = 10;
  const brackets = `<path class="ss-bracket" d="M${m} ${m + b} V${m} H${m + b} M${w - m - b} ${m} H${w - m} V${m + b} M${w - m} ${h - m - b} V${h - m} H${w - m - b} M${m + b} ${h - m} H${m} V${h - m - b}"/>`;
  const panelW = i.wide ? 236 : 196;
  const panelH = r.gap + r.big * 1.5;
  const px0 = r.x - 12;
  const py0 = r.y - r.big * 0.62;
  const t = 8;
  const hudPanel = `<rect class="ss-panel-bg" x="${px0}" y="${py0}" width="${panelW}" height="${panelH}" rx="3"/>
    <path class="ss-panel-edge" d="M${px0} ${py0 + t} V${py0} H${px0 + t} M${px0 + panelW - t} ${py0} H${px0 + panelW} V${py0 + t} M${px0 + panelW} ${py0 + panelH - t} V${py0 + panelH} H${px0 + panelW - t} M${px0 + t} ${py0 + panelH} H${px0} V${py0 + panelH - t}"/>`;

  const svg = `
  <svg class="ss" viewBox="0 0 ${w} ${h}" role="img" aria-label="Return margin ${fmt(i.ret.marginDb)} dB, ${i.ret.rating}. Forward margin ${fmt(i.fwd.marginDb)} dB, ${i.fwd.rating}.">
    <defs>
      <linearGradient id="ssSky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#070d18"/>
        <stop offset="0.65" stop-color="#14263d"/>
        <stop offset="1" stop-color="#2a4560"/>
      </linearGradient>
      <radialGradient id="ssGlow">
        <stop offset="0" stop-color="#7fb2ff" stop-opacity="0.22"/>
        <stop offset="1" stop-color="#7fb2ff" stop-opacity="0"/>
      </radialGradient>
      <pattern id="ssGrid" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M40 0 H0 V40" fill="none" class="ss-grid"/>
      </pattern>
      <linearGradient id="ssDish" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f1f4f7"/>
        <stop offset="1" stop-color="#b9c3cd"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#ssSky)"/>
    <g class="ss-stars">${stars(w, L.ground - 70, i.wide ? 70 : 50)}</g>
    <path class="ss-far" d="${ridge(w, L.ground - 8, h, [[0, 60], [0.12, 88], [0.24, 58], [0.38, 100], [0.5, 66], [0.64, 94], [0.78, 56], [0.9, 82], [1, 62]])}"/>
    <path class="ss-mid" d="${ridge(w, L.ground + 2, h, [[0, 36], [0.18, 20], [0.33, 42], [0.52, 16], [0.7, 34], [0.86, 18], [1, 30]])}"/>
    <path class="ss-near" d="M0 ${L.ground} Q${w * 0.5} ${L.ground - 12} ${w} ${L.ground} L${w} ${h} L0 ${h} Z"/>
    <rect width="${w}" height="${h}" fill="url(#ssGrid)"/>

    ${satellite(L.sat.x, L.sat.y, L.sat.s)}
    ${paths("ret", [retUp, retDown])}
    ${paths("fwd", [fwdUp, fwdDown])}
    ${terminal(L.term.x, L.term.y, L.term.s, termTilt)}
    ${gateway(L.gw.x, L.gw.y, L.gw.s, gwTilt)}

    ${tag(retTag, "end", "RETURN", "ret")}
    ${tag(fwdTag, "start", "FORWARD", "fwd")}
    <text class="ss-place" x="${L.term.x}" y="${(L.ground + (i.wide ? 34 : 30)).toFixed(1)}" text-anchor="middle" font-size="${L.label}">Your terminal</text>
    <text class="ss-place" x="${(L.gw.x + 40 * L.gw.s).toFixed(1)}" y="${(L.ground + (i.wide ? 34 : 30)).toFixed(1)}" text-anchor="middle" font-size="${L.label}">Gateway</text>

    ${hudPanel}
    ${block("ret", r.y)}
    ${block("fwd", r.y + r.gap)}
    <text class="ss-hud" x="${i.wide ? L.term.x : 24}" y="${(L.ground + (i.wide ? 52 : 46)).toFixed(1)}" text-anchor="${i.wide ? "middle" : "start"}" font-size="${L.label - 1}">AZ ${Math.round(i.azimuth)}° T · EL ${fmt(i.elevation)}°</text>
    <text class="ss-hud" x="${(L.sat.x + 70 * L.sat.s).toFixed(1)}" y="${(L.sat.y - 52 * L.sat.s).toFixed(1)}" font-size="${L.label - 1}">${i.slot}</text>
    ${brackets}
  </svg>`;
  return { svg, ratio: `${w} / ${h}` };
}
