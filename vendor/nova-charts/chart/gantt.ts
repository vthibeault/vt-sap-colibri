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
import { fmtLabel } from '../core/format.js';

export interface GanttTask {
  id: string;
  name?: string;
  start: number | Date;
  end: number | Date;
  /** Completion fraction 0–1, rendered as a brighter overlay. */
  progress?: number;
  /** Task ids this task depends on (drawn as elbow connectors). */
  dependsOn?: string[];
  color?: string;
}

export interface GanttChartOptions extends Omit<BaseChartOptions, 'data'> {
  tasks: GanttTask[];
  /** Vertical marker line (e.g. today). */
  marker?: { value: number | Date; label?: string };
  data?: ChartData;
}

interface TaskItem extends JoinItem {
  g: SVGGElement;
  bar: SVGRectElement;
  progressBar: SVGRectElement;
  /** [x, y, w, h] */
  vec: AnimatedVec;
  progress: AnimatedValue;
  opacity: AnimatedValue;
  task: GanttTask;
  removeFn: (() => void) | null;
}

const toMs = (v: number | Date): number => (v instanceof Date ? v.getTime() : v);
const DAY = 86_400_000;

/**
 * Gantt chart: tasks as rounded bars on a time axis, with spring-animated
 * progress overlays and dependency connectors that ride the morphs.
 * Reschedule a task and everything — bar, connectors, axis — glides.
 */
export class GanttChart extends Chart<GanttChartOptions & { data: ChartData }> {
  private gridLayer: SVGGElement;
  private taskLayer: SVGGElement;
  private connectorLayer: SVGGElement;
  private axisLayer: SVGGElement;
  private xAxis: Axis;
  private yAxis: Axis;
  private grid: Grid;
  private tooltip: Tooltip | null = null;
  private pointerTracker: PointerTracker;
  private markerLine: SVGLineElement;
  private markerX = new AnimatedValue(0);
  private items = new Map<string, TaskItem>();
  private connectorPaths: SVGPathElement[] = [];
  private connectorUnsubs: Array<() => void> = [];
  private yBand!: BandScale;
  private timeScale!: TimeScale;
  private hoveredId: string | null = null;
  private lastPointer: PointerPos | null = null;
  private entranceDone = false;

