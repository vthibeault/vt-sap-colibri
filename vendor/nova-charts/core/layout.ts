import type { Margin, Rect } from './types.js';

export const defaultMargin: Margin = { top: 18, right: 18, bottom: 34, left: 48 };

export function computeLayout(
  width: number,
  height: number,
  margin: Partial<Margin> = {},
): Rect {
  const m = { ...defaultMargin, ...margin };
  return {
    x: m.left,
    y: m.top,
    width: Math.max(width - m.left - m.right, 10),
    height: Math.max(height - m.top - m.bottom, 10),
  };
}
