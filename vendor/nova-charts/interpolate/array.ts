import { lerp } from './number.js';

/** Interpolator between two equal-length numeric arrays. */
export function interpolateArray(
  from: ArrayLike<number>,
  to: ArrayLike<number>,
): (t: number) => Float64Array {
  const n = Math.min(from.length, to.length);
  const a = Float64Array.from({ length: n }, (_, i) => from[i]!);
  const b = Float64Array.from({ length: n }, (_, i) => to[i]!);
  const out = new Float64Array(n);
  return (t) => {
    for (let i = 0; i < n; i++) out[i] = lerp(a[i]!, b[i]!, t);
    return out;
  };
}
