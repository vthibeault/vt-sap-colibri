import { type EasingFn, easeOutCubic } from './easing.js';
import { ticker } from './ticker.js';

export interface TweenOptions {
  from: number;
  to: number;
  duration: number;
  easing?: EasingFn;
  delay?: number;
}

/**
 * A duration-based tween for choreographed one-shots (entrances, draw-ins).
 * `retarget` captures the current value as the new starting point so an
 * interrupted tween never jumps.
 */
export class Tween {
  value: number;
  private from: number;
  private to: number;
  private duration: number;
  private easing: EasingFn;
  private delayLeft: number;
  private elapsed = 0;
  private done = false;

  constructor(opts: TweenOptions) {
    this.from = opts.from;
    this.to = opts.to;
    this.value = opts.from;
    this.duration = Math.max(opts.duration, 1);
    this.easing = opts.easing ?? easeOutCubic;
    this.delayLeft = opts.delay ?? 0;
  }

  retarget(to: number, duration?: number): void {
    this.from = this.value;
    this.to = to;
    if (duration !== undefined) this.duration = Math.max(duration, 1);
    this.elapsed = 0;
    this.delayLeft = 0;
    this.done = false;
  }

  get target(): number {
    return this.to;
  }

  get complete(): boolean {
    return this.done;
  }

  /** Advance by dtMs. Returns true when complete (value === to). */
  step(dtMs: number): boolean {
    if (this.done) return true;
    if (this.delayLeft > 0) {
      this.delayLeft -= dtMs;
      if (this.delayLeft > 0) return false;
      dtMs = -this.delayLeft;
      this.delayLeft = 0;
    }
    this.elapsed += dtMs;
    const t = Math.min(this.elapsed / this.duration, 1);
    this.value = this.from + (this.to - this.from) * this.easing(t);
    if (t >= 1) {
      this.value = this.to;
      this.done = true;
    }
    return this.done;
  }
}

/**
 * Drive a tween on the shared ticker. Returns a cancel function; `onDone`
 * fires only on natural completion.
 */
export function runTween(
  opts: TweenOptions,
  onUpdate: (value: number) => void,
  onDone?: () => void,
): () => void {
  const tween = new Tween(opts);
  onUpdate(tween.value);
  const stop = ticker.add((dt) => {
    const done = tween.step(dt);
    onUpdate(tween.value);
    if (done) {
      stop();
      onDone?.();
    }
  });
  return stop;
}
