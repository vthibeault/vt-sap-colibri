import { Chart, type UpdateReason } from '../core/chart.js';
import type { BaseChartOptions, HoverPoint, TooltipContent } from '../core/types.js';
import { svgEl } from '../core/svg.js';
import { keyedJoin, type JoinItem } from '../core/join.js';
import { AnimatedValue, AnimatedVec } from '../motion/animated.js';
import { buildArcPath, arcCentroid } from '../shape/arc.js';
import { Tooltip } from '../component/tooltip.js';
import { Legend } from '../component/legend.js';
import { PointerTracker, type PointerPos } from '../interaction/pointer.js';
import { paletteVar, resolveColor } from '../theme/theme.js';
import { fmtValue, fmtLabel, datumValue } from '../core/format.js';
import { niceDomain } from '../scale/ticks.js';

export interface PolarAreaChartOptions extends BaseChartOptions {
  /** Number of concentric grid rings (default 4). */
  levels?: number;
  /** Fixed value at the outer ring; defaults to the (niced) data max. */
  max?: number;
  /** Constant-width gap between petals, in pixels (default 2). */
  padPx?: number;
}

interface SliceItem extends JoinItem {
  path: SVGPathElement;
  /** [startAngle, endAngle, innerR, outerR] */
  vec: AnimatedVec;
  opacity: AnimatedValue;
  label: string;
  value: number;
  colorResolved: string;
  removeFn: (() => void) | null;
}

const TAU = Math.PI * 2;
const HOVER_POP = 8;

/**
 * Polar-area (rose) chart: equal-angle slices whose radii encode the values.
 * Value changes make the petals breathe in and out on springs; toggling a
 * slice re-spans the remaining angles around the circle.
 */
export class PolarAreaChart extends Chart<PolarAreaChartOptions> {
  private gridG: SVGGElement;
  private slicesLayer: SVGGElement;
  private rings: SVGCircleElement[] = [];
  private slices = new Map<string, SliceItem>();
  private tooltip: Tooltip | null = null;
  private legendComp: Legend | null = null;
  private pointerTracker: PointerTracker;
  private hoveredKey: string | null = null;
  private baseOuter = new Map<string, number>();
  private lastPointer: PointerPos | null = null;
  private entranceDone = false;
  private cx = 0;
  private cy = 0;
  private radius = 0;

