export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Inverse lerp: where does v sit between a and b, as t in [0, 1]? */
export function unlerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}
