export interface SpringConfig {
  stiffness: number;
  damping: number;
  mass: number;
  /** Distance from target (in value units) below which the spring may settle. */
  restDelta: number;
  /** Speed (units/second) below which the spring may settle. */
  restSpeed: number;
}

export const defaultSpringConfig: SpringConfig = {
  stiffness: 170,
  damping: 26,
  mass: 1,
  restDelta: 0.05,
  restSpeed: 1,
};

/** Fixed physics substep, in seconds. Keeps the sim deterministic and stable. */
const SUBSTEP = 0.001;

/**
 * A retargetable spring. `setTarget` mid-flight keeps both position and
 * velocity, so interrupted animations carry their momentum into the new
 * motion — this is what makes rapid data updates feel fluid instead of janky.
 */
export class Spring {
  position: number;
  velocity = 0;
  target: number;
  config: SpringConfig;
  private acc = 0;

  constructor(initial: number, config: Partial<SpringConfig> = {}) {
    this.position = initial;
    this.target = initial;
    this.config = { ...defaultSpringConfig, ...config };
  }

  setTarget(target: number): void {
    this.target = target;
  }

  jump(value: number): void {
    this.position = value;
    this.target = value;
    this.velocity = 0;
    this.acc = 0;
  }

  get settled(): boolean {
    return (
      Math.abs(this.velocity) < this.config.restSpeed &&
      Math.abs(this.position - this.target) < this.config.restDelta
    );
  }

  /**
   * Advance the spring by `dtMs` milliseconds using fixed 1ms substeps
   * (semi-implicit Euler). Returns true once settled, snapping exactly
   * onto the target.
   */
  step(dtMs: number): boolean {
    const { stiffness, damping, mass } = this.config;
    this.acc += dtMs / 1000;
    while (this.acc >= SUBSTEP) {
      this.acc -= SUBSTEP;
      const force = -stiffness * (this.position - this.target) - damping * this.velocity;
      this.velocity += (force / mass) * SUBSTEP;
      this.position += this.velocity * SUBSTEP;
    }
    if (this.settled) {
      this.position = this.target;
      this.velocity = 0;
      return true;
    }
    return false;
  }
}
