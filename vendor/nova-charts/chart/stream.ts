import { Chart, type UpdateReason } from '../core/chart.js';
import type { BaseChartOptions, HoverPoint, Series, TooltipContent } from '../core/types.js';
import { svgEl } from '../core/svg.js';
import { keyedJoin, type JoinItem } from '../core/join.js';
import { AnimatedValue, AnimatedVec } from '../motion/animated.js';
import { stagger } from '../motion/stagger.js';
import { curveSegments, type CurveType } from '../shape/curve.js';
import { resamplePolyline } from '../interpolate/resample.js';
import { Axis } from '../component/axis.js';
import { Legend } from '../component/legend.js';
import { Tooltip } from '../component/tooltip.js';
import { PointerTracker, type PointerPos } from '../interaction/pointer.js';
import { paletteVar, resolveColor } from '../theme/theme.js';
import { fmtLabel, fmtValue, datumValue } from '../core/format.js';
import { bisectClosest } from '../interaction/nearest.js';

export interface StreamChartOptions extends BaseChartOptions {
  /** Edge smoothing (default 'catmull-rom' for the organic river look). */
  curve?: CurveType;
}

interface StreamItem extends JoinItem {
  path: SVGPathElement;
  /** Top edge points, flat [x0, y0, ...]. */
  top: AnimatedVec;
  /** Bottom edge points, flat [x0, y0, ...]. */
  bottom: AnimatedVec;
  opacity: AnimatedValue;
  values: number[];
  colorSpec: string;
  colorResolved: string;
  removeFn: (() => void) | null;
}

/**
 * Streamgraph — stacked magnitudes flowing around a symmetric centreline as
 * smooth organic ribbons. Every edge vertex is an independent spring, so the
 * whole river breathes and re-balances when the data changes. Thickness reads
 * as magnitude over time; total thickness is the running total.
 */
export class StreamChart extends Chart<StreamChartOptions> {
  private bandLayer: SVGGElement;
  private axisLayer: SVGGElement;
  private xAxis: Axis;
  private tooltip: Tooltip | null = null;
  private legendComp: Legend | null = null;
  private pointerTracker: PointerTracker;
  private items = new Map<string, StreamItem>();
  private xPositions: number[] = [];
  private hoveredId: string | null = null;
  private lastPointer: PointerPos | null = null;
  private entranceDone = false;

  constructor(el: HTMLElement, options: StreamChartOptions) {
    super(el, options);
    this.bandLayer = svgEl('g', {}, this.svg);
    this.axisLayer = svgEl('g', {}, this.svg);
    this.xAxis = new Axis(this.axisLayer, 'bottom', this.springConfig());
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
    return 'Stream';
  }

  private curve(): CurveType {
    return this.options.curve ?? 'catmull-rom';
  }

  private labels(): string[] {
    const n = Math.max(0, ...this.options.data.series.map((s) => s.data.length));
    const raw = this.options.data.labels ?? [];
    return Array.from({ length: n }, (_, i) =>
      raw[i] !== undefined ? fmtLabel(raw[i]!) : String(i + 1),
    );
  }

  private valuesOf(series: Series, n: number): number[] {
    return Array.from({ length: n }, (_, i) => {
      const d = series.data[i];
      return d === undefined ? 0 : Math.max(datumValue(d), 0);
    });
  }

  protected override update(reason: UpdateReason): void {
    const immediate = this.immediate() || reason === 'resize';
    const spring = this.springConfig();
    const labels = this.labels();
    const n = labels.length;
    const visible = this.visibleSeries();
    const midY = this.plot.y + this.plot.height / 2;

    this.xPositions = Array.from({ length: n }, (_, i) =>
      n <= 1 ? this.plot.x + this.plot.width / 2 : this.plot.x + (i / (n - 1)) * this.plot.width,
    );

    // Symmetric (silhouette) baseline: each column's stack is centred on the
    // midline, giving the organic river shape.
    const totals = Array.from({ length: n }, (_, i) =>
      visible.reduce((sum, s) => sum + this.valuesOf(s, n)[i]!, 0),
    );
    const maxTotal = Math.max(...totals, 1);
    const scale = (this.plot.height * 0.9) / maxTotal;

    // Per-column running cursor, stacked upward from the centred bottom.
    const cursor = totals.map((t) => midY + (t * scale) / 2);

    const edgesOf = (series: Series): { top: Float64Array; bottom: Float64Array } => {
      const vals = this.valuesOf(series, n);
      const top = new Float64Array(n * 2);
      const bottom = new Float64Array(n * 2);
      for (let i = 0; i < n; i++) {
        const x = this.xPositions[i]!;
        const bot = cursor[i]!;
        const t = bot - vals[i]! * scale;
        bottom[i * 2] = x;
        bottom[i * 2 + 1] = bot;
        top[i * 2] = x;
        top[i * 2 + 1] = t;
        cursor[i] = t; // next band stacks above this one
      }
      return { top, bottom };
    };

    // x-axis ticks (sampled labels).
    const maxTicks = Math.max(2, Math.floor(this.plot.width / 80));
    const stepT = Math.max(1, Math.ceil(n / maxTicks));
    const tickIdx: number[] = [];
    for (let i = 0; i < n; i += stepT) tickIdx.push(i);
    this.xAxis.update(
      tickIdx.map((i) => ({ key: labels[i]!, label: labels[i]!, pos: this.xPositions[i]! })),
      this.plot,
      this.immediate() || reason === 'resize',
    );
    this.updateLegend();

    const flatMid = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      flatMid[i * 2] = this.xPositions[i]!;
      flatMid[i * 2 + 1] = midY;
    }

