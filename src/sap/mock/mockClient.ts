import type { SapPsClient } from '../client';
import type {
  BudgetDocument,
  ConnectionInfo,
  CostLine,
  Milestone,
  NetworkActivity,
  NewProjectInput,
  ProjectDefinition,
  SapUser,
  SystemStatus,
  WbsElement,
} from '../types';
import { mergeAuthorizations } from '../auth';
import { generateDataset, type MockDataset } from './data';

/** Demo personas selectable on the login screen. */
export interface Persona {
  id: string;
  fullName: string;
  jobTitle: string;
  email: string;
  roles: string[];
  /** Emoji avatar for the login screen. */
  avatar: string;
  blurb: string;
}

export const PERSONAS: Persona[] = [
  {
    id: 'AVARGA',
    fullName: 'Alex Varga',
    jobTitle: 'Senior Project Manager',
    email: 'alex.varga@example.com',
    roles: ['Z_PS_PROJECT_MANAGER'],
    avatar: '🛠️',
    blurb: 'Plans, reschedules and releases projects',
  },
  {
    id: 'DKELLER',
    fullName: 'Dana Keller',
    jobTitle: 'Cost Controller',
    email: 'dana.keller@example.com',
    roles: ['Z_PS_CONTROLLER'],
    avatar: '📊',
    blurb: 'Owns budgets, watches every euro',
  },
  {
    id: 'SOSEI',
    fullName: 'Sam Osei',
    jobTitle: 'VP Operations',
    email: 'sam.osei@example.com',
    roles: ['Z_PS_EXECUTIVE'],
    avatar: '🧭',
    blurb: 'Portfolio view, read-only',
  },
  {
    id: 'RCHEN',
    fullName: 'Riley Chen',
    jobTitle: 'Platform Administrator',
    email: 'riley.chen@example.com',
    roles: ['Z_COLIBRI_ADMIN', 'Z_PS_EXECUTIVE'],
    avatar: '🎨',
    blurb: 'Brands and configures the platform',
  },
];

const EDITS_KEY = 'colibri.mock.edits';

interface CreatedProject {
  project: ProjectDefinition;
  wbs: WbsElement[];
  activities: NetworkActivity[];
}

interface MockEdits {
  activities: Record<string, NetworkActivity[]>;
  statuses: Record<string, SystemStatus>;
  created?: CreatedProject[];
  /** Posted budget change documents (the ORIG docs are derived, not stored). */
  budgetDocs?: BudgetDocument[];
}

function loadEdits(): MockEdits {
  try {
    const raw = localStorage.getItem(EDITS_KEY);
    if (raw) return JSON.parse(raw) as MockEdits;
  } catch {
    /* start fresh */
  }
  return { activities: {}, statuses: {}, created: [] };
}

/**
 * In-browser stand-in for the SAP gateway. Serves the seeded dataset with
 * realistic latency; schedule edits and status changes persist to
 * localStorage so the demo behaves like a system of record.
 */
export class MockSapClient implements SapPsClient {
  readonly mode = 'mock' as const;
  private data: MockDataset = generateDataset();
  private edits: MockEdits = loadEdits();

  private async simulate<T>(result: T, min = 120, max = 380): Promise<T> {
    await new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
    return structuredClone(result);
  }

  private saveEdits(): void {
    localStorage.setItem(EDITS_KEY, JSON.stringify(this.edits));
  }

  async getCurrentUser(personaId = 'AVARGA'): Promise<SapUser> {
    const p = PERSONAS.find((x) => x.id === personaId) ?? PERSONAS[0];
    return this.simulate(
      {
        id: p.id,
        fullName: p.fullName,
        jobTitle: p.jobTitle,
        email: p.email,
        roles: p.roles,
        authorizations: mergeAuthorizations(p.roles),
      },
      80,
      200,
    );
  }

  /** Net budget change from posted documents, per project or single WBS. */
  private budgetDelta(projectId: string, wbsId?: string): number {
    return (this.edits.budgetDocs ?? [])
      .filter((d) => d.projectId === projectId && (!wbsId || d.wbsId === wbsId))
      .reduce((s, d) => s + d.amount, 0);
  }

