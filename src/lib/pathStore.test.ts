import { describe, expect, it } from "vitest";
import { CACHE_LIMIT, type StorageLike, createPathStore } from "./pathStore";

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const a = { lat: 35.765, lon: -82.2652 };
const b = { lat: 35.7454, lon: -81.6848 };
const c = { lat: 35.5951, lon: -82.5515 };

describe("profile cache", () => {
  it("finds a remembered profile for the same pins", () => {
    const store = createPathStore(memoryStorage());
    store.remember(a, b, [1, 2, 3]);
    expect(store.lookup(a, b)).toEqual([1, 2, 3]);
    expect(store.lookup(b, a)).toBeUndefined();
  });

  it("matches pins that differ by less than the stored precision", () => {
    const store = createPathStore(memoryStorage());
    store.remember(a, b, [1, 2, 3]);
    expect(store.lookup({ lat: a.lat + 1e-7, lon: a.lon }, b)).toEqual([1, 2, 3]);
  });

  it("keeps only the most recent profiles", () => {
    const store = createPathStore(memoryStorage());
    for (let i = 0; i <= CACHE_LIMIT; i++) store.remember({ lat: i, lon: 0 }, b, [i]);
    expect(store.lookup({ lat: 0, lon: 0 }, b)).toBeUndefined();
    expect(store.lookup({ lat: CACHE_LIMIT, lon: 0 }, b)).toEqual([CACHE_LIMIT]);
  });
});

describe("saved paths", () => {
  it("saves, sorts by name, replaces by name and removes", () => {
    const store = createPathStore(memoryStorage());
    store.save({ name: "Ridge", tx: a, rx: b, elevationsM: [1] });
    store.save({ name: "Base", tx: c, rx: b, elevationsM: [2] });
    store.save({ name: "Ridge", tx: a, rx: b, elevationsM: [9] });
    expect(store.saved().map((p) => p.name)).toEqual(["Base", "Ridge"]);
    expect(store.lookup(a, b)).toEqual([9]);
    store.remove("Base");
    expect(store.saved().map((p) => p.name)).toEqual(["Ridge"]);
  });

  it("survives junk in storage and a full storage", () => {
    const storage = memoryStorage();
    storage.data.set("rf-toolkit:saved-paths", "{not json");
    const store = createPathStore(storage);
    expect(store.saved()).toEqual([]);
    const full = createPathStore({ getItem: () => null, setItem: () => { throw new Error("QuotaExceeded"); } });
    expect(full.save({ name: "x", tx: a, rx: b, elevationsM: [1] })).toBe(false);
  });
});
