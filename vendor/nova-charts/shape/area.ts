import { curveSegments, fmtNum as f, type CurveType } from './curve.js';

/**
 * SVG path `d` for a closed area: the (possibly curved) top line, dropped
 * to a horizontal baseline. The baseline is passed separately so it can be
 * its own AnimatedValue (axis-domain changes animate the floor too).
 */
export function buildAreaPath(
  pts: ArrayLike<number>,
  baseline: number,
  curve: CurveType = 'linear',
): string {
  const n = pts.length / 2;
  if (n < 2) return '';
  const lastX = pts[(n - 1) * 2]!;
  return (
    `M${f(pts[0]!)},${f(pts[1]!)}` +
    curveSegments(pts, curve) +
    `L${f(lastX)},${f(baseline)}L${f(pts[0]!)},${f(baseline)}Z`
  );
}
