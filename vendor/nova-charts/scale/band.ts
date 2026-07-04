export interface BandScale {
  (value: string | number): number;
  bandwidth(): number;
  step(): number;
  domain(): (string | number)[];
  range(): [number, number];
  /** Center x of a band — where line/scatter points and ticks sit. */
  center(value: string | number): number;
  /** Index of the band containing a pixel position (clamped). */
  indexAt(pixel: number): number;
}

export interface BandScaleOptions {
  domain: (string | number)[];
  range: [number, number];
  /** Fraction of each step left empty between bands (0–1). */
  paddingInner?: number;
  /** Fraction of a step left empty at each end (0–1). */
  paddingOuter?: number;
}

export function scaleBand(opts: BandScaleOptions): BandScale {
  const domain = [...opts.domain];
  const [r0, r1] = opts.range;
  const paddingInner = opts.paddingInner ?? 0.2;
  const paddingOuter = opts.paddingOuter ?? 0.1;
  const n = domain.length;
  const span = r1 - r0;

  // span = step * (n - paddingInner + 2 * paddingOuter)
  const denom = Math.max(n - paddingInner + 2 * paddingOuter, 1e-9);
  const step = n === 0 ? 0 : span / denom;
  const bandwidth = step * (1 - paddingInner);
  const start = r0 + step * paddingOuter;

  const index = new Map<string | number, number>();
  domain.forEach((d, i) => index.set(d, i));

  const scale = ((value: string | number): number => {
    const i = index.get(value);
    return i === undefined ? NaN : start + i * step;
  }) as BandScale;

  scale.bandwidth = () => bandwidth;
  scale.step = () => step;
  scale.domain = () => [...domain];
  scale.range = () => [r0, r1];
  scale.center = (value) => scale(value) + bandwidth / 2;
  scale.indexAt = (pixel: number): number => {
    if (n === 0) return -1;
    const i = Math.round((pixel - start - bandwidth / 2) / step);
    return Math.max(0, Math.min(n - 1, i));
  };
  return scale;
}
