import { Chart, type UpdateReason } from '../core/chart.js';
import type { BaseChartOptions, HoverPoint, TooltipContent } from '../core/types.js';
import { svgEl } from '../core/svg.js';
import { keyedJoin, type JoinItem } from '../core/join.js';
import { AnimatedValue, AnimatedVec } from '../motion/animated.js';
import { Tooltip } from '../component/tooltip.js';
import { PointerTracker, type PointerPos } from '../interaction/pointer.js';
import { paletteVar, resolveColor } from '../theme/theme.js';
import { fmtValue, fmtLabel, datumValue } from '../core/format.js';

export interface FunnelChartOptions extends BaseChartOptions {
  /** Vertical gap between stages in px (default 4). */
  gap?: number;
}

interface StageItem extends JoinItem {
  g: SVGGElement;
  path: SVGPathElement;
  /** [topW, bottomW, y, h] */
  vec: AnimatedVec;
  opacity: AnimatedValue;
  name: SVGTextElement;
  detail: SVGTextElement;
  label: string;
  value: number;
  colorResolved: string;
  removeFn: (() => void) | null;
}

/**
 * Funnel chart: stages as centered trapezoids whose widths spring with the
 * values. Each stage's bottom edge meets the next stage's top, so the whole
 * funnel reflows as one shape when data changes.
 */
export class FunnelChart extends Chart<FunnelChartOptions> {
  private layer: SVGGElement;
  private stages = new Map<string, StageItem>();
  private tooltip: Tooltip | null = null;
  private pointerTracker: PointerTracker;
  private hoveredKey: string | null = null;
  private lastPointer: PointerPos | null = null;
  private entranceDone = false;

  constructor(el: HTMLElement, options: FunnelChartOptions) {
    super(el, options);
    this.layer = svgEl('g', {}, this.svg);
    if (options.tooltip !== false) this.tooltip = new Tooltip(this.overlay);
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
    return 'Funnel';
  }

  protected override ariaLabel(): string {
    return this.options.ariaLabel ?? `Funnel chart, ${this.stageData().length} stages`;
  }

