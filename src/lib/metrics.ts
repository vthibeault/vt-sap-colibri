import type { CostLine, ProjectDefinition } from '@/sap/types';
import { COST_CATEGORIES } from '@/sap/types';

/** Earned value / actual — <1 means over cost. */
export function cpi(p: ProjectDefinition): number {
  if (p.actualCost <= 0) return 1;
  return (p.budget * p.percentComplete) / p.actualCost;
}

export type Health = 'good' | 'warn' | 'bad';

export function projectHealth(p: ProjectDefinition): Health {
  // A project that hasn't started earning value yet isn't "critical".
  if (p.status === 'CRTD' || p.percentComplete === 0) return 'good';
  const index = cpi(p);
  if (index >= 0.95) return 'good';
  if (index >= 0.85) return 'warn';
  return 'bad';
}

export const HEALTH_LABEL: Record<Health, string> = {
  good: 'On track',
  warn: 'Watch',
  bad: 'Critical',
};

/** Sorted unique periods present in a set of cost lines. */
export function periodsOf(lines: CostLine[]): string[] {
  return [...new Set(lines.map((l) => l.period))].sort();
}

/** Sum a field per period, optionally per category. */
export function monthlySeries(
  lines: CostLine[],
  field: 'plan' | 'actual' | 'commitment',
  periods: string[],
): number[] {
  const byPeriod = new Map<string, number>(periods.map((p) => [p, 0]));
  for (const l of lines) {
    if (byPeriod.has(l.period)) byPeriod.set(l.period, (byPeriod.get(l.period) ?? 0) + l[field]);
  }
  return periods.map((p) => byPeriod.get(p) ?? 0);
}

export function monthlyByCategory(lines: CostLine[], field: 'plan' | 'actual', periods: string[]) {
  return COST_CATEGORIES.map((category) => ({
    id: category.toLowerCase(),
    name: category,
    data: monthlySeries(lines.filter((l) => l.category === category), field, periods),
  }));
}

export function cumulative(values: number[]): number[] {
  let acc = 0;
  return values.map((v) => (acc += v));
}
