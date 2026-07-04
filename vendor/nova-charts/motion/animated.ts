import { Spring, type SpringConfig, defaultSpringConfig } from './spring.js';
import { ticker } from './ticker.js';
import { prefersReducedMotion } from './reduced-motion.js';

export interface SetOptions {
  /** Skip animation and jump straight to the target. */
  immediate?: boolean;
  /** Delay (ms) before the spring starts chasing the new target. */
  delay?: number;
}

export interface VecSetOptions {
  immediate?: boolean;
  /** Per-component delay in ms (e.g. from stagger()) before chasing the target. */
  delays?: ArrayLike<number>;
}

/**
 * A spring-driven scalar bound to the shared ticker. Charts move its target;
 * subscribers (attribute binders) receive every intermediate value.
 */
export class AnimatedValue {
  private spring: Spring;
  private listeners = new Set<(v: number) => void>();
  private stopTicking: (() => void) | null = null;
  private delayLeft = 0;
  private pendingTarget: number | null = null;

  constructor(initial: number, config: Partial<SpringConfig> = {}) {
    this.spring = new Spring(initial, config);
  }

  get(): number {
    return this.spring.position;
  }

  get target(): number {
    return this.pendingTarget ?? this.spring.target;
  }

  get velocity(): number {
    return this.spring.velocity;
  }

  set(target: number, opts: SetOptions = {}): void {
    if (opts.immediate || prefersReducedMotion()) {
      this.pendingTarget = null;
      this.delayLeft = 0;
      if (this.spring.position !== target) {
        this.spring.jump(target);
        this.emit();
      } else {
        this.spring.jump(target);
      }
      this.stop();
      return;
    }
    if (opts.delay && opts.delay > 0) {
      this.pendingTarget = target;
      this.delayLeft = opts.delay;
    } else {
      this.pendingTarget = null;
      this.delayLeft = 0;
      this.spring.setTarget(target);
    }
    this.ensureTicking();
  }

