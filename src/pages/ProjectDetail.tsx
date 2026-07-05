import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  BarChart,
  BudgetFlowChart,
  CascadeChart,
  ForecastChart,
  GanttChart,
  GanttEditor,
  LineChart,
  TreemapChart,
  WaterfallChart,
  type EditorTask,
} from 'nova-charts';
import { useSapData } from '@/hooks/useSapData';
import { useAuth } from '@/state/AuthContext';
import { useSap } from '@/state/SapContext';
import type { NetworkActivity } from '@/sap/types';
import { fmtDate, fmtMoney, fmtPeriod, fmtPct } from '@/lib/format';
import { cpi, cumulative, monthlyByCategory, monthlySeries, periodsOf, projectHealth } from '@/lib/metrics';
import { TODAY } from '@/sap/mock/data';
import { toast } from '@/lib/toast';
import { NovaChart } from '@/charts/NovaChart';
import { ChartCard, HealthChip, KpiTile, Skeleton, StatusChip, Tabs } from '@/components/ui';
import { BudgetPanel } from '@/components/BudgetPanel';
import { IconCheck, IconLock } from '@/components/icons';

type TabId = 'overview' | 'budget' | 'schedule' | 'costs' | 'forecast';

const DAY = 86_400_000;

export function ProjectDetail() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const { client } = useSap();
  const [tab, setTab] = useState<TabId>('overview');

  const project = useSapData((c) => c.getProject(id), [id]);
  const wbs = useSapData((c) => c.getWbsElements(id), [id]);
  const activities = useSapData((c) => c.getActivities(id), [id]);
  const milestones = useSapData((c) => c.getMilestones(id), [id]);
  const costs = useSapData((c) => c.getCostLines(id), [id]);

  const p = project.data;
  const phases = useMemo(() => (wbs.data ?? []).filter((w) => w.parentWbsId), [wbs.data]);

  const setStatus = async (status: 'REL' | 'TECO') => {
    await client.setProjectStatus(id, status);
    project.reload();
    toast(status === 'REL' ? `Project ${id} released in SAP` : `Project ${id} set to technically complete`, 'success');
  };

  if (project.error) {
    return (
      <div className="empty rise">
        <span className="big">🔍</span>
        <b>{project.error}</b>
        <Link to="/projects" className="btn" style={{ marginTop: 10 }}>
          Back to projects
        </Link>
      </div>
    );
  }

  return (
    <div className="grid">
      {/* Header */}
      {p ? (
        <div className="rise" style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
              {p.projectId} · {p.profile} · CO area {p.controllingArea}
            </div>
            <h2 style={{ fontSize: 22, margin: '2px 0 6px' }}>{p.description}</h2>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <StatusChip status={p.status} />
              <HealthChip health={projectHealth(p)} />
              <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                {p.responsible} · {fmtDate(p.startDate)} → {fmtDate(p.finishDate)}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {can('C_PROJ', '02') ? (
              <>
                {p.status === 'CRTD' && (
                  <button className="btn primary" onClick={() => void setStatus('REL')}>
                    <IconCheck style={{ width: 15, height: 15 }} /> Release project
                  </button>
                )}
                {p.status === 'REL' && (
                  <button className="btn" onClick={() => void setStatus('TECO')}>
                    Set technically complete
                  </button>
                )}
              </>
            ) : (
              <span className="conn-badge" title="Authorization object C_PROJ, activity 02 (change) not granted">
                <IconLock style={{ width: 13, height: 13 }} /> display only
              </span>
            )}
          </div>
        </div>
      ) : (
        <Skeleton height={70} />
      )}

      <Tabs<TabId>
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'budget', label: 'Budget' },
          { id: 'schedule', label: 'WBS & Schedule' },
          { id: 'costs', label: 'Costs' },
          { id: 'forecast', label: 'Forecast' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'overview' && <OverviewTab {...{ p, phases, milestones: milestones.data ?? [], loading: project.loading || wbs.loading }} />}
      {tab === 'budget' && <BudgetPanel projectId={id} />}
      {tab === 'schedule' && (
        <ScheduleTab
          projectId={id}
          startDate={p ? new Date(p.startDate) : new Date()}
          spanDays={p ? Math.round((new Date(p.finishDate).getTime() - new Date(p.startDate).getTime()) / DAY) : 0}
          phases={phases}
          activities={activities.data}
          loading={activities.loading || wbs.loading}
          canEdit={can('C_AFKO', '02')}
          onSaved={() => activities.reload()}
        />
      )}
      {tab === 'costs' && <CostsTab costs={costs.data} phases={phases} loading={costs.loading || wbs.loading} />}
      {tab === 'forecast' && (
        <ForecastTab startDate={p ? new Date(p.startDate) : undefined} activities={activities.data} loading={activities.loading} />
      )}
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────

