import { XYChart } from './xy.js';
import type { UpdateReason } from '../core/chart.js';
import type { BaseChartOptions, CurveType, HoverPoint } from '../core/types.js';
import { svgEl } from '../core/svg.js';
import { keyedJoin, type JoinItem } from '../core/join.js';
import { AnimatedValue, AnimatedVec } from '../motion/animated.js';
import { runTween } from '../motion/tween.js';
import { easeInOutCubic } from '../motion/easing.js';
import { stagger } from '../motion/stagger.js';
import { scaleLinear, type LinearScale } from '../scale/linear.js';
import { niceDomain } from '../scale/ticks.js';
import type { Series } from '../core/types.js';
import { buildLinePath } from '../shape/line.js';
import { buildAreaPath } from '../shape/area.js';
import { resamplePolyline } from '../interpolate/resample.js';
import { bisectClosest } from '../interaction/nearest.js';
import { fmtValue } from '../core/format.js';
import { clamp } from '../interpolate/number.js';
import type { PointerPos } from '../interaction/pointer.js';

export interface LineChartOptions extends BaseChartOptions {
  curve?: CurveType;
  /** Render dots at each data point (default true). */
  showPoints?: boolean;
  /** Stack series (area charts): bands pile on top of each other. */
  stacked?: boolean;
}

interface Dot {
  c: SVGCircleElement;
  x: AnimatedValue;
  y: AnimatedValue;
  r: AnimatedValue;
}

interface SeriesItem extends JoinItem {
  g: SVGGElement;
  path: SVGPathElement;
  fill: SVGPathElement | null;
  vec: AnimatedVec;
  baseline: AnimatedValue;
  opacity: AnimatedValue;
  dots: Dot[];
  colorSpec: string;
  colorResolved: string;
  values: number[];
  /** Pixel-space source values (cumulative tops when stacked). */
  geomVals: number[];
  pendingSnap: Float64Array | null;
  cancelDraw: (() => void) | null;
  removeFn: (() => void) | null;
}

const DOT_R = 3;
const DOT_R_ACTIVE = 5.5;

export class LineChart extends XYChart<LineChartOptions> {
  protected items = new Map<string, SeriesItem>();
  protected xPositions: number[] = [];
  protected yScale!: LinearScale;
  private halo: SVGCircleElement;
  private haloX = new AnimatedValue(0, { stiffness: 260, damping: 22 });
  private haloY = new AnimatedValue(0, { stiffness: 260, damping: 22 });
  private haloOpacity = new AnimatedValue(0);
  private hovered: { seriesId: string; index: number } | null = null;
  private entranceDone = false;

  /** AreaChart overrides this to true. */
  protected get filled(): boolean {
    return false;
  }

  constructor(el: HTMLElement, options: LineChartOptions) {
    super(el, options);
    this.halo = svgEl(
      'circle',
      { r: 9, opacity: 0, class: 'nova-halo' },
      this.hoverLayer,
    );
    this.haloX.onChange((v) => this.halo.setAttribute('cx', String(v)));
    this.haloY.onChange((v) => this.halo.setAttribute('cy', String(v)));
    this.haloOpacity.onChange((v) =>
      this.halo.setAttribute('opacity', String(Math.max(v, 0))),
    );
    this.bootstrap();
  }

  protected override chartType(): string {
    return this.filled ? 'Area' : 'Line';
  }

  protected curve(): CurveType {
    return this.options.curve ?? 'catmull-rom';
  }

  protected includeZero(): boolean {
    return this.filled;
  }

