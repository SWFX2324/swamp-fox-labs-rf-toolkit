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

/**
 * The cache key for a path between two pins. Coordinates are rounded to about
 * a meter, so a pin nudged by less than that still finds its saved profile.
 */
export function pathKey(tx: LatLon, rx: LatLon): string {
  return `${formatLatLon(tx)} > ${formatLatLon(rx)}`;
}

/** A stored list, or an empty one when it is missing, damaged or not a list. */
function read<T>(storage: StorageLike, key: string): T[] {
  try {
    const value = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/** Stores a value as JSON. False when storage refused it. */
function write(storage: StorageLike, key: string, value: unknown): boolean {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // Full or blocked: work goes on, just not remembered.
  }
}

/**
 * Terrain profiles kept on the device: an automatic cache of the most recent
 * paths and the paths the user saved by name, so a path opens without a connection.
 */
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

    /** Every path the user saved, sorted by name. */
    saved(): SavedPath[] {
      return read<SavedPath>(storage, SAVED_KEY);
    },

    /** Save or replace a path by name. Returns false if storage refused it. */
    save(path: Omit<SavedPath, "savedAt">, now = new Date()): boolean {
      const rest = read<SavedPath>(storage, SAVED_KEY).filter((p) => p.name !== path.name);
      const next = [...rest, { ...path, savedAt: now.toISOString() }].sort((a, b) => a.name.localeCompare(b.name));
      return write(storage, SAVED_KEY, next);
    },

    /** Deletes the saved path with that name. */
    remove(name: string): void {
      write(storage, SAVED_KEY, read<SavedPath>(storage, SAVED_KEY).filter((p) => p.name !== name));
    },
  };
}

