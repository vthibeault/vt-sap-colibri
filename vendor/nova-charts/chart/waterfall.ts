import { XYChart } from './xy.js';
import type { UpdateReason } from '../core/chart.js';
import type { BaseChartOptions, HoverPoint } from '../core/types.js';
import { svgEl } from '../core/svg.js';
import { keyedJoin, type JoinItem } from '../core/join.js';
import { AnimatedValue, AnimatedVec } from '../motion/animated.js';
import { stagger } from '../motion/stagger.js';
import { scaleLinear, type LinearScale } from '../scale/linear.js';
import { scaleBand, type BandScale } from '../scale/band.js';
import { niceDomain } from '../scale/ticks.js';
import { resolveColor } from '../theme/theme.js';
import { fmtValue, datumValue } from '../core/format.js';
import type { PointerPos } from '../interaction/pointer.js';

export interface WaterfallChartOptions extends BaseChartOptions {
  /** Append a computed total bar (default true). Pass a string to name it. */
  total?: boolean | string;
  positiveColor?: string;
  negativeColor?: string;
  totalColor?: string;
  cornerRadius?: number;
}

interface BarItem extends JoinItem {
  rect: SVGRectElement;
  /** [x, y, w, h] */
  vec: AnimatedVec;
  fillOpacity: AnimatedValue;
  index: number;
  delta: number;
  running: number;
  isTotal: boolean;
  colorResolved: string;
  removeFn: (() => void) | null;
}

interface Connector extends JoinItem {
  line: SVGLineElement;
  y: AnimatedValue;
  opacity: AnimatedValue;
  remove?: () => void;
}

const IDLE_OPACITY = 0.92;
const DIM_OPACITY = 0.45;

/**
 * Waterfall chart: each bar is a delta floating at the running total, with
 * dashed connectors bridging consecutive bars. Everything — bars, baseline,
 * connectors, axes — springs together when the deltas change.
 */
export class WaterfallChart extends XYChart<WaterfallChartOptions> {
  private bars = new Map<string, BarItem>();
  private connectors = new Map<string, Connector>();
  private band!: BandScale;
  private yScale!: LinearScale;
  private hoveredIndex = -1;
  private entranceDone = false;

  constructor(el: HTMLElement, options: WaterfallChartOptions) {
    super(el, { legend: false, ...options });
    this.bootstrap();
  }

  protected override chartType(): string {
    return 'Waterfall';
  }

  private steps(): { label: string; delta: number; start: number; end: number; isTotal: boolean }[] {
    const series = this.options.data.series[0];
    if (!series) return [];
    const labels = this.options.data.labels ?? [];
    let run = 0;
    const out = series.data.map((d, i) => {
      const delta = datumValue(d);
      const start = run;
      run += delta;
      return {
        label: String(labels[i] ?? `Step ${i + 1}`),
        delta,
        start,
        end: run,
        isTotal: false,
      };
    });
    const total = this.options.total ?? true;
    if (total !== false && out.length > 0) {
      out.push({
        label: typeof total === 'string' ? total : 'Total',
        delta: run,
        start: 0,
        end: run,
        isTotal: true,
      });
    }
    return out;
  }

