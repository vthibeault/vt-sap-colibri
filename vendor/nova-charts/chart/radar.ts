import { Chart, type UpdateReason } from '../core/chart.js';
import type { BaseChartOptions, HoverPoint, Series } from '../core/types.js';
import { svgEl } from '../core/svg.js';
import { keyedJoin, type JoinItem } from '../core/join.js';
import { AnimatedValue, AnimatedVec } from '../motion/animated.js';
import { stagger } from '../motion/stagger.js';
import { resamplePolyline } from '../interpolate/resample.js';
import { nearestPoint2D } from '../interaction/nearest.js';
import { Tooltip } from '../component/tooltip.js';
import { Legend } from '../component/legend.js';
import { PointerTracker, type PointerPos } from '../interaction/pointer.js';
import { paletteVar, resolveColor } from '../theme/theme.js';
import { fmtValue, fmtLabel, datumValue } from '../core/format.js';
import { niceDomain } from '../scale/ticks.js';

export interface RadarChartOptions extends BaseChartOptions {
  /** Number of concentric grid rings (default 4). */
  levels?: number;
  /** Fixed value at the outer ring; defaults to the (niced) data max. */
  max?: number;
}

interface RadarSeriesItem extends JoinItem {
  g: SVGGElement;
  path: SVGPathElement;
  /** [x, y] * axisCount */
  vec: AnimatedVec;
  opacity: AnimatedValue;
  dots: SVGCircleElement[];
  values: number[];
  colorSpec: string;
  colorResolved: string;
  removeFn: (() => void) | null;
}

interface SpokeItem extends JoinItem {
  g: SVGGElement;
  opacity: AnimatedValue;
  remove?: () => void;
}

const TAU = Math.PI * 2;

function polygonPath(pts: ArrayLike<number>): string {
  const n = pts.length / 2;
  if (n < 3) return '';
  let d = `M${pts[0]},${pts[1]}`;
  for (let i = 1; i < n; i++) d += `L${pts[i * 2]},${pts[i * 2 + 1]}`;
  return d + 'Z';
}

/**
 * Radar/spider chart. Every vertex of every polygon is an independent
 * spring, so value changes make the shapes breathe around the axes.
 */
export class RadarChart extends Chart<RadarChartOptions> {
  private gridG: SVGGElement;
  private seriesG: SVGGElement;
  private hoverG: SVGGElement;
  private spokes = new Map<string, SpokeItem>();
  private rings: SVGPathElement[] = [];
  private items = new Map<string, RadarSeriesItem>();
  private tooltip: Tooltip | null = null;
  private legendComp: Legend | null = null;
  private pointerTracker: PointerTracker;
  private halo: SVGCircleElement;
  private haloX = new AnimatedValue(0, { stiffness: 260, damping: 22 });
  private haloY = new AnimatedValue(0, { stiffness: 260, damping: 22 });
  private haloOpacity = new AnimatedValue(0);
  private hovered: { seriesId: string; index: number } | null = null;
  private lastPointer: PointerPos | null = null;
  private entranceDone = false;
  private cx = 0;
  private cy = 0;
  private radius = 0;

  constructor(el: HTMLElement, options: RadarChartOptions) {
    super(el, options);
    this.gridG = svgEl('g', { class: 'nova-axis' }, this.svg);
    this.seriesG = svgEl('g', {}, this.svg);
    this.hoverG = svgEl('g', { 'pointer-events': 'none' }, this.svg);
    this.halo = svgEl('circle', { r: 9, opacity: 0 }, this.hoverG);
    this.haloX.onChange((v) => this.halo.setAttribute('cx', String(v)));
    this.haloY.onChange((v) => this.halo.setAttribute('cy', String(v)));
    this.haloOpacity.onChange((v) =>
      this.halo.setAttribute('opacity', String(Math.max(v, 0))),
    );
    if (options.tooltip !== false) this.tooltip = new Tooltip(this.overlay);
    if (options.legend ?? options.data.series.length > 1) {
      this.legendComp = new Legend(this.overlay, (id) => this.toggleSeries(id));
    }
    this.pointerTracker = new PointerTracker(
      this.svg,
      (p) => {
        this.lastPointer = p;
        this.pointerMove(p);
      },
      (p) => this.pointerClick(p),
    );
    this.bootstrap();
  }

