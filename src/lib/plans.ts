// Named plans kept on the device, and share links that carry a plan in the
// URL fragment. A fragment never reaches the web server. Shared links are
// untrusted input, so everything read from one is validated: only known
// settings as short strings, and finite coordinates.

import type { StorageLike } from "./pathStore";

export interface Plan {
  settings: Record<string, string>;
  /** Mesh nodes, when the plan has any. */
  nodes?: PlanNode[];
}

export interface PlanNode {
  name: string;
  lat: number;
  lon: number;
  height: string;
}

const MAX_ENCODED = 8000;
const MAX_VALUE = 80;
const MAX_NODES = 10;

export function encodePlan(plan: Plan): string {
  const bytes = new TextEncoder().encode(JSON.stringify(plan));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode and validate; undefined for anything malformed or oversized. */
export function decodePlan(encoded: string, settingNames: string[]): Plan | undefined {
  if (!encoded || encoded.length > MAX_ENCODED || !/^[A-Za-z0-9_-]+$/.test(encoded)) return undefined;
  try {
    const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return sanitizePlan(JSON.parse(new TextDecoder().decode(bytes)), settingNames);
  } catch {
    return undefined;
  }
}

export function sanitizePlan(raw: unknown, settingNames: string[]): Plan | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { settings, nodes } = raw as { settings?: unknown; nodes?: unknown };
  const clean: Plan = { settings: {} };
  if (typeof settings === "object" && settings !== null) {
    for (const name of settingNames) {
      const value = (settings as Record<string, unknown>)[name];
      if (typeof value === "string" && value.length <= MAX_VALUE) clean.settings[name] = value;
    }
  }
  if (Array.isArray(nodes)) {
    clean.nodes = nodes.slice(0, MAX_NODES).flatMap((n): PlanNode[] => {
      const { name, lat, lon, height } = (n ?? {}) as Record<string, unknown>;
      if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
      return [{
        name: typeof name === "string" ? name.slice(0, MAX_VALUE) : "",
        lat,
        lon,
        height: typeof height === "string" ? height.slice(0, 12) : "",
      }];
    });
  }
  return clean;
}

/** The encoded plan in a hash like "#mesh?plan=…", if it's for this tool. */
export function planFromHash(hash: string, toolId: string): string | undefined {
  const m = /^#([a-z]+)\?plan=([A-Za-z0-9_-]+)$/.exec(hash);
  return m && m[1] === toolId ? m[2] : undefined;
}

export interface SavedPlan extends Plan {
  name: string;
  savedAt: string;
}

export function createPlanStore(storage: StorageLike, toolId: string, settingNames: string[]) {
  const key = `rf-toolkit:plans:${toolId}`;
  const read = (): SavedPlan[] => {
    try {
      const value = JSON.parse(storage.getItem(key) ?? "[]");
      if (!Array.isArray(value)) return [];
      return value.flatMap((p): SavedPlan[] => {
        const plan = sanitizePlan(p, settingNames);
        return plan && typeof p.name === "string" ? [{ ...plan, name: p.name, savedAt: String(p.savedAt ?? "") }] : [];
      });
    } catch {
      return [];
    }
  };
  const write = (plans: SavedPlan[]) => {
    try {
      storage.setItem(key, JSON.stringify(plans));
      return true;
    } catch {
      return false;
    }
  };
  return {
    list: read,
    /** Save or replace by name. False if storage refused it. */
    save(name: string, plan: Plan, now = new Date()): boolean {
      const rest = read().filter((p) => p.name !== name);
      return write([...rest, { ...plan, name, savedAt: now.toISOString() }].sort((a, b) => a.name.localeCompare(b.name)));
    },
    remove(name: string): void {
      write(read().filter((p) => p.name !== name));
    },
  };
}
