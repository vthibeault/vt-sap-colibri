import { curveSegments, fmtNum as f, type CurveType } from './curve.js';

/** SVG path `d` for an open polyline given flat [x0, y0, ...] coordinates. */
export function buildLinePath(pts: ArrayLike<number>, curve: CurveType = 'linear'): string {
  if (pts.length < 4) return '';
  return `M${f(pts[0]!)},${f(pts[1]!)}${curveSegments(pts, curve)}`;
}
