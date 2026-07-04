import { Chart, type UpdateReason } from '../core/chart.js';
import type { BaseChartOptions, ChartData } from '../core/types.js';
import { svgEl } from '../core/svg.js';
import { keyedJoin, type JoinItem } from '../core/join.js';
import { AnimatedValue, AnimatedVec } from '../motion/animated.js';
import { stagger } from '../motion/stagger.js';
import { curveSegments } from '../shape/curve.js';
import { resamplePolyline } from '../interpolate/resample.js';
import { scaleLinear, type LinearScale } from '../scale/linear.js';
import { scaleBand, type BandScale } from '../scale/band.js';
import { Axis } from '../component/axis.js';
import { Grid } from '../component/grid.js';
import { Tooltip } from '../component/tooltip.js';
import { PointerTracker, type PointerPos } from '../interaction/pointer.js';
import { paletteVar, resolveColor } from '../theme/theme.js';
import {
  simulateSchedule,
  percentile,
  density,
  type SimTask,
  type SimResult,
} from '../analysis/montecarlo.js';

export interface ForecastTask {
  id: string;
  name?: string;
  /** Three-point (PERT) duration estimate. */
  optimistic: number;
  likely: number;
  pessimistic: number;
  dependsOn?: string[];
  color?: string;
}

export interface ForecastChartOptions extends Omit<BaseChartOptions, 'data'> {
  tasks: ForecastTask[];
  /** Monte-Carlo iterations (default 600). */
  iterations?: number;
  /** Seed for reproducible runs; omit for fresh randomness each run. */
  seed?: number;
  /** Project start; if a Date, the axis/tooltip show dates, else durations. */
  start?: number | Date;
  /** Unit label for durations (default 'd'). */
  unit?: string;
  /** Percentile for the headline confidence line (default 85). */
  confidence?: number;
  data?: ChartData;
}

const BINS = 40;
const PROJECT_ROW = '__project__';

interface RidgeItem extends JoinItem {
  g: SVGGElement;
  area: SVGPathElement;
  p50: SVGLineElement;
  p85: SVGLineElement;
  /** Top edge points, flat [x0, y0, ...]. */
  edge: AnimatedVec;
  fill: AnimatedValue;
  p50x: AnimatedValue;
  p85x: AnimatedValue;
  baseline: number;
  colorResolved: string;
  isProject: boolean;
  stats: { p50: number; p85: number; p95: number; crit: number; range: [number, number] };
  removeFn: (() => void) | null;
}

const toMs = (v: number | Date): number => (v instanceof Date ? v.getTime() : v);
const DAY = 86_400_000;

/**
 * ForecastChart — a Monte-Carlo schedule rendered as a field of probability.
 *
 * Every task's completion is a density ridge (a distribution, not a bar);
 * uncertainty compounds along dependencies, so downstream ridges spread
 * wider; the tasks that most often decide the finish glow (criticality); P50
 * and P85 markers sit on each ridge; and a headline confidence line reads the
 * realistic project finish. Change an estimate and the whole field of
 * uncertainty ripples — every ridge morphs via per-vertex springs.
 */
export class ForecastChart extends Chart<ForecastChartOptions & { data: ChartData }> {
  private gridLayer: SVGGElement;
  private ridgeLayer: SVGGElement;
  private axisLayer: SVGGElement;
  private xAxis: Axis;
  private yAxis: Axis;
  private grid: Grid;
  private tooltip: Tooltip | null = null;
  private pointerTracker: PointerTracker;
  private confLine: SVGLineElement;
  private confLabel: SVGTextElement;
  private confX = new AnimatedValue(0, { stiffness: 150, damping: 22 });
  private items = new Map<string, RidgeItem>();
  private xScale!: LinearScale;
  private yBand!: BandScale;
  private sim: SimResult | null = null;
  private hoveredId: string | null = null;
  private lastPointer: PointerPos | null = null;
  private entranceDone = false;

