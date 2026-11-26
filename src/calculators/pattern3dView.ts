// A 3D view of an antenna's idealized radiation pattern (lib/antennaPattern.ts),
// drawn like antenna modelling software: a wireframe mesh whose distance from
// the centre is the field strength, each line coloured by dB from red at the
// peak to dark blue at −30 dB, with X, Y and Z axes, a ground grid and the antenna
// in the scene. Drag to turn it.

import { toDb } from "../lib/antennaPattern";

const FLOOR = -30;
/** Colour stops: dB below the peak, and the colour there. */
const STOPS: [number, [number, number, number]][] = [
  [0, [232, 69, 44]],
  [-3, [242, 166, 35]],
  [-6, [235, 214, 52]],
  [-10, [64, 190, 113]],
  [-20, [47, 127, 216]],
  [-30, [33, 52, 128]],
];

/** The colour for a level, dB below the peak, lit by shade (0–1). */
export function patternColour(db: number, shade = 1): string {
  const d = Math.max(FLOOR, Math.min(0, db));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [a, ca] = STOPS[i];
    const [b, cb] = STOPS[i + 1];
    if (d <= a && d >= b) {
      const t = (a - d) / (a - b);
      const c = ca.map((v, k) => Math.round(v + (cb[k] - v) * t));
      return `rgb(${Math.round(c[0] * shade)},${Math.round(c[1] * shade)},${Math.round(c[2] * shade)})`;
    }
  }
  return "rgb(33,52,128)";
}

/** The colour key: a gradient from the peak to −30 dB. */
export const PATTERN_GRADIENT = `linear-gradient(to right, ${STOPS.map(([db, c]) => `rgb(${c.join(",")}) ${(db / FLOOR) * 100}%`).join(", ")})`;

export interface PatternScene {
  /** Relative field at theta (from straight up) and phi (azimuth from +x), degrees. */
  field: (thetaDeg: number, phiDeg: number) => number;
  /** How the antenna lies: along x, standing on z, or standing on ground. */
  antenna: "horizontal" | "vertical" | "ground" | "loop";
}

// Mesh spacing: rings every 6°, meridians every 10°, like a modelling program's wireframe.
const T_STEP = 6;
const P_STEP = 10;

