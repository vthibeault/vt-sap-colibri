import { XYChart } from './xy.js';
import type { UpdateReason } from '../core/chart.js';
import type { BaseChartOptions, Series } from '../core/types.js';
import { svgEl } from '../core/svg.js';
import { keyedJoin, type JoinItem } from '../core/join.js';
import { AnimatedValue, AnimatedVec } from '../motion/animated.js';
import { stagger } from '../motion/stagger.js';
import { scaleLinear, type LinearScale } from '../scale/linear.js';
import { scaleBand, type BandScale } from '../scale/band.js';
import { niceDomain } from '../scale/ticks.js';
import { paletteVar, resolveColor } from '../theme/theme.js';
import { fmtValue } from '../core/format.js';
import type { PointerPos } from '../interaction/pointer.js';

export interface BoxPlotChartOptions extends BaseChartOptions {
  /** Whisker reach as a multiple of the IQR (default 1.5). */
  whisker?: number;
}

interface BoxStats {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  outliers: number[];
}

interface BoxItem extends JoinItem {
  g: SVGGElement;
  whiskerLine: SVGLineElement;
  capLow: SVGLineElement;
  capHigh: SVGLineElement;
  box: SVGRectElement;
  medianLine: SVGLineElement;
  outlierDots: SVGCircleElement[];
  /** [x, w, yMin, yQ1, yMed, yQ3, yMax] */
  vec: AnimatedVec;
  opacity: AnimatedValue;
  stats: BoxStats;
  index: number;
  colorResolved: string;
  removeFn: (() => void) | null;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac;
}

function computeStats(samples: number[], whisker: number): BoxStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const loFence = q1 - whisker * iqr;
  const hiFence = q3 + whisker * iqr;
  const inliers = sorted.filter((v) => v >= loFence && v <= hiFence);
  return {
    min: inliers[0] ?? q1,
    q1,
    median,
    q3,
    max: inliers[inliers.length - 1] ?? q3,
    outliers: sorted.filter((v) => v < loFence || v > hiFence),
  };
}

/**
 * Box-and-whisker plot. Each series is a category of raw samples; quartiles
 * are computed internally and every stat line is spring-driven, so new
 * samples make the boxes stretch and slide.
 */
export class BoxPlotChart extends XYChart<BoxPlotChartOptions> {
  private boxes = new Map<string, BoxItem>();
  private band!: BandScale;
  private yScale!: LinearScale;
  private hoveredIndex = -1;
  private entranceDone = false;

  constructor(el: HTMLElement, options: BoxPlotChartOptions) {
    super(el, { legend: false, ...options });
    this.bootstrap();
  }

  protected override chartType(): string {
    return 'Box plot';
  }

  private samplesOf(series: Series): number[] {
    return this.valuesOf(series);
  }

