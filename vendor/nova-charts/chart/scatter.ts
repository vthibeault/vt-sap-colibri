import { XYChart } from './xy.js';
import type { UpdateReason } from '../core/chart.js';
import type { BaseChartOptions, HoverPoint, Point, Series } from '../core/types.js';
import { svgEl } from '../core/svg.js';
import { keyedJoin, type JoinItem } from '../core/join.js';
import { AnimatedValue, AnimatedVec } from '../motion/animated.js';
import { stagger } from '../motion/stagger.js';
import { scaleLinear, type LinearScale } from '../scale/linear.js';
import { nearestPoint2D } from '../interaction/nearest.js';
import { fmtValue } from '../core/format.js';
import type { PointerPos } from '../interaction/pointer.js';

export interface ScatterChartOptions extends BaseChartOptions {
  /** Pixel radius range used for the `r` (bubble) encoding. */
  radiusRange?: [number, number];
}

interface Dot extends JoinItem {
  c: SVGCircleElement;
  /** [cx, cy, r] */
  vec: AnimatedVec;
  opacity: AnimatedValue;
  seriesId: string;
  index: number;
  px: number;
  py: number;
  datum: { x: number; y: number; r?: number };
  colorResolved: string;
  baseR: number;
  removeFn: (() => void) | null;
}

const BASE_R = 5;

export class ScatterChart extends XYChart<ScatterChartOptions> {
  private dots = new Map<string, Dot>();
  private xScale!: LinearScale;
  private yScale!: LinearScale;
  private hovered: Dot | null = null;
  private entranceDone = false;

  constructor(el: HTMLElement, options: ScatterChartOptions) {
    super(el, options);
    this.bootstrap();
  }

  protected override chartType(): string {
    return 'Scatter';
  }

  private pointsOf(series: Series): { x: number; y: number; r?: number }[] {
    return series.data.map((d, i) => {
      if (typeof d === 'number') return { x: i, y: d };
      if ('y' in d) {
        return { x: this.numericX(d), y: d.y, ...(d.r !== undefined ? { r: d.r } : {}) };
      }
      return { x: i, y: d.c }; // OHLC data: plot the close
    });
  }

