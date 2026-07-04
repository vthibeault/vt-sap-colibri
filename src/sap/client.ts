import type {
  ConnectionInfo,
  CostLine,
  Milestone,
  NetworkActivity,
  ProjectDefinition,
  SapUser,
  SystemStatus,
  WbsElement,
} from './types';

/**
 * The single seam between Colibri and SAP. Everything the UI does — reads and
 * writes — goes through this interface, so swapping the mock for the live
 * OData client (src/sap/odata.ts) is a configuration change, not a refactor.
 */
export interface SapPsClient {
  readonly mode: 'mock' | 'live';

  /** Identity + PFCG roles of the logged-on user. */
  getCurrentUser(personaId?: string): Promise<SapUser>;

  listProjects(): Promise<ProjectDefinition[]>;
  getProject(projectId: string): Promise<ProjectDefinition>;
  getWbsElements(projectId: string): Promise<WbsElement[]>;
  getActivities(projectId: string): Promise<NetworkActivity[]>;
  getMilestones(projectId: string): Promise<Milestone[]>;
  /** Cost lines for one project, or the whole portfolio when omitted. */
  getCostLines(projectId?: string): Promise<CostLine[]>;

  /** Persist a rescheduled activity network (from the Gantt editor). */
  updateActivities(projectId: string, activities: NetworkActivity[]): Promise<void>;
  /** Set a project's system status (release, TECO, close…). */
  setProjectStatus(projectId: string, status: SystemStatus): Promise<ProjectDefinition>;

  /** Reachability probe for the integration page. */
  testConnection(): Promise<ConnectionInfo>;
}

export interface SapConfig {
  mode: 'mock' | 'live';
  baseUrl: string;
  user?: string;
  password?: string;
  sapClient?: string;
}

const OVERRIDE_KEY = 'colibri.sap.config';

/** Resolve config from env, allowing a runtime override saved by the Integration page. */
export function resolveSapConfig(): SapConfig {
  const env = import.meta.env;
  const base: SapConfig = {
    mode: env.VITE_SAP_MODE === 'live' ? 'live' : 'mock',
    baseUrl: env.VITE_SAP_BASE_URL ?? '',
    user: env.VITE_SAP_USER || undefined,
    password: env.VITE_SAP_PASSWORD || undefined,
    sapClient: env.VITE_SAP_CLIENT || undefined,
  };
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    if (raw) return { ...base, ...(JSON.parse(raw) as Partial<SapConfig>) };
  } catch {
    /* ignore corrupt override */
  }
  return base;
}

export function saveSapConfigOverride(patch: Partial<SapConfig>): void {
  const raw = localStorage.getItem(OVERRIDE_KEY);
  const current = raw ? (JSON.parse(raw) as Partial<SapConfig>) : {};
  localStorage.setItem(OVERRIDE_KEY, JSON.stringify({ ...current, ...patch }));
}

export function clearSapConfigOverride(): void {
  localStorage.removeItem(OVERRIDE_KEY);
}

/** Build the client for the current configuration. */
export async function createSapClient(config: SapConfig = resolveSapConfig()): Promise<SapPsClient> {
  if (config.mode === 'live') {
    const { ODataSapClient } = await import('./odata');
    return new ODataSapClient(config);
  }
  const { MockSapClient } = await import('./mock/mockClient');
  return new MockSapClient();
}
