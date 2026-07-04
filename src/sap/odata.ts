import type { SapConfig, SapPsClient } from './client';
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
import { mergeAuthorizations } from './auth';

/**
 * Live S/4HANA OData client.
 *
 * Written against the released Enterprise Project APIs so it can be pointed
 * at a real gateway the moment credentials exist (Integration page → mode
 * "live", or VITE_SAP_MODE=live). Until then it is exercised only by its
 * types. Where a released API does not cover classic-PS ground (networks,
 * cost line items) the method documents the recommended service and fails
 * with a clear message instead of guessing silently.
 *
 * Services used:
 *  - API_ENTERPRISE_PROJECT_SRV_0002   projects + WBS (A_EnterpriseProject,
 *    A_EnterpriseProjectElement). Scope: communication scenario SAP_COM_0308.
 *  - Networks/activities: no public released OData in S/4 Cloud — expose a
 *    custom CDS (e.g. ZC_ProjectActivity) or use API_PROJECTNETWORK on-prem,
 *    then adjust `getActivities`/`updateActivities` mapping below.
 *  - Costs: ACDOCA-based analytics — released CDS C_ProjectActualCostsQry or
 *    a Z-query; adjust `getCostLines`.
 *
 * All modifying calls perform the standard CSRF handshake (GET with
 * `x-csrf-token: Fetch`, echo token + cookies on the write).
 */

const EPM_SRV = '/sap/opu/odata/sap/API_ENTERPRISE_PROJECT_SRV_0002';

interface ODataListResponse<T> {
  d?: { results?: T[] };
  value?: T[]; // OData v4 shape, in case the service is consumed via v4 proxy
}

/** Raw A_EnterpriseProject fields we read. Extend as needed. */
interface RawEnterpriseProject {
  ProjectUUID: string;
  Project: string;
  ProjectDescription?: string;
  ProjectStartDate?: string;
  ProjectEndDate?: string;
  ProjectProfileCode?: string;
  CompanyCode?: string;
  ControllingArea?: string;
  ProjMgmtLaunchpadURL?: string;
  EntProjectIsConfidential?: boolean;
  ResponsiblePersonName?: string;
  ProcessingStatus?: string;
  ProjectCurrency?: string;
}

interface RawProjectElement {
  ProjectElementUUID: string;
  ProjectElement: string;
  ProjectUUID: string;
  ParentObjectUUID?: string;
  ProjectElementDescription?: string;
  PlannedStartDate?: string;
  PlannedEndDate?: string;
  ResponsiblePersonName?: string;
  ProcessingStatus?: string;
}

