import { Chart, type UpdateReason } from '../core/chart.js';
import type { BaseChartOptions, HoverPoint, TooltipContent } from '../core/types.js';
import { svgEl } from '../core/svg.js';
import { keyedJoin, type JoinItem } from '../core/join.js';
import { AnimatedValue, AnimatedVec } from '../motion/animated.js';
import { squarify } from '../shape/treemap.js';
import { Tooltip } from '../component/tooltip.js';
import { PointerTracker, type PointerPos } from '../interaction/pointer.js';
import { paletteVar, resolveColor } from '../theme/theme.js';
import { fmtValue, fmtLabel, datumValue } from '../core/format.js';

export interface TreemapChartOptions extends BaseChartOptions {
  /** Gap between cells in px (default 3). */
  gap?: number;
}

interface CellItem extends JoinItem {
  g: SVGGElement;
  rect: SVGRectElement;
  name: SVGTextElement;
  valueText: SVGTextElement;
  /** [x, y, w, h] */
  vec: AnimatedVec;
  opacity: AnimatedValue;
  label: string;
  value: number;
  colorResolved: string;
  removeFn: (() => void) | null;
}

/**
 * Squarified treemap. Cell rects are spring vectors, so value changes make
 * the whole mosaic reflow — cells slide, grow, and shrink into the new
 * layout instead of snapping.
 */
export class TreemapChart extends Chart<TreemapChartOptions> {
  private layer: SVGGElement;
  private cells = new Map<string, CellItem>();
  private tooltip: Tooltip | null = null;
  private pointerTracker: PointerTracker;
  private hoveredKey: string | null = null;
  private lastPointer: PointerPos | null = null;
  private entranceDone = false;

  constructor(el: HTMLElement, options: TreemapChartOptions) {
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
    return 'Treemap';
  }

  protected override ariaLabel(): string {
    return this.options.ariaLabel ?? `Treemap, ${this.cellData().length} cells`;
  }

