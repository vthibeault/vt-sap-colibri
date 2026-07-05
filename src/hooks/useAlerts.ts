import { useSapData } from './useSapData';
import { evaluateAlerts, type VarianceAlert } from '@/lib/alerts';
import type { Milestone, WbsElement } from '@/sap/types';

/** Portfolio variance alerts, evaluated client-side over the SAP reads. */
export function useAlerts(): { alerts: VarianceAlert[]; loading: boolean } {
  const { data, loading } = useSapData(async (client) => {
    const projects = await client.listProjects();
    const open = projects.filter((p) => p.status !== 'CLSD');
    const wbs = new Map<string, WbsElement[]>();
    const milestones = new Map<string, Milestone[]>();
    await Promise.all(
      open.map(async (p) => {
        const [w, m] = await Promise.all([client.getWbsElements(p.projectId), client.getMilestones(p.projectId)]);
        wbs.set(p.projectId, w);
        milestones.set(p.projectId, m);
      }),
    );
    return evaluateAlerts(projects, wbs, milestones);
  });
  return { alerts: data ?? [], loading };
}