  constructor(el: HTMLElement, options: ForecastChartOptions) {
    super(el, { ...options, data: options.data ?? { series: [] } });
    this.gridLayer = svgEl('g', {}, this.svg);
    this.ridgeLayer = svgEl('g', {}, this.svg);
    this.axisLayer = svgEl('g', {}, this.svg);
    const spring = this.springConfig();
    this.xAxis = new Axis(this.axisLayer, 'bottom', spring);
    this.yAxis = new Axis(this.axisLayer, 'left', spring);
    this.grid = new Grid(this.gridLayer, spring, 'vertical');
    this.confLine = svgEl(
      'line',
      { stroke: 'var(--nova-c2)', 'stroke-width': 2, 'stroke-dasharray': '5,4', opacity: 0 },
      this.svg,
    );
    this.confLabel = svgEl(
      'text',
      { fill: 'var(--nova-c2)', 'font-size': 11, 'font-weight': 700, 'text-anchor': 'middle' },
      this.svg,
    );
    this.confX.onChange((v) => {
      this.confLine.setAttribute('x1', String(v));
      this.confLine.setAttribute('x2', String(v));
      this.confLabel.setAttribute('x', String(v));
    });
    if (options.tooltip !== false) this.tooltip = new Tooltip(this.overlay);
    this.pointerTracker = new PointerTracker(this.svg, (p) => {
      this.lastPointer = p;
      this.pointerMove(p);
    });
    this.bootstrap();
  }

  setTasks(tasks: ForecastTask[]): void {
    this.options.tasks = tasks;
    this.update('data');
    this.announcer.announce('Forecast re-simulated');
  }

  get tasks(): ForecastTask[] {
    return this.options.tasks;
  }

  protected override chartType(): string {
    return 'Forecast';
  }

  protected override ariaLabel(): string {
    return this.options.ariaLabel ?? `Monte-Carlo forecast, ${this.options.tasks.length} tasks`;
  }

  private unit(): string {
    return this.options.unit ?? 'd';
  }

  /** Format a finish value (duration from start, or an absolute date). */
  private fmtFinish(v: number): string {
    if (this.options.start !== undefined) {
      const d = new Date(toMs(this.options.start) + v * DAY);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    }
    return `${Math.round(v)}${this.unit()}`;
  }

