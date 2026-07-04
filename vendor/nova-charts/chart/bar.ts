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
import { fmtValue } from '../core/format.js';
import type { PointerPos } from '../interaction/pointer.js';

export interface BarChartOptions extends BaseChartOptions {
  /** Corner radius for bars (default 3). */
  cornerRadius?: number;
  /** Stack series on top of each other instead of grouping side by side. */
  stacked?: boolean;
}

interface BarItem extends JoinItem {
  rect: SVGRectElement;
  /** [x, y, w, h] */
  vec: AnimatedVec;
  fillOpacity: AnimatedValue;
  seriesId: string;
  index: number;
  value: number;
  colorResolved: string;
  removeFn: (() => void) | null;
}

const IDLE_OPACITY = 0.92;
const DIM_OPACITY = 0.45;

export class BarChart extends XYChart<BarChartOptions> {
  private bars = new Map<string, BarItem>();
  private band!: BandScale;
  private yScale!: LinearScale;
  private hoveredIndex = -1;
  private hovered: { seriesId: string; index: number } | null = null;
  private entranceDone = false;

  constructor(el: HTMLElement, options: BarChartOptions) {
    super(el, options);
    this.bootstrap();
  }

  protected override chartType(): string {
    return 'Bar';
  }

  protected override update(reason: UpdateReason): void {
    const labels = this.labels();
    const n = labels.length;
    const immediate = this.immediate() || reason === 'resize';
    const spring = this.springConfig();
    const stacked = this.options.stacked === true;
    const visible = this.visibleSeries();

    // Stacking offsets: positives pile up, negatives pile down, per column.
    const offsets: number[][] = [];
    let d0: number;
    let d1: number;
    if (stacked) {
      const cumPos = new Array<number>(n).fill(0);
      const cumNeg = new Array<number>(n).fill(0);
      visible.forEach((s, si) => {
        offsets[si] = this.valuesOf(s).map((v, i) => {
          if (i >= n) return 0;
          if (v >= 0) {
            const y0 = cumPos[i]!;
            cumPos[i] = y0 + v;
            return y0;
          }
          const y0 = cumNeg[i]!;
          cumNeg[i] = y0 + v;
          return y0;
        });
      });
      const hi = Math.max(0, ...cumPos);
      const lo = Math.min(0, ...cumNeg);
      [d0, d1] = niceDomain(lo, hi === lo ? lo + 1 : hi, this.options.axes?.y?.ticks ?? 5);
    } else {
      [d0, d1] = this.yDomain(true);
    }
    this.yScale = scaleLinear({
      domain: [d0, d1],
      range: [this.plot.y + this.plot.height, this.plot.y],
    });
    this.band = scaleBand({
      domain: labels.map((_, i) => i),
      range: [this.plot.x, this.plot.x + this.plot.width],
      paddingInner: 0.25,
      paddingOuter: 0.12,
    });

    const chromeImmediate = this.immediate() || reason === 'resize';
    this.xAxis.update(
      this.xTickIndices(n).map((i) => ({
        key: labels[i]!,
        label: labels[i]!,
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
    this.updateLegend();

    const m = Math.max(visible.length, 1);
    const groupW = this.band.bandwidth();
    const gap = Math.min(groupW * 0.04, 2);
    const barW = stacked ? groupW : Math.max((groupW - gap * (m - 1)) / m, 1);
    const baselineY = this.yScale(Math.max(Math.min(0, d1), d0));
    const rx = Math.min(this.options.cornerRadius ?? 3, barW / 2);

    const entries: Array<readonly [string, { si: number; i: number; value: number; seriesIndex: number }]> = [];
    visible.forEach((s, si) => {
      const values = this.valuesOf(s);
      const seriesIndex = this.options.data.series.indexOf(s);
      values.forEach((value, i) => {
        if (i < n) entries.push([`${s.id}|${i}`, { si, i, value, seriesIndex }] as const);
      });
    });

    const geom = (si: number, i: number, value: number): [number, number, number, number] => {
      if (stacked) {
        const y0 = offsets[si]?.[i] ?? 0;
        const a = this.yScale(y0);
        const b = this.yScale(y0 + value);
        return [this.band(i), Math.min(a, b), barW, Math.abs(a - b)];
      }
      const x = this.band(i) + si * (barW + gap);
      const vy = this.yScale(value);
      const y = Math.min(vy, baselineY);
      const h = Math.abs(vy - baselineY);
      return [x, y, barW, h];
    };

    keyedJoin(this.bars, entries, {
      enter: (key, d) => {
        const seriesId = key.slice(0, key.lastIndexOf('|'));
        const series = visible[d.si]!;
        const { spec, resolved } = this.colorOf(series, d.seriesIndex);
        const [x, y, w, h] = geom(d.si, d.i, d.value);
        const rect = svgEl('rect', { fill: spec, rx, 'fill-opacity': 0 }, this.seriesLayer);
        const startFromBaseline = !this.immediate();
        const vec = new AnimatedVec(
          startFromBaseline ? [x, baselineY, w, 0] : [x, y, w, h],
          spring,
        );
        const fillOpacity = new AnimatedValue(this.immediate() ? IDLE_OPACITY : 0, {
          stiffness: 200,
          damping: 26,
        });
        const item: BarItem = {
          rect,
          vec,
          fillOpacity,
          seriesId,
          index: d.i,
          value: d.value,
          colorResolved: resolved,
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
        // Re-emit initial state through the binder.
        vec.reset(vec.values);
        if (startFromBaseline) {
          const delay = this.entranceDone
            ? 0
            : stagger(d.i, n, { each: this.enterStagger() }) + d.si * 60;
          vec.set([x, y, w, h], {
            delays: Float64Array.of(delay, delay, delay, delay),
          });
          fillOpacity.set(IDLE_OPACITY, { delay });
        }
        return item;
      },
      update: (item, d) => {
        item.value = d.value;
        const series = visible[d.si]!;
        const { spec, resolved } = this.colorOf(series, d.seriesIndex);
        item.colorResolved = resolved;
        item.rect.setAttribute('fill', spec);
        item.rect.setAttribute('rx', String(rx));
        const [x, y, w, h] = geom(d.si, d.i, d.value);
        const delay = immediate ? 0 : stagger(d.i, n, { each: 16 });
        item.vec.set([x, y, w, h], {
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
          // Shrink back into the baseline.
          const v = item.vec.getTargets();
          item.vec.set([v[0]!, baselineY, v[2]!, 0]);
          item.fillOpacity.set(0);
        }
      },
    });
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
    const labels = this.labels();
    const index = this.band.indexAt(p.x);
    if (index < 0 || labels.length === 0) {
      this.clearHover();
      return;
    }

    const points: HoverPoint[] = [];
    for (const item of this.bars.values()) {
      if (item.exiting || item.index !== index) continue;
      const series = this.options.data.series.find((s) => s.id === item.seriesId);
      points.push({
        seriesId: item.seriesId,
        seriesName: series?.name ?? item.seriesId,
        index,
        value: item.value,
        label: labels[index] ?? String(index),
        color: item.colorResolved,
        x: this.band.center(index),
        y: this.yScale(item.value),
      });
    }
    if (points.length === 0) {
      this.clearHover();
      return;
    }

    if (index !== this.hoveredIndex) {
      this.hoveredIndex = index;
      for (const item of this.bars.values()) {
        if (!item.exiting) item.fillOpacity.set(this.opacityFor(item));
      }
    }

    let active = points[0]!;
    for (const pt of points) {
      if (Math.abs(pt.y - p.y) < Math.abs(active.y - p.y)) active = pt;
    }
    const immediate = this.immediate();
    this.tooltip?.show(
      this.tooltipContent(points, active.label),
      { x: this.band.center(index), y: p.y },
      immediate,
    );

    const prev = this.hovered;
    if (!prev || prev.seriesId !== active.seriesId || prev.index !== active.index) {
      if (prev) this.emitBarEvent('point:leave', prev, p);
      this.hovered = { seriesId: active.seriesId, index: active.index };
      this.emit('point:enter', {
        seriesId: active.seriesId,
        index: active.index,
        value: active.value,
        label: active.label,
        clientX: p.clientX,
        clientY: p.clientY,
      });
    }
  }

  protected override pointerClick(p: PointerPos): void {
    if (this.hovered) this.emitBarEvent('point:click', this.hovered, p);
  }

  private emitBarEvent(
    type: 'point:leave' | 'point:click',
    ref: { seriesId: string; index: number },
    p: PointerPos,
  ): void {
    const item = this.bars.get(`${ref.seriesId}|${ref.index}`);
    const labels = this.labels();
    this.emit(type, {
      seriesId: ref.seriesId,
      index: ref.index,
      value: item?.value ?? NaN,
      label: labels[ref.index] ?? String(ref.index),
      clientX: p.clientX,
      clientY: p.clientY,
    });
  }

  private clearHover(): void {
    if (this.hovered && this.lastPointer) {
      this.emitBarEvent('point:leave', this.hovered, this.lastPointer);
    }
    this.hovered = null;
    if (this.hoveredIndex !== -1) {
      this.hoveredIndex = -1;
      for (const item of this.bars.values()) {
        if (!item.exiting) item.fillOpacity.set(IDLE_OPACITY);
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
    for (const item of this.bars.values()) this.disposeBar(item);
    this.bars.clear();
  }
}