/** "/Date(1735689600000)/" (OData v2) or ISO → ISO yyyy-mm-dd. */
function parseSapDate(value?: string): string {
  if (!value) return '';
  const m = /\/Date\((\d+)\)\//.exec(value);
  const d = m ? new Date(Number(m[1])) : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** Enterprise-project processing status → classic system status. TODO verify codes against your tenant (00=created … 40=released, 98/99=completed/closed vary). */
function mapStatus(processingStatus?: string): SystemStatus {
  switch (processingStatus) {
    case '00':
    case '10':
      return 'CRTD';
    case '40':
      return 'REL';
    case '98':
      return 'TECO';
    case '99':
      return 'CLSD';
    default:
      return 'REL';
  }
}

export class ODataSapClient implements SapPsClient {
  readonly mode = 'live' as const;
  private csrfToken: string | null = null;

  constructor(private config: SapConfig) {}

  private url(path: string): string {
    // Same-origin ("/sap/opu/odata/...") goes through the vite dev proxy;
    // otherwise hit the configured gateway directly (needs CORS or a reverse proxy).
    const base = this.config.baseUrl?.replace(/\/$/, '') ?? '';
    const sep = path.includes('?') ? '&' : '?';
    const client = this.config.sapClient ? `${sep}sap-client=${this.config.sapClient}` : '';
    return `${base}${path}${client}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json', ...extra };
    if (this.config.user && this.config.password) {
      h.Authorization = `Basic ${btoa(`${this.config.user}:${this.config.password}`)}`;
    }
    return h;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(this.url(path), { headers: this.headers(), credentials: 'include' });
    if (!res.ok) throw new Error(`SAP GET ${path} → HTTP ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  }

  private async fetchCsrfToken(): Promise<string> {
    const res = await fetch(this.url(`${EPM_SRV}/`), {
      headers: this.headers({ 'x-csrf-token': 'Fetch' }),
      credentials: 'include',
    });
    const token = res.headers.get('x-csrf-token');
    if (!token) throw new Error('SAP gateway did not return a CSRF token — check auth and CORS exposure of x-csrf-token.');
    this.csrfToken = token;
    return token;
  }

  private async modify(path: string, method: 'POST' | 'PATCH', body: unknown): Promise<Response> {
    const token = this.csrfToken ?? (await this.fetchCsrfToken());
    const res = await fetch(this.url(path), {
      method,
      headers: this.headers({ 'x-csrf-token': token, 'Content-Type': 'application/json' }),
      credentials: 'include',
      body: JSON.stringify(body),
    });
    if (res.status === 403) {
      // Token expired — refresh once and retry.
      await this.fetchCsrfToken();
      return this.modify(path, method, body);
    }
    if (!res.ok) throw new Error(`SAP ${method} ${path} → HTTP ${res.status} ${res.statusText}`);
    return res;
  }

  private list<T>(payload: ODataListResponse<T>): T[] {
    return payload.d?.results ?? payload.value ?? [];
  }

  // ── SapPsClient ────────────────────────────────────────────────────────────

  async getCurrentUser(): Promise<SapUser> {
    // In live mode, identity should come from the gateway session. S/4 exposes
    // it via /sap/bc/ui2/start_up (on-prem) or the IAS token. Role→authorization
    // mapping stays in auth.ts so the UI checks are identical in both modes.
    // TODO: replace the communication-user placeholder with the start_up call
    // once the auth flow for your tenant is decided.
    const roles = ['Z_PS_PROJECT_MANAGER'];
    return {
      id: this.config.user ?? 'SAP_COMM_USER',
      fullName: this.config.user ?? 'Communication user',
      jobTitle: 'Live SAP session',
      email: '',
      roles,
      authorizations: mergeAuthorizations(roles),
    };
  }

  async listProjects(): Promise<ProjectDefinition[]> {
    const payload = await this.get<ODataListResponse<RawEnterpriseProject>>(
      `${EPM_SRV}/A_EnterpriseProject?$top=200&$format=json`,
    );
    return this.list(payload).map((raw) => this.mapProject(raw));
  }

  async getProject(projectId: string): Promise<ProjectDefinition> {
    const payload = await this.get<ODataListResponse<RawEnterpriseProject>>(
      `${EPM_SRV}/A_EnterpriseProject?$filter=Project eq '${encodeURIComponent(projectId)}'&$format=json`,
    );
    const raw = this.list(payload)[0];
    if (!raw) throw new Error(`Project ${projectId} not found in SAP`);
    return this.mapProject(raw);
  }

  private mapProject(raw: RawEnterpriseProject): ProjectDefinition {
    return {
      projectId: raw.Project,
      description: raw.ProjectDescription ?? raw.Project,
      profile: raw.ProjectProfileCode ?? '',
      companyCode: raw.CompanyCode ?? '',
      controllingArea: raw.ControllingArea ?? '',
      responsible: raw.ResponsiblePersonName ?? '',
      status: mapStatus(raw.ProcessingStatus),
      priority: 'medium', // TODO: derive from a project classification field or custom extension
      startDate: parseSapDate(raw.ProjectStartDate),
      finishDate: parseSapDate(raw.ProjectEndDate),
      // Financials live in controlling, not the project master. Until the cost
      // service is wired (getCostLines), expose zeros rather than fake numbers.
      budget: 0,
      planCost: 0,
      actualCost: 0,
      commitment: 0,
      currency: raw.ProjectCurrency ?? 'EUR',
      percentComplete: 0,
    };
  }

  async getWbsElements(projectId: string): Promise<WbsElement[]> {
    const payload = await this.get<ODataListResponse<RawProjectElement>>(
      `${EPM_SRV}/A_EnterpriseProjectElement?$filter=Project eq '${encodeURIComponent(projectId)}'&$top=500&$format=json`,
    );
    const rows = this.list(payload);
    const byUuid = new Map(rows.map((r) => [r.ProjectElementUUID, r.ProjectElement] as const));
    return rows.map((raw) => ({
      wbsId: raw.ProjectElement,
      projectId,
      parentWbsId: raw.ParentObjectUUID ? byUuid.get(raw.ParentObjectUUID) : undefined,
      description: raw.ProjectElementDescription ?? raw.ProjectElement,
      responsible: raw.ResponsiblePersonName,
      status: mapStatus(raw.ProcessingStatus),
      startDate: parseSapDate(raw.PlannedStartDate),
      finishDate: parseSapDate(raw.PlannedEndDate),
      budget: 0,
      planCost: 0,
      actualCost: 0,
      commitment: 0,
      percentComplete: 0,
    }));
  }

  async getActivities(_projectId: string): Promise<NetworkActivity[]> {
    throw new Error(
      'Live activity data needs a network/activity service (custom CDS ZC_ProjectActivity or on-prem API_PROJECTNETWORK). Map it in ODataSapClient.getActivities.',
    );
  }

  async getMilestones(_projectId: string): Promise<Milestone[]> {
    throw new Error(
      'Live milestones: expose A_EnterpriseProjectElement milestones or the project milestone CDS view, then map in ODataSapClient.getMilestones.',
    );
  }

  async getCostLines(_projectId?: string): Promise<CostLine[]> {
    throw new Error(
      'Live cost data: wire an ACDOCA-based CDS query (e.g. C_ProjectActualCostsQry) or a Z OData service, then map in ODataSapClient.getCostLines.',
    );
  }

  async updateActivities(_projectId: string, _activities: NetworkActivity[]): Promise<void> {
    throw new Error('Live schedule write-back requires the activity service — see getActivities.');
  }

  async setProjectStatus(projectId: string, status: SystemStatus): Promise<ProjectDefinition> {
    // Enterprise projects change status via the SetStatus-style function
    // imports on API_ENTERPRISE_PROJECT_SRV_0002 (e.g. ReleaseProject).
    // TODO verify the function-import names in your tenant's $metadata.
    const fn = status === 'REL' ? 'ReleaseProject' : status === 'TECO' ? 'CompleteProject' : null;
    if (!fn) throw new Error(`No function import mapped for status ${status}.`);
    const project = await this.getProject(projectId);
    await this.modify(`${EPM_SRV}/${fn}?Project='${encodeURIComponent(projectId)}'`, 'POST', {});
    return { ...project, status };
  }

  async testConnection(): Promise<ConnectionInfo> {
    const t0 = performance.now();
    try {
      await this.get(`${EPM_SRV}/A_EnterpriseProject?$top=1&$format=json`);
      return {
        ok: true,
        mode: 'live',
        system: this.config.baseUrl || 'via dev proxy',
        message: 'Connected to API_ENTERPRISE_PROJECT_SRV_0002.',
        latencyMs: Math.round(performance.now() - t0),
      };
    } catch (err) {
      return {
        ok: false,
        mode: 'live',
        system: this.config.baseUrl || '(no gateway configured)',
        message: err instanceof Error ? err.message : String(err),
        latencyMs: Math.round(performance.now() - t0),
      };
    }
  }
}
