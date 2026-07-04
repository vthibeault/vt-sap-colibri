/**
 * Domain model for SAP Project System (PS).
 *
 * Field names follow the business meaning of their SAP counterparts
 * (PROJ, PRPS, network activities, budget/cost on WBS) rather than the raw
 * DDIC names, so the UI stays readable. The OData adapter in `odata.ts` maps
 * real API payloads into these shapes; the mock generates them directly.
 */

/** SAP system status (JEST/TJ02): created, released, technically complete, closed. */
export type SystemStatus = 'CRTD' | 'REL' | 'TECO' | 'CLSD';

export type ProjectPriority = 'strategic' | 'high' | 'medium' | 'low';

export interface ProjectDefinition {
  /** External project id (PROJ-PSPID), e.g. "NEO-2601". */
  projectId: string;
  description: string;
  /** Project profile (PROFL). */
  profile: string;
  companyCode: string;
  controllingArea: string;
  /** Person responsible (VERNR name). */
  responsible: string;
  status: SystemStatus;
  priority: ProjectPriority;
  /** ISO dates (PLFAZ / PLSEZ). */
  startDate: string;
  finishDate: string;
  /** Overall budget on the project (BPGE), in `currency`. */
  budget: number;
  planCost: number;
  actualCost: number;
  commitment: number;
  currency: string;
  /** Progress / POC, 0..1. */
  percentComplete: number;
}

export interface WbsElement {
  /** WBS code (PRPS-POSID), e.g. "NEO-2601.2". */
  wbsId: string;
  projectId: string;
  /** Parent WBS code; undefined for the level-1 element. */
  parentWbsId?: string;
  description: string;
  responsible?: string;
  status: SystemStatus;
  startDate: string;
  finishDate: string;
  budget: number;
  planCost: number;
  actualCost: number;
  commitment: number;
  percentComplete: number;
}

export interface NetworkActivity {
  /** Activity id (AFVC-VORNR scoped by network), e.g. "0010". */
  activityId: string;
  projectId: string;
  /** WBS the activity is assigned to. */
  wbsId: string;
  description: string;
  /** Scheduled offset in working days from project start. */
  startDay: number;
  /** Normal duration in working days (DAUNO). */
  duration: number;
  /** Finish-start predecessors (activity ids). */
  dependsOn: string[];
  /** 0..1 confirmed progress. */
  progress: number;
  workCenter?: string;
  /** Three-point estimate for Monte-Carlo forecasting (days). */
  optimistic: number;
  likely: number;
  pessimistic: number;
}

export interface Milestone {
  id: string;
  projectId: string;
  wbsId?: string;
  description: string;
  /** ISO date. */
  date: string;
  achieved: boolean;
}

export type CostCategory = 'Labor' | 'Material' | 'Services' | 'Travel' | 'Overhead';
export const COST_CATEGORIES: CostCategory[] = ['Labor', 'Material', 'Services', 'Travel', 'Overhead'];

/** One period's plan/actual/commitment for a WBS element and cost category. */
export interface CostLine {
  projectId: string;
  wbsId: string;
  /** Fiscal period as "YYYY-MM". */
  period: string;
  category: CostCategory;
  plan: number;
  actual: number;
  commitment: number;
}

// ── Security ─────────────────────────────────────────────────────────────────

/** SAP activity codes as used in authorization objects (TACT). */
export type AuthActivity =
  | '01' // create
  | '02' // change
  | '03' // display
  | '06'; // delete

/**
 * Authorization objects checked by Colibri, mirroring PS authority checks:
 *  - C_PROJ:  project definition
 *  - C_PRPS:  WBS elements
 *  - C_AFKO:  network / activities (scheduling)
 *  - K_BUDG:  budgeting
 *  - Z_COLIBRI_BRAND: platform branding administration (custom object)
 */
export type AuthObject = 'C_PROJ' | 'C_PRPS' | 'C_AFKO' | 'K_BUDG' | 'Z_COLIBRI_BRAND';

export interface Authorization {
  object: AuthObject;
  activities: AuthActivity[];
}

/** A PFCG role: a named bundle of authorizations. */
export interface PfcgRole {
  name: string;
  description: string;
  authorizations: Authorization[];
}

export interface SapUser {
  /** SAP user id (BNAME). */
  id: string;
  fullName: string;
  jobTitle: string;
  email: string;
  /** PFCG role names assigned to the user. */
  roles: string[];
  /** Flattened, merged authorizations from all roles. */
  authorizations: Authorization[];
}

/** Input for creating a project (definition + phase WBS skeleton). */
export interface NewProjectInput {
  description: string;
  profile: string;
  priority: ProjectPriority;
  responsible: string;
  /** ISO date. */
  startDate: string;
  /** Planned duration in months. */
  months: number;
  budget: number;
  /** Phase skeleton; shares should sum to ~1 (they are normalized). */
  phases: { name: string; share: number }[];
}

export interface ConnectionInfo {
  ok: boolean;
  mode: 'mock' | 'live';
  system: string;
  message: string;
  latencyMs: number;
}
