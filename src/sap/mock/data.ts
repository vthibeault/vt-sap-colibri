import type {
  CostCategory,
  CostLine,
  Milestone,
  NetworkActivity,
  ProjectDefinition,
  ProjectPriority,
  SystemStatus,
  WbsElement,
} from '../types';
import { COST_CATEGORIES } from '../types';

/**
 * Seeded demo dataset for the mock SAP system. Deterministic (mulberry32), so
 * every visitor sees the same believable portfolio and screenshots stay stable.
 */

/** Anchor "today" for data generation — keeps the demo timeless. */
export const TODAY = new Date(2026, 6, 1); // 1 Jul 2026

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(26_01);
const between = (lo: number, hi: number) => lo + rnd() * (hi - lo);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

// ── Templates ────────────────────────────────────────────────────────────────

interface PhaseTemplate {
  name: string;
  /** Relative share of the project budget. */
  share: number;
  activities: string[];
}

interface ProjectTemplate {
  projectId: string;
  description: string;
  profile: string;
  priority: ProjectPriority;
  status: SystemStatus;
  responsible: string;
  start: Date;
  /** Total duration in days. */
  span: number;
  budget: number;
  /** Burn-health factor: 1 = on plan, >1 overruns. */
  burnFactor: number;
  phases: PhaseTemplate[];
  milestones: { name: string; at: number }[]; // `at` = fraction of span
}

const ENG = ['Requirements workshop', 'Solution design', 'Detailed engineering', 'Prototype build', 'Design review'];
const BUILD = ['Procurement', 'Site preparation', 'Installation', 'System integration', 'Construction supervision'];
const IT = ['Data migration', 'Interface development', 'Configuration', 'Custom development', 'Cutover rehearsal'];
const TEST = ['Integration testing', 'User acceptance testing', 'Performance testing', 'Regression run'];
const ROLL = ['Key-user training', 'Go-live preparation', 'Hypercare', 'Handover to operations'];

