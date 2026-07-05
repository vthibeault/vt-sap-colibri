import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { useBrand } from '@/state/BrandContext';
import { useI18n } from '@/i18n';

interface Destroyable {
  destroy(): void;
}

interface NovaChartProps<C extends Destroyable> {
  /** Construct the chart on the host element. Runs once per (deps, theme) life. */
  create: (el: HTMLDivElement) => C;
  /**
   * Push new data into a live chart (setData/setTasks…) — this is where
   * nova-charts' morphing shines. Runs when `updateDeps` change.
   */
  update?: (chart: C) => void;
  updateDeps?: unknown[];
  /** Recreate (not morph) when these change — e.g. structural options. */
  createDeps?: unknown[];
  height?: number | string;
  className?: string;
  style?: CSSProperties;
}

/**
 * React bridge for nova-charts. The library is imperative and framework-
 * agnostic; this wrapper owns the lifecycle: create on mount, morph on data
 * change, recreate on theme change (charts resolve CSS custom properties at
 * draw time, so a rebrand needs a fresh render).
 */
export function NovaChart<C extends Destroyable>({
  create,
  update,
  updateDeps = [],
  createDeps = [],
  height = 300,
  className,
  style,
}: NovaChartProps<C>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<C | null>(null);
  const { themeKey } = useBrand();
  const { locale } = useI18n(); // labels are formatted at create time

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const chart = create(el);
    chartRef.current = chart;
    return () => {
      chartRef.current = null;
      chart.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeKey, locale, ...createDeps]);

  useEffect(() => {
    if (chartRef.current && update) update(chartRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...updateDeps]);

  return (
    <div
      ref={hostRef}
      className={`chart-host ${className ?? ''}`}
      style={{ height, ...style }}
    />
  );
}
