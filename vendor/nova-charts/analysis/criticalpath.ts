/**
 * Critical Path Method (CPM) with slack and live delay propagation.
 *
 * A forward pass computes each task's earliest start/finish; a backward pass
 * computes the latest start/finish that still hits the project finish. The gap
 * between them is the task's *total float* (slack) — how long it can slip
 * before it moves the project end date. Tasks with zero float form the
 * critical path. An injected `slip` on any task re-runs the whole thing, which
 * is what lets the UI ripple a delay downstream and watch slack get consumed.
 */

export interface CpmTask {
  id: string;
  duration: number;
  dependsOn?: string[];
  /** Injected extra duration (a simulated slip), in the same unit as duration. */
  slip?: number;
}

export interface CpmNode {
  id: string;
  es: number;
  ef: number;
  ls: number;
  lf: number;
  /** Total float: ls - es. 0 ⇒ on the critical path. */
  float: number;
  critical: boolean;
  /** Longest dependency distance from a root, for ripple staggering. */
  depth: number;
}

export interface CpmResult {
  nodes: Map<string, CpmNode>;
  projectFinish: number;
  order: string[];
}

function order(tasks: CpmTask[]): string[] {
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
  const q = tasks.filter((t) => (indeg.get(t.id) ?? 0) === 0).map((t) => t.id);
  const out: string[] = [];
  while (q.length) {
    const id = q.shift()!;
    out.push(id);
    for (const nx of adj.get(id) ?? []) {
      indeg.set(nx, indeg.get(nx)! - 1);
      if (indeg.get(nx) === 0) q.push(nx);
    }
  }
  for (const t of tasks) if (!out.includes(t.id)) out.push(t.id); // cycle fallback
  return out;
}

export function criticalPath(tasks: CpmTask[], epsilon = 1e-6): CpmResult {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ord = order(tasks);
  const dur = (id: string): number => {
    const t = byId.get(id)!;
    return Math.max(t.duration + (t.slip ?? 0), 0);
  };

  // Successors, for the backward pass.
  const succ = new Map<string, string[]>();
  for (const t of tasks) succ.set(t.id, []);
  for (const t of tasks) {
    for (const dep of t.dependsOn ?? []) {
      if (succ.has(dep)) succ.get(dep)!.push(t.id);
    }
  }

  // Forward pass: earliest start/finish + depth.
  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  const depth = new Map<string, number>();
  for (const id of ord) {
    const deps = (byId.get(id)!.dependsOn ?? []).filter((d) => byId.has(d));
    let start = 0;
    let dp = 0;
    for (const d of deps) {
      start = Math.max(start, ef.get(d) ?? 0);
      dp = Math.max(dp, (depth.get(d) ?? 0) + 1);
    }
    es.set(id, start);
    ef.set(id, start + dur(id));
    depth.set(id, dp);
  }

  const projectFinish = Math.max(0, ...ord.map((id) => ef.get(id) ?? 0));

  // Backward pass: latest finish/start over the reverse order.
  const lf = new Map<string, number>();
  const ls = new Map<string, number>();
  for (let i = ord.length - 1; i >= 0; i--) {
    const id = ord[i]!;
    const next = succ.get(id) ?? [];
    let finish = next.length === 0 ? projectFinish : Infinity;
    for (const s of next) finish = Math.min(finish, ls.get(s) ?? projectFinish);
    if (!Number.isFinite(finish)) finish = projectFinish;
    lf.set(id, finish);
    ls.set(id, finish - dur(id));
  }

  const nodes = new Map<string, CpmNode>();
  for (const id of ord) {
    const float = (ls.get(id) ?? 0) - (es.get(id) ?? 0);
    nodes.set(id, {
      id,
      es: es.get(id) ?? 0,
      ef: ef.get(id) ?? 0,
      ls: ls.get(id) ?? 0,
      lf: lf.get(id) ?? 0,
      float,
      critical: Math.abs(float) <= epsilon,
      depth: depth.get(id) ?? 0,
    });
  }
  return { nodes, projectFinish, order: ord };
}
