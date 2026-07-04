/**
 * Resample a polyline (flat [x0, y0, x1, y1, ...] array) to `count` points,
 * evenly spaced in normalized parameter t along the point sequence.
 * Endpoints are preserved exactly; same-count input is returned as a copy.
 *
 * This is what lets a 5-point line morph into an 8-point line: both sides of
 * the transition are normalized to max(5, 8) points first, so every vertex
 * has a spring partner.
 */
export function resamplePolyline(points: ArrayLike<number>, count: number): Float64Array {
  const n = points.length / 2;
  if (n === 0 || count <= 0) return new Float64Array(0);
  const out = new Float64Array(count * 2);

  if (n === 1) {
    for (let i = 0; i < count; i++) {
      out[i * 2] = points[0]!;
      out[i * 2 + 1] = points[1]!;
    }
    return out;
  }

  if (count === 1) {
    out[0] = points[0]!;
    out[1] = points[1]!;
    return out;
  }

  for (let i = 0; i < count; i++) {
    const t = (i / (count - 1)) * (n - 1);
    const lo = Math.min(Math.floor(t), n - 2);
    const frac = t - lo;
    out[i * 2] = points[lo * 2]! + (points[(lo + 1) * 2]! - points[lo * 2]!) * frac;
    out[i * 2 + 1] =
      points[lo * 2 + 1]! + (points[(lo + 1) * 2 + 1]! - points[lo * 2 + 1]!) * frac;
  }
  return out;
}
