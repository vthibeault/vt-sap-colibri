export interface StaggerOptions {
  /** Delay between consecutive items, in ms. */
  each?: number;
  from?: 'start' | 'center' | 'end';
}

/** Delay (ms) for item `i` of `count` in a choreographed sequence. */
export function stagger(i: number, count: number, opts: StaggerOptions = {}): number {
  const each = opts.each ?? 40;
  const from = opts.from ?? 'start';
  if (count <= 1) return 0;
  switch (from) {
    case 'start':
      return i * each;
    case 'end':
      return (count - 1 - i) * each;
    case 'center': {
      const center = (count - 1) / 2;
      return Math.abs(i - center) * each;
    }
  }
}
