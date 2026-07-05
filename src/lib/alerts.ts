import type { Milestone, ProjectDefinition, WbsElement } from '@/sap/types';
import { cpi } from './metrics';
import { fmtMoney } from './format';
import { TODAY } from '@/sap/mock/data';

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface VarianceAlert {
  id: string;
  severity: AlertSeverity;
  projectId: string;
  projectName: string;
  /** i18n key into the alert catalog. */
  messageKey: string;
  /** Values interpolated into the message. */
  params: Record<string, string>;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

/**
 * Pure variance rules over portfolio data — the same checks a controller
 * runs by hand every Monday morning.
 */
export function evaluateAlerts(
  projects: ProjectDefinition[],
  wbsByProject: Map<string, WbsElement[]>,
  milestonesByProject: Map<string, Milestone[]>,
): VarianceAlert[] {
  const alerts: VarianceAlert[] = [];
  const push = (
    severity: AlertSeverity,
    p: ProjectDefinition,
    key: string,
    messageKey: string,
    params: Record<string, string> = {},
  ) =>
    alerts.push({
      id: `${p.projectId}-${key}`,
      severity,
      projectId: p.projectId,
      projectName: p.description.split(' · ')[0],
      messageKey,
      params,
    });

  for (const p of projects) {
    if (p.status === 'CLSD') continue;

    const index = cpi(p);
    if (p.status === 'REL' && index < 0.85) {
      push('critical', p, 'cpi', 'alert.cpiCritical', { cpi: index.toFixed(2) });
    } else if (p.status === 'REL' && index < 0.95) {
      push('warning', p, 'cpi', 'alert.cpiWatch', { cpi: index.toFixed(2) });
    }

    // Ignore trivial variances — alerting on €500 in a €12M project is noise.
    const MATERIALITY = 5_000;

    const available = p.budget - p.actualCost - p.commitment;
    if (available < -MATERIALITY) {
      push('critical', p, 'overrun', 'alert.budgetOverrun', { amount: fmtMoney(-available) });
    } else if (p.budget > 0 && (p.actualCost + p.commitment) / p.budget > 0.9 && p.percentComplete < 0.75) {
      push('warning', p, 'consumption', 'alert.consumptionAhead', {
        consumed: `${Math.round(((p.actualCost + p.commitment) / p.budget) * 100)}%`,
        progress: `${Math.round(p.percentComplete * 100)}%`,
      });
    }

    for (const w of (wbsByProject.get(p.projectId) ?? []).filter((x) => x.parentWbsId)) {
      if (w.budget - w.actualCost - w.commitment < -MATERIALITY) {
        push('warning', p, `phase-${w.wbsId}`, 'alert.phaseOverrun', {
          phase: w.description,
          amount: fmtMoney(w.actualCost + w.commitment - w.budget),
        });
      }
    }

    for (const m of milestonesByProject.get(p.projectId) ?? []) {
      if (!m.achieved && new Date(m.date) < TODAY) {
        push('warning', p, `ms-${m.id}`, 'alert.milestoneOverdue', { milestone: m.description });
      }
    }

    if (p.status === 'CRTD' && new Date(p.startDate) < TODAY) {
      push('info', p, 'notreleased', 'alert.notReleased', {});
    }
  }

  return alerts.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.projectId.localeCompare(b.projectId),
  );
}
