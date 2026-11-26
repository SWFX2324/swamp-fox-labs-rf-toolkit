// Light or dark: the theme the user picked, or the device's until they pick one.
// main.ts fires THEME_EVENT whenever it changes.

export const THEME_EVENT = "rf-toolkit:theme";

/** True when the page is dark: the theme the user picked, or the device's setting if they haven't picked one. */
export function isDarkTheme(): boolean {
  const picked = document.documentElement.dataset.theme;
  return picked ? picked === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
}
