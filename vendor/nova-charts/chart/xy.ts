import { Chart } from '../core/chart.js';
import type {
  BaseChartOptions,
  HoverPoint,
  Series,
  TooltipContent,
} from '../core/types.js';
import { svgEl } from '../core/svg.js';
import { datumValue, fmtLabel, fmtValue } from '../core/format.js';
import { Axis } from '../component/axis.js';
import { Grid } from '../component/grid.js';
import { Tooltip } from '../component/tooltip.js';
import { Crosshair } from '../component/crosshair.js';
import { Legend } from '../component/legend.js';
import { PointerTracker, type PointerPos } from '../interaction/pointer.js';
import { paletteVar, resolveColor } from '../theme/theme.js';
import { niceDomain } from '../scale/ticks.js';

/**
 * Shared chrome for cartesian charts: layered svg groups, animated axes and
 * grid, tooltip/crosshair/legend, and pointer plumbing. Subclasses implement
 * the marks and the hit-testing.
 */
export abstract class XYChart<O extends BaseChartOptions = BaseChartOptions> extends Chart<O> {
  protected gridLayer: SVGGElement;
  protected seriesLayer: SVGGElement;
  protected axisLayer: SVGGElement;
  protected hoverLayer: SVGGElement;
  protected xAxis: Axis;
  protected yAxis: Axis;
  protected grid: Grid;
  protected crosshair: Crosshair;
  protected tooltip: Tooltip | null = null;
  protected legendComp: Legend | null = null;
  protected lastPointer: PointerPos | null = null;
  private pointerTracker: PointerTracker;

  constructor(el: HTMLElement, options: O) {
    super(el, options);
    this.gridLayer = svgEl('g', {}, this.svg);
    this.seriesLayer = svgEl('g', {}, this.svg);
    this.axisLayer = svgEl('g', {}, this.svg);
    this.hoverLayer = svgEl('g', { 'pointer-events': 'none' }, this.svg);

    const spring = this.springConfig();
    this.xAxis = new Axis(this.axisLayer, 'bottom', spring);
    this.yAxis = new Axis(this.axisLayer, 'left', spring);
    this.grid = new Grid(this.gridLayer, spring);
    this.crosshair = new Crosshair(this.hoverLayer);

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
  }

  /** Category labels, padded with indices so every point has one. */
  protected labels(): string[] {
    const n = Math.max(0, ...this.options.data.series.map((s) => s.data.length));
    const raw = this.options.data.labels ?? [];
    return Array.from({ length: n }, (_, i) =>
      raw[i] !== undefined ? fmtLabel(raw[i]!) : String(i + 1),
    );
  }

  protected valuesOf(series: Series): number[] {
    return series.data.map(datumValue);
  }

  protected yDomain(includeZero: boolean): [number, number] {
    let min = Infinity;
    let max = -Infinity;
    for (const s of this.visibleSeries()) {
      for (const v of this.valuesOf(s)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (min === Infinity) {
      min = 0;
      max = 1;
    }
    if (includeZero) {
      min = Math.min(min, 0);
      max = Math.max(max, 0);
    }
    if (min === max) {
      min -= 1;
      max += 1;
    }
    return niceDomain(min, max, this.options.axes?.y?.ticks ?? 5);
  }

  /** Spec (may be `var(--…)`) and resolved concrete color for series `i`. */
  protected colorOf(series: Series, i: number): { spec: string; resolved: string } {
    const spec = series.color ?? paletteVar(i);
    return { spec, resolved: resolveColor(this.el, spec) };
  }

  protected updateLegend(): void {
    if (!this.legendComp) return;
    this.legendComp.update(
      this.options.data.series.map((s, i) => ({
        id: s.id,
        name: s.name ?? s.id,
        color: this.colorOf(s, i).resolved,
        visible: this.isSeriesVisible(s.id),
      })),
    );
  }

  /** Evenly spread tick indices so labels never collide. */
  protected xTickIndices(n: number): number[] {
    const maxTicks = Math.max(2, Math.floor(this.plot.width / 64));
    if (n <= maxTicks) return Array.from({ length: n }, (_, i) => i);
    const step = Math.ceil(n / maxTicks);
    const out: number[] = [];
    for (let i = 0; i < n; i += step) out.push(i);
    return out;
  }

  protected tooltipContent(points: HoverPoint[], title: string): TooltipContent {
    const t = this.options.tooltip;
    if (t && typeof t === 'object' && t.formatter) return t.formatter(points);
    return {
      title,
      rows: points.map((p) => ({
        color: p.color,
        label: p.seriesName,
        value: fmtValue(p.value),
      })),
    };
  }

  protected abstract pointerMove(p: PointerPos | null): void;

  protected pointerClick(_p: PointerPos): void {}

  /** Re-run hover logic after a data/layout change so tooltips stay live. */
  protected refreshHover(): void {
    if (this.lastPointer) this.pointerMove(this.lastPointer);
  }

  protected override teardown(): void {
    this.pointerTracker.destroy();
    this.xAxis.destroy();
    this.yAxis.destroy();
    this.grid.destroy();
    this.crosshair.destroy();
    this.tooltip?.destroy();
    this.legendComp?.destroy();
  }
}
