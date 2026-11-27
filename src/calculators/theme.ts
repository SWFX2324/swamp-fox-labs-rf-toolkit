// Light or dark: the theme the user picked, or the device's until they pick one.
// main.ts fires THEME_EVENT whenever it changes.

export const THEME_EVENT = "rf-toolkit:theme";

/** True when the page is dark: the theme the user picked, or the device's setting if they haven't picked one. */
export function isDarkTheme(): boolean {
  const picked = document.documentElement.dataset.theme;
  return picked ? picked === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** A color from the page's CSS variables (such as --good) as red, green and blue, so the canvas uses the theme's colors. */
export function cssColor(name: string): [number, number, number] {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  document.body.append(probe);
  const m = getComputedStyle(probe).color.match(/\d+/g) ?? ["0", "0", "0"];
  probe.remove();
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}
