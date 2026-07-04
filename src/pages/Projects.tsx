import { useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSapData } from '@/hooks/useSapData';
import type { SystemStatus } from '@/sap/types';
import { fmtDate, fmtMoney } from '@/lib/format';
import { cpi, projectHealth } from '@/lib/metrics';
import { HealthChip, Meter, Skeleton, StatusChip, EmptyState } from '@/components/ui';
import { IconSearch } from '@/components/icons';

const STATUS_FILTERS: { id: SystemStatus | 'ALL'; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'CRTD', label: 'Created' },
  { id: 'REL', label: 'Released' },
  { id: 'TECO', label: 'Tech. complete' },
  { id: 'CLSD', label: 'Closed' },
];

export function Projects() {
  const navigate = useNavigate();
  const { data, loading } = useSapData((c) => c.listProjects());
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<SystemStatus | 'ALL'>('ALL');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter(
      (p) =>
        (status === 'ALL' || p.status === status) &&
        (!q ||
          p.description.toLowerCase().includes(q) ||
          p.projectId.toLowerCase().includes(q) ||
          p.responsible.toLowerCase().includes(q)),
    );
  }, [data, query, status]);

  return (
    <div className="grid">
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }} className="rise">
        <div style={{ position: 'relative', width: 300 }}>
          <IconSearch style={{ position: 'absolute', left: 12, top: 10, width: 15, height: 15, color: 'var(--text-3)' }} />
          <input
            className="input"
            style={{ paddingLeft: 36 }}
            placeholder="Search projects, ids, people…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="chip-row">
          {STATUS_FILTERS.map((f) => (
            <button key={f.id} className={`chip ${status === f.id ? 'on' : ''}`} onClick={() => setStatus(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="project-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} height={190} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState title="No projects match" hint="Try a different search or status filter." />
      ) : (
        <div className="project-grid">
          {filtered.map((p, i) => {
            const index = cpi(p);
            return (
              <article
                key={p.projectId}
                className="card hoverable project-card stagger"
                style={{ '--i': i } as CSSProperties}
                onClick={() => navigate(`/projects/${p.projectId}`)}
              >
                <div className="top">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="pid">{p.projectId} · {p.profile}</div>
                    <h3>{p.description}</h3>
                  </div>
                  <StatusChip status={p.status} />
                </div>
                <div className="facts">
                  <span>
                    Budget <b>{fmtMoney(p.budget)}</b>
                  </span>
                  <span>
                    Actual <b>{fmtMoney(p.actualCost)}</b>
                  </span>
                  <span>
                    CPI <b style={{ color: index < 0.9 ? 'var(--status-critical-ink)' : undefined }}>{index.toFixed(2)}</b>
                  </span>
                  <span>
                    Finish <b>{fmtDate(p.finishDate)}</b>
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <Meter fraction={p.percentComplete} over={p.actualCost > p.budget} />
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
                    {Math.round(p.percentComplete * 100)}%
                  </span>
                  <HealthChip health={projectHealth(p)} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {p.responsible} · {fmtDate(p.startDate)} → {fmtDate(p.finishDate)}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
