/** A "nice" step size (1/2/5 × 10^k) close to span/count. */
export function tickStep(start: number, stop: number, count: number): number {
  const span = Math.abs(stop - start);
  if (span === 0 || count <= 0) return 1;
  const raw = span / count;
  const power = Math.floor(Math.log10(raw));
  const base = Math.pow(10, power);
  const err = raw / base;
  const factor = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
  return factor * base;
}

/** Round, human-friendly tick values covering [start, stop]. */
export function ticks(start: number, stop: number, count = 5): number[] {
  if (start === stop) return [start];
  const reverse = stop < start;
  if (reverse) [start, stop] = [stop, start];
  const step = tickStep(start, stop, count);
  const first = Math.ceil(start / step) * step;
  const last = Math.floor(stop / step) * step;
  const out: number[] = [];
  // Compensate floating point drift by rounding to the step's precision.
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  for (let v = first; v <= last + step / 2; v += step) {
    out.push(Number(v.toFixed(decimals)));
  }
  return reverse ? out.reverse() : out;
}

/** Expand [start, stop] outward to nice step boundaries. */
export function niceDomain(start: number, stop: number, count = 5): [number, number] {
  if (start === stop) return [start, stop];
  const reverse = stop < start;
  if (reverse) [start, stop] = [stop, start];
  const step = tickStep(start, stop, count);
  const lo = Math.floor(start / step) * step;
  const hi = Math.ceil(stop / step) * step;
  return reverse ? [hi, lo] : [lo, hi];
}