function OverviewTab({
  p,
  phases,
  milestones,
  loading,
}: {
  p: import('@/sap/types').ProjectDefinition | null;
  phases: import('@/sap/types').WbsElement[];
  milestones: import('@/sap/types').Milestone[];
  loading: boolean;
}) {
  if (loading || !p) {
    return (
      <div className="grid">
        <Skeleton height={110} /> <Skeleton height={320} />
      </div>
    );
  }
  const available = p.budget - p.actualCost - p.commitment;
  return (
    <div className="grid">
      <div className="kpi-row">
        <KpiTile index={0} label="Budget" value={p.budget} format={fmtMoney} />
        <KpiTile index={1} label="Actual cost" value={p.actualCost} format={fmtMoney} meta={<>{fmtPct(p.actualCost / (p.budget || 1))} of budget</>} />
        <KpiTile index={2} label="Commitments" value={p.commitment} format={fmtMoney} />
        <KpiTile
          index={3}
          label="Available"
          value={available}
          format={fmtMoney}
          delta={{ direction: available >= 0 ? 'up' : 'down', text: available >= 0 ? 'in budget' : 'overrun' }}
        />
        <KpiTile index={4} label="Progress" value={p.percentComplete * 100} format={(v) => `${Math.round(v)}%`} />
        <KpiTile index={5} label="CPI" value={cpi(p)} format={(v) => v.toFixed(2)} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
        <ChartCard title="Phase budget flow" sub="spend sweeping through each WBS phase" style={{ '--i': 2 } as CSSProperties}>
          <NovaChart
            height={Math.max(240, phases.length * 64)}
            create={(el) =>
              new BudgetFlowChart(el, {
                now: TODAY,
                currency: (n) => fmtMoney(n),
                margin: { left: 150 },
                tasks: phases.map((w) => ({
                  id: w.wbsId,
                  name: w.description,
                  start: new Date(w.startDate),
                  end: new Date(w.finishDate),
                  budget: w.budget,
                  spent: w.actualCost,
                })),
              })
            }
          />
        </ChartCard>

        <ChartCard title="Milestones" sub="from SAP milestone data" style={{ '--i': 3 } as CSSProperties}>
          <div className="milestones" style={{ paddingTop: 6 }}>
            {milestones.map((m, i) => (
              <div key={m.id} className={`milestone stagger ${m.achieved ? 'done' : ''}`} style={{ '--i': i + 3 } as CSSProperties}>
                <span className="knot">{m.achieved ? '✓' : ''}</span>
                <div>
                  <b style={{ fontSize: 13 }}>{m.description}</b>
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{m.achieved ? 'Achieved' : 'Planned'}</div>
                </div>
                <span className="when">{fmtDate(m.date)}</span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      <ChartCard title="Budget consumption" sub="where the budget went, phase by phase" style={{ '--i': 4 } as CSSProperties}>
        <NovaChart
          height={280}
          create={(el) =>
            new WaterfallChart(el, {
              data: {
                labels: ['Budget', ...phases.map((w) => w.description)],
                series: [{ id: 'flow', data: [p.budget, ...phases.map((w) => -w.actualCost)] }],
              },
              total: 'Available',
              axes: { y: { format: (v) => fmtMoney(Number(v)) } },
            })
          }
        />
      </ChartCard>
    </div>
  );
}

// ── Schedule ─────────────────────────────────────────────────────────────────

function ScheduleTab({
  projectId,
  startDate,
  spanDays,
  phases,
  activities,
  loading,
  canEdit,
  onSaved,
}: {
  projectId: string;
  startDate: Date;
  spanDays: number;
  phases: import('@/sap/types').WbsElement[];
  activities: NetworkActivity[] | null;
  loading: boolean;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const { client } = useSap();
  const cascadeRef = useRef<CascadeChart | null>(null);
  const editedRef = useRef<EditorTask[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  if (loading || !activities) return <Skeleton height={420} />;

  const cascadeTasks = [
    { id: projectId, name: 'Project' },
    ...phases.map((w) => ({ id: w.wbsId, name: w.description, parent: projectId })),
    ...activities.map((a) => ({
      id: a.activityId,
      name: a.description,
      parent: a.wbsId,
      duration: a.duration,
      dependsOn: a.dependsOn,
    })),
  ];

  const editorTasks: EditorTask[] = [
    ...phases.map((w) => ({ id: w.wbsId, name: w.description, start: 0, duration: 1 })),
    ...activities.map((a) => ({
      id: a.activityId,
      name: a.description,
      start: a.startDay,
      duration: a.duration,
      parent: a.wbsId,
      dependsOn: a.dependsOn,
      progress: a.progress,
    })),
  ];

  const save = async () => {
    const edited = editedRef.current;
    if (!edited) return;
    setSaving(true);
    try {
      const phaseIds = new Set(phases.map((w) => w.wbsId));
      const byId = new Map(activities.map((a) => [a.activityId, a]));
      let parent = phases[0]?.wbsId ?? projectId;
      const next: NetworkActivity[] = [];
      for (const t of edited) {
        if (phaseIds.has(t.id)) {
          parent = t.id;
          continue;
        }
        const prev = byId.get(t.id);
        next.push({
          activityId: t.id,
          projectId,
          wbsId: t.parent && phaseIds.has(t.parent) ? t.parent : prev?.wbsId ?? parent,
          description: t.name,
          startDay: t.start,
          duration: t.duration,
          dependsOn: t.dependsOn ?? [],
          progress: t.progress ?? 0,
          workCenter: prev?.workCenter,
          optimistic: prev?.optimistic ?? Math.max(2, Math.round(t.duration * 0.7)),
          likely: t.duration,
          pessimistic: prev?.pessimistic ?? Math.round(t.duration * 1.6),
        });
      }
      await client.updateActivities(projectId, next);
      setDirty(false);
      toast('Schedule posted to SAP (network activity update)', 'success');
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid">
      <ChartCard
        title="Critical-path what-if"
        sub="click ▸ to drill into a WBS · click an activity bar to slip it and watch the ripple"
        actions={
          <button className="btn sm ghost" onClick={() => cascadeRef.current?.reset()}>
            Reset slips
          </button>
        }
      >
        <NovaChart
          height={Math.max(380, (phases.length + activities.length + 1) * 26)}
          create={(el) => {
            const chart = new CascadeChart(el, {
              tasks: cascadeTasks,
              deadline: spanDays,
              unit: 'd',
              expanded: [projectId, ...phases.map((w) => w.wbsId)],
            });
            cascadeRef.current = chart;
            return chart;
          }}
        />
      </ChartCard>

      <ChartCard
        title={canEdit ? 'Schedule editor' : 'Schedule'}
        sub={
          canEdit
            ? 'drag bars to move · drag edges to resize · drag the end-dot onto a bar for a dependency · double-click cells to edit'
            : 'authorization C_AFKO/02 required to edit — displaying read-only'
        }
        actions={
          canEdit ? (
            <button className="btn sm primary" disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? 'Posting…' : dirty ? 'Save to SAP' : 'Saved'}
            </button>
          ) : (
            <span className="conn-badge">
              <IconLock style={{ width: 12, height: 12 }} /> read-only
            </span>
          )
        }
      >
        {canEdit ? (
          <NovaChart
            height={Math.max(340, (editorTasks.length + 3) * 33)}
            create={(el) =>
              new GanttEditor(el, {
                tasks: editorTasks,
                startDate,
                dayWidth: 5.5,
                onChange: (tasks) => {
                  editedRef.current = tasks;
                  setDirty(true);
                },
              })
            }
          />
        ) : (
          <NovaChart
            height={Math.max(300, activities.length * 30)}
            create={(el) =>
              new GanttChart(el, {
                margin: { left: 160 },
                marker: { value: TODAY },
                tasks: activities.map((a) => ({
                  id: a.activityId,
                  name: a.description,
                  start: new Date(startDate.getTime() + a.startDay * DAY),
                  end: new Date(startDate.getTime() + (a.startDay + a.duration) * DAY),
                  progress: a.progress,
                  dependsOn: a.dependsOn,
                })),
              })
            }
          />
        )}
      </ChartCard>
    </div>
  );
}

// ── Costs ────────────────────────────────────────────────────────────────────

function CostsTab({
  costs,
  phases,
  loading,
}: {
  costs: import('@/sap/types').CostLine[] | null;
  phases: import('@/sap/types').WbsElement[];
  loading: boolean;
}) {
  const periods = useMemo(() => {
    const all = periodsOf(costs ?? []);
    const nowKey = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}`;
    return { all, past: all.filter((x) => x <= nowKey) };
  }, [costs]);

  if (loading || !costs) return <Skeleton height={420} />;
  if (periods.past.length === 0) {
    return <ChartCard title="Costs" sub="no postings yet"><div className="empty"><span className="big">🌱</span><b>No actuals posted yet</b></div></ChartCard>;
  }

  return (
    <div className="grid">
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)' }}>
        <ChartCard title="Monthly actuals" sub="stacked by cost category">
          <NovaChart
            height={300}
            create={(el) =>
              new BarChart(el, {
                stacked: true,
                data: {
                  labels: periods.past.map(fmtPeriod),
                  series: monthlyByCategory(costs, 'actual', periods.past),
                },
                axes: { y: { format: (v) => fmtMoney(Number(v)) } },
              })
            }
          />
        </ChartCard>

        <ChartCard title="Budget by phase" sub="treemap of WBS budgets">
          <NovaChart
            height={300}
            create={(el) =>
              new TreemapChart(el, {
                data: {
                  labels: phases.map((w) => w.description),
                  series: [{ id: 'budget', data: phases.map((w) => w.budget) }],
                },
              })
            }
          />
        </ChartCard>
      </div>

      <ChartCard title="Cumulative burn" sub="plan vs actual, project to date">
        <NovaChart
          height={280}
          create={(el) =>
            new LineChart(el, {
              curve: 'catmull-rom',
              data: {
                labels: periods.past.map(fmtPeriod),
                series: [
                  { id: 'plan', name: 'Plan', data: cumulative(monthlySeries(costs, 'plan', periods.past)) },
                  { id: 'actual', name: 'Actual', data: cumulative(monthlySeries(costs, 'actual', periods.past)) },
                ],
              },
              axes: { y: { format: (v) => fmtMoney(Number(v)) } },
            })
          }
        />
      </ChartCard>
    </div>
  );
}

// ── Forecast ─────────────────────────────────────────────────────────────────

function ForecastTab({
  startDate,
  activities,
  loading,
}: {
  startDate?: Date;
  activities: NetworkActivity[] | null;
  loading: boolean;
}) {
  const [confidence, setConfidence] = useState(85);

  if (loading || !activities) return <Skeleton height={420} />;

  return (
    <ChartCard
      title="Monte-Carlo schedule forecast"
      sub="each ridge is a completion-date distribution from three-point estimates; glowing rows drive the finish"
      actions={
        <div className="segmented">
          {[50, 85, 95].map((c) => (
            <button key={c} className={confidence === c ? 'on' : ''} onClick={() => setConfidence(c)}>
              P{c}
            </button>
          ))}
        </div>
      }
    >
      <NovaChart
        height={Math.max(380, activities.length * 30)}
        createDeps={[confidence]}
        create={(el) =>
          new ForecastChart(el, {
            iterations: 800,
            confidence,
            seed: 42,
            start: startDate,
            margin: { left: 160 },
            tasks: activities.map((a) => ({
              id: a.activityId,
              name: a.description,
              optimistic: a.optimistic,
              likely: a.likely,
              pessimistic: a.pessimistic,
              dependsOn: a.dependsOn,
            })),
          })
        }
      />
    </ChartCard>
  );
}
