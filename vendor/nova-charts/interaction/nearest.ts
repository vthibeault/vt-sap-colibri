/**
 * Index of the position closest to `x` in a sorted array of pixel
 * positions (binary search + neighbor comparison).
 */
export function bisectClosest(positions: ArrayLike<number>, x: number): number {
  const n = positions.length;
  if (n === 0) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (positions[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(positions[lo - 1]! - x) <= Math.abs(positions[lo]! - x)) {
    return lo - 1;
  }
  return lo;
}

/**
 * Nearest point in 2D within `maxDist` pixels (radius-aware when `rs` is
 * given). Linear scan — fine for v1 point counts.
 */
export function nearestPoint2D(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  x: number,
  y: number,
  maxDist = 32,
  rs?: ArrayLike<number>,
): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i]! - x;
    const dy = ys[i]! - y;
    const d = Math.sqrt(dx * dx + dy * dy) - (rs ? rs[i]! : 0);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return bestD <= maxDist ? best : -1;
}