  constructor(el: HTMLElement, options: GanttChartOptions) {
    super(el, { ...options, data: options.data ?? { series: [] } });
    this.gridLayer = svgEl('g', {}, this.svg);
    this.connectorLayer = svgEl('g', {}, this.svg);
    this.taskLayer = svgEl('g', {}, this.svg);
    this.axisLayer = svgEl('g', {}, this.svg);
    const spring = this.springConfig();
    this.xAxis = new Axis(this.axisLayer, 'bottom', spring);
    this.yAxis = new Axis(this.axisLayer, 'left', spring);
    this.grid = new Grid(this.gridLayer, spring, 'vertical');
    this.markerLine = svgEl(
      'line',
      { stroke: 'var(--nova-c5)', 'stroke-width': 1.5, 'stroke-dasharray': '4,3', opacity: 0 },
      this.svg,
    );
    this.markerX.onChange((v) => {
      this.markerLine.setAttribute('x1', String(v));
      this.markerLine.setAttribute('x2', String(v));
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

  get tasks(): GanttTask[] {
    return this.options.tasks;
  }

  setTasks(tasks: GanttTask[]): void {
    this.options.tasks = tasks;
    this.update('data');
    this.announcer.announce('Schedule updated');
  }

  protected override chartType(): string {
    return 'Gantt';
  }

  protected override ariaLabel(): string {
    return this.options.ariaLabel ?? `Gantt chart, ${this.options.tasks.length} tasks`;
  }

  protected override update(reason: UpdateReason): void {
    const immediate = this.immediate() || reason === 'resize';
    const spring = this.springConfig();
    const tasks = this.options.tasks;
    const n = tasks.length;

    let lo = Infinity;
    let hi = -Infinity;
    for (const t of tasks) {
      lo = Math.min(lo, toMs(t.start));
      hi = Math.max(hi, toMs(t.end));
    }
    if (this.options.marker) {
      lo = Math.min(lo, toMs(this.options.marker.value));
      hi = Math.max(hi, toMs(this.options.marker.value));
    }
    if (lo === Infinity) {
      lo = Date.now();
      hi = lo + 7 * DAY;
    }
    const pad = Math.max((hi - lo) * 0.04, DAY / 4);
    this.timeScale = scaleTime({
      domain: [lo - pad, hi + pad],
      range: [this.plot.x, this.plot.x + this.plot.width],
    });
    this.yBand = scaleBand({
      domain: tasks.map((t) => t.id),
      range: [this.plot.y, this.plot.y + this.plot.height],
      paddingInner: 0.35,
      paddingOuter: 0.2,
    });

    const chromeImmediate = this.immediate() || reason === 'resize';
    const fmt = this.timeScale.tickFormat();
    const ticks = this.timeScale.ticks(Math.max(3, Math.floor(this.plot.width / 90)));
    this.xAxis.update(
      ticks.map((d) => ({
        key: String(d.getTime()),
        label: fmt(d),
        pos: this.timeScale(d),
      })),
      this.plot,
      chromeImmediate,
    );
    this.grid.update(
      ticks.map((d) => ({ key: String(d.getTime()), pos: this.timeScale(d) })),
      this.plot,
      chromeImmediate,
    );
    this.yAxis.update(
      tasks.map((t) => ({
        key: t.id,
        label: t.name ?? t.id,
        pos: this.yBand.center(t.id),
      })),
      this.plot,
      chromeImmediate,
    );

    // Marker line (e.g. today).
    if (this.options.marker) {
      const mx = this.timeScale(toMs(this.options.marker.value));
      this.markerLine.setAttribute('y1', String(this.plot.y));
      this.markerLine.setAttribute('y2', String(this.plot.y + this.plot.height));
      this.markerLine.setAttribute('opacity', '0.8');
      this.markerX.set(mx, { immediate });
    } else {
      this.markerLine.setAttribute('opacity', '0');
    }

    const h = this.yBand.bandwidth();

    keyedJoin(
      this.items,
      tasks.map((t, i) => [t.id, { t, i }] as const),
      {
        enter: (_key, { t, i }) => {
          const spec = t.color ?? paletteVar(i);
          const x = this.timeScale(toMs(t.start));
          const y = this.yBand(t.id);
          const w = Math.max(this.timeScale(toMs(t.end)) - x, 2);
          const g = svgEl('g', {}, this.taskLayer);
          const rx = Math.min(h * 0.3, 6);
          const bar = svgEl('rect', { fill: spec, 'fill-opacity': 0.3, rx }, g);
          const progressBar = svgEl('rect', { fill: spec, rx }, g);
          const grow = !this.immediate();
          const vec = new AnimatedVec(grow ? [x, y, 0, h] : [x, y, w, h], spring);
          const progress = new AnimatedValue(grow ? 0 : t.progress ?? 0, spring);
          const opacity = new AnimatedValue(1, spring);
          const item: TaskItem = {
            g,
            bar,
            progressBar,
            vec,
            progress,
            opacity,
            task: t,
            removeFn: null,
          };
          const repaint = (): void => {
            const v = vec.values;
            bar.setAttribute('x', String(v[0]!));
            bar.setAttribute('y', String(v[1]!));
            bar.setAttribute('width', String(Math.max(v[2]!, 0)));
            bar.setAttribute('height', String(Math.max(v[3]!, 0)));
            progressBar.setAttribute('x', String(v[0]!));
            progressBar.setAttribute('y', String(v[1]!));
            progressBar.setAttribute(
              'width',
              String(Math.max(v[2]! * Math.min(Math.max(progress.get(), 0), 1), 0)),
            );
            progressBar.setAttribute('height', String(Math.max(v[3]!, 0)));
          };
          vec.onChange(repaint);
          progress.onChange(repaint);
          vec.onRest(() => {
            if (item.exiting) {
              g.remove();
              this.disposeTask(item);
              item.removeFn?.();
            }
          });
          opacity.onChange((v) => g.setAttribute('opacity', String(Math.max(v, 0))));
          repaint();
          if (grow) {
            const delay = this.entranceDone ? 0 : stagger(i, n, { each: 70 });
            vec.set([x, y, w, h], { delays: Float64Array.of(delay, delay, delay, delay) });
            progress.set(t.progress ?? 0, { delay: delay + 250 });
          }
          return item;
        },
        update: (item, { t }) => {
          item.task = t;
          const spec = t.color ?? paletteVar(tasks.indexOf(t));
          item.bar.setAttribute('fill', spec);
          item.progressBar.setAttribute('fill', spec);
          const x = this.timeScale(toMs(t.start));
          const w = Math.max(this.timeScale(toMs(t.end)) - x, 2);
          item.vec.set([x, this.yBand(t.id), w, h], { immediate });
          item.progress.set(t.progress ?? 0, { immediate });
          item.opacity.set(1, { immediate });
        },
        exit: (item, remove) => {
          item.removeFn = remove;
          if (immediate) {
            item.g.remove();
            this.disposeTask(item);
            remove();
          } else {
            const t = item.vec.getTargets();
            item.vec.set([t[0]!, t[1]!, 0, t[3]!]);
            item.opacity.set(0);
          }
        },
      },
    );

    this.rebuildConnectors();
    this.entranceDone = true;
    if (this.lastPointer) this.pointerMove(this.lastPointer);
  }

  /**
   * Dependency elbows are rebuilt from the *current animated* bar geometry
   * on every frame either endpoint moves — they ride the springs for free.
   */
  private rebuildConnectors(): void {
    for (const unsub of this.connectorUnsubs) unsub();
    this.connectorUnsubs = [];
    for (const path of this.connectorPaths) path.remove();
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
            opacity: 0.7,
          },
          this.connectorLayer,
        );
        this.connectorPaths.push(path);
        const redraw = (): void => {
          const s = source.vec.values;
          const t = target.vec.values;
          const sx = s[0]! + s[2]!;
          const sy = s[1]! + s[3]! / 2;
          const tx = t[0]!;
          const ty = t[1]! + t[3]! / 2;
          const elbowX = Math.max(sx + 10, tx - 10);
          path.setAttribute(
            'd',
            `M${sx},${sy}L${elbowX},${sy}L${elbowX},${ty}L${tx},${ty}`,
          );
        };
        redraw();
        this.connectorUnsubs.push(source.vec.onChange(redraw), target.vec.onChange(redraw));
      }
    }
  }

  private taskAt(p: PointerPos): TaskItem | null {
    const idx = this.yBand.indexAt(p.y);
    const task = this.options.tasks[idx];
    if (!task) return null;
    const item = this.items.get(task.id);
    if (!item || item.exiting) return null;
    const t = item.vec.getTargets();
    if (p.x < t[0]! - 8 || p.x > t[0]! + t[2]! + 8) return null;
    return item;
  }

  private pointerMove(p: PointerPos | null): void {
    const item = p ? this.taskAt(p) : null;
    const immediate = this.immediate();
    const nextId = item ? item.task.id : null;
    if (nextId !== this.hoveredId) {
      const prev = this.hoveredId ? this.items.get(this.hoveredId) : null;
      this.hoveredId = nextId;
      if (prev && !prev.exiting) prev.bar.setAttribute('fill-opacity', '0.3');
      if (item) {
        item.bar.setAttribute('fill-opacity', '0.5');
        if (p) this.emitTask('point:enter', item, p);
      }
      if (prev && p) this.emitTask('point:leave', prev, p);
    }
    if (item && p) {
      const t = item.task;
      const days = Math.max(Math.round((toMs(t.end) - toMs(t.start)) / DAY), 0);
      const color = resolveColor(
        this.el,
        t.color ?? paletteVar(this.options.tasks.indexOf(t)),
      );
      const dateLabel = (v: number | Date): string =>
        fmtLabel(v instanceof Date ? v : new Date(v));
      this.tooltip?.show(
        {
          title: t.name ?? t.id,
          rows: [
            {
              color,
              label: 'When',
              value: `${dateLabel(t.start)} → ${dateLabel(t.end)}`,
            },
            { color, label: 'Duration', value: `${days}d` },
            ...(t.progress !== undefined
              ? [{ color, label: 'Progress', value: `${Math.round(t.progress * 100)}%` }]
              : []),
          ],
        },
        { x: p.x, y: this.yBand.center(t.id) },
        immediate,
      );
    } else {
      this.tooltip?.hide(immediate);
    }
  }

  private pointerClick(p: PointerPos): void {
    const item = this.taskAt(p);
    if (item) this.emitTask('point:click', item, p);
  }

  private emitTask(
    type: 'point:enter' | 'point:leave' | 'point:click',
    item: TaskItem,
    p: PointerPos,
  ): void {
    this.emit(type, {
      seriesId: item.task.id,
      index: this.options.tasks.indexOf(item.task),
      value: item.task.progress ?? 0,
      label: item.task.name ?? item.task.id,
      clientX: p.clientX,
      clientY: p.clientY,
    });
  }

  private disposeTask(item: TaskItem): void {
    item.vec.destroy();
    item.progress.destroy();
    item.opacity.destroy();
  }

  protected override teardown(): void {
    this.pointerTracker.destroy();
    this.tooltip?.destroy();
    this.xAxis.destroy();
    this.yAxis.destroy();
    this.grid.destroy();
    this.markerX.destroy();
    for (const unsub of this.connectorUnsubs) unsub();
    for (const path of this.connectorPaths) path.remove();
    for (const item of this.items.values()) this.disposeTask(item);
    this.items.clear();
  }
}