  private numericX(p: Point): number {
    if (typeof p.x === 'number') return p.x;
    if (p.x instanceof Date) return p.x.getTime();
    const parsed = Number(p.x);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  protected override update(reason: UpdateReason): void {
    const immediate = this.immediate() || reason === 'resize';
    const spring = this.springConfig();
    const visible = this.visibleSeries();

    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    let rMax = 0;
    for (const s of visible) {
      for (const p of this.pointsOf(s)) {
        if (p.x < xMin) xMin = p.x;
        if (p.x > xMax) xMax = p.x;
        if (p.y < yMin) yMin = p.y;
        if (p.y > yMax) yMax = p.y;
        if (p.r !== undefined && p.r > rMax) rMax = p.r;
      }
    }
    if (xMin === Infinity) {
      xMin = 0;
      xMax = 1;
      yMin = 0;
      yMax = 1;
    }
    if (xMin === xMax) {
      xMin -= 1;
      xMax += 1;
    }
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }

    this.xScale = scaleLinear({
      domain: [xMin, xMax],
      range: [this.plot.x, this.plot.x + this.plot.width],
      nice: true,
    });
    this.yScale = scaleLinear({
      domain: [yMin, yMax],
      range: [this.plot.y + this.plot.height, this.plot.y],
      nice: true,
    });
    const [rLo, rHi] = this.options.radiusRange ?? [3, 18];
    const radiusOf = (r: number | undefined): number =>
      r === undefined || rMax === 0 ? BASE_R : rLo + Math.sqrt(r / rMax) * (rHi - rLo);

    const chromeImmediate = this.immediate() || reason === 'resize';
    this.xAxis.update(
      this.xScale
        .ticks(Math.max(2, Math.floor(this.plot.width / 80)))
        .map((v) => ({ key: String(v), label: fmtValue(v), pos: this.xScale(v) })),
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

    const entries: Array<
      readonly [string, { series: Series; seriesIndex: number; i: number; p: { x: number; y: number; r?: number }; count: number }]
    > = [];
    for (const s of visible) {
      const seriesIndex = this.options.data.series.indexOf(s);
      const pts = this.pointsOf(s);
      pts.forEach((p, i) =>
        entries.push([`${s.id}|${i}`, { series: s, seriesIndex, i, p, count: pts.length }] as const),
      );
    }

    keyedJoin(this.dots, entries, {
      enter: (_key, d) => {
        const { spec, resolved } = this.colorOf(d.series, d.seriesIndex);
        const px = this.xScale(d.p.x);
        const py = this.yScale(d.p.y);
        const r = radiusOf(d.p.r);
        const c = svgEl(
          'circle',
          { fill: spec, 'fill-opacity': 0.75, stroke: spec, 'stroke-width': 1.5 },
          this.seriesLayer,
        );
        const vec = new AnimatedVec([px, py, 0], spring);
        const opacity = new AnimatedValue(1, spring);
        const item: Dot = {
          c,
          vec,
          opacity,
          seriesId: d.series.id,
          index: d.i,
          px,
          py,
          datum: d.p,
          colorResolved: resolved,
          baseR: r,
          removeFn: null,
        };
        vec.onChange((v) => {
          c.setAttribute('cx', String(v[0]!));
          c.setAttribute('cy', String(v[1]!));
          c.setAttribute('r', String(Math.max(v[2]!, 0)));
        });
        vec.onRest(() => {
          if (item.exiting) {
            c.remove();
            this.disposeDot(item);
            item.removeFn?.();
          }
        });
        opacity.onChange((v) => c.setAttribute('opacity', String(Math.max(v, 0))));
        vec.reset(vec.values);
        if (this.immediate()) {
          vec.reset([px, py, r]);
        } else {
          const delay = this.entranceDone
            ? 0
            : stagger(d.i, d.count, { each: this.enterStagger() * 0.8 });
          vec.set([px, py, r], { delays: Float64Array.of(delay, delay, delay) });
        }
        return item;
      },
      update: (item, d) => {
        const { spec, resolved } = this.colorOf(d.series, d.seriesIndex);
        item.colorResolved = resolved;
        item.c.setAttribute('fill', spec);
        item.c.setAttribute('stroke', spec);
        item.datum = d.p;
        item.px = this.xScale(d.p.x);
        item.py = this.yScale(d.p.y);
        const r = radiusOf(d.p.r);
        const delay = immediate ? 0 : stagger(d.i, d.count, { each: 8 });
        item.opacity.set(1, { immediate });
        item.vec.set([item.px, item.py, this.hovered === item ? r * 1.5 : r], {
          immediate,
          delays: Float64Array.of(delay, delay, delay),
        });
        item.baseR = r;
      },
      exit: (item, remove) => {
        item.removeFn = remove;
        if (immediate) {
          item.c.remove();
          this.disposeDot(item);
          remove();
        } else {
          const t = item.vec.getTargets();
          item.vec.set([t[0]!, t[1]!, 0]);
          item.opacity.set(0);
        }
      },
    });
    this.entranceDone = true;
    this.refreshHover();
  }

  protected override pointerMove(p: PointerPos | null): void {
    if (p === null) {
      this.clearHover();
      return;
    }
    const items = [...this.dots.values()].filter((d) => !d.exiting);
    const idx = nearestPoint2D(
      items.map((d) => d.px),
      items.map((d) => d.py),
      p.x,
      p.y,
      28,
      items.map((d) => d.baseR),
    );
    const next = idx >= 0 ? items[idx]! : null;
    if (next !== this.hovered) {
      const immediate = this.immediate();
      if (this.hovered) this.setHoverVisual(this.hovered, false, immediate);
      this.hovered = next;
      if (next) {
        this.setHoverVisual(next, true, immediate);
        this.emit('point:enter', this.eventOf(next, p));
      } else {
        this.tooltip?.hide(immediate);
      }
    }
    if (next) {
      const series = this.options.data.series.find((s) => s.id === next.seriesId);
      const hp: HoverPoint = {
        seriesId: next.seriesId,
        seriesName: series?.name ?? next.seriesId,
        index: next.index,
        value: next.datum.y,
        label: `${fmtValue(next.datum.x)}, ${fmtValue(next.datum.y)}`,
        color: next.colorResolved,
        x: next.px,
        y: next.py,
      };
      const rows = [
        { color: next.colorResolved, label: 'x', value: fmtValue(next.datum.x) },
        { color: next.colorResolved, label: 'y', value: fmtValue(next.datum.y) },
        ...(next.datum.r !== undefined
          ? [{ color: next.colorResolved, label: 'r', value: fmtValue(next.datum.r) }]
          : []),
      ];
      const t = this.options.tooltip;
      const content =
        t && typeof t === 'object' && t.formatter
          ? t.formatter([hp])
          : { title: hp.seriesName, rows };
      this.tooltip?.show(content, { x: next.px, y: next.py }, this.immediate());
    }
  }

  protected override pointerClick(p: PointerPos): void {
    if (this.hovered) this.emit('point:click', this.eventOf(this.hovered, p));
  }

  private eventOf(d: Dot, p: PointerPos) {
    return {
      seriesId: d.seriesId,
      index: d.index,
      value: d.datum.y,
      label: `${fmtValue(d.datum.x)}, ${fmtValue(d.datum.y)}`,
      clientX: p.clientX,
      clientY: p.clientY,
    };
  }

  private setHoverVisual(d: Dot, active: boolean, immediate: boolean): void {
    const r = d.baseR;
    const t = d.vec.getTargets();
    d.vec.set([t[0]!, t[1]!, active ? r * 1.5 : r], { immediate });
    d.c.setAttribute('fill-opacity', active ? '0.95' : '0.75');
  }

  private clearHover(): void {
    if (this.hovered) {
      this.setHoverVisual(this.hovered, false, this.immediate());
      if (this.lastPointer) {
        this.emit('point:leave', this.eventOf(this.hovered, this.lastPointer));
      }
      this.hovered = null;
    }
    this.tooltip?.hide(this.immediate());
  }

  private disposeDot(d: Dot): void {
    d.vec.destroy();
    d.opacity.destroy();
  }

  protected override teardown(): void {
    super.teardown();
    for (const d of this.dots.values()) this.disposeDot(d);
    this.dots.clear();
  }
}