  protected override update(reason: UpdateReason): void {
    const labels = this.labels();
    const n = labels.length;
    const immediate = this.immediate() || reason === 'init' || reason === 'resize';
    const spring = this.springConfig();
    const visible = this.visibleSeries();
    const stacked = this.filled && this.options.stacked === true;

    // Stacking: each band's geometry follows the cumulative top (negatives
    // are clamped — stacked areas are sums of magnitudes).
    const tops = new Map<string, number[]>();
    let d0: number;
    let d1: number;
    if (stacked) {
      const cum = new Array<number>(n).fill(0);
      for (const s of visible) {
        const values = this.valuesOf(s);
        tops.set(
          s.id,
          Array.from({ length: n }, (_, i) => {
            cum[i] = cum[i]! + Math.max(values[i] ?? 0, 0);
            return cum[i]!;
          }),
        );
      }
      [d0, d1] = niceDomain(0, Math.max(...cum, 1), this.options.axes?.y?.ticks ?? 5);
    } else {
      [d0, d1] = this.yDomain(this.includeZero());
    }
    const geomValues = (s: Series): number[] => tops.get(s.id) ?? this.valuesOf(s);
    const fillOpacity = stacked ? 0.85 : 0.18;

    this.yScale = scaleLinear({
      domain: [d0, d1],
      range: [this.plot.y + this.plot.height, this.plot.y],
    });
    const xPos = (i: number): number =>
      n <= 1
        ? this.plot.x + this.plot.width / 2
        : this.plot.x + (i / (n - 1)) * this.plot.width;
    this.xPositions = Array.from({ length: n }, (_, i) => xPos(i));

    // Chrome: axes + grid glide to the new domain.
    const chromeImmediate = this.immediate() || reason === 'resize';
    this.xAxis.update(
      this.xTickIndices(n).map((i) => ({
        key: labels[i]!,
        label: labels[i]!,
        pos: this.xPositions[i]!,
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

    const baselineY = this.yScale(clamp(0, Math.min(d0, d1), Math.max(d0, d1)));

    keyedJoin(
      this.items,
      visible.map((s) => [s.id, s] as const),
      {
        enter: (_key, s, si) => {
          const values = this.valuesOf(s);
          const pts = this.targetPoints(geomValues(s));
          const { spec, resolved } = this.colorOf(s, si);
          const g = svgEl('g', {}, this.seriesLayer);
          let fill: SVGPathElement | null = null;
          if (this.filled) {
            fill = svgEl(
              'path',
              { fill: spec, 'fill-opacity': fillOpacity, stroke: 'none' },
              g,
            );
          }
          const path = svgEl(
            'path',
            {
              fill: 'none',
              stroke: spec,
              'stroke-width': 2.5,
              'stroke-linecap': 'round',
              'stroke-linejoin': 'round',
            },
            g,
          );
          const vec = new AnimatedVec(pts, spring);
          const baseline = new AnimatedValue(baselineY, spring);
          const opacity = new AnimatedValue(1, spring);
          const item: SeriesItem = {
            g,
            path,
            fill,
            vec,
            baseline,
            opacity,
            dots: [],
            colorSpec: spec,
            colorResolved: resolved,
            values,
            geomVals: geomValues(s),
            pendingSnap: null,
            cancelDraw: null,
            removeFn: null,
          };
          const redraw = (): void => {
            path.setAttribute('d', buildLinePath(vec.values, this.curve()));
            fill?.setAttribute(
              'd',
              buildAreaPath(vec.values, baseline.get(), this.curve()),
            );
          };
          vec.onChange(redraw);
          baseline.onChange(redraw);
          vec.onRest(() => {
            if (item.pendingSnap) {
              const snap = item.pendingSnap;
              item.pendingSnap = null;
              vec.reset(snap);
              this.syncDots(item, snap, true);
            }
          });
          opacity.onChange((v) => {
            g.setAttribute('opacity', String(Math.max(v, 0)));
            if (item.exiting && v < 0.02) {
              g.remove();
              item.removeFn?.();
            }
          });
          redraw();
          this.syncDots(item, pts, true);
          if (!this.immediate()) {
            if (!this.entranceDone) {
              this.playEntrance(item, si, fillOpacity);
            } else {
              // Series appearing later (new id, legend re-show): fade in.
              item.opacity.set(0, { immediate: true });
              item.opacity.set(1);
            }
          }
          return item;
        },
        update: (item, s, si) => {
          const values = this.valuesOf(s);
          item.values = values;
          item.geomVals = geomValues(s);
          const { spec, resolved } = this.colorOf(s, si);
          if (spec !== item.colorSpec) {
            item.colorSpec = spec;
            item.colorResolved = resolved;
            item.path.setAttribute('stroke', spec);
            item.fill?.setAttribute('fill', spec);
            for (const d of item.dots) d.c.setAttribute('fill', spec);
          }
          item.fill?.setAttribute('fill-opacity', String(fillOpacity));
          item.opacity.set(1, { immediate });
          item.baseline.set(baselineY, { immediate });
          this.morphTo(item, this.targetPoints(geomValues(s)), immediate);
        },
        exit: (item, remove) => {
          item.removeFn = remove;
          if (immediate) {
            item.g.remove();
            this.disposeItem(item);
            remove();
          } else {
            item.opacity.set(0);
            for (const d of item.dots) d.r.set(0);
          }
        },
      },
    );
    // Stacked bands overdraw from largest (last series) to smallest, so each
    // band stays visible above the one below it.
    if (stacked) {
      for (let i = visible.length - 1; i >= 0; i--) {
        const item = this.items.get(visible[i]!.id);
        if (item) this.seriesLayer.appendChild(item.g);
      }
    }
    this.entranceDone = true;
    this.refreshHover();
  }

  /** Flat [x0, y0, …] pixel targets for a series' values. */
  private targetPoints(values: number[]): Float64Array {
    const m = values.length;
    const out = new Float64Array(m * 2);
    for (let i = 0; i < m; i++) {
      out[i * 2] = this.xPositions[i] ?? this.plot.x;
      out[i * 2 + 1] = this.yScale(values[i]!);
    }
    return out;
  }

  /**
   * The headline move: retarget every vertex's spring toward the new shape.
   * Mismatched point counts are reconciled by resampling both sides to the
   * larger count, then snapping down (invisibly) once the morph settles.
   */
  private morphTo(item: SeriesItem, target: Float64Array, immediate: boolean): void {
    item.cancelDraw?.();
    item.cancelDraw = null;
    item.path.removeAttribute('stroke-dasharray');
    item.path.removeAttribute('stroke-dashoffset');

    if (immediate) {
      item.pendingSnap = null;
      item.vec.reset(target);
      this.syncDots(item, target, true);
      return;
    }

    const m = item.vec.length / 2;
    const n = target.length / 2;
    const big = Math.max(m, n);
    if (m !== big) item.vec.reset(resamplePolyline(item.vec.values, big));
    const finalTarget = n === big ? target : resamplePolyline(target, big);
    item.pendingSnap = n === big ? null : target;

    // Left-to-right ripple: each vertex starts chasing slightly after the
    // previous one, so updates flow across the chart.
    const delays = new Float64Array(big * 2);
    for (let i = 0; i < big; i++) {
      const d = stagger(i, big, { each: Math.min(14, 320 / big) });
      delays[i * 2] = d;
      delays[i * 2 + 1] = d;
    }
    item.vec.set(finalTarget, { delays });
    this.syncDots(item, target, false);
  }

  /** Keep one dot per true data point, animating positions and pops. */
  private syncDots(item: SeriesItem, pts: Float64Array, immediate: boolean): void {
    if (this.options.showPoints === false) return;
    const n = pts.length / 2;
    while (item.dots.length > n) {
      const dot = item.dots.pop()!;
      if (immediate) {
        dot.c.remove();
        this.disposeDot(dot);
      } else {
        dot.r.onChange((v) => {
          if (v < 0.05) {
            dot.c.remove();
            this.disposeDot(dot);
          }
        });
        dot.r.set(0);
      }
    }
    for (let i = 0; i < n; i++) {
      const tx = pts[i * 2]!;
      const ty = pts[i * 2 + 1]!;
      const delay = immediate ? 0 : stagger(i, n, { each: Math.min(14, 320 / n) });
      let dot = item.dots[i];
      if (!dot) {
        const c = svgEl(
          'circle',
          { fill: item.colorSpec, r: 0, cx: tx, cy: ty },
          item.g,
        );
        dot = {
          c,
          x: new AnimatedValue(tx, this.springConfig()),
          y: new AnimatedValue(ty, this.springConfig()),
          r: new AnimatedValue(0, { stiffness: 300, damping: 20 }),
        };
        dot.x.onChange((v) => dot!.c.setAttribute('cx', String(v)));
        dot.y.onChange((v) => dot!.c.setAttribute('cy', String(v)));
        dot.r.onChange((v) => dot!.c.setAttribute('r', String(Math.max(v, 0))));
        dot.r.set(DOT_R, { immediate, delay });
        item.dots.push(dot);
      } else {
        dot.x.set(tx, { immediate, delay });
        dot.y.set(ty, { immediate, delay });
      }
    }
  }

  /** Entrance: stroke draw-in (with per-series stagger) + dot pops. */
  private playEntrance(item: SeriesItem, seriesIndex: number, fillOpacity = 0.18): void {
    const duration = this.enterDuration();
    const delay = seriesIndex * Math.max(this.enterStagger() * 3, 100);
    let length = 0;
    try {
      length = item.path.getTotalLength();
    } catch {
      length = 0;
    }
    if (length > 0) {
      item.path.setAttribute('stroke-dasharray', String(length));
      item.path.setAttribute('stroke-dashoffset', String(length));
      item.cancelDraw = runTween(
        { from: length, to: 0, duration, delay, easing: easeInOutCubic },
        (v) => item.path.setAttribute('stroke-dashoffset', String(v)),
        () => {
          item.path.removeAttribute('stroke-dasharray');
          item.path.removeAttribute('stroke-dashoffset');
          item.cancelDraw = null;
        },
      );
    }
    if (item.fill) {
      const fill = item.fill;
      fill.setAttribute('fill-opacity', '0');
      runTween(
        { from: 0, to: fillOpacity, duration: duration * 0.8, delay: delay + duration * 0.3 },
        (v) => fill.setAttribute('fill-opacity', String(v)),
      );
    }
    // Dots pop in along the draw direction.
    item.dots.forEach((d, i) => {
      d.r.set(0, { immediate: true });
      d.r.set(DOT_R, {
        delay: delay + (i / Math.max(item.dots.length - 1, 1)) * duration * 0.9,
      });
    });
  }

  protected override pointerMove(p: PointerPos | null): void {
    const inside =
      p !== null &&
      p.x >= this.plot.x - 8 &&
      p.x <= this.plot.x + this.plot.width + 8 &&
      p.y >= this.plot.y - 8 &&
      p.y <= this.plot.y + this.plot.height + 8;
    if (!inside) {
      this.clearHover();
      return;
    }
    const index = bisectClosest(this.xPositions, p.x);
    if (index < 0) {
      this.clearHover();
      return;
    }

    const labels = this.labels();
    const points: HoverPoint[] = [];
    for (const [id, item] of this.items) {
      if (item.exiting || index >= item.values.length) continue;
      const series = this.options.data.series.find((s) => s.id === id);
      points.push({
        seriesId: id,
        seriesName: series?.name ?? id,
        index,
        value: item.values[index]!,
        label: labels[index] ?? String(index),
        color: item.colorResolved,
        x: this.xPositions[index]!,
        y: this.yScale(item.geomVals[index] ?? item.values[index]!),
      });
    }
    if (points.length === 0) {
      this.clearHover();
      return;
    }

    // Active series: nearest vertically to the pointer.
    let active = points[0]!;
    for (const pt of points) {
      if (Math.abs(pt.y - p.y) < Math.abs(active.y - p.y)) active = pt;
    }

    const immediate = this.immediate();
    this.crosshair.show(active.x, this.plot, immediate);
    this.halo.setAttribute('fill', active.color);
    const firstHalo = this.hovered === null;
    this.haloX.set(active.x, { immediate: immediate || firstHalo });
    this.haloY.set(active.y, { immediate: immediate || firstHalo });
    this.haloOpacity.set(0.25, { immediate });

    for (const [id, item] of this.items) {
      item.dots.forEach((d, i) => {
        const isActive = id === active.seriesId && i === index;
        if (!item.exiting) d.r.set(isActive ? DOT_R_ACTIVE : DOT_R);
      });
    }

    this.tooltip?.show(this.tooltipContent(points, active.label), { x: active.x, y: p.y }, immediate);

    const prev = this.hovered;
    if (!prev || prev.seriesId !== active.seriesId || prev.index !== active.index) {
      if (prev) this.emitPointEvent('point:leave', prev, p);
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
    if (this.hovered) this.emitPointEvent('point:click', this.hovered, p);
  }

  private emitPointEvent(
    type: 'point:leave' | 'point:click',
    ref: { seriesId: string; index: number },
    p: PointerPos,
  ): void {
    const item = this.items.get(ref.seriesId);
    const labels = this.labels();
    this.emit(type, {
      seriesId: ref.seriesId,
      index: ref.index,
      value: item?.values[ref.index] ?? NaN,
      label: labels[ref.index] ?? String(ref.index),
      clientX: p.clientX,
      clientY: p.clientY,
    });
  }

  private clearHover(): void {
    if (this.hovered && this.lastPointer) {
      this.emitPointEvent('point:leave', this.hovered, this.lastPointer);
    }
    this.hovered = null;
    const immediate = this.immediate();
    this.crosshair.hide(immediate);
    this.tooltip?.hide(immediate);
    this.haloOpacity.set(0, { immediate });
    for (const item of this.items.values()) {
      if (!item.exiting) for (const d of item.dots) d.r.set(DOT_R);
    }
  }

  private disposeDot(dot: Dot): void {
    dot.x.destroy();
    dot.y.destroy();
    dot.r.destroy();
  }

  private disposeItem(item: SeriesItem): void {
    item.cancelDraw?.();
    item.vec.destroy();
    item.baseline.destroy();
    item.opacity.destroy();
    for (const d of item.dots) this.disposeDot(d);
    item.dots = [];
  }

  protected override teardown(): void {
    super.teardown();
    for (const item of this.items.values()) this.disposeItem(item);
    this.items.clear();
    this.haloX.destroy();
    this.haloY.destroy();
    this.haloOpacity.destroy();
  }
}
