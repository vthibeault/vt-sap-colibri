import { Chart, type UpdateReason } from '../core/chart.js';
import type { BaseChartOptions, ChartData } from '../core/types.js';
import { svgEl } from '../core/svg.js';
import { keyedJoin, type JoinItem } from '../core/join.js';
import { AnimatedValue, AnimatedVec } from '../motion/animated.js';
import { stagger } from '../motion/stagger.js';
import { scaleTime, type TimeScale } from '../scale/time.js';
import { scaleBand, type BandScale } from '../scale/band.js';
import { Axis } from '../component/axis.js';
import { Grid } from '../component/grid.js';
import { Tooltip } from '../component/tooltip.js';
import { PointerTracker, type PointerPos } from '../interaction/pointer.js';
import { paletteVar, resolveColor } from '../theme/theme.js';
import { fmtLabel, fmtValue } from '../core/format.js';
import { vecToRgba, type RGBA } from '../interpolate/color.js';
import { clamp } from '../interpolate/number.js';

export interface BudgetFlowTask {
  id: string;
  name?: string;
  start: number | Date;
  end: number | Date;
  /** Planned cost — drives ribbon thickness. */
  budget: number;
  /** Actual cost incurred to date — drives the burn fill. */
  spent: number;
  /** Tasks this one depends on (drawn as elbow connectors). */
  dependsOn?: string[];
  color?: string;
}

export interface BudgetFlowChartOptions extends Omit<BaseChartOptions, 'data'> {
  tasks: BudgetFlowTask[];
  /** "Today" playhead. Defaults to now. */
  now?: number | Date;
  /** Currency/value formatter for tooltips. */
  currency?: (value: number) => string;
  data?: ChartData;
}

interface FlowItem extends JoinItem {
  g: SVGGElement;
  envelope: SVGRectElement;
  burn: SVGRectElement;
  forecast: SVGRectElement;
  label: SVGTextElement;
  /** [x, cy, w, halfThickness] */
  geo: AnimatedVec;
  /** spent / budget (0..1 clamped for the in-bar fill) */
  burnFrac: AnimatedValue;
  /** projected over-run as a fraction of planned width (>=0) */
  overrunFrac: AnimatedValue;
  /** health color [r,g,b,a] */
  color: AnimatedVec;
  opacity: AnimatedValue;
  task: BudgetFlowTask;
  removeFn: (() => void) | null;
}

const toMs = (v: number | Date): number => (v instanceof Date ? v.getTime() : v);
const DAY = 86_400_000;

const GREEN: RGBA = { r: 52, g: 211, b: 153, a: 1 }; // under budget
const AMBER: RGBA = { r: 251, g: 191, b: 36, a: 1 }; // on the line
const RED: RGBA = { r: 251, g: 113, b: 133, a: 1 }; // over budget
const RED_RGB = `rgb(${RED.r}, ${RED.g}, ${RED.b})`;

function healthColor(ratio: number): RGBA {
  // ratio = (spent/budget) / elapsedFraction. 1 = exactly on pace.
  if (ratio <= 1) {
    const t = clamp((ratio - 0.7) / 0.3, 0, 1); // 0.7→green, 1→amber
    return mix(GREEN, AMBER, t);
  }
  const t = clamp((ratio - 1) / 0.25, 0, 1); // 1→amber, 1.25→red
  return mix(AMBER, RED, t);
}

function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: 1,
  };
}

/**
 * BudgetFlow — a schedule/budget/health/forecast timeline in one view.
 *
 * Each task is a ribbon along the time axis. Its THICKNESS encodes the
 * planned budget, a sweeping FILL encodes spend-to-date, the gap between the
 * burn front and the "today" playhead (reinforced by a green→amber→red color
 * spring) reads as health, and a translucent extension past the planned end
 * FORECASTS an over-run when the current burn rate projects over budget.
 * Everything is spring-driven, so logging spend makes the fill flow, the
 * color shift, and the forecast morph in real time.
 */
export class BudgetFlowChart extends Chart<BudgetFlowChartOptions & { data: ChartData }> {
  private gridLayer: SVGGElement;
  private connectorLayer: SVGGElement;
  private flowLayer: SVGGElement;
  private axisLayer: SVGGElement;
  private xAxis: Axis;
  private yAxis: Axis;
  private grid: Grid;
  private tooltip: Tooltip | null = null;
  private pointerTracker: PointerTracker;
  private playhead: SVGLineElement;
  private playheadCap: SVGTextElement;
  private playheadX = new AnimatedValue(0, { stiffness: 150, damping: 22 });
  private items = new Map<string, FlowItem>();
  private connectorPaths: SVGPathElement[] = [];
  private connectorUnsubs: Array<() => void> = [];
  private yBand!: BandScale;
  private timeScale!: TimeScale;
  private hoveredId: string | null = null;
  private lastPointer: PointerPos | null = null;
  private entranceDone = false;