  async listProjects(): Promise<ProjectDefinition[]> {
    const created = (this.edits.created ?? []).map((c) => c.project);
    const projects = [...created, ...this.data.projects].map((p) => ({
      ...p,
      status: this.edits.statuses[p.projectId] ?? p.status,
      budget: p.budget + this.budgetDelta(p.projectId),
    }));
    return this.simulate(projects);
  }

  async getProject(projectId: string): Promise<ProjectDefinition> {
    const p = (await this.listProjects()).find((x) => x.projectId === projectId);
    if (!p) throw new Error(`Project ${projectId} not found`);
    return p;
  }

  private createdFor(projectId: string): CreatedProject | undefined {
    return (this.edits.created ?? []).find((c) => c.project.projectId === projectId);
  }

  /** Base (pre-overlay) WBS elements of a project. */
  private baseWbs(projectId: string): WbsElement[] {
    const created = this.createdFor(projectId);
    return created ? created.wbs : this.data.wbs.filter((w) => w.projectId === projectId);
  }

  async getWbsElements(projectId: string): Promise<WbsElement[]> {
    const wbs = this.baseWbs(projectId).map((w) => ({
      ...w,
      budget:
        w.budget +
        // level-1 element mirrors the project: all deltas roll up to it
        (w.parentWbsId ? this.budgetDelta(projectId, w.wbsId) : this.budgetDelta(projectId)),
    }));
    return this.simulate(wbs);
  }

  async getActivities(projectId: string): Promise<NetworkActivity[]> {
    const edited = this.edits.activities[projectId];
    const created = this.createdFor(projectId);
    return this.simulate(
      edited ?? created?.activities ?? this.data.activities.filter((a) => a.projectId === projectId),
    );
  }

  async getMilestones(projectId: string): Promise<Milestone[]> {
    return this.simulate(this.data.milestones.filter((m) => m.projectId === projectId));
  }

  async getCostLines(projectId?: string): Promise<CostLine[]> {
    const lines = projectId
      ? this.data.costLines.filter((c) => c.projectId === projectId)
      : this.data.costLines;
    return this.simulate(lines, 150, 450);
  }

  async getBudgetDocuments(projectId: string): Promise<BudgetDocument[]> {
    // ORIG documents are derived from the base phase budgets (dated at the
    // project start); posted supplements/returns follow chronologically.
    const phases = this.baseWbs(projectId).filter((w) => w.parentWbsId);
    const orig: BudgetDocument[] = phases.map((w, i) => ({
      id: `${projectId}-B${i + 1}`,
      projectId,
      wbsId: w.wbsId,
      date: w.startDate,
      type: 'ORIG',
      amount: w.budget,
      reason: 'Original budget',
      user: 'SYSTEM',
    }));
    const posted = (this.edits.budgetDocs ?? []).filter((d) => d.projectId === projectId);
    return this.simulate([...orig, ...posted]);
  }

  async updateBudget(projectId: string, wbsId: string, newBudget: number, reason: string): Promise<void> {
    const base = this.baseWbs(projectId).find((w) => w.wbsId === wbsId);
    if (!base || !base.parentWbsId) throw new Error(`WBS element ${wbsId} not budgetable`);
    const current = base.budget + this.budgetDelta(projectId, wbsId);
    const delta = Math.round(newBudget - current);
    if (delta === 0) return;
    const docs = this.edits.budgetDocs ?? [];
    docs.push({
      id: `${projectId}-B${Date.now()}`,
      projectId,
      wbsId,
      date: new Date().toISOString().slice(0, 10),
      type: delta > 0 ? 'SUPL' : 'RETN',
      amount: delta,
      reason: reason.trim() || (delta > 0 ? 'Budget supplement' : 'Budget return'),
      user: sessionStorage.getItem('colibri.persona') ?? 'UNKNOWN',
    });
    this.edits.budgetDocs = docs;
    this.saveEdits();
    await this.simulate(undefined, 250, 550);
  }