  protected override update(reason: UpdateReason): void {
    const immediate = this.immediate() || reason === 'resize';
    const spring = this.springConfig();
    const tasks = this.options.tasks;

    // Re-run the simulation (skip on a pure resize — geometry only).
    if (reason !== 'resize' || !this.sim) {
      this.sim = simulateSchedule(tasks as SimTask[], {
        iterations: this.options.iterations ?? 600,
        ...(this.options.seed !== undefined ? { seed: this.options.seed } : {}),
      });
    }
    const sim = this.sim;
    const horizon = Math.max(sim.horizon, 1);

    this.xScale = scaleLinear({
      domain: [0, horizon],
      range: [this.plot.x, this.plot.x + this.plot.width],
      nice: true,
    });
    const rows = [...tasks.map((t) => t.id), PROJECT_ROW];
    this.yBand = scaleBand({
      domain: rows,
      range: [this.plot.y, this.plot.y + this.plot.height],
      paddingInner: 0.25,
      paddingOuter: 0.12,
    });

    const chromeImmediate = this.immediate() || reason === 'resize';
    const xticks = this.xScale.ticks(Math.max(3, Math.floor(this.plot.width / 80)));
    this.xAxis.update(
      xticks.map((v) => ({ key: String(v), label: this.fmtFinish(v), pos: this.xScale(v) })),
      this.plot,
      chromeImmediate,
    );
    this.grid.update(
      xticks.map((v) => ({ key: String(v), pos: this.xScale(v) })),
      this.plot,
      chromeImmediate,
    );
    this.yAxis.update(
      rows.map((id) => ({
        key: id,
        label: id === PROJECT_ROW ? 'PROJECT' : tasks.find((t) => t.id === id)?.name ?? id,
        pos: this.yBand.center(id),
      })),
      this.plot,
      chromeImmediate,
    );

    // Headline confidence line at the chosen project percentile.
    const conf = this.options.confidence ?? 85;
    const confVal = percentile(sim.project, conf);
    const confPx = this.xScale(confVal);
    this.confLine.setAttribute('y1', String(this.plot.y - 4));
    this.confLine.setAttribute('y2', String(this.plot.y + this.plot.height + 4));
    this.confLine.setAttribute('opacity', '0.9');
    this.confLabel.setAttribute('y', String(this.plot.y - 8));
    this.confLabel.textContent = `P${conf} · ${this.fmtFinish(confVal)}`;
    this.confX.set(confPx, { immediate });

    const rowH = this.yBand.bandwidth();
    const binX = (k: number): number => this.xScale(((k + 0.5) / BINS) * horizon);

    const rowData = rows.map((id, i) => {
      const isProject = id === PROJECT_ROW;
      const sorted = isProject ? sim.project : sim.tasks.get(id)?.sorted ?? [];
      const dens = density(sorted, horizon, BINS);
      const crit = isProject ? 1 : sim.tasks.get(id)?.criticality ?? 0;
      return { id, i, isProject, sorted, dens, crit };
    });

    keyedJoin(
      this.items,
      rowData.map((d) => [d.id, d] as const),
      {
        enter: (_key, d, i) => {
          const task = tasks.find((t) => t.id === d.id);
          const spec = d.isProject ? 'var(--nova-c2)' : task?.color ?? paletteVar(i);
          const baseline = this.yBand(d.id) + rowH;
          const g = svgEl('g', {}, this.ridgeLayer);
          const area = svgEl(
            'path',
            { fill: spec, stroke: spec, 'stroke-width': d.isProject ? 1.5 : 1, 'stroke-opacity': 0.5 },
            g,
          );
          const p50 = svgEl('line', { stroke: spec, 'stroke-width': 2, opacity: 0.9 }, g);
          const p85 = svgEl(
            'line',
            { stroke: spec, 'stroke-width': 1.5, 'stroke-dasharray': '2,2', opacity: 0.7 },
            g,
          );
          const edgeTarget = this.edgePoints(d.dens, baseline, rowH, binX);
          const flat = this.flatEdge(baseline, binX);
          const grow = !this.immediate();
          const edge = new AnimatedVec(grow ? flat : edgeTarget, spring);
          const critFill = 0.2 + d.crit * 0.6;
          const fill = new AnimatedValue(grow ? 0 : critFill, spring);
          const p50x = new AnimatedValue(this.xScale(percentile(d.sorted, 50)), spring);
          const p85x = new AnimatedValue(this.xScale(percentile(d.sorted, 85)), spring);
          const item: RidgeItem = {
            g,
            area,
            p50,
            p85,
            edge,
            fill,
            p50x,
            p85x,
            baseline,
            colorResolved: resolveColor(this.el, spec),
            isProject: d.isProject,
            stats: this.statsOf(d.sorted, d.crit),
            removeFn: null,
          };
          const render = (): void => {
            area.setAttribute('d', this.areaPath(edge.values, baseline, binX));
          };
          edge.onChange(render);
          fill.onChange((v) => {
            area.setAttribute('fill-opacity', String(Math.max(v, 0)));
            // Critical ridges glow a little brighter at the edge.
            area.setAttribute('stroke-opacity', String(0.3 + Math.max(v, 0) * 0.5));
          });
          const setMarker = (line: SVGLineElement, x: AnimatedValue): void => {
            const top = baseline - rowH;
            x.onChange((v) => {
              line.setAttribute('x1', String(v));
              line.setAttribute('x2', String(v));
              line.setAttribute('y1', String(top));
              line.setAttribute('y2', String(baseline));
            });
          };
          setMarker(p50, p50x);
          setMarker(p85, p85x);
          render();
          fill.set(critFill, { immediate });
          // re-emit marker positions
          p50x.set(this.xScale(percentile(d.sorted, 50)), { immediate });
          p85x.set(this.xScale(percentile(d.sorted, 85)), { immediate });
          if (grow) {
            const delay = this.entranceDone ? 0 : stagger(i, rows.length, { each: 70 });
            const delays = new Float64Array(edgeTarget.length).fill(delay);
            edge.set(edgeTarget, { delays });
            fill.set(critFill, { delay });
          }
          return item;
        },
        update: (item, d) => {
          const task = tasks.find((t) => t.id === d.id);
          const spec = d.isProject ? 'var(--nova-c2)' : task?.color ?? paletteVar(d.i);
          item.colorResolved = resolveColor(this.el, spec);
          item.area.setAttribute('fill', spec);
          item.area.setAttribute('stroke', spec);
          item.stats = this.statsOf(d.sorted, d.crit);
          const baseline = this.yBand(d.id) + rowH;
          item.baseline = baseline;
          this.morph(item.edge, this.edgePoints(d.dens, baseline, rowH, binX), immediate);
          item.fill.set(
            (0.2 + d.crit * 0.6) *
              (this.hoveredId === null || this.hoveredId === d.id ? 1 : 0.45),
            { immediate },
          );
          item.p50x.set(this.xScale(percentile(d.sorted, 50)), { immediate });
          item.p85x.set(this.xScale(percentile(d.sorted, 85)), { immediate });
        },
        exit: (item, remove) => {
          item.removeFn = remove;
          if (immediate) {
            item.g.remove();
            this.disposeItem(item);
            remove();
          } else {
            item.edge.set(this.flatEdge(item.baseline, binX), {});
            item.fill.set(0, {});
            item.edge.onRest(() => {
              item.g.remove();
              this.disposeItem(item);
              item.removeFn?.();
            });
          }
        },
      },
    );

    this.entranceDone = true;
    if (this.lastPointer) this.pointerMove(this.lastPointer);
  }

