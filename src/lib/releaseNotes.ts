// Release notes: one entry per update, newest first, kept in src/releaseNotes.json
// and written in plain words when each update ships. Every build knows its own
// version (the newest entry when it was built). When a newer version is waiting,
// the page fetches the new build's notes and shows every entry newer than its
// own, merged by category, so someone who skipped several updates sees them all.

/** The four kinds of change, in the order the notes show them. */
export const CATEGORIES = ["feature", "fix", "security", "dependencies"] as const;
export type Category = (typeof CATEGORIES)[number];

/** Each category's heading in the notes. */
export const CATEGORY_NAMES: Record<Category, string> = {
  feature: "New Feature",
  fix: "Bug Fixes",
  security: "Security",
  dependencies: "Dependencies",
};

export interface Release {
  /** Year, month, day and that day's count, such as "2026.11.26.1". */
  version: string;
  date: string;
  notes: Record<Category, string[]>;
}

const VERSION = /^\d{4}\.\d{1,2}\.\d{1,2}\.\d{1,3}$/;
const MAX_RELEASES = 100;
const MAX_NOTE = 400;

/**
 * Releases from the fetched notes file, checked: a valid version, and each
 * category a list of short text notes. Anything malformed is dropped, so a
 * damaged file shows fewer notes rather than breaking the update button.
 */
export function cleanReleases(raw: unknown): Release[] {
  const list = (raw as { releases?: unknown } | null)?.releases;
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_RELEASES).flatMap((r): Release[] => {
    const e = (r ?? {}) as Record<string, unknown>;
    if (typeof e.version !== "string" || !VERSION.test(e.version)) return [];
    const notes = (e.notes ?? {}) as Record<string, unknown>;
    const clean = Object.fromEntries(
      CATEGORIES.map((c) => [c, Array.isArray(notes[c]) ? (notes[c] as unknown[]).filter((n): n is string => typeof n === "string" && n.trim() !== "").map((n) => n.slice(0, MAX_NOTE)) : []]),
    ) as Record<Category, string[]>;
    return [{ version: e.version, date: typeof e.date === "string" ? e.date.slice(0, 10) : "", notes: clean }];
  });
}

/**
 * Every note newer than the version this page runs, merged by category, with
 * the newest notes first. A page too old to know its version (or one not in
 * the list) gets every entry. empty is true when there's nothing to show.
 */
export function notesSince(releases: Release[], current: string): { notes: Record<Category, string[]>; latest?: string; empty: boolean } {
  const at = releases.findIndex((r) => r.version === current);
  const newer = at < 0 ? releases : releases.slice(0, at);
  const notes = Object.fromEntries(CATEGORIES.map((c) => [c, [...new Set(newer.flatMap((r) => r.notes[c]))]])) as Record<Category, string[]>;
  return { notes, latest: newer[0]?.version, empty: CATEGORIES.every((c) => notes[c].length === 0) };
}