  protected override chartType(): string {
    return 'Radar';
  }

  private axes(): string[] {
    const n = Math.max(0, ...this.options.data.series.map((s) => s.data.length));
    const raw = this.options.data.labels ?? [];
    return Array.from({ length: n }, (_, i) =>
      raw[i] !== undefined ? fmtLabel(raw[i]!) : `Axis ${i + 1}`,
    );
  }

  private valuesOf(series: Series, n: number): number[] {
    return Array.from({ length: n }, (_, i) => {
      const d = series.data[i];
      return d === undefined ? 0 : Math.max(datumValue(d), 0);
    });
  }

  private pointAt(i: number, n: number, value: number, max: number): [number, number] {
    const angle = (i / Math.max(n, 1)) * TAU;
    const r = max > 0 ? (value / max) * this.radius : 0;
    return [this.cx + r * Math.sin(angle), this.cy - r * Math.cos(angle)];
  }

  protected override update(reason: UpdateReason): void {
    const immediate = this.immediate() || reason === 'resize';
    const spring = this.springConfig();
    const axes = this.axes();
    const n = axes.length;
    const visible = this.visibleSeries();

    this.cx = this.plot.x + this.plot.width / 2;
    this.cy = this.plot.y + this.plot.height / 2;
    this.radius = Math.max(Math.min(this.plot.width, this.plot.height) / 2 - 18, 10);

    let max = this.options.max ?? 0;
    if (!this.options.max) {
      for (const s of visible) for (const v of this.valuesOf(s, n)) max = Math.max(max, v);
      max = niceDomain(0, max || 1)[1];
    }

    this.renderChrome(axes, max, immediate);

    if (this.legendComp) {
      this.legendComp.update(
        this.options.data.series.map((s, i) => ({
          id: s.id,
          name: s.name ?? s.id,
          color: resolveColor(this.el, s.color ?? paletteVar(i)),
          visible: this.isSeriesVisible(s.id),
        })),
      );
    }

    keyedJoin(this.items, visible.map((s) => [s.id, s] as const), {
      enter: (_key, s, si) => {
        const seriesIndex = this.options.data.series.indexOf(s);
        const spec = s.color ?? paletteVar(seriesIndex);
        const values = this.valuesOf(s, n);
        const target = this.targetPoints(values, max);
        const g = svgEl('g', {}, this.seriesG);
        const path = svgEl(
          'path',
          {
            fill: spec,
            'fill-opacity': 0.16,
            stroke: spec,
            'stroke-width': 2,
            'stroke-linejoin': 'round',
          },
          g,
        );
        const startCollapsed = !this.immediate();
        const center = new Float64Array(n * 2);
        for (let i = 0; i < n; i++) {
          center[i * 2] = this.cx;
          center[i * 2 + 1] = this.cy;
        }
        const vec = new AnimatedVec(startCollapsed ? center : target, spring);
        const opacity = new AnimatedValue(1, spring);
        const item: RadarSeriesItem = {
          g,
          path,
          vec,
          opacity,
          dots: [],
          values,
          colorSpec: spec,
          colorResolved: resolveColor(this.el, spec),
          removeFn: null,
        };
        vec.onChange((pts) => {
          path.setAttribute('d', polygonPath(pts));
          item.dots.forEach((c, i) => {
            c.setAttribute('cx', String(pts[i * 2] ?? this.cx));
            c.setAttribute('cy', String(pts[i * 2 + 1] ?? this.cy));
          });
        });
        opacity.onChange((v) => {
          g.setAttribute('opacity', String(Math.max(v, 0)));
          if (item.exiting && v < 0.02) {
            g.remove();
            item.removeFn?.();
          }
        });
        this.syncDots(item, n);
        if (startCollapsed) {
          const delays = new Float64Array(n * 2);
          for (let i = 0; i < n; i++) {
            const d =
              (this.entranceDone ? 0 : si * 140) + stagger(i, n, { each: this.entranceDone ? 0 : 35 });
            delays[i * 2] = d;
            delays[i * 2 + 1] = d;
          }
          vec.set(target, { delays });
        } else {
          vec.reset(target);
        }
        return item;
      },
      update: (item, s) => {
        const values = this.valuesOf(s, n);
        item.values = values;
        item.opacity.set(1, { immediate });
        const target = this.targetPoints(values, max);
        if (immediate) {
          item.vec.reset(target);
        } else {
          if (item.vec.length !== target.length) {
            item.vec.reset(resamplePolyline(item.vec.values, n));
          }
          const delays = new Float64Array(n * 2);
          for (let i = 0; i < n; i++) {
            const d = stagger(i, n, { each: 12 });
            delays[i * 2] = d;
            delays[i * 2 + 1] = d;
          }
          item.vec.set(target, { delays });
        }
        this.syncDots(item, n);
      },
      exit: (item, remove) => {
        item.removeFn = remove;
        if (immediate) {
          item.g.remove();
          this.disposeItem(item);
          remove();
        } else {
          item.opacity.set(0);
        }
      },
    });
    this.entranceDone = true;
    if (this.lastPointer) this.pointerMove(this.lastPointer);
  }