  protected override update(reason: UpdateReason): void {
    const immediate = this.immediate() || reason === 'resize';
    const spring = this.springConfig();
    const categories = this.options.data.series;
    const n = categories.length;
    const whisker = this.options.whisker ?? 1.5;

    const allStats = categories.map((s) => computeStats(this.samplesOf(s), whisker));
    let lo = Infinity;
    let hi = -Infinity;
    allStats.forEach((st) => {
      lo = Math.min(lo, st.min, ...st.outliers);
      hi = Math.max(hi, st.max, ...st.outliers);
    });
    if (lo === Infinity) {
      lo = 0;
      hi = 1;
    }
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const [d0, d1] = niceDomain(lo, hi, this.options.axes?.y?.ticks ?? 5);
    this.yScale = scaleLinear({
      domain: [d0, d1],
      range: [this.plot.y + this.plot.height, this.plot.y],
    });
    this.band = scaleBand({
      domain: categories.map((s) => s.id),
      range: [this.plot.x, this.plot.x + this.plot.width],
      paddingInner: 0.45,
      paddingOuter: 0.2,
    });

    const chromeImmediate = this.immediate() || reason === 'resize';
    this.xAxis.update(
      categories.map((s) => ({
        key: s.id,
        label: s.name ?? s.id,
        pos: this.band.center(s.id),
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

    keyedJoin(
      this.boxes,
      categories.map((s, i) => [s.id, { s, i, stats: allStats[i]! }] as const),
      {
        enter: (_key, d, i) => {
          const spec = d.s.color ?? paletteVar(d.i);
          const x = this.band(d.s.id);
          const target = this.targetOf(x, w, d.stats);
          const g = svgEl('g', { class: 'nova-box' }, this.seriesLayer);
          const whiskerLine = svgEl('line', { stroke: spec, 'stroke-width': 1.5 }, g);
          const capLow = svgEl('line', { stroke: spec, 'stroke-width': 1.5 }, g);
          const capHigh = svgEl('line', { stroke: spec, 'stroke-width': 1.5 }, g);
          const box = svgEl(
            'rect',
            { fill: spec, 'fill-opacity': 0.35, stroke: spec, 'stroke-width': 1.5, rx: 3 },
            g,
          );
          const medianLine = svgEl('line', { stroke: spec, 'stroke-width': 2.5 }, g);
          const grow = !this.immediate();
          const med = this.yScale(d.stats.median);
          const vec = new AnimatedVec(
            grow ? [x, w, med, med, med, med, med] : target,
            spring,
          );
          const opacity = new AnimatedValue(1, spring);
          const item: BoxItem = {
            g,
            whiskerLine,
            capLow,
            capHigh,
            box,
            medianLine,
            outlierDots: [],
            vec,
            opacity,
            stats: d.stats,
            index: d.i,
            colorResolved: resolveColor(this.el, spec),
            removeFn: null,
          };
          vec.onChange((v) => this.renderBox(item, v));
          vec.onRest(() => {
            if (item.exiting) {
              g.remove();
              this.disposeBox(item);
              item.removeFn?.();
            }
          });
          opacity.onChange((v) => g.setAttribute('opacity', String(Math.max(v, 0))));
          vec.reset(vec.values);
          if (grow) {
            // Boxes unfold from their median, rippling across categories.
            const delay = this.entranceDone ? 0 : stagger(i, n, { each: 90 });
            vec.set(target, {
              delays: Float64Array.from({ length: 7 }, () => delay),
            });
          }
          this.syncOutliers(item, d.stats, x, w, spec);
          return item;
        },
        update: (item, d) => {
          item.stats = d.stats;
          item.index = d.i;
          const spec = d.s.color ?? paletteVar(d.i);
          item.colorResolved = resolveColor(this.el, spec);
          for (const el of [item.whiskerLine, item.capLow, item.capHigh, item.medianLine]) {
            el.setAttribute('stroke', spec);
          }
          item.box.setAttribute('fill', spec);
          item.box.setAttribute('stroke', spec);
          const x = this.band(d.s.id);
          item.vec.set(this.targetOf(x, w, d.stats), { immediate });
          item.opacity.set(
            this.hoveredIndex === -1 || this.hoveredIndex === d.i ? 1 : 0.5,
            { immediate },
          );
          this.syncOutliers(item, d.stats, x, w, spec);
        },
        exit: (item, remove) => {
          item.removeFn = remove;
          if (immediate) {
            item.g.remove();
            this.disposeBox(item);
            remove();
          } else {
            const t = item.vec.getTargets();
            const med = t[4]!;
            item.vec.set([t[0]!, t[1]!, med, med, med, med, med]);
            item.opacity.set(0);
          }
        },
      },
    );
    this.entranceDone = true;
    this.refreshHover();
  }

  private targetOf(x: number, w: number, st: BoxStats): Float64Array {
    return Float64Array.of(
      x,
      w,
      this.yScale(st.min),
      this.yScale(st.q1),
      this.yScale(st.median),
      this.yScale(st.q3),
      this.yScale(st.max),
    );
  }

  private renderBox(item: BoxItem, v: Float64Array): void {
    const x = v[0]!;
    const w = Math.max(v[1]!, 0);
    const cx = x + w / 2;
    const [yMin, yQ1, yMed, yQ3, yMax] = [v[2]!, v[3]!, v[4]!, v[5]!, v[6]!];
    item.whiskerLine.setAttribute('x1', String(cx));
    item.whiskerLine.setAttribute('x2', String(cx));
    item.whiskerLine.setAttribute('y1', String(yMin));
    item.whiskerLine.setAttribute('y2', String(yMax));
    const capW = w * 0.5;
    for (const [cap, y] of [
      [item.capLow, yMin],
      [item.capHigh, yMax],
    ] as const) {
      cap.setAttribute('x1', String(cx - capW / 2));
      cap.setAttribute('x2', String(cx + capW / 2));
      cap.setAttribute('y1', String(y));
      cap.setAttribute('y2', String(y));
    }
    item.box.setAttribute('x', String(x));
    item.box.setAttribute('y', String(Math.min(yQ1, yQ3)));
    item.box.setAttribute('width', String(w));
    item.box.setAttribute('height', String(Math.abs(yQ1 - yQ3)));
    item.medianLine.setAttribute('x1', String(x));
    item.medianLine.setAttribute('x2', String(x + w));
    item.medianLine.setAttribute('y1', String(yMed));
    item.medianLine.setAttribute('y2', String(yMed));
  }

  private syncOutliers(
    item: BoxItem,
    st: BoxStats,
    x: number,
    w: number,
    spec: string,
  ): void {
    while (item.outlierDots.length > st.outliers.length) item.outlierDots.pop()!.remove();
    while (item.outlierDots.length < st.outliers.length) {
      item.outlierDots.push(
        svgEl('circle', { r: 2.5, fill: 'none', stroke: spec, 'stroke-width': 1.2 }, item.g),
      );
    }
    st.outliers.forEach((v, i) => {
      const c = item.outlierDots[i]!;
      c.setAttribute('cx', String(x + w / 2));
      c.setAttribute('cy', String(this.yScale(v)));
      c.setAttribute('stroke', spec);
    });
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
    const item = [...this.boxes.values()].find((b) => b.index === index && !b.exiting);
    if (!item) {
      this.clearHover();
      return;
    }
    const immediate = this.immediate();
    if (index !== this.hoveredIndex) {
      this.hoveredIndex = index;
      for (const b of this.boxes.values()) {
        if (!b.exiting) {
          b.opacity.set(b.index === index ? 1 : 0.5, { immediate });
        }
      }
      this.emit('point:enter', this.boxEvent(item, p));
    }
    const series = this.options.data.series[index];
    const c = item.colorResolved;
    const st = item.stats;
    this.tooltip?.show(
      {
        title: series?.name ?? series?.id ?? String(index),
        rows: [
          { color: c, label: 'Max', value: fmtValue(st.max) },
          { color: c, label: 'Q3', value: fmtValue(st.q3) },
          { color: c, label: 'Median', value: fmtValue(st.median) },
          { color: c, label: 'Q1', value: fmtValue(st.q1) },
          { color: c, label: 'Min', value: fmtValue(st.min) },
          ...(st.outliers.length > 0
            ? [{ color: c, label: 'Outliers', value: String(st.outliers.length) }]
            : []),
        ],
      },
      { x: this.band.center(series?.id ?? index), y: p.y },
      immediate,
    );
  }

  protected override pointerClick(p: PointerPos): void {
    const item = [...this.boxes.values()].find(
      (b) => b.index === this.hoveredIndex && !b.exiting,
    );
    if (item) this.emit('point:click', this.boxEvent(item, p));
  }

  private boxEvent(item: BoxItem, p: PointerPos) {
    const series = this.options.data.series[item.index];
    return {
      seriesId: series?.id ?? String(item.index),
      index: item.index,
      value: item.stats.median,
      label: series?.name ?? series?.id ?? String(item.index),
      clientX: p.clientX,
      clientY: p.clientY,
    };
  }

  private clearHover(): void {
    if (this.hoveredIndex !== -1) {
      const item = [...this.boxes.values()].find((b) => b.index === this.hoveredIndex);
      if (item && this.lastPointer) {
        this.emit('point:leave', this.boxEvent(item, this.lastPointer));
      }
      this.hoveredIndex = -1;
      for (const b of this.boxes.values()) {
        if (!b.exiting) b.opacity.set(1);
      }
    }
    this.tooltip?.hide(this.immediate());
  }

  private disposeBox(item: BoxItem): void {
    item.vec.destroy();
    item.opacity.destroy();
  }

  protected override teardown(): void {
    super.teardown();
    for (const b of this.boxes.values()) this.disposeBox(b);
    this.boxes.clear();
  }
}
