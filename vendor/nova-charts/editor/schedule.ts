/**
 * Auto-scheduling for the Gantt editor. A forward pass places each task at the
 * later of its manual start and the finish of its predecessors (finish→start
 * dependencies, MS-Project "automatic" scheduling); a backward pass yields
 * float, and zero-float tasks form the critical path. Summary (parent) rows
 * roll up to span their children.
 */

export interface SchedTask {
  id: string;
  duration: number;
  /** Manual earliest start (used when the task has no predecessors). */
  start?: number;
  dependsOn?: string[];
  parent?: string;
}

export interface SchedNode {
  id: string;
  start: number;
  end: number;
  float: number;
  critical: boolean;
  isSummary: boolean;
}

export interface ScheduleResult {
  nodes: Map<string, SchedNode>;
  finish: number;
  order: string[];
}

function topo(tasks: SchedTask[]): string[] {
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
  for (const t of tasks) if (!out.includes(t.id)) out.push(t.id);
  return out;
}

export function schedule(tasks: SchedTask[], epsilon = 1e-6): ScheduleResult {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const isSummary = (id: string): boolean => tasks.some((t) => t.parent === id);
  const leaves = tasks.filter((t) => !isSummary(t.id));
  const leafIds = new Set(leaves.map((t) => t.id));

  // A dependency on a summary means "after all its leaf descendants".
  const subtreeLeaves = (id: string, acc: string[] = []): string[] => {
    const kids = tasks.filter((t) => t.parent === id);
    if (kids.length === 0) acc.push(id);
    else for (const k of kids) subtreeLeaves(k.id, acc);
    return acc;
  };
  const expandDep = (dep: string): string[] => (leafIds.has(dep) ? [dep] : subtreeLeaves(dep));

  const leafSched: SchedTask[] = leaves.map((t) => ({
    id: t.id,
    duration: Math.max(t.duration, 0),
    start: t.start ?? 0,
    dependsOn: (t.dependsOn ?? []).flatMap(expandDep).filter((d) => d !== t.id && leafIds.has(d)),
  }));

  const order = topo(leafSched);
  const sById = new Map(leafSched.map((t) => [t.id, t]));
  const start = new Map<string, number>();
  const end = new Map<string, number>();
  for (const id of order) {
    const t = sById.get(id)!;
    const deps = t.dependsOn ?? [];
    let s = t.start ?? 0;
    for (const d of deps) s = Math.max(s, end.get(d) ?? 0);
    start.set(id, s);
    end.set(id, s + t.duration);
  }
  const finish = Math.max(0, ...order.map((id) => end.get(id) ?? 0));

  // Backward pass for float / critical.
  const succ = new Map<string, string[]>();
  for (const t of leafSched) succ.set(t.id, []);
  for (const t of leafSched) for (const d of t.dependsOn ?? []) succ.get(d)?.push(t.id);
  const lateStart = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]!;
    const t = sById.get(id)!;
    const next = succ.get(id) ?? [];
    let lf = next.length ? Infinity : finish;
    for (const n of next) lf = Math.min(lf, lateStart.get(n) ?? finish);
    if (!Number.isFinite(lf)) lf = finish;
    lateStart.set(id, lf - t.duration);
  }

  const nodes = new Map<string, SchedNode>();
  for (const id of leafIds) {
    const fl = (lateStart.get(id) ?? 0) - (start.get(id) ?? 0);
    nodes.set(id, {
      id,
      start: start.get(id) ?? 0,
      end: end.get(id) ?? 0,
      float: fl,
      critical: Math.abs(fl) <= epsilon,
      isSummary: false,
    });
  }
  // Roll up summaries (deepest first by walking parents).
  const summaries = tasks.filter((t) => isSummary(t.id));
  for (const s of summaries) {
    const kids = subtreeLeaves(s.id).map((l) => nodes.get(l)!).filter(Boolean);
    const st = Math.min(...kids.map((k) => k.start));
    const en = Math.max(...kids.map((k) => k.end));
    nodes.set(s.id, {
      id: s.id,
      start: st,
      end: en,
      float: Math.min(...kids.map((k) => k.float)),
      critical: kids.some((k) => k.critical),
      isSummary: true,
    });
  }
  void byId;
  return { nodes, finish, order };
}