  private targetPoints(values: number[], max: number): Float64Array {
    const n = values.length;
    const out = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      const [x, y] = this.pointAt(i, n, values[i]!, max);
      out[i * 2] = x;
      out[i * 2 + 1] = y;
    }
    return out;
  }

  private syncDots(item: RadarSeriesItem, n: number): void {
    while (item.dots.length > n) item.dots.pop()!.remove();
    while (item.dots.length < n) {
      item.dots.push(svgEl('circle', { r: 3, fill: item.colorSpec }, item.g));
    }
  }

  private renderChrome(axes: string[], max: number, immediate: boolean): void {
    const n = axes.length;
    const levels = this.options.levels ?? 4;

    // Concentric rings (polygons matching the axis count).
    while (this.rings.length > levels) this.rings.pop()!.remove();
    while (this.rings.length < levels) {
      this.rings.push(
        svgEl('path', { fill: 'none', stroke: 'var(--nova-grid)' }, this.gridG),
      );
    }
    this.rings.forEach((ring, li) => {
      const f = (li + 1) / levels;
      const pts = new Float64Array(n * 2);
      for (let i = 0; i < n; i++) {
        const [x, y] = this.pointAt(i, n, f * max, max);
        pts[i * 2] = x;
        pts[i * 2 + 1] = y;
      }
      ring.setAttribute('d', polygonPath(pts));
    });

    // Spokes + axis labels, keyed by label so axis changes fade in/out.
    keyedJoin(this.spokes, axes.map((a, i) => [a, { label: a, i }] as const), {
      enter: (_key, d) => {
        const g = svgEl('g', {}, this.gridG);
        const [x, y] = this.pointAt(d.i, n, max, max);
        svgEl('line', { x1: this.cx, y1: this.cy, x2: x, y2: y, stroke: 'var(--nova-grid)' }, g);
        const [lx, ly] = this.pointAt(d.i, n, max * 1.12, max);
        const text = svgEl('text', { x: lx, y: ly, 'text-anchor': 'middle', dy: '0.32em' }, g);
        text.textContent = d.label;
        const opacity = new AnimatedValue(0, this.springConfig());
        const item: SpokeItem = { g, opacity };
        opacity.onChange((v) => {
          g.setAttribute('opacity', String(Math.max(v, 0)));
          if (item.exiting && v < 0.02) {
            g.remove();
            item.remove?.();
          }
        });
        opacity.set(1, { immediate });
        return item;
      },
      update: (item, d) => {
        const [x, y] = this.pointAt(d.i, n, max, max);
        const line = item.g.querySelector('line')!;
        line.setAttribute('x1', String(this.cx));
        line.setAttribute('y1', String(this.cy));
        line.setAttribute('x2', String(x));
        line.setAttribute('y2', String(y));
        const [lx, ly] = this.pointAt(d.i, n, max * 1.12, max);
        const text = item.g.querySelector('text')!;
        text.setAttribute('x', String(lx));
        text.setAttribute('y', String(ly));
        item.opacity.set(1, { immediate });
      },
      exit: (item, remove) => {
        item.remove = remove;
        if (immediate) {
          item.g.remove();
          remove();
        } else {
          item.opacity.set(0);
        }
      },
    });
  }

  private pointerMove(p: PointerPos | null): void {
    if (p === null) {
      this.clearHover();
      return;
    }
    const axes = this.axes();
    const entries: { item: RadarSeriesItem; id: string; index: number; x: number; y: number }[] = [];
    for (const [id, item] of this.items) {
      if (item.exiting) continue;
      const t = item.vec.getTargets();
      for (let i = 0; i < item.values.length; i++) {
        entries.push({ item, id, index: i, x: t[i * 2]!, y: t[i * 2 + 1]! });
      }
    }
    const idx = nearestPoint2D(
      entries.map((e) => e.x),
      entries.map((e) => e.y),
      p.x,
      p.y,
      30,
    );
    if (idx < 0) {
      this.clearHover();
      return;
    }
    const active = entries[idx]!;
    const label = axes[active.index] ?? String(active.index);
    const immediate = this.immediate();

    const points: HoverPoint[] = [];
    for (const [id, item] of this.items) {
      if (item.exiting || active.index >= item.values.length) continue;
      const series = this.options.data.series.find((s) => s.id === id);
      points.push({
        seriesId: id,
        seriesName: series?.name ?? id,
        index: active.index,
        value: item.values[active.index]!,
        label,
        color: item.colorResolved,
        x: item.vec.getTargets()[active.index * 2]!,
        y: item.vec.getTargets()[active.index * 2 + 1]!,
      });
    }

    this.halo.setAttribute('fill', active.item.colorResolved);
    const firstHalo = this.hovered === null;
    this.haloX.set(active.x, { immediate: immediate || firstHalo });
    this.haloY.set(active.y, { immediate: immediate || firstHalo });
    this.haloOpacity.set(0.25, { immediate });

    const t = this.options.tooltip;
    const content =
      t && typeof t === 'object' && t.formatter
        ? t.formatter(points)
        : {
            title: label,
            rows: points.map((pt) => ({
              color: pt.color,
              label: pt.seriesName,
              value: fmtValue(pt.value),
            })),
          };
    this.tooltip?.show(content, { x: active.x, y: active.y }, immediate);

    const prev = this.hovered;
    if (!prev || prev.seriesId !== active.id || prev.index !== active.index) {
      if (prev) this.emitPoint('point:leave', prev, p);
      this.hovered = { seriesId: active.id, index: active.index };
      this.emitPoint('point:enter', this.hovered, p);
    }
  }

  private pointerClick(p: PointerPos): void {
    if (this.hovered) this.emitPoint('point:click', this.hovered, p);
  }

  private emitPoint(
    type: 'point:enter' | 'point:leave' | 'point:click',
    ref: { seriesId: string; index: number },
    p: PointerPos,
  ): void {
    const item = this.items.get(ref.seriesId);
    this.emit(type, {
      seriesId: ref.seriesId,
      index: ref.index,
      value: item?.values[ref.index] ?? NaN,
      label: this.axes()[ref.index] ?? String(ref.index),
      clientX: p.clientX,
      clientY: p.clientY,
    });
  }

  private clearHover(): void {
    if (this.hovered && this.lastPointer) {
      this.emitPoint('point:leave', this.hovered, this.lastPointer);
    }
    this.hovered = null;
    const immediate = this.immediate();
    this.tooltip?.hide(immediate);
    this.haloOpacity.set(0, { immediate });
  }

  private disposeItem(item: RadarSeriesItem): void {
    item.vec.destroy();
    item.opacity.destroy();
  }

  protected override teardown(): void {
    this.pointerTracker.destroy();
    this.tooltip?.destroy();
    this.legendComp?.destroy();
    for (const item of this.items.values()) this.disposeItem(item);
    this.items.clear();
    for (const s of this.spokes.values()) s.opacity.destroy();
    this.spokes.clear();
    this.haloX.destroy();
    this.haloY.destroy();
    this.haloOpacity.destroy();
  }
}