  private cellData(): { key: string; label: string; value: number; color: string }[] {
    const series = this.options.data.series[0];
    if (!series) return [];
    const labels = this.options.data.labels ?? [];
    return series.data.map((d, i) => {
      const label = labels[i] !== undefined ? fmtLabel(labels[i]!) : `Cell ${i + 1}`;
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
    const data = this.cellData();
    const gap = this.options.gap ?? 3;

    const layout = squarify(
      data.map((d) => ({ key: d.key, value: d.value })),
      this.plot,
    );
    const rects = new Map(layout.map((l) => [l.key, l.rect] as const));

    keyedJoin(
      this.cells,
      data.map((d, i) => [d.key, { ...d, i }] as const),
      {
        enter: (key, d, i) => {
          const r = rects.get(key)!;
          const target = this.padded(r, gap);
          const g = svgEl('g', {}, this.layer);
          const rect = svgEl('rect', { fill: d.color, 'fill-opacity': 0.85, rx: 4 }, g);
          const name = svgEl(
            'text',
            { fill: '#fff', 'font-size': 12, 'font-weight': 600 },
            g,
          );
          const valueText = svgEl('text', { fill: '#fff', 'font-size': 11, opacity: 0.7 }, g);
          const grow = !this.immediate();
          const cx = target[0]! + target[2]! / 2;
          const cy = target[1]! + target[3]! / 2;
          const vec = new AnimatedVec(grow ? [cx, cy, 0, 0] : target, spring);
          const opacity = new AnimatedValue(1, spring);
          const item: CellItem = {
            g,
            rect,
            name,
            valueText,
            vec,
            opacity,
            label: d.label,
            value: d.value,
            colorResolved: resolveColor(this.el, d.color),
            removeFn: null,
          };
          vec.onChange((v) => this.renderCell(item, v));
          vec.onRest(() => {
            if (item.exiting) {
              g.remove();
              this.disposeCell(item);
              item.removeFn?.();
            }
          });
          opacity.onChange((v) => g.setAttribute('opacity', String(Math.max(v, 0))));
          vec.reset(vec.values);
          if (grow) {
            const delay = this.entranceDone ? 0 : i * 45;
            vec.set(target, { delays: Float64Array.of(delay, delay, delay, delay) });
          }
          this.renderText(item);
          return item;
        },
        update: (item, d) => {
          item.value = d.value;
          item.colorResolved = resolveColor(this.el, d.color);
          item.rect.setAttribute('fill', d.color);
          const r = rects.get(d.key)!;
          item.vec.set(this.padded(r, gap), { immediate });
          item.opacity.set(this.hoveredKey === null || this.hoveredKey === d.key ? 1 : 0.6, {
            immediate,
          });
          this.renderText(item);
        },
        exit: (item, remove) => {
          item.removeFn = remove;
          if (immediate) {
            item.g.remove();
            this.disposeCell(item);
            remove();
          } else {
            const t = item.vec.getTargets();
            item.vec.set([t[0]! + t[2]! / 2, t[1]! + t[3]! / 2, 0, 0]);
            item.opacity.set(0);
          }
        },
      },
    );
    this.entranceDone = true;
    if (this.lastPointer) this.pointerMove(this.lastPointer);
  }

  private padded(r: { x: number; y: number; width: number; height: number }, gap: number): [number, number, number, number] {
    const g = Math.min(gap, r.width / 4, r.height / 4) / 2;
    return [r.x + g, r.y + g, Math.max(r.width - gap, 0), Math.max(r.height - gap, 0)];
  }

  private renderCell(item: CellItem, v: Float64Array): void {
    const w = Math.max(v[2]!, 0);
    const h = Math.max(v[3]!, 0);
    item.rect.setAttribute('x', String(v[0]!));
    item.rect.setAttribute('y', String(v[1]!));
    item.rect.setAttribute('width', String(w));
    item.rect.setAttribute('height', String(h));
    item.name.setAttribute('x', String(v[0]! + 8));
    item.name.setAttribute('y', String(v[1]! + 18));
    item.valueText.setAttribute('x', String(v[0]! + 8));
    item.valueText.setAttribute('y', String(v[1]! + 33));
    // Hide labels when the cell is too small for them.
    const showName = w > 60 && h > 26;
    const showValue = w > 60 && h > 44;
    item.name.setAttribute('opacity', showName ? '1' : '0');
    item.valueText.setAttribute('opacity', showValue ? '0.7' : '0');
  }

  private renderText(item: CellItem): void {
    item.name.textContent = item.label;
    item.valueText.textContent = fmtValue(item.value);
  }

  private cellAt(p: PointerPos): CellItem | null {
    for (const item of this.cells.values()) {
      if (item.exiting) continue;
      const t = item.vec.getTargets();
      if (p.x >= t[0]! && p.x <= t[0]! + t[2]! && p.y >= t[1]! && p.y <= t[1]! + t[3]!) {
        return item;
      }
    }
    return null;
  }

  private keyOf(item: CellItem): string {
    for (const [key, value] of this.cells) if (value === item) return key;
    return item.label;
  }

  private pointerMove(p: PointerPos | null): void {
    const item = p ? this.cellAt(p) : null;
    const immediate = this.immediate();
    const nextKey = item ? this.keyOf(item) : null;
    if (nextKey !== this.hoveredKey) {
      const prev = this.hoveredKey ? this.cells.get(this.hoveredKey) : null;
      this.hoveredKey = nextKey;
      for (const [key, c] of this.cells) {
        if (c.exiting) continue;
        c.opacity.set(nextKey === null || key === nextKey ? 1 : 0.6, { immediate });
      }
      if (prev && p) this.emitCell('point:leave', prev, p);
      if (item && p) this.emitCell('point:enter', item, p);
    }
    if (item && p) {
      const total = [...this.cells.values()]
        .filter((c) => !c.exiting)
        .reduce((s, c) => s + c.value, 0);
      const hp: HoverPoint = {
        seriesId: item.label,
        seriesName: item.label,
        index: this.cellData().findIndex((d) => d.key === nextKey),
        value: item.value,
        label: item.label,
        color: item.colorResolved,
        x: p.x,
        y: p.y,
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
      this.tooltip?.show(content, { x: p.x, y: p.y }, immediate);
    } else {
      this.tooltip?.hide(immediate);
    }
  }

  private pointerClick(p: PointerPos): void {
    const item = this.cellAt(p);
    if (item) this.emitCell('point:click', item, p);
  }

  private emitCell(
    type: 'point:enter' | 'point:leave' | 'point:click',
    item: CellItem,
    p: PointerPos,
  ): void {
    this.emit(type, {
      seriesId: item.label,
      index: this.cellData().findIndex((d) => d.key === this.keyOf(item)),
      value: item.value,
      label: item.label,
      clientX: p.clientX,
      clientY: p.clientY,
    });
  }

  private disposeCell(item: CellItem): void {
    item.vec.destroy();
    item.opacity.destroy();
  }

  protected override teardown(): void {
    this.pointerTracker.destroy();
    this.tooltip?.destroy();
    for (const c of this.cells.values()) this.disposeCell(c);
    this.cells.clear();
  }
}