  constructor(el: HTMLElement, options: BudgetFlowChartOptions) {
    super(el, { ...options, data: options.data ?? { series: [] } });
    this.gridLayer = svgEl('g', {}, this.svg);
    this.connectorLayer = svgEl('g', {}, this.svg);
    this.flowLayer = svgEl('g', {}, this.svg);
    this.axisLayer = svgEl('g', {}, this.svg);
    const spring = this.springConfig();
    this.xAxis = new Axis(this.axisLayer, 'bottom', spring);
    this.yAxis = new Axis(this.axisLayer, 'left', spring);
    this.grid = new Grid(this.gridLayer, spring, 'vertical');
    this.playhead = svgEl(
      'line',
      { stroke: 'var(--nova-c2)', 'stroke-width': 2, 'stroke-dasharray': '5,4', opacity: 0 },
      this.svg,
    );
    this.playheadCap = svgEl(
      'text',
      { fill: 'var(--nova-c2)', 'font-size': 10, 'font-weight': 700, 'text-anchor': 'middle' },
      this.svg,
    );
    this.playheadX.onChange((v) => {
      this.playhead.setAttribute('x1', String(v));
      this.playhead.setAttribute('x2', String(v));
      this.playheadCap.setAttribute('x', String(v));
    });
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

  setTasks(tasks: BudgetFlowTask[]): void {
    this.options.tasks = tasks;
    this.update('data');
    this.announcer.announce('Budget flow updated');
  }

  setNow(now: number | Date): void {
    this.options.now = now;
    this.update('data');
  }

  get tasks(): BudgetFlowTask[] {
    return this.options.tasks;
  }

  protected override chartType(): string {
    return 'Budget flow';
  }

  protected override ariaLabel(): string {
    return this.options.ariaLabel ?? `Budget flow timeline, ${this.options.tasks.length} tasks`;
  }

  private money(v: number): string {
    return (this.options.currency ?? ((n: number) => `$${fmtValue(n)}`))(v);
  }

  /** Linear extrapolation of the current burn rate to a projected final cost. */
  private projection(t: BudgetFlowTask, now: number): { ratio: number; overrunFrac: number } {
    const span = toMs(t.end) - toMs(t.start);
    const elapsed = span > 0 ? clamp((now - toMs(t.start)) / span, 0, 1) : 1;
    const burnFrac = t.budget > 0 ? t.spent / t.budget : 0;
    if (elapsed <= 0.001) return { ratio: burnFrac > 0 ? 2 : 1, overrunFrac: 0 };
    const ratio = burnFrac / elapsed; // >1 spending faster than time
    const projectedFinal = t.spent / elapsed; // extrapolate to end
    const overrunFrac = t.budget > 0 ? Math.max((projectedFinal - t.budget) / t.budget, 0) : 0;
    return { ratio, overrunFrac: clamp(overrunFrac, 0, 1.5) };
  }

  protected override update(reason: UpdateReason): void {
    const immediate = this.immediate() || reason === 'resize';
    const spring = this.springConfig();
    const colorSpring = { stiffness: 110, damping: 24 };
    const tasks = this.options.tasks;
    const n = tasks.length;
    const now = this.options.now !== undefined ? toMs(this.options.now) : Date.now();

    // Time domain spans the tasks plus any forecast over-runs.
    let lo = Infinity;
    let hi = -Infinity;
    for (const t of tasks) {
      const s = toMs(t.start);
      const e = toMs(t.end);
      lo = Math.min(lo, s);
      hi = Math.max(hi, e);
      const { overrunFrac } = this.projection(t, now);
      hi = Math.max(hi, e + overrunFrac * (e - s));
    }
    lo = Math.min(lo, now);
    hi = Math.max(hi, now);
    if (lo === Infinity) {
      lo = now;
      hi = now + 7 * DAY;
    }
    const pad = Math.max((hi - lo) * 0.04, DAY / 2);
    this.timeScale = scaleTime({
      domain: [lo - pad, hi + pad],
      range: [this.plot.x, this.plot.x + this.plot.width],
    });
    this.yBand = scaleBand({
      domain: tasks.map((t) => t.id),
      range: [this.plot.y, this.plot.y + this.plot.height],
      paddingInner: 0.45,
      paddingOuter: 0.25,
    });

    // Budget → ribbon thickness. Largest budget fills the lane; others scale
    // by sqrt so thickness reads as "how much money lives here".
    const maxBudget = Math.max(...tasks.map((t) => t.budget), 1);
    const slot = this.yBand.bandwidth();
    const thicknessOf = (b: number): number =>
      Math.max(slot * 0.32 + Math.sqrt(Math.max(b, 0) / maxBudget) * slot * 0.68, 4);

    const chromeImmediate = this.immediate() || reason === 'resize';
    const fmt = this.timeScale.tickFormat();
    const ticks = this.timeScale.ticks(Math.max(3, Math.floor(this.plot.width / 90)));
    this.xAxis.update(
      ticks.map((d) => ({ key: String(d.getTime()), label: fmt(d), pos: this.timeScale(d) })),
      this.plot,
      chromeImmediate,
    );
    this.grid.update(
      ticks.map((d) => ({ key: String(d.getTime()), pos: this.timeScale(d) })),
      this.plot,
      chromeImmediate,
    );
    this.yAxis.update(
      tasks.map((t) => ({ key: t.id, label: t.name ?? t.id, pos: this.yBand.center(t.id) })),
      this.plot,
      chromeImmediate,
    );

    // Playhead.
    const phx = this.timeScale(now);
    this.playhead.setAttribute('y1', String(this.plot.y - 4));
    this.playhead.setAttribute('y2', String(this.plot.y + this.plot.height + 4));
    this.playhead.setAttribute('opacity', '0.9');
    this.playheadCap.setAttribute('y', String(this.plot.y - 8));
    this.playheadCap.textContent = 'TODAY';
    this.playheadX.set(phx, { immediate });

    keyedJoin(
      this.items,
      tasks.map((t, i) => [t.id, { t, i }] as const),
      {
        enter: (_key, { t, i }) => {
          const spec = t.color ?? paletteVar(i);
          const x = this.timeScale(toMs(t.start));
          const w = Math.max(this.timeScale(toMs(t.end)) - x, 2);
          const cy = this.yBand.center(t.id);
          const th = thicknessOf(t.budget);
          const { ratio, overrunFrac } = this.projection(t, now);
          const burnFrac = t.budget > 0 ? clamp(t.spent / t.budget, 0, 1) : 0;
          const hc = healthColor(ratio);

          const g = svgEl('g', { class: 'nova-flow' }, this.flowLayer);
          // Planned-budget envelope (translucent outline of the full ribbon).
          const envelope = svgEl(
            'rect',
            { class: 'nova-flow-envelope', fill: spec, 'fill-opacity': 0.16, stroke: spec, 'stroke-width': 1, rx: 5 },
            g,
          );
          // Forecast over-run extension past the planned end.
          const forecast = svgEl(
            'rect',
            { class: 'nova-flow-forecast', fill: RED_RGB, 'fill-opacity': 0.28, rx: 4 },
            g,
          );
          // Burn fill (health-colored), drawn on top.
          const burn = svgEl('rect', { class: 'nova-flow-burn', rx: 4 }, g);
          const label = svgEl(
            'text',
            { fill: 'var(--nova-fg)', 'font-size': 10, 'font-weight': 600 },
            g,
          );

          const grow = !this.immediate();
          const geo = new AnimatedVec(grow ? [x, cy, 0, th] : [x, cy, w, th], spring);
          const burnAV = new AnimatedValue(grow ? 0 : burnFrac, spring);
          const overrunAV = new AnimatedValue(grow ? 0 : overrunFrac, spring);
          const colorAV = new AnimatedVec([hc.r, hc.g, hc.b, hc.a], colorSpring);
          const opacity = new AnimatedValue(1, spring);

          const item: FlowItem = {
            g,
            envelope,
            burn,
            forecast,
            label,
            geo,
            burnFrac: burnAV,
            overrunFrac: overrunAV,
            color: colorAV,
            opacity,
            task: t,
            removeFn: null,
          };
          const render = (): void => this.renderItem(item);
          geo.onChange(render);
          burnAV.onChange(render);
          overrunAV.onChange(render);
          colorAV.onChange(render);
          geo.onRest(() => {
            if (item.exiting) {
              g.remove();
              this.disposeItem(item);
              item.removeFn?.();
            }
          });
          opacity.onChange((v) => g.setAttribute('opacity', String(Math.max(v, 0))));
          render();
          if (grow) {
            const delay = this.entranceDone ? 0 : stagger(i, n, { each: 80 });
            geo.set([x, cy, w, th], { delays: Float64Array.of(delay, delay, delay, delay) });
            burnAV.set(burnFrac, { delay: delay + 200 });
            overrunAV.set(overrunFrac, { delay: delay + 350 });
          }
          return item;
        },
        update: (item, { t }) => {
          item.task = t;
          const spec = t.color ?? paletteVar(tasks.indexOf(t));
          item.envelope.setAttribute('stroke', spec);
          item.envelope.setAttribute('fill', spec);
          const x = this.timeScale(toMs(t.start));
          const w = Math.max(this.timeScale(toMs(t.end)) - x, 2);
          const { ratio, overrunFrac } = this.projection(t, now);
          const burnFrac = t.budget > 0 ? clamp(t.spent / t.budget, 0, 1) : 0;
          const hc = healthColor(ratio);
          item.geo.set([x, this.yBand.center(t.id), w, thicknessOf(t.budget)], { immediate });
          item.burnFrac.set(burnFrac, { immediate });
          item.overrunFrac.set(overrunFrac, { immediate });
          item.color.set([hc.r, hc.g, hc.b, hc.a], { immediate });
          item.opacity.set(this.hoveredId === null || this.hoveredId === t.id ? 1 : 0.55, {
            immediate,
          });
        },
        exit: (item, remove) => {
          item.removeFn = remove;
          if (immediate) {
            item.g.remove();
            this.disposeItem(item);
            remove();
          } else {
            const t = item.geo.getTargets();
            item.geo.set([t[0]!, t[1]!, 0, t[3]!]);
            item.opacity.set(0);
          }
        },
      },
    );

    this.rebuildConnectors();
    this.entranceDone = true;
    if (this.lastPointer) this.pointerMove(this.lastPointer);
  }

  private renderItem(item: FlowItem): void {
    const v = item.geo.values;
    const x = v[0]!;
    const cy = v[1]!;
    const w = Math.max(v[2]!, 0);
    const th = Math.max(v[3]!, 0);
    const y = cy - th / 2;
    const burnW = w * clamp(item.burnFrac.get(), 0, 1);
    const overW = w * Math.max(item.overrunFrac.get(), 0);

    item.envelope.setAttribute('x', String(x));
    item.envelope.setAttribute('y', String(y));
    item.envelope.setAttribute('width', String(w));
    item.envelope.setAttribute('height', String(th));

    item.burn.setAttribute('x', String(x));
    item.burn.setAttribute('y', String(y));
    item.burn.setAttribute('width', String(burnW));
    item.burn.setAttribute('height', String(th));
    item.burn.setAttribute('fill', vecToRgba(item.color.values));

    if (overW > 0.5) {
      item.forecast.setAttribute('x', String(x + w));
      item.forecast.setAttribute('y', String(y + th * 0.15));
      item.forecast.setAttribute('width', String(overW));
      item.forecast.setAttribute('height', String(th * 0.7));
      item.forecast.setAttribute('opacity', '1');
    } else {
      item.forecast.setAttribute('opacity', '0');
    }

    item.label.setAttribute('x', String(x + 6));
    item.label.setAttribute('y', String(y - 4));
    item.label.textContent = `${item.task.name ?? item.task.id} · ${this.money(item.task.spent)}/${this.money(item.task.budget)}`;
  }

  /** Dependency elbows rebuilt from live animated geometry — they ride the springs. */
  private rebuildConnectors(): void {
    for (const unsub of this.connectorUnsubs) unsub();
    this.connectorUnsubs = [];
    for (const p of this.connectorPaths) p.remove();
    this.connectorPaths = [];
    for (const task of this.options.tasks) {
      const target = this.items.get(task.id);
      if (!target || !task.dependsOn) continue;
      for (const depId of task.dependsOn) {
        const source = this.items.get(depId);
        if (!source) continue;
        const path = svgEl(
          'path',
          {
            fill: 'none',
            stroke: 'var(--nova-fg-muted)',
            'stroke-width': 1.2,
            'stroke-dasharray': '3,3',
            opacity: 0.6,
          },
          this.connectorLayer,
        );
        this.connectorPaths.push(path);
        const redraw = (): void => {
          const s = source.geo.values;
          const t = target.geo.values;
          const sx = s[0]! + s[2]!;
          const sy = s[1]!;
          const tx = t[0]!;
          const ty = t[1]!;
          const elbowX = Math.max(sx + 10, tx - 10);
          path.setAttribute('d', `M${sx},${sy}L${elbowX},${sy}L${elbowX},${ty}L${tx},${ty}`);
        };
        redraw();
        this.connectorUnsubs.push(source.geo.onChange(redraw), target.geo.onChange(redraw));
      }
    }
  }

  private itemAt(p: PointerPos): FlowItem | null {
    const idx = this.yBand.indexAt(p.y);
    const task = this.options.tasks[idx];
    if (!task) return null;
    const item = this.items.get(task.id);
    if (!item || item.exiting) return null;
    const v = item.geo.getTargets();
    const halfMax = Math.max(v[3]!, 0) / 2 + 4;
    if (Math.abs(p.y - v[1]!) > halfMax) return null;
    if (p.x < v[0]! - 6 || p.x > v[0]! + v[2]! * (1 + item.overrunFrac.get()) + 6) return null;
    return item;
  }

  private pointerMove(p: PointerPos | null): void {
    const item = p ? this.itemAt(p) : null;
    const immediate = this.immediate();
    const nextId = item ? item.task.id : null;
    if (nextId !== this.hoveredId) {
      const prev = this.hoveredId ? this.items.get(this.hoveredId) : null;
      this.hoveredId = nextId;
      for (const [id, it] of this.items) {
        if (!it.exiting) it.opacity.set(nextId === null || id === nextId ? 1 : 0.55, { immediate });
      }
      if (prev && p) this.emitTask('point:leave', prev, p);
      if (item && p) this.emitTask('point:enter', item, p);
    }
    if (item && p) {
      const t = item.task;
      const now = this.options.now !== undefined ? toMs(this.options.now) : Date.now();
      const { ratio, overrunFrac } = this.projection(t, now);
      const cpi = ratio > 0 ? 1 / ratio : 1;
      const eac = t.budget * (1 + overrunFrac);
      const variance = t.budget - eac;
      const c = resolveColor(this.el, t.color ?? paletteVar(this.options.tasks.indexOf(t)));
      const dateLabel = (v: number | Date): string =>
        fmtLabel(v instanceof Date ? v : new Date(v));
      const status =
        ratio <= 0.95 ? 'Under budget' : ratio < 1.1 ? 'On track' : 'Over budget';
      this.tooltip?.show(
        {
          title: t.name ?? t.id,
          rows: [
            { color: c, label: 'When', value: `${dateLabel(t.start)} → ${dateLabel(t.end)}` },
            { color: c, label: 'Budget', value: this.money(t.budget) },
            { color: c, label: 'Spent', value: `${this.money(t.spent)} (${Math.round((t.spent / Math.max(t.budget, 1)) * 100)}%)` },
            { color: c, label: 'CPI', value: cpi.toFixed(2) },
            { color: c, label: 'Forecast (EAC)', value: this.money(eac) },
            { color: c, label: 'Variance', value: `${variance >= 0 ? '+' : ''}${this.money(variance)}` },
            { color: c, label: 'Status', value: status },
          ],
        },
        { x: p.x, y: item.geo.getTargets()[1]! },
        immediate,
      );
    } else {
      this.tooltip?.hide(immediate);
    }
  }

  private pointerClick(p: PointerPos): void {
    const item = this.itemAt(p);
    if (item) this.emitTask('point:click', item, p);
  }

  private emitTask(
    type: 'point:enter' | 'point:leave' | 'point:click',
    item: FlowItem,
    p: PointerPos,
  ): void {
    this.emit(type, {
      seriesId: item.task.id,
      index: this.options.tasks.indexOf(item.task),
      value: item.task.spent,
      label: item.task.name ?? item.task.id,
      clientX: p.clientX,
      clientY: p.clientY,
    });
  }

  private disposeItem(item: FlowItem): void {
    item.geo.destroy();
    item.burnFrac.destroy();
    item.overrunFrac.destroy();
    item.color.destroy();
    item.opacity.destroy();
  }

  protected override teardown(): void {
    this.pointerTracker.destroy();
    this.tooltip?.destroy();
    this.xAxis.destroy();
    this.yAxis.destroy();
    this.grid.destroy();
    this.playheadX.destroy();
    for (const unsub of this.connectorUnsubs) unsub();
    for (const p of this.connectorPaths) p.remove();
    for (const item of this.items.values()) this.disposeItem(item);
    this.items.clear();
  }
}
