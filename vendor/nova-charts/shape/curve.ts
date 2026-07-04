export type CurveType = 'linear' | 'step' | 'catmull-rom';

const f = (v: number): string => String(Math.round(v * 100) / 100);

/**
 * Build the path segments (everything after the initial M) for a polyline
 * given as flat [x0, y0, x1, y1, ...] coordinates. Operates on the *current
 * animated points* every frame, so curvature itself flows during morphs.
 */
export function curveSegments(pts: ArrayLike<number>, curve: CurveType): string {
  const n = pts.length / 2;
  if (n < 2) return '';
  switch (curve) {
    case 'linear': {
      let d = '';
      for (let i = 1; i < n; i++) d += `L${f(pts[i * 2]!)},${f(pts[i * 2 + 1]!)}`;
      return d;
    }
    case 'step': {
      let d = '';
      for (let i = 1; i < n; i++) {
        const mx = (pts[(i - 1) * 2]! + pts[i * 2]!) / 2;
        d += `L${f(mx)},${f(pts[(i - 1) * 2 + 1]!)}L${f(mx)},${f(pts[i * 2 + 1]!)}L${f(
          pts[i * 2]!,
        )},${f(pts[i * 2 + 1]!)}`;
      }
      return d;
    }
    case 'catmull-rom': {
      // Catmull-Rom -> cubic bezier with duplicated endpoints. The curve
      // passes exactly through every input point.
      let d = '';
      const px = (i: number): number => pts[Math.max(0, Math.min(n - 1, i)) * 2]!;
      const py = (i: number): number => pts[Math.max(0, Math.min(n - 1, i)) * 2 + 1]!;
      for (let i = 0; i < n - 1; i++) {
        const c1x = px(i) + (px(i + 1) - px(i - 1)) / 6;
        const c1y = py(i) + (py(i + 1) - py(i - 1)) / 6;
        const c2x = px(i + 1) - (px(i + 2) - px(i)) / 6;
        const c2y = py(i + 1) - (py(i + 2) - py(i)) / 6;
        d += `C${f(c1x)},${f(c1y)},${f(c2x)},${f(c2y)},${f(px(i + 1))},${f(py(i + 1))}`;
      }
      return d;
    }
  }
}

export { f as fmtNum };
