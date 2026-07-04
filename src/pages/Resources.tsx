import { useMemo } from 'react';
import { BarChart, HeatmapChart } from 'nova-charts';
import { useSapData } from '@/hooks/useSapData';
import { fmtPeriod } from '@/lib/format';
import { TODAY } from '@/sap/mock/data';
import { NovaChart } from '@/charts/NovaChart';
import { ChartCard, KpiTile, Skeleton } from '@/components/ui';

const DAY = 86_400_000;

/** 12-month window: two months back, nine ahead. */
function windowMonths(): { key: string; start: number; end: number }[] {
  const out = [];
  for (let i = -2; i <= 9; i++) {
    const d = new Date(TODAY.getFullYear(), TODAY.getMonth() + i, 1);
    const end = new Date(TODAY.getFullYear(), TODAY.getMonth() + i + 1, 1);
    out.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      start: d.getTime(),
      end: end.getTime(),
    });
  }
  return out;
}

export function Resources() {
  const { data, loading } = useSapData(async (client) => {
    const projects = (await client.listProjects()).filter((p) => p.status === 'REL' || p.status === 'CRTD');
    const activityLists = await Promise.all(projects.map((p) => client.getActivities(p.projectId)));
    return { projects, activityLists };
  });

  const months = useMemo(windowMonths, []);

  const load = useMemo(() => {
    if (!data) return null;
    const centers = new Map<string, number[]>(); // workCenter → days per month
    const byProject = new Map<string, number[]>(); // project → days per month
    data.projects.forEach((project, pi) => {
      const projStart = new Date(project.startDate).getTime();
      for (const a of data.activityLists[pi]) {
        const s = projStart + a.startDay * DAY;
        const e = s + a.duration * DAY;
        const wc = a.workCenter ?? 'UNASSIGNED';
        if (!centers.has(wc)) centers.set(wc, months.map(() => 0));
        if (!byProject.has(project.projectId)) byProject.set(project.projectId, months.map(() => 0));
        months.forEach((m, mi) => {
          const overlap = Math.max(0, Math.min(e, m.end) - Math.max(s, m.start)) / DAY;
          if (overlap > 0) {
            centers.get(wc)![mi] += overlap;
            byProject.get(project.projectId)![mi] += overlap;
          }
        });
      }
    });
    const centerRows = [...centers.entries()]
      .map(([id, days]) => ({ id, days: days.map(Math.round), total: days.reduce((x, y) => x + y, 0) }))
      .sort((a, b) => b.total - a.total);
    const totals = months.map((_, mi) => centerRows.reduce((s, r) => s + r.days[mi], 0));
    const peakMonth = months[totals.indexOf(Math.max(...totals))];
    return { centerRows, byProject, peakMonth, busiest: centerRows[0] };
  }, [data, months]);

  if (loading || !load || !data) {
    return (
      <div className="grid">
        <Skeleton height={90} />
        <Skeleton height={320} />
        <Skeleton height={280} />
      </div>
    );
  }

  return (
    <div className="grid">
      <div className="kpi-row">
        <KpiTile index={0} label="Work centres" value={load.centerRows.length} format={(v) => String(Math.round(v))} meta={<>across {data.projects.length} open projects</>} />
        <KpiTile index={1} label="Busiest centre" value={load.busiest?.total ?? 0} format={(v) => `${Math.round(v)}d`} meta={<>{load.busiest?.id}</>} />
        <KpiTile index={2} label="Peak month" value={Math.max(...load.centerRows.flatMap((r) => r.days))} format={(v) => `${Math.round(v)}d`} meta={<>{load.peakMonth ? fmtPeriod(load.peakMonth.key) : '—'} · single-centre peak</>} />
      </div>

      <ChartCard title="Work-centre load" sub="scheduled activity-days per centre and month — stronger colour = hotter">
        <NovaChart
          height={Math.max(240, load.centerRows.length * 44)}
          create={(el) => {
            // Sequential ramp from the live theme: near-surface = idle, series-1 = hot.
            const css = getComputedStyle(document.documentElement);
            return new HeatmapChart(el, {
              margin: { left: 90 },
              colorRange: [css.getPropertyValue('--surface-3').trim(), css.getPropertyValue('--series-1').trim()],
              data: {
                labels: months.map((m) => fmtPeriod(m.key)),
                series: load.centerRows.map((r) => ({ id: r.id, name: r.id, data: r.days })),
              },
            });
          }}
        />
      </ChartCard>

      <ChartCard title="Demand by project" sub="activity-days per month, stacked">
        <NovaChart
          height={300}
          create={(el) =>
            new BarChart(el, {
              stacked: true,
              data: {
                labels: months.map((m) => fmtPeriod(m.key)),
                series: [...load.byProject.entries()].map(([projectId, days]) => ({
                  id: projectId,
                  name: data.projects.find((p) => p.projectId === projectId)?.description.split(' · ')[0] ?? projectId,
                  data: days.map(Math.round),
                })),
              },
              axes: { y: { format: (v) => `${v}d` } },
            })
          }
        />
      </ChartCard>
    </div>
  );
}
