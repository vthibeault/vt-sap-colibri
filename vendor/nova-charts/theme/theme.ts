/** Default palette slot for series `i` (cycles through 8 CSS variables). */
export function paletteVar(i: number): string {
  return `var(--nova-c${(i % 8) + 1})`;
}

const varRe = /^var\((--[\w-]+)\s*(?:,\s*([^)]+))?\)$/;

/**
 * Resolve a CSS color to a concrete value (needed wherever colors are
 * interpolated). Plain colors pass through; `var(--x)` is resolved against
 * the element's computed style.
 */
export function resolveColor(el: Element, color: string): string {
  const m = varRe.exec(color.trim());
  if (!m) return color;
  if (typeof getComputedStyle !== 'function') return m[2]?.trim() ?? '#888888';
  const resolved = getComputedStyle(el).getPropertyValue(m[1]!).trim();
  return resolved || (m[2]?.trim() ?? '#888888');
}