  onChange(fn: (v: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Stop animating and detach from the ticker (value stays where it is). */
  stop(): void {
    this.stopTicking?.();
    this.stopTicking = null;
  }

  destroy(): void {
    this.stop();
    this.listeners.clear();
  }

  private ensureTicking(): void {
    if (!this.stopTicking) this.stopTicking = ticker.add(this.tick);
  }

  private tick = (dt: number): void => {
    if (this.pendingTarget !== null) {
      this.delayLeft -= dt;
      if (this.delayLeft <= 0) {
        this.spring.setTarget(this.pendingTarget);
        this.pendingTarget = null;
        this.delayLeft = 0;
      } else if (this.spring.settled) {
        return; // waiting out the delay with nothing else to do
      }
    }
    const settled = this.spring.step(dt);
    this.emit();
    if (settled && this.pendingTarget === null) this.stop();
  };

  private emit(): void {
    const v = this.spring.position;
    for (const fn of this.listeners) fn(v);
  }
}

/**
 * A vector of spring-driven components sharing one config and one ticker
 * subscription. Used for path vertices, rect geometry, arc angles and rgba
 * colors. Per-component delays enable ripple/stagger choreography inside a
 * single morph.
 */
export class AnimatedVec {
  values: Float64Array;
  private velocities: Float64Array;
  private targets: Float64Array;
  private delays: Float64Array;
  private config: SpringConfig;
  private acc = 0;
  private listeners = new Set<(v: Float64Array) => void>();
  private restListeners = new Set<() => void>();
  private stopTicking: (() => void) | null = null;

  constructor(initial: ArrayLike<number>, config: Partial<SpringConfig> = {}) {
    this.values = Float64Array.from(initial);
    this.velocities = new Float64Array(this.values.length);
    this.targets = Float64Array.from(initial);
    this.delays = new Float64Array(this.values.length);
    this.config = { ...defaultSpringConfig, ...config };
  }

  get length(): number {
    return this.values.length;
  }

  get(): Float64Array {
    return this.values;
  }

  getTargets(): Float64Array {
    return this.targets;
  }

  set(target: ArrayLike<number>, opts: VecSetOptions = {}): void {
    if (target.length !== this.values.length) {
      throw new Error(
        `AnimatedVec.set: length mismatch (${target.length} !== ${this.values.length}); use reset() to change size`,
      );
    }
    if (opts.immediate || prefersReducedMotion()) {
      this.values.set(Array.from(target));
      this.targets.set(Array.from(target));
      this.velocities.fill(0);
      this.delays.fill(0);
      this.emit();
      this.stop();
      return;
    }
    for (let i = 0; i < target.length; i++) {
      this.targets[i] = target[i]!;
      this.delays[i] = opts.delays ? Math.max(opts.delays[i] ?? 0, 0) : 0;
    }
    this.ensureTicking();
  }

  /**
   * Replace the entire state (any length) without animating. Used after a
   * morph settles to snap a resampled path back to its true point count.
   */
  reset(values: ArrayLike<number>): void {
    this.values = Float64Array.from(values);
    this.targets = Float64Array.from(values);
    this.velocities = new Float64Array(this.values.length);
    this.delays = new Float64Array(this.values.length);
    this.emit();
    this.stop();
  }

  onChange(fn: (v: Float64Array) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Called whenever an animation fully settles (not on immediate sets). */
  onRest(fn: () => void): () => void {
    this.restListeners.add(fn);
    return () => this.restListeners.delete(fn);
  }

  stop(): void {
    this.stopTicking?.();
    this.stopTicking = null;
  }

  destroy(): void {
    this.stop();
    this.listeners.clear();
    this.restListeners.clear();
  }

  private ensureTicking(): void {
    if (!this.stopTicking) this.stopTicking = ticker.add(this.tick);
  }

  private tick = (dt: number): void => {
    const { stiffness, damping, mass, restDelta, restSpeed } = this.config;
    const n = this.values.length;
    for (let i = 0; i < n; i++) {
      if (this.delays[i]! > 0) this.delays[i] = Math.max(this.delays[i]! - dt, 0);
    }
    this.acc += dt / 1000;
    const h = 0.001;
    while (this.acc >= h) {
      this.acc -= h;
      for (let i = 0; i < n; i++) {
        if (this.delays[i]! > 0) continue;
        const force = -stiffness * (this.values[i]! - this.targets[i]!) - damping * this.velocities[i]!;
        this.velocities[i] = this.velocities[i]! + (force / mass) * h;
        this.values[i] = this.values[i]! + this.velocities[i]! * h;
      }
    }
    let allSettled = true;
    for (let i = 0; i < n; i++) {
      if (this.delays[i]! > 0) {
        allSettled = false;
        continue;
      }
      const settled =
        Math.abs(this.velocities[i]!) < restSpeed &&
        Math.abs(this.values[i]! - this.targets[i]!) < restDelta;
      if (settled) {
        this.values[i] = this.targets[i]!;
        this.velocities[i] = 0;
      } else {
        allSettled = false;
      }
    }
    this.emit();
    if (allSettled) {
      this.stop();
      for (const fn of [...this.restListeners]) fn();
    }
  };

  private emit(): void {
    for (const fn of this.listeners) fn(this.values);
  }
}

const fmtDefault = (v: number): string => String(Math.round(v * 100) / 100);

/** Bind an AnimatedValue to an element attribute; writes the current value immediately. */
export function bindAttr(
  el: Element,
  name: string,
  av: AnimatedValue,
  fmt: (v: number) => string = fmtDefault,
): () => void {
  el.setAttribute(name, fmt(av.get()));
  return av.onChange((v) => el.setAttribute(name, fmt(v)));
}

/** Bind an AnimatedVec to a path's `d`, rebuilding the string each frame. */
export function bindPath(
  el: SVGPathElement,
  vec: AnimatedVec,
  build: (pts: Float64Array) => string,
): () => void {
  el.setAttribute('d', build(vec.get()));
  return vec.onChange((v) => el.setAttribute('d', build(v)));
}