const TEMPLATES: ProjectTemplate[] = [
  {
    projectId: 'NEO-2601',
    description: 'Phoenix · ERP Consolidation',
    profile: 'ZPS_CAPEX',
    priority: 'strategic',
    status: 'REL',
    responsible: 'Ingrid Halvorsen',
    start: new Date(2026, 0, 12),
    span: 420,
    budget: 4_800_000,
    burnFactor: 0.97,
    phases: [
      { name: 'Discover & Design', share: 0.2, activities: ENG },
      { name: 'Build & Integrate', share: 0.42, activities: IT },
      { name: 'Test & Validate', share: 0.2, activities: TEST },
      { name: 'Deploy & Hypercare', share: 0.18, activities: ROLL },
    ],
    milestones: [
      { name: 'Design freeze', at: 0.22 },
      { name: 'System integration complete', at: 0.58 },
      { name: 'Go / no-go decision', at: 0.8 },
      { name: 'Go-live wave 1', at: 0.9 },
    ],
  },
  {
    projectId: 'NEO-2602',
    description: 'Helios · Solar Plant Expansion',
    profile: 'ZPS_CAPEX',
    priority: 'high',
    status: 'REL',
    responsible: 'Mateo Ruiz',
    start: new Date(2026, 1, 2),
    span: 380,
    budget: 12_500_000,
    burnFactor: 1.04,
    phases: [
      { name: 'Engineering', share: 0.18, activities: ENG },
      { name: 'Procurement & Civil works', share: 0.4, activities: BUILD },
      { name: 'Electrical & Grid', share: 0.28, activities: BUILD },
      { name: 'Commissioning', share: 0.14, activities: TEST },
    ],
    milestones: [
      { name: 'Permit approval', at: 0.15 },
      { name: 'Panels on site', at: 0.45 },
      { name: 'Grid connection', at: 0.82 },
    ],
  },
  {
    projectId: 'NEO-2603',
    description: 'Atlas · Warehouse Automation',
    profile: 'ZPS_INVEST',
    priority: 'medium',
    status: 'REL',
    responsible: 'Priya Nair',
    start: new Date(2026, 2, 16),
    span: 300,
    budget: 3_200_000,
    burnFactor: 0.9,
    phases: [
      { name: 'Concept & Vendor selection', share: 0.15, activities: ENG },
      { name: 'AGV & Conveyor installation', share: 0.5, activities: BUILD },
      { name: 'WMS integration', share: 0.22, activities: IT },
      { name: 'Ramp-up', share: 0.13, activities: ROLL },
    ],
    milestones: [
      { name: 'Vendor contract signed', at: 0.18 },
      { name: 'First AGV operational', at: 0.55 },
      { name: 'Full throughput reached', at: 0.95 },
    ],
  },
  {
    projectId: 'NEO-2606',
    description: 'Meridian · Plant Maintenance Rollout',
    profile: 'ZPS_OPEX',
    priority: 'high',
    status: 'REL',
    responsible: 'Jonas Weber',
    start: new Date(2026, 0, 26),
    span: 320,
    budget: 1_900_000,
    burnFactor: 1.24, // the problem child — burning hot
    phases: [
      { name: 'Template design', share: 0.22, activities: ENG },
      { name: 'Site rollouts', share: 0.5, activities: IT },
      { name: 'Stabilisation', share: 0.28, activities: ROLL },
    ],
    milestones: [
      { name: 'Template sign-off', at: 0.25 },
      { name: 'Pilot site live', at: 0.5 },
      { name: 'All sites live', at: 0.92 },
    ],
  },
  {
    projectId: 'NEO-2605',
    description: 'Quill · Customer Portal Revamp',
    profile: 'ZPS_OPEX',
    priority: 'medium',
    status: 'CRTD',
    responsible: 'Amara Diallo',
    start: new Date(2026, 8, 1),
    span: 240,
    budget: 950_000,
    burnFactor: 1,
    phases: [
      { name: 'UX & Architecture', share: 0.3, activities: ENG },
      { name: 'Implementation', share: 0.5, activities: IT },
      { name: 'Launch', share: 0.2, activities: ROLL },
    ],
    milestones: [
      { name: 'Design system approved', at: 0.28 },
      { name: 'Public beta', at: 0.75 },
    ],
  },
  {
    projectId: 'NEO-2554',
    description: 'Borealis · Fleet Electrification',
    profile: 'ZPS_CAPEX',
    priority: 'high',
    status: 'TECO',
    responsible: 'Mateo Ruiz',
    start: new Date(2025, 3, 7),
    span: 400,
    budget: 6_700_000,
    burnFactor: 1.02,
    phases: [
      { name: 'Pilot fleet', share: 0.25, activities: ENG },
      { name: 'Charging infrastructure', share: 0.45, activities: BUILD },
      { name: 'Fleet conversion', share: 0.3, activities: ROLL },
    ],
    milestones: [
      { name: 'Pilot review', at: 0.3 },
      { name: 'Depot 1 energised', at: 0.6 },
      { name: 'Last vehicle delivered', at: 0.97 },
    ],
  },
  {
    projectId: 'NEO-2521',
    description: 'Cascade · Data Center Migration',
    profile: 'ZPS_INVEST',
    priority: 'low',
    status: 'CLSD',
    responsible: 'Ingrid Halvorsen',
    start: new Date(2025, 0, 20),
    span: 330,
    budget: 2_400_000,
    burnFactor: 0.94,
    phases: [
      { name: 'Assessment', share: 0.2, activities: ENG },
      { name: 'Migration waves', share: 0.6, activities: IT },
      { name: 'Decommissioning', share: 0.2, activities: ROLL },
    ],
    milestones: [
      { name: 'Wave plan approved', at: 0.25 },
      { name: 'Final wave complete', at: 0.85 },
    ],
  },
];

// ── Generation ───────────────────────────────────────────────────────────────