  private statsOf(sorted: number[], crit: number) {
    return {
      p50: percentile(sorted, 50),
      p85: percentile(sorted, 85),
      p95: percentile(sorted, 95),
      crit,
      range: [percentile(sorted, 5), percentile(sorted, 95)] as [number, number],
    };
  }

  private edgePoints(
    dens: Float64Array,
    baseline: number,
    rowH: number,
    binX: (k: number) => number,
  ): Float64Array {
    const out = new Float64Array(BINS * 2);
    for (let k = 0; k < BINS; k++) {
      out[k * 2] = binX(k);
      out[k * 2 + 1] = baseline - dens[k]! * rowH * 0.96;
    }
    return out;
  }

  private flatEdge(baseline: number, binX: (k: number) => number): Float64Array {
    const out = new Float64Array(BINS * 2);
    for (let k = 0; k < BINS; k++) {
      out[k * 2] = binX(k);
      out[k * 2 + 1] = baseline;
    }
    return out;
  }

  private areaPath(edge: ArrayLike<number>, baseline: number, binX: (k: number) => number): string {
    const n = edge.length / 2;
    if (n < 2) return '';
    const x0 = binX(0);
    const xLast = edge[(n - 1) * 2]!;
    return (
      `M${x0},${baseline}L${edge[0]},${edge[1]}` +
      curveSegments(edge, 'catmull-rom') +
      `L${xLast},${baseline}Z`
    );
  }

  private morph(vec: AnimatedVec, target: Float64Array, immediate: boolean): void {
    if (immediate) {
      vec.reset(target);
      return;
    }
    if (vec.length !== target.length) vec.reset(resamplePolyline(vec.values, target.length / 2));
    vec.set(target, {});
  }

  private rowAt(p: PointerPos): RidgeItem | null {
    if (
      p.x < this.plot.x ||
      p.x > this.plot.x + this.plot.width ||
      p.y < this.plot.y ||
      p.y > this.plot.y + this.plot.height
    ) {
      return null;
    }
    const idx = this.yBand.indexAt(p.y);
    const rows = [...this.items.keys()];
    const id = rows[idx];
    const item = id ? this.items.get(id) : null;
    return item && !item.exiting ? item : null;
  }

  private pointerMove(p: PointerPos | null): void {
    const item = p ? this.rowAt(p) : null;
    const immediate = this.immediate();
    const nextId = item ? this.keyOf(item) : null;
    if (nextId !== this.hoveredId) {
      this.hoveredId = nextId;
      for (const [id, it] of this.items) {
        if (it.exiting) continue;
        const base = it.isProject ? 1 : 0.2 + it.stats.crit * 0.6;
        it.fill.set(base * (nextId === null || id === nextId ? 1 : 0.45), { immediate });
      }
    }
    if (item && p) {
      const s = item.stats;
      const c = item.colorResolved;
      const label = item.isProject
        ? 'Project finish'
        : this.options.tasks.find((t) => t.id === this.keyOf(item))?.name ?? this.keyOf(item);
      const rows = [
        { color: c, label: 'Likely (P50)', value: this.fmtFinish(s.p50) },
        { color: c, label: 'Commit (P85)', value: this.fmtFinish(s.p85) },
        { color: c, label: 'Worst (P95)', value: this.fmtFinish(s.p95) },
      ];
      if (!item.isProject) {
        rows.push({
          color: c,
          label: 'Criticality',
          value: `${Math.round(s.crit * 100)}%`,
        });
      }
      this.tooltip?.show(
        { title: label, rows },
        { x: this.xScale(s.p85), y: item.baseline - this.yBand.bandwidth() / 2 },
        immediate,
      );
    } else {
      this.tooltip?.hide(immediate);
    }
  }

  private keyOf(item: RidgeItem): string {
    for (const [key, value] of this.items) if (value === item) return key;
    return '';
  }

  private disposeItem(item: RidgeItem): void {
    item.edge.destroy();
    item.fill.destroy();
    item.p50x.destroy();
    item.p85x.destroy();
  }

  protected override teardown(): void {
    this.pointerTracker.destroy();
    this.xAxis.destroy();
    this.yAxis.destroy();
    this.grid.destroy();
    this.tooltip?.destroy();
    this.confX.destroy();
    for (const item of this.items.values()) this.disposeItem(item);
    this.items.clear();
  }
}
