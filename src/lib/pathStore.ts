// Terrain kept on the device so paths work without a connection: a small
// automatic cache of recent profiles, and paths the user saves by name.

import { type LatLon, formatLatLon } from "./geo";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SavedPath {
  name: string;
  tx: LatLon;
  rx: LatLon;
  elevationsM: number[];
  savedAt: string;
}

// v2: profiles from Terrain Tiles (v1 held Open-Meteo profiles).
const CACHE_KEY = "rf-toolkit:profile-cache-v2";
const SAVED_KEY = "rf-toolkit:saved-paths";
export const CACHE_LIMIT = 20;

/** Pins rounded to ~1 m identify a profile. */
export function pathKey(tx: LatLon, rx: LatLon): string {
  return `${formatLatLon(tx)} > ${formatLatLon(rx)}`;
}

function read<T>(storage: StorageLike, key: string): T[] {
  try {
    const value = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function write(storage: StorageLike, key: string, value: unknown): boolean {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // Full or blocked: work goes on, just not remembered.
  }
}

export function createPathStore(storage: StorageLike) {
  type CacheEntry = { key: string; elevationsM: number[] };

  return {
    /** Elevations for this exact path, from the cache or a saved path. */
    lookup(tx: LatLon, rx: LatLon): number[] | undefined {
      const key = pathKey(tx, rx);
      const saved = read<SavedPath>(storage, SAVED_KEY).find((p) => pathKey(p.tx, p.rx) === key);
      return saved?.elevationsM ?? read<CacheEntry>(storage, CACHE_KEY).find((e) => e.key === key)?.elevationsM;
    },

    /** Remember a fetched profile, keeping the most recent CACHE_LIMIT. */
    remember(tx: LatLon, rx: LatLon, elevationsM: number[]): void {
      const key = pathKey(tx, rx);
      const rest = read<CacheEntry>(storage, CACHE_KEY).filter((e) => e.key !== key);
      write(storage, CACHE_KEY, [{ key, elevationsM }, ...rest].slice(0, CACHE_LIMIT));
    },

    saved(): SavedPath[] {
      return read<SavedPath>(storage, SAVED_KEY);
    },

    /** Save or replace a path by name. Returns false if storage refused it. */
    save(path: Omit<SavedPath, "savedAt">, now = new Date()): boolean {
      const rest = read<SavedPath>(storage, SAVED_KEY).filter((p) => p.name !== path.name);
      const next = [...rest, { ...path, savedAt: now.toISOString() }].sort((a, b) => a.name.localeCompare(b.name));
      return write(storage, SAVED_KEY, next);
    },

    remove(name: string): void {
      write(storage, SAVED_KEY, read<SavedPath>(storage, SAVED_KEY).filter((p) => p.name !== name));
    },
  };
}

export type PathStore = ReturnType<typeof createPathStore>;
