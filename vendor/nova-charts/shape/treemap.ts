import type { Rect } from '../core/types.js';

export interface TreemapInput {
  key: string;
  value: number;
}

export interface TreemapCell extends TreemapInput {
  rect: Rect;
}

/**
 * Squarified treemap layout (Bruls et al.): lays values out as rects with
 * aspect ratios as close to 1 as possible. Input order is preserved in the
 * output; zero/negative values get zero-area rects at the layout cursor.
 */
export function squarify(items: TreemapInput[], bounds: Rect): TreemapCell[] {
  const total = items.reduce((s, d) => s + Math.max(d.value, 0), 0);
  const out = new Map<string, Rect>();
  if (total <= 0 || bounds.width <= 0 || bounds.height <= 0) {
    for (const d of items) {
      out.set(d.key, { x: bounds.x, y: bounds.y, width: 0, height: 0 });
    }
    return items.map((d) => ({ ...d, rect: out.get(d.key)! }));
  }

  // Sort descending for the squarify quality criterion, keep originals for output order.
  const sorted = items
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((d) => ({ key: d.key, area: (d.value / total) * bounds.width * bounds.height }));
  for (const d of items) {
    if (d.value <= 0) out.set(d.key, { x: bounds.x, y: bounds.y, width: 0, height: 0 });
  }

  let x = bounds.x;
  let y = bounds.y;
  let w = bounds.width;
  let h = bounds.height;
  let row: { key: string; area: number }[] = [];

  const worst = (areas: number[], side: number): number => {
    const sum = areas.reduce((s, a) => s + a, 0);
    if (sum === 0 || side === 0) return Infinity;
    const max = Math.max(...areas);
    const min = Math.min(...areas);
    const s2 = sum * sum;
    return Math.max((side * side * max) / s2, s2 / (side * side * min));
  };

  const layoutRow = (): void => {
    const sum = row.reduce((s, d) => s + d.area, 0);
    const horizontal = w < h; // lay the row along the shorter side
    const side = horizontal ? w : h;
    const thickness = side > 0 ? sum / side : 0;
    let offset = 0;
    for (const d of row) {
      const length = thickness > 0 ? d.area / thickness : 0;
      out.set(
        d.key,
        horizontal
          ? { x: x + offset, y, width: length, height: thickness }
          : { x, y: y + offset, width: thickness, height: length },
      );
      offset += length;
    }
    if (horizontal) {
      y += thickness;
      h -= thickness;
    } else {
      x += thickness;
      w -= thickness;
    }
    row = [];
  };

  for (const d of sorted) {
    const side = Math.min(w, h);
    if (
      row.length > 0 &&
      worst([...row.map((r) => r.area), d.area], side) > worst(row.map((r) => r.area), side)
    ) {
      layoutRow();
    }
    row.push(d);
  }
  if (row.length > 0) layoutRow();

  return items.map((d) => ({ ...d, rect: out.get(d.key)! }));
}
