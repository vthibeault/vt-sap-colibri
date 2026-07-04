import type { AuthActivity, Authorization, AuthObject, PfcgRole, SapUser } from './types';

/**
 * PFCG-style role catalog. In live mode these would be read from the SAP
 * user's assigned roles (e.g. via the /sap/bc/ui2/start_up service or IAS
 * group claims); the mock personas below reference them by name.
 */
export const ROLE_CATALOG: Record<string, PfcgRole> = {
  Z_PS_PROJECT_MANAGER: {
    name: 'Z_PS_PROJECT_MANAGER',
    description: 'Create/change projects, WBS and schedules',
    authorizations: [
      { object: 'C_PROJ', activities: ['01', '02', '03'] },
      { object: 'C_PRPS', activities: ['01', '02', '03'] },
      { object: 'C_AFKO', activities: ['01', '02', '03', '06'] },
      { object: 'K_BUDG', activities: ['03'] },
    ],
  },
  Z_PS_CONTROLLER: {
    name: 'Z_PS_CONTROLLER',
    description: 'Budgeting and cost controlling, display projects',
    authorizations: [
      { object: 'C_PROJ', activities: ['03'] },
      { object: 'C_PRPS', activities: ['03'] },
      { object: 'C_AFKO', activities: ['03'] },
      { object: 'K_BUDG', activities: ['01', '02', '03'] },
    ],
  },
  Z_PS_EXECUTIVE: {
    name: 'Z_PS_EXECUTIVE',
    description: 'Portfolio visibility, display only',
    authorizations: [
      { object: 'C_PROJ', activities: ['03'] },
      { object: 'C_PRPS', activities: ['03'] },
      { object: 'C_AFKO', activities: ['03'] },
      { object: 'K_BUDG', activities: ['03'] },
    ],
  },
  Z_COLIBRI_ADMIN: {
    name: 'Z_COLIBRI_ADMIN',
    description: 'Platform administration: branding, integration',
    authorizations: [
      { object: 'Z_COLIBRI_BRAND', activities: ['01', '02', '03'] },
      { object: 'C_PROJ', activities: ['03'] },
      { object: 'C_PRPS', activities: ['03'] },
      { object: 'C_AFKO', activities: ['03'] },
      { object: 'K_BUDG', activities: ['03'] },
    ],
  },
};

/** Merge the authorizations of a set of roles into one flat list. */
export function mergeAuthorizations(roleNames: string[]): Authorization[] {
  const byObject = new Map<AuthObject, Set<AuthActivity>>();
  for (const name of roleNames) {
    const role = ROLE_CATALOG[name];
    if (!role) continue;
    for (const auth of role.authorizations) {
      const set = byObject.get(auth.object) ?? new Set<AuthActivity>();
      for (const act of auth.activities) set.add(act);
      byObject.set(auth.object, set);
    }
  }
  return [...byObject.entries()].map(([object, acts]) => ({
    object,
    activities: [...acts].sort() as AuthActivity[],
  }));
}

/** SAP-style authority check: does the user hold `activity` for `object`? */
export function authorityCheck(user: SapUser | null, object: AuthObject, activity: AuthActivity): boolean {
  if (!user) return false;
  return user.authorizations.some((a) => a.object === object && a.activities.includes(activity));
}

export const ACTIVITY_LABEL: Record<AuthActivity, string> = {
  '01': 'create',
  '02': 'change',
  '03': 'display',
  '06': 'delete',
};
