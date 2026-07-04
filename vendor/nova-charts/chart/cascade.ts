import { Chart, type UpdateReason } from '../core/chart.js';
import type { BaseChartOptions, ChartData } from '../core/types.js';
import { svgEl } from '../core/svg.js';
import { keyedJoin, type JoinItem } from '../core/join.js';
import { AnimatedValue, AnimatedVec } from '../motion/animated.js';
import { scaleLinear, type LinearScale } from '../scale/linear.js';
import { scaleBand, type BandScale } from '../scale/band.js';
import { Axis } from '../component/axis.js';
import { Grid } from '../component/grid.js';
import { Tooltip } from '../component/tooltip.js';
import { PointerTracker, type PointerPos } from '../interaction/pointer.js';
import { resolveColor } from '../theme/theme.js';
import { vecToRgba, type RGBA } from '../interpolate/color.js';
import { clamp } from '../interpolate/number.js';
import { criticalPath, type CpmTask } from '../analysis/criticalpath.js';

export interface CascadeTask {
  id: string;
  name?: string;
  /** Parent WBS id. Omit for a top-level element. */
  parent?: string;
  /** Activity duration. Omit for WBS summary elements (rolled up from children). */
  duration?: number;
  /** Predecessor ids — activities, or a WBS (⇒ after all its activities). */
  dependsOn?: string[];
  color?: string;
}

export interface CascadeChartOptions extends Omit<BaseChartOptions, 'data'> {
  tasks: CascadeTask[];
  unit?: string;
  /** Days a task slips per click / nudge (default 2). */
  slipStep?: number;
  /** Target finish; the deadline line turns red on overrun. */
  deadline?: number;
  /** WBS ids expanded on first render (default: none — roots collapsed). */
  expanded?: string[];
  data?: ChartData;
}

const GREEN: RGBA = { r: 52, g: 211, b: 153, a: 1 };
const AMBER: RGBA = { r: 251, g: 191, b: 36, a: 1 };
const RED: RGBA = { r: 251, g: 113, b: 133, a: 1 };

function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: 1 };
}

interface RowStat {
  es: number;
  ef: number;
  lf: number;
  float: number;
  critical: boolean;
  depth: number;
  leafCount: number;
}

function healthColor(s: RowStat): RGBA {
  if (s.critical) return RED;
  const dur = Math.max(s.ef - s.es, 1);
  const t = clamp(s.float / (0.5 * dur + 3), 0, 1);
  return mix(AMBER, GREEN, t);
}

interface RowItem extends JoinItem {
  g: SVGGElement;
  bar: SVGPathElement; // activity rect OR WBS summary bracket (one path)
  slack: SVGRectElement;
  chevron: SVGPathElement | null;
  label: SVGTextElement;
  /** [esX, efX, lfX, cy, h] */
  geo: AnimatedVec;
  color: AnimatedVec;
  opacity: AnimatedValue;
  chev: AnimatedValue; // chevron rotation 0→90
  task: CascadeTask;
  isWBS: boolean;
  level: number;
  stat: RowStat;
  colorResolved: string;
  removeFn: (() => void) | null;
}

/**
 * Cascade — an interactive, SAP-style critical-path timeline. Tasks form a WBS
 * hierarchy: collapsed WBS elements show a rolled-up summary bar; click one (or
 * its chevron) to drill into its sub-WBS and activities. The Critical Path
 * Method runs on the leaf activities; each row trails its slack buffer; nudging
 * an activity ripples the delay downstream (staggered by depth) and re-rolls
 * the summaries, so the whole structure breathes.
 */
export class CascadeChart extends Chart<CascadeChartOptions & { data: ChartData }> {
  private gridLayer: SVGGElement;
  private connectorLayer: SVGGElement;
  private rowLayer: SVGGElement;
  private axisLayer: SVGGElement;
  private xAxis: Axis;
  private grid: Grid;
  private tooltip: Tooltip | null = null;
  private pointerTracker: PointerTracker;
  private finishLine: SVGLineElement;
  private finishLabel: SVGTextElement;
  private baselineLine: SVGLineElement;
  private deadlineLine: SVGLineElement | null = null;
  private finishX = new AnimatedValue(0, { stiffness: 150, damping: 20 });
  private baselineX = new AnimatedValue(0, { stiffness: 150, damping: 20 });
  private items = new Map<string, RowItem>();
  private connectors: SVGPathElement[] = [];
  private connectorUnsubs: Array<() => void> = [];
  private slip = new Map<string, number>();
  private expanded = new Set<string>();
  private xScale!: LinearScale;
  private yBand!: BandScale;
  private projectFinish = 0;
  private baselineFinish = 0;
  private cpm = criticalPath([]);
  private hoveredId: string | null = null;
  private lastPointer: PointerPos | null = null;
  private entranceDone = false;

