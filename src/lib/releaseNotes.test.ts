import { describe, expect, it } from "vitest";
import file from "../releaseNotes.json";
import { CATEGORIES, cleanReleases, notesSince } from "./releaseNotes";

const r = (version: string, feature: string[] = [], fix: string[] = []) => ({ version, date: "2026-11-26", notes: { feature, fix, security: [], dependencies: [] } });

describe("notesSince", () => {
  const releases = cleanReleases({ releases: [r("2026.11.28.1", ["C"]), r("2026.11.27.1", ["B"], ["fix B"]), r("2026.11.26.1", ["A"])] });

  it("merges every entry newer than the running version, newest first", () => {
    const s = notesSince(releases, "2026.11.26.1");
    expect(s.notes.feature).toEqual(["C", "B"]);
    expect(s.notes.fix).toEqual(["fix B"]);
    expect(s.latest).toBe("2026.11.28.1");
    expect(s.empty).toBe(false);
  });

  it("shows everything to a page too old to know its version", () => {
    expect(notesSince(releases, "").notes.feature).toEqual(["C", "B", "A"]);
  });

  it("has nothing to show when already up to date", () => {
    expect(notesSince(releases, "2026.11.28.1").empty).toBe(true);
  });
});

describe("cleanReleases", () => {
  it("drops malformed entries and notes", () => {
    const list = cleanReleases({ releases: [{ version: "1.0", notes: {} }, { version: "2026.1.2.3", notes: { feature: ["ok", 5, " "], bogus: ["x"] } }] });
    expect(list).toHaveLength(1);
    expect(list[0].notes.feature).toEqual(["ok"]);
    expect(cleanReleases(null)).toEqual([]);
  });
});

// Guards each hand-written entry in src/releaseNotes.json.
describe("the release notes file", () => {
  const raw = (file as { releases: { version: string; date: string; notes: Record<string, string[]> }[] }).releases;

  it("is well formed: every entry valid, versions unique and newest first", () => {
    expect(cleanReleases(file)).toHaveLength(raw.length);
    const versions = raw.map((e) => e.version);
    expect(new Set(versions).size).toBe(versions.length);
    const key = (v: string) => v.split(".").map((n) => n.padStart(4, "0")).join(".");
    expect([...versions].sort((a, b) => key(b).localeCompare(key(a)))).toEqual(versions);
  });

  it("uses only the four categories, and every entry says something", () => {
    for (const e of raw) {
      expect(Object.keys(e.notes).every((k) => (CATEGORIES as readonly string[]).includes(k))).toBe(true);
      expect(CATEGORIES.some((c) => (e.notes[c] ?? []).length > 0)).toBe(true);
    }
  });
});
