import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useCountUp } from '@/hooks/useCountUp';
import { onToast, type ToastMessage } from '@/lib/toast';
import type { SystemStatus } from '@/sap/types';
import type { Health } from '@/lib/metrics';
import { useI18n } from '@/i18n';

// ── Cards ────────────────────────────────────────────────────────────────────

export function ChartCard({
  title,
  sub,
  actions,
  children,
  className = '',
  style,
}: {
  title: string;
  sub?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section className={`card stagger ${className}`} style={style}>
      <div className="card-head">
        <h3>{title}</h3>
        {sub && <span className="sub">{sub}</span>}
        {actions && <div className="actions">{actions}</div>}
      </div>
      <div className="card-body">{children}</div>
    </section>
  );
}

// ── KPI tile ─────────────────────────────────────────────────────────────────

export function KpiTile({
  label,
  value,
  format,
  meta,
  delta,
  spark,
  index = 0,
}: {
  label: string;
  value: number;
  format: (v: number) => string;
  meta?: ReactNode;
  delta?: { direction: 'up' | 'down' | 'flat'; text: string };
  spark?: number[];
  index?: number;
}) {
  const animated = useCountUp(value);
  return (
    <div className="card kpi stagger" style={{ '--i': index } as CSSProperties}>
      <span className="label">{label}</span>
      <span className="value">{format(animated)}</span>
      {(meta || delta) && (
        <span className="meta">
          {delta && <span className={`delta ${delta.direction}`}>{delta.direction === 'up' ? '▲' : delta.direction === 'down' ? '▼' : '—'} {delta.text}</span>}
          {meta}
        </span>
      )}
      {spark && spark.length > 1 && <Sparkline data={spark} className="spark" />}
    </div>
  );
}

/** Tiny area sparkline with a draw-in animation; ink comes from the accent. */
export function Sparkline({ data, className }: { data: number[]; className?: string }) {
  const d = useMemo(() => {
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const span = max - min || 1;
    const pts = data.map((v, i) => [
      (i / (data.length - 1)) * 100,
      34 - ((v - min) / span) * 30 - 2,
    ]);
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    return { line, area: `${line} L100 34 L0 34 Z` };
  }, [data]);
  return (
    <svg className={className} viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden>
      <path d={d.area} fill="var(--accent-soft)" stroke="none" />
      <path d={d.line} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ── Status ───────────────────────────────────────────────────────────────────

export function StatusChip({ status }: { status: SystemStatus }) {
  const { t } = useI18n();
  return (
    <span className={`status-chip ${status}`}>
      <span className="dot" />
      {t(`status.${status}`)}
    </span>
  );
}

export function HealthChip({ health }: { health: Health }) {
  const { t } = useI18n();
  const cls = health === 'good' ? 'health-good' : health === 'warn' ? 'health-warn' : 'health-bad';
  return (
    <span className={`status-chip ${cls}`}>
      <span className="dot" />
      {t(`health.${health}`)}
    </span>
  );
}

export function Meter({ fraction, over = false }: { fraction: number; over?: boolean }) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setWidth(Math.min(Math.max(fraction, 0), 1) * 100));
    return () => cancelAnimationFrame(raf);
  }, [fraction]);
  return (
    <span className={`meter ${over ? 'over' : ''}`} style={{ display: 'block' }}>
      <i style={{ width: `${width}%` }} />
    </span>
  );
}

// ── Loading & empty ──────────────────────────────────────────────────────────

export function Skeleton({ height = 200, style }: { height?: number | string; style?: CSSProperties }) {
  return <div className="skeleton" style={{ height, ...style }} />;
}

export function EmptyState({ icon = '🫙', title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <div className="empty rise">
      <span className="big">{icon}</span>
      <b>{title}</b>
      {hint && <span style={{ fontSize: 12.5 }}>{hint}</span>}
    </div>
  );
}

// ── Toasts ───────────────────────────────────────────────────────────────────

const TOAST_COLOR: Record<ToastMessage['kind'], string> = {
  success: 'var(--status-good)',
  error: 'var(--status-critical)',
  info: 'var(--accent)',
};

export function Toasts() {
  const [items, setItems] = useState<ToastMessage[]>([]);
  useEffect(
    () =>
      onToast((t) => {
        setItems((prev) => [...prev, t]);
        setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 4200);
      }),
    [],
  );
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast">
          <span className="t-dot" style={{ background: TOAST_COLOR[t.kind] }} />
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          className={t.id === active ? 'on' : ''}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
