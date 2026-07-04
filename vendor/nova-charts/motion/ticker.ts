export type TickFn = (dt: number, now: number) => void;

const raf: (cb: (t: number) => void) => number =
  typeof requestAnimationFrame === 'function'
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => setTimeout(() => cb(performanceNow()), 16) as unknown as number;

const caf: (id: number) => void =
  typeof cancelAnimationFrame === 'function'
    ? (id) => cancelAnimationFrame(id)
    : (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);

function performanceNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * A single shared requestAnimationFrame loop. Starts when the first
 * subscriber is added and stops when the last one leaves, so idle charts
 * cost nothing.
 */
export class Ticker {
  private fns = new Set<TickFn>();
  private running = false;
  private last = 0;
  private frame = 0;

  add(fn: TickFn): () => void {
    this.fns.add(fn);
    if (!this.running) this.start();
    return () => this.remove(fn);
  }

  remove(fn: TickFn): void {
    this.fns.delete(fn);
  }

  get size(): number {
    return this.fns.size;
  }

  private start(): void {
    this.running = true;
    this.last = performanceNow();
    this.frame = raf(this.tick);
  }

  private tick = (now: number): void => {
    // Clamp dt so a backgrounded tab doesn't produce a huge physics jump.
    const dt = Math.min(Math.max(now - this.last, 0), 64);
    this.last = now;
    for (const fn of [...this.fns]) fn(dt, now);
    if (this.fns.size > 0) {
      this.frame = raf(this.tick);
    } else {
      this.running = false;
      caf(this.frame);
    }
  };
}

export const ticker = new Ticker();
