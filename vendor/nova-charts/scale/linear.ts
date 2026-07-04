import { ticks as genTicks, niceDomain } from './ticks.js';

export interface LinearScale {
  (value: number): number;
  invert(pixel: number): number;
  domain(): [number, number];
  range(): [number, number];
  ticks(count?: number): number[];
}

export interface LinearScaleOptions {
  domain: [number, number];
  range: [number, number];
  nice?: boolean | number;
  clamp?: boolean;
}

export function scaleLinear(opts: LinearScaleOptions): LinearScale {
  let [d0, d1] = opts.domain;
  if (opts.nice) {
    [d0, d1] = niceDomain(d0, d1, typeof opts.nice === 'number' ? opts.nice : 5);
  }
  const [r0, r1] = opts.range;
  const dSpan = d1 - d0;

  const scale = ((value: number): number => {
    let t = dSpan === 0 ? 0.5 : (value - d0) / dSpan;
    if (opts.clamp) t = t < 0 ? 0 : t > 1 ? 1 : t;
    return r0 + t * (r1 - r0);
  }) as LinearScale;

  scale.invert = (pixel: number): number => {
    const rSpan = r1 - r0;
    const t = rSpan === 0 ? 0.5 : (pixel - r0) / rSpan;
    return d0 + t * dSpan;
  };
  scale.domain = () => [d0, d1];
  scale.range = () => [r0, r1];
  scale.ticks = (count = 5) => genTicks(d0, d1, count);
  return scale;
}
