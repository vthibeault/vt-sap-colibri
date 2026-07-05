import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BudgetFlowChart, DonutChart, ForecastChart, LineChart, StreamChart, percentile, simulateSchedule } from 'nova-charts';
import { useSapData } from '@/hooks/useSapData';
import { fmtMoney, fmtPeriod } from '@/lib/format';
import { cpi, cumulative, monthlyByCategory, monthlySeries, periodsOf, projectHealth } from '@/lib/metrics';
import { TODAY } from '@/sap/mock/data';
import { useI18n } from '@/i18n';
import { NovaChart } from '@/charts/NovaChart';
import { ChartCard, HealthChip, KpiTile, Meter, Skeleton, StatusChip } from '@/components/ui';

const DAY = 86_400_000;

/**
 * Portfolio-level Monte-Carlo: simulate each project's own network, then
 * express every project as one three-point "task" on a shared calendar
 * (offset + P10/P50/P90 of its simulated finish). The ForecastChart's
 * project row then reads as "the whole portfolio is done" — the max over
 * all projects, uncertainty included.
 */
function PortfolioForecast() {
  const { t } = useI18n();
  const [confidence, setConfidence] = useState(85);
  const { data, loading } = useSapData(async (client) => {
    const projects = (await client.listProjects()).filter((p) => p.status === 'REL');
    const lists = await Promise.all(projects.map((p) => client.getActivities(p.projectId)));
    const anchor = Math.min(...projects.map((p) => new Date(p.startDate).getTime()));
    const tasks = projects.map((p, i) => {
      const sim = simulateSchedule(
        lists[i].map((a) => ({
          id: a.activityId,
          optimistic: a.optimistic,
          likely: a.likely,
          pessimistic: a.pessimistic,
          dependsOn: a.dependsOn,
        })),
        { iterations: 400, seed: 7 },
      );
      const offset = Math.round((new Date(p.startDate).getTime() - anchor) / DAY);
      return {
        id: p.projectId,
        name: p.description.split(' · ')[0],
        optimistic: offset + Math.round(percentile(sim.project, 10)),
        likely: offset + Math.round(percentile(sim.project, 50)),
        pessimistic: offset + Math.round(percentile(sim.project, 90)),
      };
    });
    return { tasks, anchor };
  });

  return (
    <ChartCard
      title={t('dash.portfolioForecast')}
      sub={t('dash.portfolioForecastSub')}
      style={{ '--i': 7 } as React.CSSProperties}
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
      {loading || !data ? (
        <Skeleton height={300} />
      ) : (
        <NovaChart
          height={Math.max(280, (data.tasks.length + 1) * 52)}
          createDeps={[confidence]}
          create={(el) =>
            new ForecastChart(el, {
              iterations: 600,
              confidence,
              seed: 11,
              start: new Date(data.anchor),
              margin: { left: 120 },
              tasks: data.tasks,
            })
          }
        />
      )}
    </ChartCard>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const projects = useSapData((c) => c.listProjects());
  const costs = useSapData((c) => c.getCostLines());

  const active = useMemo(() => (projects.data ?? []).filter((p) => p.status === 'REL'), [projects.data]);

  const kpis = useMemo(() => {
    const list = projects.data ?? [];
    const budget = list.reduce((s, p) => s + p.budget, 0);
    const actual = list.reduce((s, p) => s + p.actualCost, 0);
    const commitment = list.reduce((s, p) => s + p.commitment, 0);
    const earned = list.reduce((s, p) => s + p.budget * p.percentComplete, 0);
    return {
      budget,
      actual,
      commitment,
      available: budget - actual - commitment,
      cpi: actual > 0 ? earned / actual : 1,
    };
  }, [projects.data]);

  const periods = useMemo(() => {
    const all = periodsOf(costs.data ?? []);
    const nowKey = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}`;
    return { all, past: all.filter((p) => p <= nowKey) };
  }, [costs.data]);

  const monthlyActualTotals = useMemo(
    () => monthlySeries(costs.data ?? [], 'actual', periods.past),
    [costs.data, periods.past],
  );

  const loading = projects.loading || costs.loading;

  return (
    <div className="grid">
      <div className="kpi-row">
        <KpiTile index={0} label={t('dash.activeProjects')} value={active.length} format={(v) => String(Math.round(v))} meta={t('dash.totalInPortfolio', { count: projects.data?.length ?? 0 })} />
        <KpiTile index={1} label={t('dash.portfolioBudget')} value={kpis.budget} format={fmtMoney} />
        <KpiTile index={2} label={t('dash.actualsToDate')} value={kpis.actual} format={fmtMoney} spark={monthlyActualTotals.slice(-10)} />
        <KpiTile index={3} label={t('dash.openCommitments')} value={kpis.commitment} format={fmtMoney} />
        <KpiTile
          index={4}
          label={t('dash.portfolioCpi')}
          value={kpis.cpi}
          format={(v) => v.toFixed(2)}
          delta={{
            direction: kpis.cpi >= 1 ? 'up' : kpis.cpi >= 0.9 ? 'flat' : 'down',
            text: kpis.cpi >= 1 ? t('dash.underPlan') : t('dash.overPlan'),
          }}
        />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
        <ChartCard
          title={t('dash.budgetFlow')}
          sub={t('dash.budgetFlowSub')}
          style={{ '--i': 2 } as React.CSSProperties}
        >
          {loading ? (
            <Skeleton height={320} />
          ) : (
            <NovaChart
              height={320}
              create={(el) =>
                new BudgetFlowChart(el, {
                  now: TODAY,
                  currency: (n) => fmtMoney(n),
                  margin: { left: 130 },
                  tasks: active.map((p) => ({
                    id: p.projectId,
                    name: p.description.split(' · ')[0],
                    start: new Date(p.startDate),
                    end: new Date(p.finishDate),
                    budget: p.budget,
                    spent: p.actualCost,
                  })),
                })
              }
            />
          )}
        </ChartCard>

        <ChartCard title={t('dash.budgetByProject')} sub={t('dash.budgetByProjectSub')} style={{ '--i': 3 } as React.CSSProperties}>
          {loading ? (
            <Skeleton height={320} />
          ) : (
            <NovaChart
              height={320}
              create={(el) =>
                new DonutChart(el, {
                  innerRadius: 0.68,
                  centerLabel: false,
                  margin: { top: 34 },
                  data: {
                    labels: (projects.data ?? []).map((p) => p.description.split(' · ')[0]),
                    series: [{ id: 'budget', name: 'Budget', data: (projects.data ?? []).map((p) => p.budget) }],
                  },
                  tooltip: true,
                })
              }
            />
          )}
        </ChartCard>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
        <ChartCard title={t('dash.spendComposition')} sub={t('dash.spendCompositionSub')} style={{ '--i': 4 } as React.CSSProperties}>
          {loading ? (
            <Skeleton height={280} />
          ) : (
            <NovaChart
              height={280}
              create={(el) =>
                new StreamChart(el, {
                  curve: 'catmull-rom',
                  data: {
                    labels: periods.past.map(fmtPeriod),
                    series: monthlyByCategory(costs.data ?? [], 'actual', periods.past),
                  },
                })
              }
            />
          )}
        </ChartCard>

        <ChartCard title={t('dash.cumulativeBurn')} sub={t('dash.cumulativeBurnSub')} style={{ '--i': 5 } as React.CSSProperties}>
          {loading ? (
            <Skeleton height={280} />
          ) : (
            <NovaChart
              height={280}
              create={(el) =>
                new LineChart(el, {
                  curve: 'catmull-rom',
                  data: {
                    labels: periods.past.map(fmtPeriod),
                    series: [
                      { id: 'plan', name: t('common.plan'), data: cumulative(monthlySeries(costs.data ?? [], 'plan', periods.past)) },
                      { id: 'actual', name: t('common.actualSeries'), data: cumulative(monthlyActualTotals) },
                    ],
                  },
                  axes: { y: { format: (v) => fmtMoney(Number(v)) } },
                })
              }
            />
          )}
        </ChartCard>
      </div>

      <ChartCard title={t('dash.projectHealth')} sub={t('dash.projectHealthSub')} style={{ '--i': 6 } as React.CSSProperties}>
        {loading ? (
          <Skeleton height={220} />
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>{t('col.project')}</th>
                <th>{t('col.status')}</th>
                <th>{t('col.responsible')}</th>
                <th className="num">{t('col.budget')}</th>
                <th className="num">{t('col.actual')}</th>
                <th className="num">CPI</th>
                <th style={{ width: 160 }}>{t('col.progress')}</th>
                <th>{t('col.health')}</th>
              </tr>
            </thead>
            <tbody>
              {(projects.data ?? []).map((p) => (
                <tr key={p.projectId} onClick={() => navigate(`/projects/${p.projectId}`)}>
                  <td>
                    <b>{p.description}</b>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{p.projectId}</div>
                  </td>
                  <td><StatusChip status={p.status} /></td>
                  <td>{p.responsible}</td>
                  <td className="num">{fmtMoney(p.budget)}</td>
                  <td className="num">{fmtMoney(p.actualCost)}</td>
                  <td className="num">{cpi(p).toFixed(2)}</td>
                  <td>
                    <Meter fraction={p.percentComplete} />
                  </td>
                  <td><HealthChip health={projectHealth(p)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ChartCard>

      <PortfolioForecast />
    </div>
  );
}
