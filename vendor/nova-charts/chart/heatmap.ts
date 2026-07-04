import { XYChart } from './xy.js';
import type { UpdateReason } from '../core/chart.js';
import type { BaseChartOptions } from '../core/types.js';
import { svgEl } from '../core/svg.js';
import { keyedJoin, type JoinItem } from '../core/join.js';
import { AnimatedValue, AnimatedVec } from '../motion/animated.js';
import { scaleBand, type BandScale } from '../scale/band.js';
import { parseColor, vecToRgba, type RGBA } from '../interpolate/color.js';
import { resolveColor } from '../theme/theme.js';
import { lerp, unlerp } from '../interpolate/number.js';
import type { PointerPos } from '../interaction/pointer.js';

export interface HeatmapChartOptions extends BaseChartOptions {
  /** Low/high colors of the value ramp. */
  colorRange?: [string, string];
  /** Corner radius for cells (default 3). */
  cornerRadius?: number;
}

interface CellItem extends JoinItem {
  rect: SVGRectElement;
  /** [x, y, w, h] */
  geo: AnimatedVec;
  /** [r, g, b, a] — springs through color space */
  color: AnimatedVec;
  opacity: AnimatedValue;
  seriesId: string;
  index: number;
  value: number;
  removeFn: (() => void) | null;
}

/**
 * Heatmap: rows are series, columns are labels. Cell colors are animated
 * vectors in rgba space, so value changes wash across the grid as living
 * color rather than repaints.
 */
export class HeatmapChart extends XYChart<HeatmapChartOptions> {
  private cells = new Map<string, CellItem>();
  private xBand!: BandScale;
  private yBand!: BandScale;
  private hovered: CellItem | null = null;
  private entranceDone = false;

  constructor(el: HTMLElement, options: HeatmapChartOptions) {
    // Rows already label the y axis; the legend is redundant by default.
    super(el, { legend: false, ...options });
    this.bootstrap();
  }

  protected override chartType(): string {
    return 'Heatmap';
  }

  private ramp(): [RGBA, RGBA] {
    const [lo, hi] = this.options.colorRange ?? ['#312e81', '#22d3ee'];
    return [
      parseColor(resolveColor(this.el, lo)) ?? { r: 49, g: 46, b: 129, a: 1 },
      parseColor(resolveColor(this.el, hi)) ?? { r: 34, g: 211, b: 238, a: 1 },
    ];
  }

