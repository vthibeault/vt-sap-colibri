import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BudgetFlowChart, DonutChart, LineChart, StreamChart } from 'nova-charts';
import { useSapData } from '@/hooks/useSapData';
import { fmtMoney, fmtPeriod } from '@/lib/format';
import { cpi, cumulative, monthlyByCategory, monthlySeries, periodsOf, projectHealth } from '@/lib/metrics';
import { TODAY } from '@/sap/mock/data';
import { NovaChart } from '@/charts/NovaChart';
import { ChartCard, HealthChip, KpiTile, Meter, Skeleton, StatusChip } from '@/components/ui';

export function Dashboard() {
  const navigate = useNavigate();
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
        <KpiTile index={0} label="Active projects" value={active.length} format={(v) => String(Math.round(v))} meta={<>{projects.data?.length ?? 0} total in portfolio</>} />
        <KpiTile index={1} label="Portfolio budget" value={kpis.budget} format={fmtMoney} />
        <KpiTile index={2} label="Actuals to date" value={kpis.actual} format={fmtMoney} spark={monthlyActualTotals.slice(-10)} />
        <KpiTile index={3} label="Open commitments" value={kpis.commitment} format={fmtMoney} />
        <KpiTile
          index={4}
          label="Portfolio CPI"
          value={kpis.cpi}
          format={(v) => v.toFixed(2)}
          delta={{
            direction: kpis.cpi >= 1 ? 'up' : kpis.cpi >= 0.9 ? 'flat' : 'down',
            text: kpis.cpi >= 1 ? 'under plan' : 'over plan',
          }}
        />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
        <ChartCard
          title="Budget flow"
          sub="ribbon = budget · fill = spend · color = burn health"
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

        <ChartCard title="Budget by project" sub="share of portfolio" style={{ '--i': 3 } as React.CSSProperties}>
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
        <ChartCard title="Spend composition" sub="monthly actuals by cost category" style={{ '--i': 4 } as React.CSSProperties}>
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

        <ChartCard title="Cumulative burn" sub="plan vs actuals, portfolio to date" style={{ '--i': 5 } as React.CSSProperties}>
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
                      { id: 'plan', name: 'Plan', data: cumulative(monthlySeries(costs.data ?? [], 'plan', periods.past)) },
                      { id: 'actual', name: 'Actual', data: cumulative(monthlyActualTotals) },
                    ],
                  },
                  axes: { y: { format: (v) => fmtMoney(Number(v)) } },
                })
              }
            />
          )}
        </ChartCard>
      </div>

      <ChartCard title="Project health" sub="earned value vs actual cost" style={{ '--i': 6 } as React.CSSProperties}>
        {loading ? (
          <Skeleton height={220} />
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Project</th>
                <th>Status</th>
                <th>Responsible</th>
                <th className="num">Budget</th>
                <th className="num">Actual</th>
                <th className="num">CPI</th>
                <th style={{ width: 160 }}>Progress</th>
                <th>Health</th>
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
    </div>
  );
}