    keyedJoin(
      this.items,
      visible.map((s) => [s.id, s] as const),
      {
        enter: (_key, s, si) => {
          const seriesIndex = this.options.data.series.indexOf(s);
          const spec = s.color ?? paletteVar(seriesIndex);
          const { top, bottom } = edgesOf(s);
          const path = svgEl(
            'path',
            { fill: spec, 'fill-opacity': 0.88, stroke: spec, 'stroke-width': 1, 'stroke-opacity': 0.25 },
            this.bandLayer,
          );
          const grow = !this.immediate();
          const topAV = new AnimatedVec(grow ? flatMid : top, spring);
          const botAV = new AnimatedVec(grow ? flatMid : bottom, spring);
          const opacity = new AnimatedValue(1, spring);
          const item: StreamItem = {
            path,
            top: topAV,
            bottom: botAV,
            opacity,
            values: this.valuesOf(s, n),
            colorSpec: spec,
            colorResolved: resolveColor(this.el, spec),
            removeFn: null,
          };
          const render = (): void => {
            path.setAttribute('d', this.bandPath(topAV.values, botAV.values));
          };
          topAV.onChange(render);
          botAV.onChange(render);
          topAV.onRest(() => {
            if (item.exiting) {
              path.remove();
              this.disposeItem(item);
              item.removeFn?.();
            }
          });
          opacity.onChange((v) => path.setAttribute('opacity', String(Math.max(v, 0))));
          render();
          if (grow) {
            const delay = this.entranceDone ? 0 : stagger(si, visible.length, { each: 90 });
            const delays = new Float64Array(n * 2).fill(delay);
            topAV.set(top, { delays });
            botAV.set(bottom, { delays });
          }
          return item;
        },
        update: (item, s) => {
          item.values = this.valuesOf(s, n);
          const seriesIndex = this.options.data.series.indexOf(s);
          const spec = s.color ?? paletteVar(seriesIndex);
          if (spec !== item.colorSpec) {
            item.colorSpec = spec;
            item.colorResolved = resolveColor(this.el, spec);
            item.path.setAttribute('fill', spec);
            item.path.setAttribute('stroke', spec);
          }
          const { top, bottom } = edgesOf(s);
          this.morph(item.top, top, immediate);
          this.morph(item.bottom, bottom, immediate);
          item.opacity.set(this.hoveredId === null || this.hoveredId === s.id ? 1 : 0.35, {
            immediate,
          });
        },
        exit: (item, remove) => {
          item.removeFn = remove;
          if (immediate) {
            item.path.remove();
            this.disposeItem(item);
            remove();
          } else {
            // Sink back into the centreline.
            item.top.set(flatMid, {});
            item.bottom.set(flatMid, {});
            item.opacity.set(0);
          }
        },
      },
    );
    this.entranceDone = true;
    if (this.lastPointer) this.pointerMove(this.lastPointer);
  }

  /** Retarget an edge vec, resampling first if the point count changed. */
  private morph(vec: AnimatedVec, target: Float64Array, immediate: boolean): void {
    if (immediate) {
      vec.reset(target);
      return;
    }
    if (vec.length !== target.length) {
      vec.reset(resamplePolyline(vec.values, target.length / 2));
    }
    vec.set(target, {});
  }

  private bandPath(top: ArrayLike<number>, bottom: ArrayLike<number>): string {
    // The two edges can differ in length for a single synchronous frame while
    // a resample retargets them; clamp to the shorter so we never index past
    // the end (which would emit NaN into the path).
    const n = Math.min(top.length, bottom.length) / 2;
    if (n < 2) return '';
    const curve = this.curve();
    // Take exactly n points from each edge (the top truncated to match).
    const topN = top.length / 2 === n ? top : Float64Array.prototype.slice.call(top, 0, n * 2);
    let d = `M${topN[0]},${topN[1]}` + curveSegments(topN, curve);
    // Down the right edge, then back along the bottom (reversed).
    const rev = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      rev[i * 2] = bottom[(n - 1 - i) * 2]!;
      rev[i * 2 + 1] = bottom[(n - 1 - i) * 2 + 1]!;
    }
    d += `L${rev[0]},${rev[1]}` + curveSegments(rev, curve) + 'Z';
    return d;
  }

  private updateLegend(): void {
    if (!this.legendComp) return;
    this.legendComp.update(
      this.options.data.series.map((s, i) => ({
        id: s.id,
        name: s.name ?? s.id,
        color: resolveColor(this.el, s.color ?? paletteVar(i)),
        visible: this.isSeriesVisible(s.id),
      })),
    );
  }

  private bandAt(p: PointerPos): { item: StreamItem; index: number } | null {
    if (this.xPositions.length === 0) return null;
    const index = bisectClosest(this.xPositions, p.x);
    if (index < 0) return null;
    for (const item of this.items.values()) {
      if (item.exiting) continue;
      const top = item.top.getTargets()[index * 2 + 1]!;
      const bot = item.bottom.getTargets()[index * 2 + 1]!;
      if (p.y >= top - 1 && p.y <= bot + 1) return { item, index };
    }
    return null;
  }

  private keyOf(item: StreamItem): string {
    for (const [key, value] of this.items) if (value === item) return key;
    return '';
  }

  private pointerMove(p: PointerPos | null): void {
    const hit = p ? this.bandAt(p) : null;
    const immediate = this.immediate();
    const nextId = hit ? this.keyOf(hit.item) : null;
    if (nextId !== this.hoveredId) {
      const prev = this.hoveredId ? this.items.get(this.hoveredId) : null;
      this.hoveredId = nextId;
      for (const [id, it] of this.items) {
        if (!it.exiting) it.opacity.set(nextId === null || id === nextId ? 1 : 0.35, { immediate });
      }
      if (prev && p) this.emitBand('point:leave', prev, 0, p);
      if (hit && p) this.emitBand('point:enter', hit.item, hit.index, p);
    }
    if (hit && p) {
      const labels = this.labels();
      const series = this.options.data.series.find((s) => s.id === nextId);
      const value = hit.item.values[hit.index] ?? 0;
      const total = [...this.items.values()]
        .filter((it) => !it.exiting)
        .reduce((sum, it) => sum + (it.values[hit.index] ?? 0), 0);
      const hp: HoverPoint = {
        seriesId: nextId ?? '',
        seriesName: series?.name ?? nextId ?? '',
        index: hit.index,
        value,
        label: labels[hit.index] ?? String(hit.index),
        color: hit.item.colorResolved,
        x: this.xPositions[hit.index]!,
        y: p.y,
      };
      const opt = this.options.tooltip;
      const content: TooltipContent =
        opt && typeof opt === 'object' && opt.formatter
          ? opt.formatter([hp])
          : {
              title: `${series?.name ?? nextId} · ${labels[hit.index] ?? ''}`,
              rows: [
                { color: hit.item.colorResolved, label: 'Value', value: fmtValue(value) },
                {
                  color: hit.item.colorResolved,
                  label: 'Share',
                  value: total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '—',
                },
              ],
            };
      this.tooltip?.show(content, { x: this.xPositions[hit.index]!, y: p.y }, immediate);
    } else {
      this.tooltip?.hide(immediate);
    }
  }

  private pointerClick(p: PointerPos): void {
    const hit = this.bandAt(p);
    if (hit) this.emitBand('point:click', hit.item, hit.index, p);
  }

  private emitBand(
    type: 'point:enter' | 'point:leave' | 'point:click',
    item: StreamItem,
    index: number,
    p: PointerPos,
  ): void {
    const id = this.keyOf(item);
    this.emit(type, {
      seriesId: id,
      index,
      value: item.values[index] ?? NaN,
      label: this.labels()[index] ?? String(index),
      clientX: p.clientX,
      clientY: p.clientY,
    });
  }

  private disposeItem(item: StreamItem): void {
    item.top.destroy();
    item.bottom.destroy();
    item.opacity.destroy();
  }

  protected override teardown(): void {
    this.pointerTracker.destroy();
    this.xAxis.destroy();
    this.tooltip?.destroy();
    this.legendComp?.destroy();
    for (const item of this.items.values()) this.disposeItem(item);
    this.items.clear();
  }
}
