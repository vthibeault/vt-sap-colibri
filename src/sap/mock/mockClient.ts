import type { SapPsClient } from '../client';
import type {
  ConnectionInfo,
  CostLine,
  Milestone,
  NetworkActivity,
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

interface MockEdits {
  activities: Record<string, NetworkActivity[]>;
  statuses: Record<string, SystemStatus>;
}

function loadEdits(): MockEdits {
  try {
    const raw = localStorage.getItem(EDITS_KEY);
    if (raw) return JSON.parse(raw) as MockEdits;
  } catch {
    /* start fresh */
  }
  return { activities: {}, statuses: {} };
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

  async listProjects(): Promise<ProjectDefinition[]> {
    const projects = this.data.projects.map((p) => ({
      ...p,
      status: this.edits.statuses[p.projectId] ?? p.status,
    }));
    return this.simulate(projects);
  }

  async getProject(projectId: string): Promise<ProjectDefinition> {
    const p = (await this.listProjects()).find((x) => x.projectId === projectId);
    if (!p) throw new Error(`Project ${projectId} not found`);
    return p;
  }

  async getWbsElements(projectId: string): Promise<WbsElement[]> {
    return this.simulate(this.data.wbs.filter((w) => w.projectId === projectId));
  }

  async getActivities(projectId: string): Promise<NetworkActivity[]> {
    const edited = this.edits.activities[projectId];
    return this.simulate(edited ?? this.data.activities.filter((a) => a.projectId === projectId));
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
