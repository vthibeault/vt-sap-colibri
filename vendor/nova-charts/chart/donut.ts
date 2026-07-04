import { Chart, type UpdateReason } from '../core/chart.js';
import type { BaseChartOptions, HoverPoint, TooltipContent } from '../core/types.js';
import { svgEl } from '../core/svg.js';
import { keyedJoin, type JoinItem } from '../core/join.js';
import { AnimatedValue, AnimatedVec } from '../motion/animated.js';
import { runTween } from '../motion/tween.js';
import { buildArcPath, arcCentroid } from '../shape/arc.js';
import { Tooltip } from '../component/tooltip.js';
import { Legend } from '../component/legend.js';
import { PointerTracker, type PointerPos } from '../interaction/pointer.js';
import { paletteVar, resolveColor } from '../theme/theme.js';
import { fmtValue, fmtLabel, datumValue } from '../core/format.js';

export interface DonutChartOptions extends BaseChartOptions {
  /** Inner radius as a fraction of the outer radius; 0 makes a pie. */
  innerRadius?: number;
  /** Constant-width gap between slices, in pixels (default 2). */
  padPx?: number;
  /** Show the animated total in the center (donut only). */
  centerLabel?: boolean;
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
 * Donut/pie chart. Slices are driven entirely in angle space — arc paths are
 * rebuilt from animated angles each frame, never string-morphed. Toggling a
 * slice collapses it while the others spring around the ring to re-span it.
 */
export class DonutChart extends Chart<DonutChartOptions> {
  private slicesLayer: SVGGElement;
  private slices = new Map<string, SliceItem>();
  private tooltip: Tooltip | null = null;
  private legendComp: Legend | null = null;
  private pointerTracker: PointerTracker;
  private centerText: SVGTextElement | null = null;
  private centerValue = 0;
  private cancelCount: (() => void) | null = null;
  private hoveredKey: string | null = null;
  private lastPointer: PointerPos | null = null;
  private entranceDone = false;
  private cx = 0;
  private cy = 0;
  private outerR = 0;
  private innerR = 0;

  constructor(el: HTMLElement, options: DonutChartOptions) {
    super(el, options);
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
    return this.innerFraction() > 0 ? 'Donut' : 'Pie';
  }

  protected override ariaLabel(): string {
    if (this.options.ariaLabel) return this.options.ariaLabel;
    return `${this.chartType()} chart, ${this.sliceData().length} slices`;
  }

