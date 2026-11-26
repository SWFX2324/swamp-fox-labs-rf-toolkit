// Text that came from the user (a site name, a preset name, an imported file)
// must never be read as markup when the page builds HTML or SVG from a string.

/**
 * Escapes the five characters that can change the meaning of HTML: the
 * ampersand, both angle brackets and both quote marks. The result is safe both
 * as element text and inside a quoted attribute.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