/** A canvas showing the pattern in 3D, turned by dragging. */
export function createPattern3d(): { element: HTMLElement; show(scene: PatternScene | undefined): void } {
  const wrap = document.createElement("div");
  wrap.className = "pattern3d";
  wrap.innerHTML = `
    <button type="button" class="pattern3d-waves" aria-pressed="true">Waves</button>
    <canvas aria-label="Idealized radiation pattern in 3D. Drag to turn it."></canvas>
    <div class="pattern3d-key"><span>Peak</span><span class="bar" style="background:${PATTERN_GRADIENT}"></span><span>−30 dB</span></div>`;
  const canvas = wrap.querySelector("canvas")!;
  const ctx = canvas.getContext("2d")!;
  let scene: PatternScene | undefined;
  // The view: turned around the vertical axis, then tilted toward you.
  let yaw = -28;
  let pitch = 20;
  // The surface, worked out once per scene: each point's position and level.
  let grid: { x: number; y: number; z: number; db: number }[][] = [];
  // The strongest field, to scale the waves' brightness.
  let peakField = 0;
  // Waves rippling out from the antenna: on unless turned off; still if the
  // viewer asks for less motion.
  let waves = true;
  const stillMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let phase = 0;
  let frame = 0;

  // Works out the pattern's surface for the current antenna: a point for every
  // angle step, as far from the centre as the field is strong, with its level in dB.
  const build = () => {
    grid = [];
    if (!scene) return;
    const raw: number[][] = [];
    let peak = 0;
    for (let t = 0; t <= 180; t += T_STEP) {
      const row: number[] = [];
      for (let p = 0; p <= 360; p += P_STEP) {
        const v = scene.field(t, p);
        row.push(v);
        if (v > peak) peak = v;
      }
      raw.push(row);
    }
    peakField = peak;
    grid = raw.map((row, i) =>
      row.map((v, j) => {
        const rel = peak > 0 ? v / peak : 0;
        const db = toDb(rel, FLOOR);
        // Size by field strength, colour by dB.
        const r = rel;
        const t = (i * T_STEP * Math.PI) / 180;
        const p = (j * P_STEP * Math.PI) / 180;
        return { x: r * Math.sin(t) * Math.cos(p), y: r * Math.sin(t) * Math.sin(p), z: r * Math.cos(t), db };
      }),
    );
  };

  // Draws one frame: the ground grid, the waves, the pattern mesh, the axes and
  // the antenna, sorted so nearer parts cover farther ones, then the labels.
  const draw = () => {
    const w = wrap.clientWidth;
    if (!w) return;
    const h = Math.round(Math.min(w * 0.7, 400));
    const dpr = window.devicePixelRatio || 1;
    // Only resized when the size changes: this runs every frame while waves move.
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.height = `${h}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!scene || !grid.length) return;
    // Room for the axes, which reach past the pattern.
    const scale = Math.min(w, h) * 0.34;
    const cy = Math.cos((yaw * Math.PI) / 180);
    const sy = Math.sin((yaw * Math.PI) / 180);
    const cp = Math.cos((pitch * Math.PI) / 180);
    const sp = Math.sin((pitch * Math.PI) / 180);
    // World (z up) to screen, turned and tilted; depth grows toward the viewer.
    type P3 = { x: number; y: number; z: number };
    // A point in the scene to its place on screen, and how near the viewer it is.
    const project = (q: P3) => {
      const x1 = q.x * cy - q.y * sy;
      const y1 = q.x * sy + q.y * cy;
      return { sx: w / 2 + x1 * scale, sy: h / 2 - (q.z * cp - y1 * sp) * scale, depth: y1 * cp + q.z * sp };
    };
    const style = getComputedStyle(wrap);
    const gridColour = style.getPropertyValue("--muted").trim() || "#888";
    const textColour = style.getPropertyValue("--text").trim() || "#ddd";

    // Everything goes into one list and is drawn back to front, so the mesh,
    // grid, axes and antenna overlap properly as it turns.
    const prims: { depth: number; paint: () => void }[] = [];
    // Queues one line to be drawn in depth order.
    const line = (p: P3, q: P3, colour: string, width: number, alpha = 1) => {
      const a = project(p);
      const b = project(q);
      prims.push({
        depth: (a.depth + b.depth) / 2,
        // Draws this line when its turn comes in depth order.
        paint: () => {
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = colour;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.stroke();
        },
      });
    };

    // The ground grid, in the horizontal plane.
    const G = 1.2;
    for (let v = -G; v <= G + 1e-9; v += 0.3) {
      line({ x: -G, y: v, z: 0 }, { x: G, y: v, z: 0 }, gridColour, 1, 0.25);
      line({ x: v, y: -G, z: 0 }, { x: v, y: G, z: 0 }, gridColour, 1, 0.25);
    }

    // With waves showing, the mesh steps back so the waves read.
    const meshAlpha = waves ? 0.22 : 1;

    // Waves: rings rippling out in two slices, the ground plane and the
    // upright plane along the wire (X–Z). Each bit of a ring is as bright as
    // the antenna is strong that way, so they pour out where it radiates and
    // fade to nothing at its nulls. An illustration: not to scale in spacing or speed.
    if (waves && peakField > 0) {
      const RINGS = 5;
      const MAX = 1.25;
      const STEP = 4;
      // How strong the antenna is in a direction, from 0 to 1 of its peak.
      const strength = (thetaDeg: number, phiDeg: number) => scene!.field(thetaDeg, phiDeg) / peakField;
      for (let k = 0; k < RINGS; k++) {
        const r = (((phase + k / RINGS) % 1) + 1) % 1 * MAX;
        if (r < 0.05) continue;
        // Brightest near the antenna, fading as they spread.
        const fade = 1 - r / MAX;
        for (let a = 0; a < 360; a += STEP) {
          const b = a + STEP;
          const mid = (a + STEP / 2) * Math.PI / 180;
          // Ground plane: theta 90°, azimuth a.
          const g = strength(90, a + STEP / 2);
          if (g > 0.02) {
            line(
              { x: r * Math.cos((a * Math.PI) / 180), y: r * Math.sin((a * Math.PI) / 180), z: 0 },
              { x: r * Math.cos((b * Math.PI) / 180), y: r * Math.sin((b * Math.PI) / 180), z: 0 },
              patternColour(toDb(g, FLOOR)),
              2.4,
              Math.min(1, g * 1.1) * fade,
            );
          }
          // Upright plane through the wire: point (cos a, 0, sin a).
          const sinA = Math.sin(mid);
          const cosA = Math.cos(mid);
          const v = strength((Math.acos(Math.max(-1, Math.min(1, sinA))) * 180) / Math.PI, cosA >= 0 ? 0 : 180);
          if (v > 0.02) {
            line(
              { x: r * Math.cos((a * Math.PI) / 180), y: 0, z: r * Math.sin((a * Math.PI) / 180) },
              { x: r * Math.cos((b * Math.PI) / 180), y: 0, z: r * Math.sin((b * Math.PI) / 180) },
              patternColour(toDb(v, FLOOR)),
              2.4,
              Math.min(1, v * 1.1) * fade,
            );
          }
        }
      }
    }

    // The pattern: a mesh of rings and meridians, each segment in its strength's colour.
    const zero = (q: P3) => Math.abs(q.x) + Math.abs(q.y) + Math.abs(q.z) < 1e-6;
    for (let i = 0; i < grid.length; i++) {
      for (let j = 0; j < grid[i].length; j++) {
        const q = grid[i][j];
        const right = grid[i][j + 1];
        const down = grid[i + 1]?.[j];
        if (right && !(zero(q) && zero(right))) line(q, right, patternColour((q.db + right.db) / 2), 1.2, meshAlpha);
        if (down && !(zero(q) && zero(down))) line(q, down, patternColour((q.db + down.db) / 2), 1.2, meshAlpha);
      }
    }

    // The axes, both ways along the ground, up only: X red, Y green, Z blue.
    const L = 1.3;
    const X = "#e5484d";
    const Y = "#30a46c";
    const Z = "#3e8ed0";
    line({ x: -L, y: 0, z: 0 }, { x: L, y: 0, z: 0 }, X, 1.6, 0.9);
    line({ x: 0, y: -L, z: 0 }, { x: 0, y: L, z: 0 }, Y, 1.6, 0.9);
    line({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: L }, Z, 1.6, 0.9);
    // What each direction means for this antenna, at the ends of the axes.
    const labels: [P3, string, string][] = [[{ x: 0, y: 0, z: L }, Z, "Up"]];
    if (scene.antenna === "horizontal" || scene.antenna === "loop") {
      const [along, across] = scene.antenna === "loop" ? ["Edge-on", "Through the loop"] : ["Wire end", "Broadside"];
      labels.push([{ x: L, y: 0, z: 0 }, X, along], [{ x: -L, y: 0, z: 0 }, X, along], [{ x: 0, y: L, z: 0 }, Y, across], [{ x: 0, y: -L, z: 0 }, Y, across]);
    }

    // The antenna, in the scene at the centre.
    const ant = (p: P3, q: P3) => line(p, q, textColour, 3);
    if (scene.antenna === "horizontal") ant({ x: -0.3, y: 0, z: 0 }, { x: 0.3, y: 0, z: 0 });
    else if (scene.antenna === "vertical") ant({ x: 0, y: 0, z: -0.3 }, { x: 0, y: 0, z: 0.3 });
    else if (scene.antenna === "ground") {
      ant({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0.35 });
      // Four radials, drooped a little.
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) ant({ x: 0, y: 0, z: 0 }, { x: dx * 0.25, y: dy * 0.25, z: -0.06 });
    } else {
      const c = 0.14;
      ant({ x: -c, y: 0, z: -c }, { x: c, y: 0, z: -c });
      ant({ x: c, y: 0, z: -c }, { x: c, y: 0, z: c });
      ant({ x: c, y: 0, z: c }, { x: -c, y: 0, z: c });
      ant({ x: -c, y: 0, z: c }, { x: -c, y: 0, z: -c });
    }

    prims.sort((p, q) => p.depth - q.depth);
    ctx.lineCap = "round";
    for (const p of prims) p.paint();
    ctx.globalAlpha = 1;

    // Labels last, so they're never hidden, each on a small backing so it reads over the mesh.
    ctx.font = "600 11.5px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const backing = style.getPropertyValue("--card-2").trim() || "#222";
    // A label on a small backing, kept inside the canvas.
    const tag = (at: { sx: number; sy: number }, colour: string, text: string) => {
      const tw = ctx.measureText(text).width + 10;
      // Kept inside the canvas.
      const x = Math.max(tw / 2 + 2, Math.min(w - tw / 2 - 2, at.sx));
      const y = Math.max(10, Math.min(h - 10, at.sy));
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = backing;
      ctx.fillRect(x - tw / 2, y - 9, tw, 18);
      ctx.globalAlpha = 1;
      ctx.fillStyle = colour;
      ctx.fillText(text, x, y);
    };
    for (const [tip, colour, text] of labels) tag(project({ x: tip.x * 1.1, y: tip.y * 1.1, z: tip.z * 1.1 }), colour, text);
    // A vertical radiates the same every way round: said on the ground.
    if (scene.antenna === "vertical" || scene.antenna === "ground") tag(project({ x: 0, y: -1.05, z: 0 }), textColour, "Same all round");
  };

  // The waves move while showing, the page is in view and motion is welcome.
  const tick = (now: number) => {
    frame = 0;
    if (!wrap.isConnected || !waves || !scene || stillMotion.matches || document.hidden) return;
    phase = (now / 2600) % 1;
    draw();
    frame = requestAnimationFrame(tick);
  };
  // Starts the wave animation if it should be running and isn't already.
  const animate = () => {
    if (!frame && waves && scene && !stillMotion.matches) frame = requestAnimationFrame(tick);
  };
  document.addEventListener("visibilitychange", animate);
  const toggle = wrap.querySelector<HTMLButtonElement>(".pattern3d-waves")!;
  toggle.addEventListener("click", () => {
    waves = !waves;
    toggle.setAttribute("aria-pressed", String(waves));
    draw();
    animate();
  });

  // Drag to turn: sideways turns it around, up and down tilts it.
  let dragging: { x: number; y: number; yaw: number; pitch: number } | undefined;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = { x: e.clientX, y: e.clientY, yaw, pitch };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    yaw = dragging.yaw - (e.clientX - dragging.x) * 0.5;
    pitch = Math.max(-85, Math.min(85, dragging.pitch + (e.clientY - dragging.y) * 0.4));
    draw();
  });
  const stop = () => (dragging = undefined); // Ends a drag.
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);
  new ResizeObserver(() => draw()).observe(wrap);
  window.addEventListener("rf-toolkit:theme", () => wrap.isConnected && draw());

  return {
    element: wrap,
    /** Shows the pattern for another antenna, or hides the view when given none. */
    show(next) {
      scene = next;
      wrap.hidden = !next;
      build();
      draw();
      animate();
    },
  };
}