  protected override update(reason: UpdateReason): void {
    const labels = this.labels();
    const n = labels.length;
    const immediate = this.immediate() || reason === 'resize';
    const spring = this.springConfig();
    const rows = this.visibleSeries();

    this.xBand = scaleBand({
      domain: labels.map((_, i) => i),
      range: [this.plot.x, this.plot.x + this.plot.width],
      paddingInner: 0.06,
      paddingOuter: 0.03,
    });
    this.yBand = scaleBand({
      domain: rows.map((s) => s.id),
      range: [this.plot.y, this.plot.y + this.plot.height],
      paddingInner: 0.06,
      paddingOuter: 0.03,
    });

    const chromeImmediate = this.immediate() || reason === 'resize';
    this.xAxis.update(
      this.xTickIndices(n).map((i) => ({
        key: labels[i]!,
        label: labels[i]!,
        pos: this.xBand.center(i),
      })),
      this.plot,
      chromeImmediate,
    );
    this.yAxis.update(
      rows.map((s) => ({
        key: s.id,
        label: s.name ?? s.id,
        pos: this.yBand.center(s.id),
      })),
      this.plot,
      chromeImmediate,
    );

    let min = Infinity;
    let max = -Infinity;
    for (const s of rows) {
      for (const v of this.valuesOf(s)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (min === Infinity) {
      min = 0;
      max = 1;
    }
    const [lo, hi] = this.ramp();
    const colorFor = (v: number): [number, number, number, number] => {
      const t = min === max ? 0.5 : unlerp(min, max, v);
      return [lerp(lo.r, hi.r, t), lerp(lo.g, hi.g, t), lerp(lo.b, hi.b, t), lerp(lo.a, hi.a, t)];
    };
    const rx = this.options.cornerRadius ?? 3;
    const w = this.xBand.bandwidth();
    const h = this.yBand.bandwidth();

    const entries: Array<readonly [string, { rowId: string; i: number; value: number }]> = [];
    for (const s of rows) {
      this.valuesOf(s).forEach((value, i) => {
        if (i < n) entries.push([`${s.id}|${i}`, { rowId: s.id, i, value }] as const);
      });
    }

    keyedJoin(this.cells, entries, {
      enter: (_key, d) => {
        const x = this.xBand(d.i);
        const y = this.yBand(d.rowId);
        const target = colorFor(d.value);
        const rect = svgEl('rect', { rx }, this.seriesLayer);
        const grow = !this.immediate();
        const geo = new AnimatedVec(
          grow ? [x + w / 2, y + h / 2, 0, 0] : [x, y, w, h],
          spring,
        );
        const color = new AnimatedVec(target, { stiffness: 110, damping: 26 });
        const opacity = new AnimatedValue(1, spring);
        const item: CellItem = {
          rect,
          geo,
          color,
          opacity,
          seriesId: d.rowId,
          index: d.i,
          value: d.value,
          removeFn: null,
        };
        geo.onChange((v) => {
          rect.setAttribute('x', String(v[0]!));
          rect.setAttribute('y', String(v[1]!));
          rect.setAttribute('width', String(Math.max(v[2]!, 0)));
          rect.setAttribute('height', String(Math.max(v[3]!, 0)));
        });
        geo.onRest(() => {
          if (item.exiting) {
            rect.remove();
            this.disposeCell(item);
            item.removeFn?.();
          }
        });
        color.onChange((v) => rect.setAttribute('fill', vecToRgba(v)));
        opacity.onChange((v) => rect.setAttribute('opacity', String(Math.max(v, 0))));
        geo.reset(geo.values);
        color.reset(color.values);
        if (grow) {
          // Diagonal wave: cells pop in from the top-left corner outward.
          const row = rows.findIndex((s) => s.id === d.rowId);
          const delay = this.entranceDone ? 0 : (d.i + row) * 28;
          geo.set([x, y, w, h], { delays: Float64Array.of(delay, delay, delay, delay) });
        }
        return item;
      },
      update: (item, d) => {
        item.value = d.value;
        const x = this.xBand(d.i);
        const y = this.yBand(d.rowId);
        item.geo.set([x, y, w, h], { immediate });
        item.color.set(colorFor(d.value), { immediate });
        item.opacity.set(1, { immediate });
      },
      exit: (item, remove) => {
        item.removeFn = remove;
        if (immediate) {
          item.rect.remove();
          this.disposeCell(item);
          remove();
        } else {
          const t = item.geo.getTargets();
          item.geo.set([t[0]! + t[2]! / 2, t[1]! + t[3]! / 2, 0, 0]);
          item.opacity.set(0);
        }
      },
    });
    this.entranceDone = true;
    this.refreshHover();
  }

  protected override pointerMove(p: PointerPos | null): void {
    const inside =
      p !== null &&
      p.x >= this.plot.x &&
      p.x <= this.plot.x + this.plot.width &&
      p.y >= this.plot.y &&
      p.y <= this.plot.y + this.plot.height;
    if (!inside) {
      this.clearHover();
      return;
    }
    const labels = this.labels();
    const rows = this.visibleSeries();
    const col = this.xBand.indexAt(p.x);
    const rowIdx = this.yBand.indexAt(p.y);
    const row = rows[rowIdx];
    const item = row ? this.cells.get(`${row.id}|${col}`) : undefined;
    if (!item || item.exiting) {
      this.clearHover();
      return;
    }
    if (item !== this.hovered) {
      const immediate = this.immediate();
      if (this.hovered) this.setCellHover(this.hovered, false);
      this.hovered = item;
      this.setCellHover(item, true);
      this.emit('point:enter', this.cellEvent(item, p));
      const label = labels[col] ?? String(col);
      this.tooltip?.show(
        this.tooltipContent(
          [
            {
              seriesId: item.seriesId,
              seriesName: row?.name ?? item.seriesId,
              index: col,
              value: item.value,
              label,
              color: vecToRgba(item.color.getTargets()),
              x: this.xBand.center(col),
              y: this.yBand.center(item.seriesId),
            },
          ],
          `${row?.name ?? item.seriesId} · ${label}`,
        ),
        { x: this.xBand.center(col), y: this.yBand.center(item.seriesId) },
        immediate,
      );
    }
  }

  protected override pointerClick(p: PointerPos): void {
    if (this.hovered) this.emit('point:click', this.cellEvent(this.hovered, p));
  }

  private cellEvent(item: CellItem, p: PointerPos) {
    return {
      seriesId: item.seriesId,
      index: item.index,
      value: item.value,
      label: this.labels()[item.index] ?? String(item.index),
      clientX: p.clientX,
      clientY: p.clientY,
    };
  }

  /** Hovered cell pops slightly proud of the grid. */
  private setCellHover(item: CellItem, active: boolean): void {
    const t = item.geo.getTargets();
    const cxc = t[0]! + t[2]! / 2;
    const cyc = t[1]! + t[3]! / 2;
    const w = this.xBand.bandwidth();
    const h = this.yBand.bandwidth();
    const grow = active ? 1.08 : 1;
    item.geo.set([cxc - (w * grow) / 2, cyc - (h * grow) / 2, w * grow, h * grow], {
      immediate: this.immediate(),
    });
    item.rect.setAttribute('stroke', active ? 'var(--nova-fg)' : 'none');
    item.rect.setAttribute('stroke-width', active ? '1.5' : '0');
  }

  private clearHover(): void {
    if (this.hovered) {
      this.setCellHover(this.hovered, false);
      if (this.lastPointer) {
        this.emit('point:leave', this.cellEvent(this.hovered, this.lastPointer));
      }
      this.hovered = null;
    }
    this.tooltip?.hide(this.immediate());
  }

  private disposeCell(item: CellItem): void {
    item.geo.destroy();
    item.color.destroy();
    item.opacity.destroy();
  }

  protected override teardown(): void {
    super.teardown();
    for (const c of this.cells.values()) this.disposeCell(c);
    this.cells.clear();
  }
}