  private innerFraction(): number {
    return this.options.innerRadius ?? 0.62;
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
    // Slices animate in radians, so the default pixel rest threshold (0.05)
    // would let springs settle ~3° short and snap. Tighten it so the motion
    // resolves smoothly all the way to the target.
    const spring = { ...this.springConfig(), restDelta: 0.0012, restSpeed: 0.08 };
    const slices = this.sliceData();

    this.cx = this.plot.x + this.plot.width / 2;
    this.cy = this.plot.y + this.plot.height / 2;
    this.outerR = Math.max(Math.min(this.plot.width, this.plot.height) / 2 - HOVER_POP, 10);
    this.innerR = this.outerR * this.innerFraction();

    this.legendComp?.update(
      slices.map((s) => ({
        id: s.key,
        name: s.label,
        color: resolveColor(this.el, s.color),
        visible: this.isSeriesVisible(s.key),
      })),
    );

    // Lay out the full ring across visible slices; hidden ones collapse to
    // a zero-width wedge at the point where they'd reopen.
    const visibleTotal = slices.reduce(
      (sum, s) => (this.isSeriesVisible(s.key) ? sum + s.value : sum),
      0,
    );
    let cum = 0;
    const layout = slices.map((s) => {
      const visible = this.isSeriesVisible(s.key) && visibleTotal > 0;
      const extent = visible ? (s.value / visibleTotal) * TAU : 0;
      const start = cum;
      cum += extent;
      return { ...s, start, end: cum, visible };
    });

    const pad = this.options.padPx ?? 2;

    keyedJoin(this.slices, layout.map((l) => [l.key, l] as const), {
      enter: (_key, l, i) => {
        const path = svgEl('path', { fill: l.color, stroke: 'none' }, this.slicesLayer);
        const vec = new AnimatedVec(
          [l.start, this.entranceDone ? l.start : 0, this.innerR, this.outerR],
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
        if (immediate) {
          vec.reset([l.start, l.end, this.innerR, this.outerR]);
        } else {
          // Clockwise sweep: each slice starts growing as the previous one
          // finishes its share of the circle.
          const delay = this.entranceDone
            ? 0
            : (l.start / TAU) * this.enterDuration() * 0.6 + i * 20;
          vec.set([l.start, l.end, this.innerR, this.outerR], {
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
        item.vec.set([l.start, l.end, this.innerR, this.outerR + pop], { immediate });
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
          const mid = (t[0]! + t[1]!) / 2;
          item.vec.set([mid, mid, t[2]!, t[3]!]);
          item.opacity.set(0);
        }
      },
    });

    this.updateCenterLabel(visibleTotal, immediate);
    this.entranceDone = true;
    if (this.lastPointer) this.pointerMove(this.lastPointer);
  }

  private updateCenterLabel(total: number, immediate: boolean): void {
    const wanted = (this.options.centerLabel ?? true) && this.innerFraction() > 0.3;
    if (!wanted) {
      this.centerText?.remove();
      this.centerText = null;
      return;
    }
    if (!this.centerText) {
      this.centerText = svgEl(
        'text',
        {
          'text-anchor': 'middle',
          dy: '0.35em',
          fill: 'var(--nova-fg)',
          'font-size': 24,
          'font-weight': 700,
        },
        this.svg,
      );
      this.centerValue = 0;
    }
    this.centerText.setAttribute('x', String(this.cx));
    this.centerText.setAttribute('y', String(this.cy));
    this.cancelCount?.();
    if (immediate) {
      this.centerValue = total;
      this.centerText.textContent = fmtValue(Math.round(total));
      return;
    }
    // Count up/down to the new total alongside the slice morph.
    this.cancelCount = runTween(
      { from: this.centerValue, to: total, duration: 700 },
      (v) => {
        this.centerValue = v;
        this.centerText!.textContent = fmtValue(Math.round(v));
      },
      () => (this.cancelCount = null),
    );
  }

  private sliceAt(p: PointerPos): SliceItem | null {
    const dx = p.x - this.cx;
    const dy = p.y - this.cy;
    const dist = Math.hypot(dx, dy);
    if (dist < this.innerR - 6 || dist > this.outerR + HOVER_POP + 6) return null;
    let angle = Math.atan2(dx, -dy);
    if (angle < 0) angle += TAU;
    for (const item of this.slices.values()) {
      if (item.exiting) continue;
      const t = item.vec.getTargets();
      if (t[1]! - t[0]! > 1e-6 && angle >= t[0]! && angle < t[1]!) return item;
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
        s.vec.set([t[0]!, t[1]!, t[2]!, this.outerR + (active ? HOVER_POP : 0)], {
          immediate,
        });
        s.opacity.set(nextKey === null || active ? 1 : 0.55, { immediate });
      }
      if (prev && p) this.emit('point:leave', this.eventOf(prev, p));
      if (item) this.emit('point:enter', this.eventOf(item, p!));
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
        innerRadius: this.innerR,
        outerRadius: this.outerR,
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
    if (item) this.emit('point:click', this.eventOf(item, p));
  }

  private eventOf(item: SliceItem, p: PointerPos) {
    return {
      seriesId: item.label,
      index: this.sliceData().findIndex((s) => s.key === this.keyOf(item)),
      value: item.value,
      label: item.label,
      clientX: p.clientX,
      clientY: p.clientY,
    };
  }

  private disposeSlice(item: SliceItem): void {
    item.vec.destroy();
    item.opacity.destroy();
  }

  protected override teardown(): void {
    this.pointerTracker.destroy();
    this.tooltip?.destroy();
    this.legendComp?.destroy();
    this.cancelCount?.();
    for (const s of this.slices.values()) this.disposeSlice(s);
    this.slices.clear();
  }
}