  private stageData(): { key: string; label: string; value: number; color: string }[] {
    const series = this.options.data.series[0];
    if (!series) return [];
    const labels = this.options.data.labels ?? [];
    return series.data.map((d, i) => {
      const label = labels[i] !== undefined ? fmtLabel(labels[i]!) : `Stage ${i + 1}`;
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
    const spring = this.springConfig();
    const stages = this.stageData();
    const count = stages.length;
    const gap = this.options.gap ?? 4;
    const max = Math.max(...stages.map((s) => s.value), 1);
    const cx = this.plot.x + this.plot.width / 2;
    const stageH =
      count > 0 ? (this.plot.height - gap * Math.max(count - 1, 0)) / count : 0;
    const widthOf = (value: number): number => (value / max) * this.plot.width;

    keyedJoin(
      this.stages,
      stages.map((s, i) => {
        const topW = widthOf(s.value);
        const next = stages[i + 1];
        const bottomW = next ? widthOf(next.value) : topW;
        const y = this.plot.y + i * (stageH + gap);
        return [s.key, { ...s, i, topW, bottomW, y }] as const;
      }),
      {
        enter: (_key, d, i) => {
          const g = svgEl('g', {}, this.layer);
          const path = svgEl('path', { fill: d.color, 'fill-opacity': 0.88 }, g);
          const name = svgEl(
            'text',
            { 'text-anchor': 'middle', fill: '#fff', 'font-size': 12, 'font-weight': 600 },
            g,
          );
          const detail = svgEl(
            'text',
            { 'text-anchor': 'middle', fill: '#fff', 'font-size': 11, opacity: 0.75 },
            g,
          );
          const fromZero = !this.immediate() && !this.entranceDone;
          const vec = new AnimatedVec(
            fromZero ? [0, 0, d.y, stageH] : [d.topW, d.bottomW, d.y, stageH],
            spring,
          );
          const opacity = new AnimatedValue(this.entranceDone && !this.immediate() ? 0 : 1, spring);
          const item: StageItem = {
            g,
            path,
            vec,
            opacity,
            name,
            detail,
            label: d.label,
            value: d.value,
            colorResolved: resolveColor(this.el, d.color),
            removeFn: null,
          };
          vec.onChange((v) => this.renderStage(item, v, cx));
          opacity.onChange((v) => {
            g.setAttribute('opacity', String(Math.max(v, 0)));
            if (item.exiting && v < 0.02) {
              g.remove();
              item.removeFn?.();
            }
          });
          vec.reset(vec.values);
          if (fromZero) {
            // Cascade open from the top of the funnel.
            const delay = i * 90;
            vec.set([d.topW, d.bottomW, d.y, stageH], {
              delays: Float64Array.of(delay, delay, delay, delay),
            });
          } else if (!this.immediate()) {
            opacity.set(1);
          }
          this.renderText(item, d.value, stages[0]?.value ?? 0, d.i, stages);
          return item;
        },
        update: (item, d) => {
          item.value = d.value;
          item.colorResolved = resolveColor(this.el, d.color);
          item.path.setAttribute('fill', d.color);
          item.vec.set([d.topW, d.bottomW, d.y, stageH], { immediate });
          item.opacity.set(this.hoveredKey === null || this.hoveredKey === d.key ? 1 : 0.6, {
            immediate,
          });
          this.renderText(item, d.value, stages[0]?.value ?? 0, d.i, stages);
        },
        exit: (item, remove) => {
          item.removeFn = remove;
          if (immediate) {
            item.g.remove();
            this.disposeStage(item);
            remove();
          } else {
            const t = item.vec.getTargets();
            item.vec.set([0, 0, t[2]!, t[3]!]);
            item.opacity.set(0);
          }
        },
      },
    );
    this.entranceDone = true;
    if (this.lastPointer) this.pointerMove(this.lastPointer);
  }

  private renderStage(item: StageItem, v: Float64Array, cx: number): void {
    const topW = Math.max(v[0]!, 0);
    const botW = Math.max(v[1]!, 0);
    const y = v[2]!;
    const h = Math.max(v[3]!, 0);
    item.path.setAttribute(
      'd',
      `M${cx - topW / 2},${y}L${cx + topW / 2},${y}L${cx + botW / 2},${y + h}L${
        cx - botW / 2
      },${y + h}Z`,
    );
    item.name.setAttribute('x', String(cx));
    item.name.setAttribute('y', String(y + h / 2 - 3));
    item.detail.setAttribute('x', String(cx));
    item.detail.setAttribute('y', String(y + h / 2 + 13));
  }

  private renderText(
    item: StageItem,
    value: number,
    first: number,
    index: number,
    stages: { value: number }[],
  ): void {
    item.name.textContent = item.label;
    const ofFirst = first > 0 ? `${((value / first) * 100).toFixed(0)}%` : '—';
    const prev = index > 0 ? stages[index - 1]?.value ?? 0 : 0;
    const ofPrev =
      index > 0 && prev > 0 ? ` · ${((value / prev) * 100).toFixed(0)}% of prev` : '';
    item.detail.textContent = `${fmtValue(value)} · ${ofFirst}${ofPrev}`;
  }

  private stageAt(p: PointerPos): StageItem | null {
    for (const item of this.stages.values()) {
      if (item.exiting) continue;
      const t = item.vec.getTargets();
      const y = t[2]!;
      const h = t[3]!;
      const w = Math.max(t[0]!, t[1]!);
      const cx = this.plot.x + this.plot.width / 2;
      if (p.y >= y && p.y <= y + h && Math.abs(p.x - cx) <= w / 2 + 6) return item;
    }
    return null;
  }

  private keyOf(item: StageItem): string {
    for (const [key, value] of this.stages) if (value === item) return key;
    return item.label;
  }

  private pointerMove(p: PointerPos | null): void {
    const item = p ? this.stageAt(p) : null;
    const immediate = this.immediate();
    const nextKey = item ? this.keyOf(item) : null;
    if (nextKey !== this.hoveredKey) {
      const prev = this.hoveredKey ? this.stages.get(this.hoveredKey) : null;
      this.hoveredKey = nextKey;
      for (const [key, s] of this.stages) {
        if (s.exiting) continue;
        s.opacity.set(nextKey === null || key === nextKey ? 1 : 0.6, { immediate });
      }
      if (prev && p) this.emitPoint('point:leave', prev, p);
      if (item && p) this.emitPoint('point:enter', item, p);
    }
    if (item && p) {
      const stages = this.stageData();
      const index = stages.findIndex((s) => s.key === nextKey);
      const first = stages[0]?.value ?? 0;
      const prevValue = index > 0 ? stages[index - 1]!.value : 0;
      const hp: HoverPoint = {
        seriesId: item.label,
        seriesName: item.label,
        index,
        value: item.value,
        label: item.label,
        color: item.colorResolved,
        x: p.x,
        y: p.y,
      };
      const opt = this.options.tooltip;
      const rows = [
        { color: item.colorResolved, label: 'Value', value: fmtValue(item.value) },
        {
          color: item.colorResolved,
          label: 'Of first',
          value: first > 0 ? `${((item.value / first) * 100).toFixed(1)}%` : '—',
        },
        ...(index > 0
          ? [
              {
                color: item.colorResolved,
                label: 'Of previous',
                value: prevValue > 0 ? `${((item.value / prevValue) * 100).toFixed(1)}%` : '—',
              },
            ]
          : []),
      ];
      const content: TooltipContent =
        opt && typeof opt === 'object' && opt.formatter
          ? opt.formatter([hp])
          : { title: item.label, rows };
      this.tooltip?.show(content, { x: p.x, y: p.y }, immediate);
    } else {
      this.tooltip?.hide(immediate);
    }
  }

  private pointerClick(p: PointerPos): void {
    const item = this.stageAt(p);
    if (item) this.emitPoint('point:click', item, p);
  }

  private emitPoint(
    type: 'point:enter' | 'point:leave' | 'point:click',
    item: StageItem,
    p: PointerPos,
  ): void {
    this.emit(type, {
      seriesId: item.label,
      index: this.stageData().findIndex((s) => s.key === this.keyOf(item)),
      value: item.value,
      label: item.label,
      clientX: p.clientX,
      clientY: p.clientY,
    });
  }

  private disposeStage(item: StageItem): void {
    item.vec.destroy();
    item.opacity.destroy();
  }

  protected override teardown(): void {
    this.pointerTracker.destroy();
    this.tooltip?.destroy();
    for (const s of this.stages.values()) this.disposeStage(s);
    this.stages.clear();
  }
}