  protected override update(reason: UpdateReason): void {
    const immediate = this.immediate() || reason === 'resize';
    const spring = this.springConfig();
    const steps = this.steps();
    const n = steps.length;

    let lo = 0;
    let hi = 0;
    for (const s of steps) {
      lo = Math.min(lo, s.start, s.end);
      hi = Math.max(hi, s.start, s.end);
    }
    const [d0, d1] = niceDomain(lo, hi === lo ? lo + 1 : hi, this.options.axes?.y?.ticks ?? 5);
    this.yScale = scaleLinear({
      domain: [d0, d1],
      range: [this.plot.y + this.plot.height, this.plot.y],
    });
    this.band = scaleBand({
      domain: steps.map((_, i) => i),
      range: [this.plot.x, this.plot.x + this.plot.width],
      paddingInner: 0.3,
      paddingOuter: 0.12,
    });

    const chromeImmediate = this.immediate() || reason === 'resize';
    this.xAxis.update(
      this.xTickIndices(n).map((i) => ({
        key: steps[i]!.label,
        label: steps[i]!.label,
        pos: this.band.center(i),
      })),
      this.plot,
      chromeImmediate,
    );
    const yTicks = this.yScale.ticks(this.options.axes?.y?.ticks ?? 5);
    this.yAxis.update(
      yTicks.map((v) => ({ key: String(v), label: fmtValue(v), pos: this.yScale(v) })),
      this.plot,
      chromeImmediate,
    );
    if (this.options.axes?.y?.gridLines !== false) {
      this.grid.update(
        yTicks.map((v) => ({ key: String(v), pos: this.yScale(v) })),
        this.plot,
        chromeImmediate,
      );
    }

    const w = this.band.bandwidth();
    const rx = Math.min(this.options.cornerRadius ?? 3, w / 2);
    const colorFor = (s: { delta: number; isTotal: boolean }): string =>
      s.isTotal
        ? this.options.totalColor ?? 'var(--nova-c1)'
        : s.delta >= 0
          ? this.options.positiveColor ?? 'var(--nova-c4)'
          : this.options.negativeColor ?? 'var(--nova-c7)';

    keyedJoin(
      this.bars,
      steps.map((s, i) => [`${s.label}|${i}`, { ...s, i }] as const),
      {
        enter: (_key, d) => {
          const spec = colorFor(d);
          const x = this.band(d.i);
          const yA = this.yScale(d.start);
          const yB = this.yScale(d.end);
          const y = Math.min(yA, yB);
          const h = Math.abs(yA - yB);
          const grow = !this.immediate();
          const rect = svgEl('rect', { fill: spec, rx, 'fill-opacity': grow ? 0 : IDLE_OPACITY }, this.seriesLayer);
          const vec = new AnimatedVec(grow ? [x, yA, w, 0] : [x, y, w, h], spring);
          const fillOpacity = new AnimatedValue(grow ? 0 : IDLE_OPACITY, {
            stiffness: 200,
            damping: 26,
          });
          const item: BarItem = {
            rect,
            vec,
            fillOpacity,
            index: d.i,
            delta: d.delta,
            running: d.end,
            isTotal: d.isTotal,
            colorResolved: resolveColor(this.el, spec),
            removeFn: null,
          };
          vec.onChange((v) => {
            rect.setAttribute('x', String(v[0]!));
            rect.setAttribute('y', String(v[1]!));
            rect.setAttribute('width', String(Math.max(v[2]!, 0)));
            rect.setAttribute('height', String(Math.max(v[3]!, 0)));
          });
          vec.onRest(() => {
            if (item.exiting) {
              rect.remove();
              this.disposeBar(item);
              item.removeFn?.();
            }
          });
          fillOpacity.onChange((v) =>
            rect.setAttribute('fill-opacity', String(Math.max(v, 0))),
          );
          vec.reset(vec.values);
          if (grow) {
            const delay = this.entranceDone
              ? 0
              : stagger(d.i, n, { each: this.enterStagger() * 1.6 });
            vec.set([x, y, w, h], { delays: Float64Array.of(delay, delay, delay, delay) });
            fillOpacity.set(IDLE_OPACITY, { delay });
          }
          return item;
        },
        update: (item, d) => {
          item.delta = d.delta;
          item.running = d.end;
          item.isTotal = d.isTotal;
          const spec = colorFor(d);
          item.colorResolved = resolveColor(this.el, spec);
          item.rect.setAttribute('fill', spec);
          item.rect.setAttribute('rx', String(rx));
          const yA = this.yScale(d.start);
          const yB = this.yScale(d.end);
          const delay = immediate ? 0 : stagger(d.i, n, { each: 18 });
          item.vec.set([this.band(d.i), Math.min(yA, yB), w, Math.abs(yA - yB)], {
            immediate,
            delays: Float64Array.of(delay, delay, delay, delay),
          });
          item.fillOpacity.set(this.opacityFor(item), { immediate });
        },
        exit: (item, remove) => {
          item.removeFn = remove;
          if (immediate) {
            item.rect.remove();
            this.disposeBar(item);
            remove();
          } else {
            const t = item.vec.getTargets();
            item.vec.set([t[0]!, t[1]! + t[3]! / 2, t[2]!, 0]);
            item.fillOpacity.set(0);
          }
        },
      },
    );

    // Dashed connectors: from each bar's end level across the gap to the
    // next bar. Their y is a spring, so they ride the morph.
    keyedJoin(
      this.connectors,
      steps.slice(0, -1).map((s, i) => {
        return [
          String(i),
          { y: this.yScale(s.end), x1: this.band(i) + w, x2: this.band(i + 1) },
        ] as const;
      }),
      {
        enter: (_key, d) => {
          const line = svgEl(
            'line',
            {
              x1: d.x1,
              x2: d.x2,
              stroke: 'var(--nova-axis)',
              'stroke-dasharray': '3,3',
              opacity: 0,
            },
            this.seriesLayer,
          );
          const y = new AnimatedValue(d.y, spring);
          const opacity = new AnimatedValue(0, spring);
          const item: Connector = { line, y, opacity };
          y.onChange((v) => {
            line.setAttribute('y1', String(v));
            line.setAttribute('y2', String(v));
          });
          opacity.onChange((v) => {
            line.setAttribute('opacity', String(Math.max(v, 0)));
            if (item.exiting && v < 0.02) {
              line.remove();
              item.remove?.();
            }
          });
          line.setAttribute('y1', String(d.y));
          line.setAttribute('y2', String(d.y));
          opacity.set(1, { immediate });
          return item;
        },
        update: (item, d) => {
          item.line.setAttribute('x1', String(d.x1));
          item.line.setAttribute('x2', String(d.x2));
          item.y.set(d.y, { immediate });
          item.opacity.set(1, { immediate });
        },
        exit: (item, remove) => {
          item.remove = remove;
          if (immediate) {
            item.line.remove();
            remove();
          } else {
            item.opacity.set(0);
          }
        },
      },
    );

    this.entranceDone = true;
    this.refreshHover();
  }