  constructor(el: HTMLElement, options: CascadeChartOptions) {
    super(el, { ...options, data: options.data ?? { series: [] } });
    for (const id of options.expanded ?? []) this.expanded.add(id);
    this.gridLayer = svgEl('g', {}, this.svg);
    this.connectorLayer = svgEl('g', {}, this.svg);
    this.rowLayer = svgEl('g', {}, this.svg);
    this.axisLayer = svgEl('g', {}, this.svg);
    const spring = this.springConfig();
    this.xAxis = new Axis(this.axisLayer, 'bottom', spring);
    this.grid = new Grid(this.gridLayer, spring, 'vertical');
    this.baselineLine = svgEl(
      'line',
      { stroke: 'var(--nova-fg-muted)', 'stroke-width': 1, 'stroke-dasharray': '2,3', opacity: 0 },
      this.svg,
    );
    this.finishLine = svgEl(
      'line',
      { stroke: 'var(--nova-c2)', 'stroke-width': 2, 'stroke-dasharray': '5,4', opacity: 0 },
      this.svg,
    );
    this.finishLabel = svgEl(
      'text',
      { fill: 'var(--nova-c2)', 'font-size': 11, 'font-weight': 700, 'text-anchor': 'middle' },
      this.svg,
    );
    this.baselineX.onChange((v) => {
      this.baselineLine.setAttribute('x1', String(v));
      this.baselineLine.setAttribute('x2', String(v));
    });
    this.finishX.onChange((v) => {
      this.finishLine.setAttribute('x1', String(v));
      this.finishLine.setAttribute('x2', String(v));
      this.finishLabel.setAttribute('x', String(v));
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

  // ---- public API -----------------------------------------------------------

  nudge(id: string, days?: number): void {
    const step = days ?? this.options.slipStep ?? 2;
    this.slip.set(id, (this.slip.get(id) ?? 0) + step);
    this.update('data');
    this.announcer.announce(`${id} slipped; cascade updated`);
  }

  reset(): void {
    this.slip.clear();
    this.update('data');
  }

  toggle(id: string): void {
    if (this.expanded.has(id)) this.expanded.delete(id);
    else this.expanded.add(id);
    this.update('data');
  }

  expandAll(): void {
    for (const t of this.options.tasks) if (this.hasChildren(t.id)) this.expanded.add(t.id);
    this.update('data');
  }

  collapseAll(): void {
    this.expanded.clear();
    this.update('data');
  }

  setTasks(tasks: CascadeTask[]): void {
    this.options.tasks = tasks;
    this.slip.clear();
    this.update('data');
  }

  get tasks(): CascadeTask[] {
    return this.options.tasks;
  }

  protected override chartType(): string {
    return 'Cascade';
  }

  protected override ariaLabel(): string {
    return this.options.ariaLabel ?? `WBS cascade, ${this.options.tasks.length} elements`;
  }

  // ---- tree helpers ---------------------------------------------------------

  private childrenOf(id: string): CascadeTask[] {
    return this.options.tasks.filter((t) => t.parent === id);
  }

  private hasChildren(id: string): boolean {
    return this.options.tasks.some((t) => t.parent === id);
  }

  private roots(): CascadeTask[] {
    const ids = new Set(this.options.tasks.map((t) => t.id));
    return this.options.tasks.filter((t) => !t.parent || !ids.has(t.parent));
  }

  private subtreeLeaves(id: string, acc: string[] = []): string[] {
    const kids = this.childrenOf(id);
    if (kids.length === 0) {
      acc.push(id); // a leaf
    } else {
      for (const k of kids) this.subtreeLeaves(k.id, acc);
    }
    return acc;
  }

  private unit(): string {
    return this.options.unit ?? 'd';
  }

  // ---- update ---------------------------------------------------------------

  protected override update(reason: UpdateReason): void {
    const immediate = this.immediate() || reason === 'resize';
    const spring = this.springConfig();
    const colorSpring = { stiffness: 110, damping: 24 };
    const tasks = this.options.tasks;
    const rippling = reason === 'data';

    const leaves = tasks.filter((t) => !this.hasChildren(t.id));
    const leafIds = new Set(leaves.map((t) => t.id));
    // Expand a dependency on a WBS into all its leaf activities.
    const expandDep = (dep: string): string[] =>
      leafIds.has(dep) ? [dep] : this.subtreeLeaves(dep);

    const cpmTasks: CpmTask[] = leaves.map((t) => ({
      id: t.id,
      duration: t.duration ?? 0,
      dependsOn: (t.dependsOn ?? []).flatMap(expandDep).filter((d) => d !== t.id),
      slip: this.slip.get(t.id) ?? 0,
    }));
    if (reason !== 'resize') {
      this.cpm = criticalPath(cpmTasks);
      this.baselineFinish = criticalPath(
        cpmTasks.map((t) => ({ id: t.id, duration: t.duration, dependsOn: t.dependsOn })),
      ).projectFinish;
    }
    const cpm = this.cpm;
    this.projectFinish = cpm.projectFinish;

    const statOf = (id: string): RowStat => {
      if (leafIds.has(id)) {
        const n = cpm.nodes.get(id)!;
        return { es: n.es, ef: n.ef, lf: n.lf, float: n.float, critical: n.critical, depth: n.depth, leafCount: 1 };
      }
      const kids = this.subtreeLeaves(id).map((l) => cpm.nodes.get(l)!).filter(Boolean);
      const es = Math.min(...kids.map((k) => k.es));
      const ef = Math.max(...kids.map((k) => k.ef));
      const float = Math.min(...kids.map((k) => k.float));
      const depth = Math.min(...kids.map((k) => k.depth));
      const critical = kids.some((k) => k.critical);
      return { es, ef, lf: ef + Math.max(float, 0), float, critical, depth, leafCount: kids.length };
    };

    // Visible rows: DFS from roots, descending into expanded WBS.
    const rows: { id: string; level: number }[] = [];
    const walk = (t: CascadeTask, level: number): void => {
      rows.push({ id: t.id, level });
      if (this.hasChildren(t.id) && this.expanded.has(t.id)) {
        for (const c of this.childrenOf(t.id)) walk(c, level + 1);
      }
    };
    for (const r of this.roots()) walk(r, 0);

    const horizon = Math.max(this.projectFinish, this.baselineFinish, this.options.deadline ?? 0, 1);
    this.xScale = scaleLinear({
      domain: [0, horizon],
      range: [this.plot.x, this.plot.x + this.plot.width],
      nice: true,
    });
    this.yBand = scaleBand({
      domain: rows.map((r) => r.id),
      range: [this.plot.y, this.plot.y + this.plot.height],
      paddingInner: 0.35,
      paddingOuter: 0.18,
    });

    const chromeImmediate = this.immediate() || reason === 'resize';
    const xticks = this.xScale.ticks(Math.max(3, Math.floor(this.plot.width / 80)));
    this.xAxis.update(
      xticks.map((v) => ({ key: String(v), label: `${Math.round(v)}${this.unit()}`, pos: this.xScale(v) })),
      this.plot,
      chromeImmediate,
    );
    this.grid.update(
      xticks.map((v) => ({ key: String(v), pos: this.xScale(v) })),
      this.plot,
      chromeImmediate,
    );

    // Finish / baseline / deadline lines.
    const top = this.plot.y - 4;
    const bot = this.plot.y + this.plot.height + 4;
    for (const ln of [this.finishLine, this.baselineLine]) {
      ln.setAttribute('y1', String(top));
      ln.setAttribute('y2', String(bot));
    }
    this.finishLine.setAttribute('opacity', '0.9');
    this.finishLabel.setAttribute('y', String(top - 2));
    const overrun = this.projectFinish - this.baselineFinish;
    this.finishLabel.textContent =
      `Finish ${Math.round(this.projectFinish)}${this.unit()}` + (overrun > 0.001 ? ` (+${Math.round(overrun)})` : '');
    this.finishX.set(this.xScale(this.projectFinish), { immediate });
    this.baselineLine.setAttribute('opacity', overrun > 0.001 ? '0.7' : '0');
    this.baselineX.set(this.xScale(this.baselineFinish), { immediate });
    this.renderDeadline(top, bot);

    const rowH = this.yBand.bandwidth();

    keyedJoin(
      this.items,
      rows.map((r, i) => [r.id, { ...r, i }] as const),
      {
        enter: (_key, r, i) => {
          const task = tasks.find((t) => t.id === r.id)!;
          const isWBS = this.hasChildren(r.id);
          const stat = statOf(r.id);
          const cy = this.yBand.center(r.id);
          const hc = healthColor(stat);
          const g = svgEl('g', { class: isWBS ? 'nova-row nova-wbs' : 'nova-row' }, this.rowLayer);
          const slack = svgEl('rect', { class: 'nova-cascade-slack', rx: 3, 'fill-opacity': 0.22 }, g);
          const bar = svgEl('path', { class: 'nova-cascade-bar' }, g);
          const chevron = isWBS
            ? svgEl('path', { class: 'nova-cascade-chevron', d: 'M-3,-4L3,0L-3,4Z', fill: 'var(--nova-fg-muted)' }, g)
            : null;
          const label = svgEl(
            'text',
            { fill: 'var(--nova-fg)', 'font-size': 11, 'font-weight': isWBS ? 700 : 400, dy: '0.32em' },
            g,
          );
          const esX = this.xScale(stat.es);
          const efX = this.xScale(stat.ef);
          const lfX = this.xScale(stat.lf);
          const grow = !this.immediate();
          const geo = new AnimatedVec(grow ? [esX, esX, esX, cy, rowH] : [esX, efX, lfX, cy, rowH], spring);
          const color = new AnimatedVec([hc.r, hc.g, hc.b, hc.a], colorSpring);
          const opacity = new AnimatedValue(grow && this.entranceDone ? 0 : 1, spring);
          const chev = new AnimatedValue(this.expanded.has(r.id) ? 90 : 0, { stiffness: 240, damping: 22 });
          const item: RowItem = {
            g, bar, slack, chevron, label, geo, color, opacity, chev,
            task, isWBS, level: r.level, stat,
            colorResolved: resolveColor(this.el, vecToRgba([hc.r, hc.g, hc.b, hc.a])),
            removeFn: null,
          };
          const render = (): void => this.renderRow(item);
          geo.onChange(render);
          color.onChange(render);
          chev.onChange(render);
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
            const delay = this.entranceDone ? 0 : i * 55;
            geo.set([esX, efX, lfX, cy, rowH], { delays: Float64Array.of(delay, delay, delay, delay, delay) });
            if (this.entranceDone) opacity.set(1);
          }
          return item;
        },
        update: (item, r) => {
          item.task = tasks.find((t) => t.id === r.id)!;
          item.level = r.level;
          item.stat = statOf(r.id);
          const hc = healthColor(item.stat);
          item.colorResolved = resolveColor(this.el, vecToRgba([hc.r, hc.g, hc.b, hc.a]));
          const esX = this.xScale(item.stat.es);
          const efX = this.xScale(item.stat.ef);
          const lfX = this.xScale(item.stat.lf);
          const delay = rippling && !immediate ? item.stat.depth * 70 : 0;
          item.geo.set([esX, efX, lfX, this.yBand.center(r.id), rowH], {
            immediate,
            delays: Float64Array.of(delay, delay, delay, delay, delay),
          });
          item.color.set([hc.r, hc.g, hc.b, hc.a], { immediate, ...(delay ? { delay } : {}) });
          item.opacity.set(this.hoveredId === null || this.hoveredId === r.id ? 1 : 0.5, { immediate });
          item.chev.set(this.expanded.has(r.id) ? 90 : 0, { immediate });
        },
        exit: (item, remove) => {
          item.removeFn = remove;
          if (immediate) {
            item.g.remove();
            this.disposeItem(item);
            remove();
          } else {
            const t = item.geo.getTargets();
            item.geo.set([t[0]!, t[0]!, t[0]!, t[3]!, t[4]!]);
            item.opacity.set(0);
          }
        },
      },
    );

    this.rebuildConnectors(leafIds);
    this.entranceDone = true;
    if (this.lastPointer) this.pointerMove(this.lastPointer);
  }

  private renderDeadline(top: number, bot: number): void {
    if (this.options.deadline === undefined) {
      this.deadlineLine?.remove();
      this.deadlineLine = null;
      return;
    }
    if (!this.deadlineLine) this.deadlineLine = svgEl('line', { 'stroke-width': 2 }, this.svg);
    const over = this.projectFinish > this.options.deadline + 0.001;
    const x = this.xScale(this.options.deadline);
    this.deadlineLine.setAttribute('x1', String(x));
    this.deadlineLine.setAttribute('x2', String(x));
    this.deadlineLine.setAttribute('y1', String(top));
    this.deadlineLine.setAttribute('y2', String(bot));
    this.deadlineLine.setAttribute('stroke', over ? 'var(--nova-c7)' : 'var(--nova-c4)');
    this.deadlineLine.setAttribute('opacity', '0.8');
  }

  /** Left-gutter x for a row's chevron, by indent level. */
  private gutterX(level: number): number {
    return 10 + level * 15;
  }

  private renderRow(item: RowItem): void {
    const v = item.geo.values;
    const esX = v[0]!;
    const efX = v[1]!;
    const lfX = v[2]!;
    const cy = v[3]!;
    const h = Math.max(v[4]!, 0);
    const fill = vecToRgba(item.color.values);

    // Timeline bar.
    if (item.isWBS) {
      // SAP-style summary bracket: thin bar with downward legs at both ends.
      const hs = h * 0.4;
      const tp = cy - hs / 2;
      const bp = cy + hs / 2;
      const leg = Math.min(bp - tp + 5, h / 2);
      const lx = Math.min(esX + 5, (esX + efX) / 2);
      const rx = Math.max(efX - 5, (esX + efX) / 2);
      item.bar.setAttribute(
        'd',
        `M${esX},${tp}L${efX},${tp}L${efX},${cy + leg}L${rx},${bp}L${lx},${bp}L${esX},${cy + leg}Z`,
      );
      item.bar.setAttribute('fill', fill);
      item.bar.setAttribute('fill-opacity', '0.95');
    } else {
      const y = cy - h / 2;
      const w = Math.max(efX - esX, 0);
      item.bar.setAttribute(
        'd',
        `M${esX + 4},${y}L${esX + w},${y}Q${esX + w + 4},${y} ${esX + w + 4},${y + 4}` +
          `L${esX + w + 4},${y + h - 4}Q${esX + w + 4},${y + h} ${esX + w},${y + h}` +
          `L${esX + 4},${y + h}Q${esX},${y + h} ${esX},${y + h - 4}L${esX},${y + 4}Q${esX},${y} ${esX + 4},${y}Z`,
      );
      item.bar.setAttribute('fill', fill);
      item.bar.setAttribute('fill-opacity', '1');
    }

    // Slack buffer.
    const slackW = Math.max(lfX - efX, 0);
    item.slack.setAttribute('x', String(efX));
    item.slack.setAttribute('y', String(cy - h * 0.3));
    item.slack.setAttribute('width', String(slackW));
    item.slack.setAttribute('height', String(h * 0.6));
    item.slack.setAttribute('fill', fill);
    item.slack.setAttribute('opacity', slackW > 1 ? '1' : '0');

    // Left-gutter tree: chevron + indented label.
    const gx = this.gutterX(item.level);
    if (item.chevron) {
      item.chevron.setAttribute('transform', `translate(${gx},${cy}) rotate(${item.chev.get()})`);
    }
    item.label.setAttribute('x', String(gx + (item.isWBS ? 12 : 6)));
    item.label.setAttribute('y', String(cy));
    const suffix = item.isWBS ? `  (${item.stat.leafCount})` : '';
    item.label.textContent = (item.task.name ?? item.task.id) + suffix;
  }

  private rebuildConnectors(leafIds: Set<string>): void {
    for (const u of this.connectorUnsubs) u();
    this.connectorUnsubs = [];
    for (const p of this.connectors) p.remove();
    this.connectors = [];
    // Only draw a connector when both endpoints are currently visible rows.
    for (const task of this.options.tasks) {
      const target = this.items.get(task.id);
      if (!target || !task.dependsOn) continue;
      for (const depId of task.dependsOn) {
        const source = this.items.get(depId);
        if (!source || !leafIds.has(task.id)) continue;
        const path = svgEl(
          'path',
          { fill: 'none', stroke: 'var(--nova-fg-muted)', 'stroke-width': 1.2, 'stroke-dasharray': '3,3', opacity: 0.5 },
          this.connectorLayer,
        );
        this.connectors.push(path);
        const redraw = (): void => {
          const s = source.geo.values;
          const t = target.geo.values;
          const sx = s[1]!;
          const sy = s[3]!;
          const tx = t[0]!;
          const ty = t[3]!;
          const elbow = Math.max(sx + 8, tx - 8);
          path.setAttribute('d', `M${sx},${sy}L${elbow},${sy}L${elbow},${ty}L${tx},${ty}`);
        };
        redraw();
        this.connectorUnsubs.push(source.geo.onChange(redraw), target.geo.onChange(redraw));
      }
    }
  }

  // ---- interaction ----------------------------------------------------------

  private rowAt(p: PointerPos): RowItem | null {
    let best: RowItem | null = null;
    let bestDy = Infinity;
    for (const item of this.items.values()) {
      if (item.exiting) continue;
      const cy = item.geo.getTargets()[3]!;
      const dy = Math.abs(p.y - cy);
      if (dy < this.yBand.bandwidth() / 2 + 4 && dy < bestDy) {
        bestDy = dy;
        best = item;
      }
    }
    return best;
  }

  private pointerMove(p: PointerPos | null): void {
    const item = p ? this.rowAt(p) : null;
    const immediate = this.immediate();
    const nextId = item ? item.task.id : null;
    if (nextId !== this.hoveredId) {
      this.hoveredId = nextId;
      for (const [id, it] of this.items) {
        if (!it.exiting) it.opacity.set(nextId === null || id === nextId ? 1 : 0.5, { immediate });
      }
    }
    if (item && p) {
      const s = item.stat;
      const c = item.colorResolved;
      const u = this.unit();
      const rows = [
        { color: c, label: 'Window', value: `${Math.round(s.es)}–${Math.round(s.ef)}${u}` },
        { color: c, label: 'Slack', value: s.critical ? 'none (critical)' : `${Math.round(s.float)}${u}` },
      ];
      if (item.isWBS) {
        rows.push({ color: c, label: 'Activities', value: `${s.leafCount}` });
        rows.push({ color: c, label: '', value: this.expanded.has(item.task.id) ? 'click to collapse' : 'click to expand' });
      } else {
        rows.push({
          color: c,
          label: s.critical ? 'Status' : 'Can slip',
          value: s.critical ? 'on critical path' : `${Math.round(s.float)}${u} before it bites`,
        });
        rows.push({ color: c, label: '', value: `click to slip +${this.options.slipStep ?? 2}${u}` });
      }
      this.tooltip?.show(
        { title: item.task.name ?? item.task.id, rows },
        { x: Math.max(this.xScale(s.ef), p.x), y: item.geo.getTargets()[3]! },
        immediate,
      );
    } else {
      this.tooltip?.hide(immediate);
    }
  }

  private pointerClick(p: PointerPos): void {
    const item = this.rowAt(p);
    if (!item) return;
    this.emit('point:click', {
      seriesId: item.task.id,
      index: this.options.tasks.findIndex((t) => t.id === item.task.id),
      value: item.stat.float,
      label: item.task.name ?? item.task.id,
      clientX: p.clientX,
      clientY: p.clientY,
    });
    // WBS row (or a click in the left gutter) drills in; an activity bar slips.
    if (item.isWBS || p.x < this.plot.x) this.toggle(item.task.id);
    else this.nudge(item.task.id);
  }

  private disposeItem(item: RowItem): void {
    item.geo.destroy();
    item.color.destroy();
    item.opacity.destroy();
    item.chev.destroy();
  }

  protected override teardown(): void {
    this.pointerTracker.destroy();
    this.xAxis.destroy();
    this.grid.destroy();
    this.tooltip?.destroy();
    this.finishX.destroy();
    this.baselineX.destroy();
    for (const u of this.connectorUnsubs) u();
    for (const p of this.connectors) p.remove();
    for (const item of this.items.values()) this.disposeItem(item);
    this.items.clear();
  }
}