export interface MockDataset {
  projects: ProjectDefinition[];
  wbs: WbsElement[];
  activities: NetworkActivity[];
  milestones: Milestone[];
  costLines: CostLine[];
}

const CATEGORY_MIX: Record<CostCategory, number> = {
  Labor: 0.46,
  Material: 0.24,
  Services: 0.16,
  Travel: 0.05,
  Overhead: 0.09,
};

function monthsBetween(start: Date, end: Date): string[] {
  const out: string[] = [];
  const d = new Date(start.getFullYear(), start.getMonth(), 1);
  while (d <= end) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

export function generateDataset(): MockDataset {
  const projects: ProjectDefinition[] = [];
  const wbs: WbsElement[] = [];
  const activities: NetworkActivity[] = [];
  const milestones: Milestone[] = [];
  const costLines: CostLine[] = [];

  for (const t of TEMPLATES) {
    const end = addDays(t.start, t.span);
    const elapsed = Math.min(Math.max((TODAY.getTime() - t.start.getTime()) / (end.getTime() - t.start.getTime()), 0), 1);
    const poc = t.status === 'CLSD' || t.status === 'TECO' ? 1 : Math.min(elapsed * between(0.85, 1.05), 0.99);

    // Phases → WBS elements under a level-1 root.
    let phaseStart = 0;
    let prevPhaseLastActivity: string | null = null;
    let actSeq = 0;

    t.phases.forEach((phase, pi) => {
      const wbsId = `${t.projectId}.${pi + 1}`;
      const phaseSpan = Math.round(t.span * (phase.share + 0.06)); // phases overlap a little
      const pStart = addDays(t.start, phaseStart);
      const pEnd = addDays(t.start, Math.min(phaseStart + phaseSpan, t.span));
      const phaseBudget = Math.round(t.budget * phase.share);
      const phaseElapsed = Math.min(
        Math.max((TODAY.getTime() - pStart.getTime()) / (pEnd.getTime() - pStart.getTime()), 0),
        1,
      );
      const planned = phaseBudget * Math.min(phaseElapsed * 1.02 + 0.02, 1);
      const actual = Math.round(planned * t.burnFactor * between(0.92, 1.08));
      const commitment = t.status === 'CLSD' ? 0 : Math.round(phaseBudget * (1 - phaseElapsed) * between(0.08, 0.22));

      wbs.push({
        wbsId,
        projectId: t.projectId,
        parentWbsId: t.projectId,
        description: phase.name,
        responsible: t.responsible,
        status: phaseElapsed >= 1 ? (t.status === 'CLSD' ? 'CLSD' : 'TECO') : t.status,
        startDate: iso(pStart),
        finishDate: iso(pEnd),
        budget: phaseBudget,
        planCost: Math.round(planned),
        actualCost: Math.min(actual, Math.round(phaseBudget * 1.35)),
        commitment,
        percentComplete: Math.round(phaseElapsed * 100) / 100,
      });

      // Activities inside the phase: a chain with occasional parallel branches.
      const phaseActivityIds: string[] = [];
      let chainEnd = phaseStart;
      phase.activities.forEach((name, ai) => {
        actSeq += 10;
        const id = String(actSeq).padStart(4, '0');
        const duration = Math.max(3, Math.round((phaseSpan / phase.activities.length) * between(0.55, 0.95)));
        const parallel = ai > 0 && rnd() < 0.3;
        const deps: string[] = [];
        if (ai === 0) {
          if (prevPhaseLastActivity) deps.push(prevPhaseLastActivity);
        } else if (parallel && phaseActivityIds.length >= 2) {
          deps.push(phaseActivityIds[phaseActivityIds.length - 2]);
        } else {
          deps.push(phaseActivityIds[phaseActivityIds.length - 1]);
        }
        const startDay = parallel ? Math.max(phaseStart, chainEnd - duration) : chainEnd;
        chainEnd = Math.max(chainEnd, startDay + duration);
        const actElapsed = Math.min(Math.max((elapsed * t.span - startDay) / duration, 0), 1);
        activities.push({
          activityId: id,
          projectId: t.projectId,
          wbsId,
          description: name,
          startDay,
          duration,
          dependsOn: deps,
          progress: t.status === 'CLSD' || t.status === 'TECO' ? 1 : Math.round(actElapsed * 100) / 100,
          workCenter: pick(['ENG-01', 'CON-02', 'IT-DEV', 'IT-OPS', 'PMO']),
          optimistic: Math.max(2, Math.round(duration * 0.7)),
          likely: duration,
          pessimistic: Math.round(duration * between(1.35, 1.9)),
        });
        phaseActivityIds.push(id);
      });
      prevPhaseLastActivity = phaseActivityIds[phaseActivityIds.length - 1] ?? prevPhaseLastActivity;
      phaseStart += Math.round(t.span * phase.share * 0.9); // next phase starts before this one fully ends
    });

    // Cost lines per phase-WBS and month.
    for (const el of wbs.filter((w) => w.projectId === t.projectId && w.parentWbsId)) {
      const months = monthsBetween(new Date(el.startDate), new Date(el.finishDate));
      if (months.length === 0) continue;
      // Bell-ish spend curve over the phase.
      const weights = months.map((_, i) => 0.4 + Math.sin((Math.PI * (i + 0.5)) / months.length));
      const wSum = weights.reduce((a, b) => a + b, 0);
      months.forEach((period, mi) => {
        const monthPlan = (el.budget * weights[mi]) / wSum;
        const monthDate = new Date(Number(period.slice(0, 4)), Number(period.slice(5)) - 1, 15);
        const inPast = monthDate <= TODAY;
        for (const category of COST_CATEGORIES) {
          const plan = Math.round(monthPlan * CATEGORY_MIX[category]);
          if (plan < 100) continue;
          costLines.push({
            projectId: t.projectId,
            wbsId: el.wbsId,
            period,
            category,
            plan,
            actual: inPast ? Math.round(plan * t.burnFactor * between(0.8, 1.2)) : 0,
            commitment: !inPast && rnd() < 0.35 ? Math.round(plan * between(0.2, 0.6)) : 0,
          });
        }
      });
    }

    for (const m of t.milestones) {
      const date = addDays(t.start, Math.round(t.span * m.at));
      milestones.push({
        id: `${t.projectId}-M${milestones.length + 1}`,
        projectId: t.projectId,
        description: m.name,
        date: iso(date),
        achieved: date <= TODAY,
      });
    }

    // Roll the phase figures up to the project definition.
    const phaseEls = wbs.filter((w) => w.projectId === t.projectId && w.parentWbsId);
    const planCost = phaseEls.reduce((s, w) => s + w.planCost, 0);
    const actualCost = phaseEls.reduce((s, w) => s + w.actualCost, 0);
    const commitment = phaseEls.reduce((s, w) => s + w.commitment, 0);

    projects.push({
      projectId: t.projectId,
      description: t.description,
      profile: t.profile,
      companyCode: '1010',
      controllingArea: 'A000',
      responsible: t.responsible,
      status: t.status,
      priority: t.priority,
      startDate: iso(t.start),
      finishDate: iso(end),
      budget: t.budget,
      planCost,
      actualCost,
      commitment,
      currency: 'EUR',
      percentComplete: Math.round(poc * 100) / 100,
    });

    // Level-1 WBS mirroring the project definition.
    wbs.unshift({
      wbsId: t.projectId,
      projectId: t.projectId,
      description: t.description.split(' · ')[1] ?? t.description,
      responsible: t.responsible,
      status: t.status,
      startDate: iso(t.start),
      finishDate: iso(end),
      budget: t.budget,
      planCost,
      actualCost,
      commitment,
      percentComplete: Math.round(poc * 100) / 100,
    });
  }

  return { projects, wbs, activities, milestones, costLines };
}