  async createProject(input: NewProjectInput): Promise<ProjectDefinition> {
    // Next free id in the NEO-26xx range, counting created projects too.
    const all = [...(this.edits.created ?? []).map((c) => c.project), ...this.data.projects];
    const maxNum = Math.max(
      2610,
      ...all
        .map((p) => /^NEO-(\d+)$/.exec(p.projectId)?.[1])
        .filter((n): n is string => !!n)
        .map(Number),
    );
    const projectId = `NEO-${maxNum + 1}`;

    const start = new Date(input.startDate);
    const spanDays = Math.max(30, Math.round(input.months * 30.4));
    const end = new Date(start.getTime() + spanDays * 86_400_000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    const totalShare = input.phases.reduce((s, ph) => s + ph.share, 0) || 1;
    const project: ProjectDefinition = {
      projectId,
      description: input.description,
      profile: input.profile,
      companyCode: '1010',
      controllingArea: 'A000',
      responsible: input.responsible,
      status: 'CRTD',
      priority: input.priority,
      startDate: iso(start),
      finishDate: iso(end),
      budget: input.budget,
      planCost: 0,
      actualCost: 0,
      commitment: 0,
      currency: 'EUR',
      percentComplete: 0,
    };

    const wbs: WbsElement[] = [
      {
        wbsId: projectId,
        projectId,
        description: input.description,
        responsible: input.responsible,
        status: 'CRTD',
        startDate: iso(start),
        finishDate: iso(end),
        budget: input.budget,
        planCost: 0,
        actualCost: 0,
        commitment: 0,
        percentComplete: 0,
      },
    ];
    const activities: NetworkActivity[] = [];

    let cursor = 0;
    let seq = 0;
    let prevLast: string | null = null;
    input.phases.forEach((phase, pi) => {
      const share = phase.share / totalShare;
      const phaseSpan = Math.max(10, Math.round(spanDays * share));
      const pStart = new Date(start.getTime() + cursor * 86_400_000);
      const pEnd = new Date(Math.min(pStart.getTime() + phaseSpan * 86_400_000, end.getTime()));
      const wbsId = `${projectId}.${pi + 1}`;
      wbs.push({
        wbsId,
        projectId,
        parentWbsId: projectId,
        description: phase.name,
        responsible: input.responsible,
        status: 'CRTD',
        startDate: iso(pStart),
        finishDate: iso(pEnd),
        budget: Math.round(input.budget * share),
        planCost: 0,
        actualCost: 0,
        commitment: 0,
        percentComplete: 0,
      });
      // A starter chain of activities per phase — refine in the Gantt editor.
      const names = ['Prepare', 'Execute', 'Review & handover'];
      const per = Math.max(4, Math.round(phaseSpan / names.length));
      names.forEach((name, ai) => {
        seq += 10;
        const id = String(seq).padStart(4, '0');
        activities.push({
          activityId: id,
          projectId,
          wbsId,
          description: `${name} — ${phase.name}`,
          startDay: cursor + ai * per,
          duration: per,
          dependsOn: ai === 0 ? (prevLast ? [prevLast] : []) : [String(seq - 10).padStart(4, '0')],
          progress: 0,
          workCenter: 'PMO',
          optimistic: Math.max(2, Math.round(per * 0.7)),
          likely: per,
          pessimistic: Math.round(per * 1.6),
        });
      });
      prevLast = String(seq).padStart(4, '0');
      cursor += Math.round(phaseSpan * 0.9);
    });

    this.edits.created = [...(this.edits.created ?? []), { project, wbs, activities }];
    this.saveEdits();
    return this.simulate(project, 350, 700);
  }

  async updateActivities(projectId: string, activities: NetworkActivity[]): Promise<void> {
    this.edits.activities[projectId] = structuredClone(activities);
    this.saveEdits();
    await this.simulate(undefined, 200, 500);
  }

  async setProjectStatus(projectId: string, status: SystemStatus): Promise<ProjectDefinition> {
    this.edits.statuses[projectId] = status;
    this.saveEdits();
    return this.getProject(projectId);
  }

  async testConnection(): Promise<ConnectionInfo> {
    const t0 = performance.now();
    await this.simulate(undefined, 60, 160);
    return {
      ok: true,
      mode: 'mock',
      system: 'Colibri in-browser mock (seeded dataset)',
      message: 'Mock gateway healthy — no SAP system required.',
      latencyMs: Math.round(performance.now() - t0),
    };
  }

  /** Wipe persisted demo edits (Integration page → “Reset demo data”). */
  static resetDemoData(): void {
    localStorage.removeItem(EDITS_KEY);
  }
}