  constructor(el: HTMLElement, options: PolarAreaChartOptions) {
    super(el, options);
    this.gridG = svgEl('g', {}, this.svg);
    this.slicesLayer = svgEl('g', {}, this.svg);
    if (options.tooltip !== false) this.tooltip = new Tooltip(this.overlay);
    if (options.legend !== false) {
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
    return 'Polar area';
  }

  protected override ariaLabel(): string {
    return this.options.ariaLabel ?? `Polar area chart, ${this.sliceData().length} slices`;
  }

  private sliceData(): { key: string; label: string; value: number; color: string }[] {
    const series = this.options.data.series[0];
    if (!series) return [];
    const labels = this.options.data.labels ?? [];
    return series.data.map((d, i) => {
      const label = labels[i] !== undefined ? fmtLabel(labels[i]!) : `Slice ${i + 1}`;
      return {
        key: label,
        label,
        value: Math.max(datumValue(d), 0),
        color: paletteVar(i),
      };
    });
  }

  protected override update(reason: UpdateReason): void {
    const immediate = this.immediate() || reason === 'resize';
    // Petal angles are in radians; tighten the rest threshold so springs
    // resolve smoothly instead of snapping the last few degrees.
    const spring = { ...this.springConfig(), restDelta: 0.0012, restSpeed: 0.08 };
    const slices = this.sliceData();

    this.cx = this.plot.x + this.plot.width / 2;
    this.cy = this.plot.y + this.plot.height / 2;
    this.radius = Math.max(
      Math.min(this.plot.width, this.plot.height) / 2 - HOVER_POP - 4,
      10,
    );

    let max = this.options.max ?? 0;
    if (!this.options.max) {
      for (const s of slices) {
        if (this.isSeriesVisible(s.key)) max = Math.max(max, s.value);
      }
      max = niceDomain(0, max || 1)[1];
    }
    const radiusOf = (value: number): number =>
      max > 0 ? (value / max) * this.radius : 0;

    // Concentric ring grid.
    const levels = this.options.levels ?? 4;
    while (this.rings.length > levels) this.rings.pop()!.remove();
    while (this.rings.length < levels) {
      this.rings.push(
        svgEl('circle', { fill: 'none', stroke: 'var(--nova-grid)' }, this.gridG),
      );
    }
    this.rings.forEach((ring, li) => {
      ring.setAttribute('cx', String(this.cx));
      ring.setAttribute('cy', String(this.cy));
      ring.setAttribute('r', String(((li + 1) / levels) * this.radius));
    });

    this.legendComp?.update(
      slices.map((s) => ({
        id: s.key,
        name: s.label,
        color: resolveColor(this.el, s.color),
        visible: this.isSeriesVisible(s.key),
      })),
    );

    // Equal angles across visible slices; hidden ones collapse in place.
    const visibleCount = slices.filter((s) => this.isSeriesVisible(s.key)).length;
    const extent = visibleCount > 0 ? TAU / visibleCount : 0;
    let cum = 0;
    const layout = slices.map((s) => {
      const visible = this.isSeriesVisible(s.key);
      const start = cum;
      if (visible) cum += extent;
      return { ...s, start, end: cum, visible };
    });
    const pad = this.options.padPx ?? 2;
    this.baseOuter = new Map(
      layout.map((l) => [l.key, l.visible ? radiusOf(l.value) : 0] as const),
    );

    keyedJoin(this.slices, layout.map((l) => [l.key, l] as const), {
      enter: (_key, l, i) => {
        const path = svgEl('path', { fill: l.color, 'fill-opacity': 0.85 }, this.slicesLayer);
        const outer = l.visible ? radiusOf(l.value) : 0;
        const vec = new AnimatedVec(
          [l.start, l.end, 0, this.entranceDone || this.immediate() ? outer : 0],
          spring,
        );
        const opacity = new AnimatedValue(1, spring);
        const item: SliceItem = {
          path,
          vec,
          opacity,
          label: l.label,
          value: l.value,
          colorResolved: resolveColor(this.el, l.color),
          removeFn: null,
        };
        vec.onChange((v) => {
          path.setAttribute(
            'd',
            buildArcPath({
              cx: this.cx,
              cy: this.cy,
              startAngle: v[0]!,
              endAngle: v[1]!,
              innerRadius: Math.max(v[2]!, 0),
              outerRadius: Math.max(v[3]!, 0),
              padPx: pad,
            }),
          );
        });
        vec.onRest(() => {
          if (item.exiting) {
            path.remove();
            this.disposeSlice(item);
            item.removeFn?.();
          }
        });
        opacity.onChange((v) => path.setAttribute('opacity', String(Math.max(v, 0))));
        vec.reset(vec.values);
        if (!this.entranceDone && !this.immediate()) {
          // Petals pop outward around the circle.
          const delay = i * 70;
          vec.set([l.start, l.end, 0, outer], {
            delays: Float64Array.of(delay, delay, delay, delay),
          });
        }
        return item;
      },
      update: (item, l) => {
        item.value = l.value;
        item.colorResolved = resolveColor(this.el, l.color);
        item.path.setAttribute('fill', l.color);
        const pop = this.hoveredKey === l.key && l.visible ? HOVER_POP : 0;
        const outer = l.visible ? radiusOf(l.value) + pop : 0;
        item.vec.set([l.start, l.end, 0, outer], { immediate });
        item.opacity.set(1, { immediate });
      },
      exit: (item, remove) => {
        item.removeFn = remove;
        if (immediate) {
          item.path.remove();
          this.disposeSlice(item);
          remove();
        } else {
          const t = item.vec.getTargets();
          item.vec.set([t[0]!, t[1]!, 0, 0]);
          item.opacity.set(0);
        }
      },
    });
    this.entranceDone = true;
    if (this.lastPointer) this.pointerMove(this.lastPointer);
  }

  private sliceAt(p: PointerPos): SliceItem | null {
    const dx = p.x - this.cx;
    const dy = p.y - this.cy;
    const dist = Math.hypot(dx, dy);
    if (dist > this.radius + HOVER_POP + 6) return null;
    let angle = Math.atan2(dx, -dy);
    if (angle < 0) angle += TAU;
    for (const item of this.slices.values()) {
      if (item.exiting) continue;
      const t = item.vec.getTargets();
      if (t[1]! - t[0]! > 1e-6 && angle >= t[0]! && angle < t[1]! && dist <= t[3]! + 6) {
        return item;
      }
    }
    return null;
  }

  private keyOf(item: SliceItem): string {
    for (const [key, value] of this.slices) if (value === item) return key;
    return item.label;
  }

  private pointerMove(p: PointerPos | null): void {
    const item = p ? this.sliceAt(p) : null;
    const immediate = this.immediate();
    const nextKey = item ? this.keyOf(item) : null;

    if (nextKey !== this.hoveredKey) {
      const prev = this.hoveredKey ? this.slices.get(this.hoveredKey) : null;
      this.hoveredKey = nextKey;
      for (const [key, s] of this.slices) {
        if (s.exiting) continue;
        const t = s.vec.getTargets();
        const active = key === nextKey;
        const base = this.baseOuter.get(key) ?? t[3]!;
        s.vec.set([t[0]!, t[1]!, 0, base + (active ? HOVER_POP : 0)], { immediate });
        s.opacity.set(nextKey === null || active ? 1 : 0.55, { immediate });
      }
      if (prev && p) this.emitPoint('point:leave', prev, p);
      if (item && p) this.emitPoint('point:enter', item, p);
    }

    if (item && p) {
      const total = [...this.slices.values()]
        .filter((s) => !s.exiting)
        .reduce((sum, s) => sum + s.value, 0);
      const t = item.vec.getTargets();
      const [ax, ay] = arcCentroid({
        cx: this.cx,
        cy: this.cy,
        startAngle: t[0]!,
        endAngle: t[1]!,
        innerRadius: 0,
        outerRadius: t[3]!,
      });
      const hp: HoverPoint = {
        seriesId: item.label,
        seriesName: item.label,
        index: 0,
        value: item.value,
        label: item.label,
        color: item.colorResolved,
        x: ax,
        y: ay,
      };
      const opt = this.options.tooltip;
      const content: TooltipContent =
        opt && typeof opt === 'object' && opt.formatter
          ? opt.formatter([hp])
          : {
              title: item.label,
              rows: [
                { color: item.colorResolved, label: 'Value', value: fmtValue(item.value) },
                {
                  color: item.colorResolved,
                  label: 'Share',
                  value: total > 0 ? `${((item.value / total) * 100).toFixed(1)}%` : '—',
                },
              ],
            };
      this.tooltip?.show(content, { x: ax, y: ay }, immediate);
    } else {
      this.tooltip?.hide(immediate);
    }
  }

  private pointerClick(p: PointerPos): void {
    const item = this.sliceAt(p);
    if (item) this.emitPoint('point:click', item, p);
  }

  private emitPoint(
    type: 'point:enter' | 'point:leave' | 'point:click',
    item: SliceItem,
    p: PointerPos,
  ): void {
    this.emit(type, {
      seriesId: item.label,
      index: this.sliceData().findIndex((s) => s.key === this.keyOf(item)),
      value: item.value,
      label: item.label,
      clientX: p.clientX,
      clientY: p.clientY,
    });
  }

  private disposeSlice(item: SliceItem): void {
    item.vec.destroy();
    item.opacity.destroy();
  }

  protected override teardown(): void {
    this.pointerTracker.destroy();
    this.tooltip?.destroy();
    this.legendComp?.destroy();
    for (const s of this.slices.values()) this.disposeSlice(s);
    this.slices.clear();
  }
}
