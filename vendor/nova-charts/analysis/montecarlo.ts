/**
 * Monte-Carlo schedule simulation. Each task has a three-point (PERT) duration
 * estimate; durations are sampled many times, propagated through the
 * dependency graph, and aggregated into a finish-time distribution per task
 * plus a project distribution and a per-task criticality (how often the task
 * sits on the run that decided the project finish).
 *
 * This is the honest answer to "when will it actually be done?" — a
 * distribution instead of a single false-precision date.
 */

export interface SimTask {
  id: string;
  optimistic: number;
  likely: number;
  pessimistic: number;
  dependsOn?: string[];
}

export interface SimOptions {
  iterations?: number;
  /** Deterministic seed for reproducible runs (tests, stable visuals). */
  seed?: number;
}

export interface TaskResult {
  id: string;
  /** Finish-time samples (one per iteration), unsorted. */
  finishes: number[];
  /** Sorted copy, for percentile queries. */
  sorted: number[];
  mean: number;
  /** Fraction of iterations this task lay on the project-deciding path. */
  criticality: number;
}

export interface SimResult {
  tasks: Map<string, TaskResult>;
  /** Project finish samples (sorted). */
  project: number[];
  /** p99 finish — a sensible horizon for the time axis. */
  horizon: number;
  order: string[];
}

/** Small fast seedable PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inverse-CDF sample from a triangular distribution on [a, c] with mode b. */
export function triangularSample(a: number, b: number, c: number, rand: number): number {
  if (c <= a) return a;
  const m = Math.min(Math.max(b, a), c);
  const fc = (m - a) / (c - a);
  if (rand < fc) return a + Math.sqrt(rand * (c - a) * (m - a));
  return c - Math.sqrt((1 - rand) * (c - a) * (c - m));
}

/** Topological order (Kahn). Back edges in cycles are dropped. */
export function topoOrder(tasks: SimTask[]): string[] {
  const ids = new Set(tasks.map((t) => t.id));
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const t of tasks) {
    indeg.set(t.id, 0);
    adj.set(t.id, []);
  }
  for (const t of tasks) {
    for (const dep of t.dependsOn ?? []) {
      if (!ids.has(dep) || dep === t.id) continue;
      adj.get(dep)!.push(t.id);
      indeg.set(t.id, (indeg.get(t.id) ?? 0) + 1);
    }
  }
  const queue = tasks.filter((t) => (indeg.get(t.id) ?? 0) === 0).map((t) => t.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adj.get(id) ?? []) {
      indeg.set(next, indeg.get(next)! - 1);
      if (indeg.get(next) === 0) queue.push(next);
    }
  }
  // Any remaining (cycle) tasks appended in declaration order.
  for (const t of tasks) if (!order.includes(t.id)) order.push(t.id);
  return order;
}

export function simulateSchedule(tasks: SimTask[], opts: SimOptions = {}): SimResult {
  const iterations = Math.max(opts.iterations ?? 600, 1);
  const rand = mulberry32(opts.seed ?? ((Math.random() * 2 ** 32) >>> 0));
  const order = topoOrder(tasks);
  const byId = new Map(tasks.map((t) => [t.id, t]));

  // Successor set → terminal tasks (no successors) define project finish.
  const hasSuccessor = new Set<string>();
  for (const t of tasks) for (const dep of t.dependsOn ?? []) hasSuccessor.add(dep);
  const terminals = tasks.filter((t) => !hasSuccessor.has(t.id)).map((t) => t.id);

  const finishes = new Map<string, number[]>();
  const critCount = new Map<string, number>();
  for (const t of tasks) {
    finishes.set(t.id, new Array(iterations));
    critCount.set(t.id, 0);
  }
  const project: number[] = new Array(iterations);

  for (let it = 0; it < iterations; it++) {
    const finish = new Map<string, number>();
    const start = new Map<string, number>();
    const binding = new Map<string, string | null>(); // pred that set the start

    for (const id of order) {
      const t = byId.get(id)!;
      let s = 0;
      let bind: string | null = null;
      for (const dep of t.dependsOn ?? []) {
        const f = finish.get(dep) ?? 0;
        if (f > s) {
          s = f;
          bind = dep;
        }
      }
      const dur = triangularSample(t.optimistic, t.likely, t.pessimistic, rand());
      start.set(id, s);
      finish.set(id, s + dur);
      binding.set(id, bind);
      finishes.get(id)![it] = s + dur;
    }

    // Project finish = latest terminal finish; trace its critical path back.
    let projFinish = 0;
    let tail: string | null = null;
    const pool = terminals.length ? terminals : order;
    for (const id of pool) {
      const f = finish.get(id) ?? 0;
      if (f >= projFinish) {
        projFinish = f;
        tail = id;
      }
    }
    project[it] = projFinish;
    let cur = tail;
    const guard = new Set<string>();
    while (cur && !guard.has(cur)) {
      guard.add(cur);
      critCount.set(cur, (critCount.get(cur) ?? 0) + 1);
      cur = binding.get(cur) ?? null;
    }
  }

  const results = new Map<string, TaskResult>();
  for (const t of tasks) {
    const arr = finishes.get(t.id)!;
    const sorted = [...arr].sort((a, b) => a - b);
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    results.set(t.id, {
      id: t.id,
      finishes: arr,
      sorted,
      mean,
      criticality: (critCount.get(t.id) ?? 0) / iterations,
    });
  }
  project.sort((a, b) => a - b);
  const horizon = percentile(project, 99) || 1;
  return { tasks: results, project, horizon, order };
}

/** Percentile (q in 0..100) of a sorted array via linear interpolation. */
export function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * (q / 100);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac;
}

/**
 * Histogram density of samples over `bins` equal buckets on [0, horizon],
 * smoothed with a small triangular kernel and normalized so the peak is 1.
 * This is the per-task ridge shape.
 */
export function density(sorted: number[], horizon: number, bins: number): Float64Array {
  const hist = new Float64Array(bins);
  if (sorted.length === 0 || horizon <= 0) return hist;
  for (const v of sorted) {
    const b = Math.min(bins - 1, Math.max(0, Math.floor((v / horizon) * bins)));
    hist[b] = hist[b]! + 1;
  }
  // Triangular smoothing (radius 2).
  const sm = new Float64Array(bins);
  const w = [1, 2, 3, 2, 1];
  for (let i = 0; i < bins; i++) {
    let acc = 0;
    let wsum = 0;
    for (let k = -2; k <= 2; k++) {
      const j = i + k;
      if (j < 0 || j >= bins) continue;
      const weight = w[k + 2]!;
      acc += hist[j]! * weight;
      wsum += weight;
    }
    sm[i] = wsum > 0 ? acc / wsum : 0;
  }
  let peak = 0;
  for (const v of sm) peak = Math.max(peak, v);
  if (peak > 0) for (let i = 0; i < bins; i++) sm[i] = sm[i]! / peak;
  return sm;
}
