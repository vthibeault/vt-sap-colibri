import { scaleLinear, type LinearScale } from './linear.js';

export interface TimeScale {
  (value: Date | number): number;
  invert(pixel: number): Date;
  domain(): [Date, Date];
  range(): [number, number];
  ticks(count?: number): Date[];
  tickFormat(): (d: Date) => string;
}

export interface TimeScaleOptions {
  domain: [Date | number, Date | number];
  range: [number, number];
}

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

interface Interval {
  ms: number;
  floor: (d: Date) => Date;
  next: (d: Date) => Date;
  format: (d: Date) => string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

const intervals: Interval[] = [
  {
    ms: SEC,
    floor: (d) => new Date(Math.floor(d.getTime() / SEC) * SEC),
    next: (d) => new Date(d.getTime() + SEC),
    format: (d) => `${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  },
  {
    ms: MIN,
    floor: (d) => new Date(Math.floor(d.getTime() / MIN) * MIN),
    next: (d) => new Date(d.getTime() + MIN),
    format: (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  },
  {
    ms: HOUR,
    floor: (d) => new Date(Math.floor(d.getTime() / HOUR) * HOUR),
    next: (d) => new Date(d.getTime() + HOUR),
    format: (d) => `${pad(d.getHours())}:00`,
  },
  {
    ms: DAY,
    floor: (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()),
    next: (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1),
    format: (d) => `${d.getMonth() + 1}/${d.getDate()}`,
  },
  {
    ms: MONTH,
    floor: (d) => new Date(d.getFullYear(), d.getMonth(), 1),
    next: (d) => new Date(d.getFullYear(), d.getMonth() + 1, 1),
    format: (d) =>
      ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
        d.getMonth()
      ]!,
  },
  {
    ms: YEAR,
    floor: (d) => new Date(d.getFullYear(), 0, 1),
    next: (d) => new Date(d.getFullYear() + 1, 0, 1),
    format: (d) => String(d.getFullYear()),
  },
];

function pickInterval(spanMs: number, count: number): Interval {
  const targetMs = spanMs / Math.max(count, 1);
  let best = intervals[0]!;
  for (const iv of intervals) {
    if (Math.abs(Math.log(targetMs / iv.ms)) < Math.abs(Math.log(targetMs / best.ms))) {
      best = iv;
    }
  }
  return best;
}

export function scaleTime(opts: TimeScaleOptions): TimeScale {
  const t0 = opts.domain[0] instanceof Date ? opts.domain[0].getTime() : opts.domain[0];
  const t1 = opts.domain[1] instanceof Date ? opts.domain[1].getTime() : opts.domain[1];
  const linear: LinearScale = scaleLinear({ domain: [t0, t1], range: opts.range });

  const scale = ((value: Date | number): number =>
    linear(value instanceof Date ? value.getTime() : value)) as TimeScale;

  scale.invert = (pixel) => new Date(linear.invert(pixel));
  scale.domain = () => [new Date(t0), new Date(t1)];
  scale.range = () => linear.range();
  scale.ticks = (count = 6): Date[] => {
    const span = Math.abs(t1 - t0);
    if (span === 0) return [new Date(t0)];
    const iv = pickInterval(span, count);
    // Step in multiples of the interval so dense domains don't over-tick.
    const stepCount = Math.max(1, Math.round(span / iv.ms / count));
    const out: Date[] = [];
    let d = iv.floor(new Date(Math.min(t0, t1)));
    if (d.getTime() < Math.min(t0, t1)) d = iv.next(d);
    let i = 0;
    while (d.getTime() <= Math.max(t0, t1) && out.length < 100) {
      if (i % stepCount === 0) out.push(d);
      d = iv.next(d);
      i++;
    }
    return out;
  };
  scale.tickFormat = () => {
    const span = Math.abs(t1 - t0);
    return pickInterval(span === 0 ? DAY : span, 6).format;
  };
  return scale;
}
