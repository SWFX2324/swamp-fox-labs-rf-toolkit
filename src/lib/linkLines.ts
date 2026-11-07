// The app's standard for link lines on maps and in exports: colour for how
// strong the link is, pattern for line of sight.
//
// - Good, clear line of sight: solid green
// - Good, obstructed (terrain within 60% of the first Fresnel zone, or across
//   the line of sight itself): long-dash green
// - Marginal: short-dash amber
// - Won't connect: thin, faded red dots

import type { ProfileStatus } from "./profile";

export type LinkQuality = "good" | "marginal" | "fail";
export type LinkLineStyle = "good-clear" | "good-obstructed" | "marginal" | "fail";

/** Good once the margin covers the fade margin wanted, marginal above 0 dB. */
export function linkQuality(marginDb: number, fadeMarginDb: number): LinkQuality {
  return marginDb >= fadeMarginDb ? "good" : marginDb >= 0 ? "marginal" : "fail";
}

/**
 * Line style for a link. Line of sight only splits good links: a marginal or
 * failed link is drawn the same either way. Without a terrain verdict (still
 * loading, offline, or no profile), a good link can't promise clear line of
 * sight, so it's drawn as obstructed.
 */
export function linkLineStyle(quality: LinkQuality, lineOfSight: ProfileStatus | undefined): LinkLineStyle {
  if (quality !== "good") return quality;
  return lineOfSight === "clear" ? "good-clear" : "good-obstructed";
}

/** Plain-language names, for the legend, popups and export descriptions. */
export const linkLineLabels: Record<LinkLineStyle, string> = {
  "good-clear": "Good, clear line of sight",
  "good-obstructed": "Good, obstructed line of sight",
  marginal: "Marginal",
  fail: "Won't connect",
};

/** Legend order, strongest first. */
export const linkLineOrder: LinkLineStyle[] = ["good-clear", "good-obstructed", "marginal", "fail"];