  private opacityFor(item: BarItem): number {
    if (this.hoveredIndex < 0) return IDLE_OPACITY;
    return item.index === this.hoveredIndex ? 1 : DIM_OPACITY;
  }

  protected override pointerMove(p: PointerPos | null): void {
    const inside =
      p !== null &&
      p.x >= this.plot.x &&
      p.x <= this.plot.x + this.plot.width &&
      p.y >= this.plot.y - 8 &&
      p.y <= this.plot.y + this.plot.height + 8;
    if (!inside) {
      this.clearHover();
      return;
    }
    const index = this.band.indexAt(p.x);
    const item = [...this.bars.values()].find((b) => b.index === index && !b.exiting);
    if (!item) {
      this.clearHover();
      return;
    }
    if (index !== this.hoveredIndex) {
      this.hoveredIndex = index;
      for (const b of this.bars.values()) {
        if (!b.exiting) b.fillOpacity.set(this.opacityFor(b), { immediate: this.immediate() });
      }
      this.emit('point:enter', this.barEvent(item, p));
    }
    const label = this.steps()[index]?.label ?? String(index);
    const rows = item.isTotal
      ? [{ color: item.colorResolved, label: 'Total', value: fmtValue(item.running) }]
      : [
          {
            color: item.colorResolved,
            label: 'Change',
            value: `${item.delta >= 0 ? '+' : ''}${fmtValue(item.delta)}`,
          },
          { color: item.colorResolved, label: 'Running', value: fmtValue(item.running) },
        ];
    const hp: HoverPoint = {
      seriesId: 'waterfall',
      seriesName: label,
      index,
      value: item.delta,
      label,
      color: item.colorResolved,
      x: this.band.center(index),
      y: this.yScale(item.running),
    };
    const opt = this.options.tooltip;
    const content =
      opt && typeof opt === 'object' && opt.formatter
        ? opt.formatter([hp])
        : { title: label, rows };
    this.tooltip?.show(content, { x: this.band.center(index), y: p.y }, this.immediate());
  }

  protected override pointerClick(p: PointerPos): void {
    const item = [...this.bars.values()].find(
      (b) => b.index === this.hoveredIndex && !b.exiting,
    );
    if (item) this.emit('point:click', this.barEvent(item, p));
  }

  private barEvent(item: BarItem, p: PointerPos) {
    return {
      seriesId: 'waterfall',
      index: item.index,
      value: item.delta,
      label: this.steps()[item.index]?.label ?? String(item.index),
      clientX: p.clientX,
      clientY: p.clientY,
    };
  }

  private clearHover(): void {
    if (this.hoveredIndex !== -1) {
      const item = [...this.bars.values()].find((b) => b.index === this.hoveredIndex);
      if (item && this.lastPointer) this.emit('point:leave', this.barEvent(item, this.lastPointer));
      this.hoveredIndex = -1;
      for (const b of this.bars.values()) {
        if (!b.exiting) b.fillOpacity.set(IDLE_OPACITY);
      }
    }
    this.tooltip?.hide(this.immediate());
  }

  private disposeBar(item: BarItem): void {
    item.vec.destroy();
    item.fillOpacity.destroy();
  }

  protected override teardown(): void {
    super.teardown();
    for (const b of this.bars.values()) this.disposeBar(b);
    this.bars.clear();
    for (const c of this.connectors.values()) {
      c.y.destroy();
      c.opacity.destroy();
    }
    this.connectors.clear();
  }
}
