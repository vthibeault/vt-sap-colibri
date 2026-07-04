import type { BaseChartOptions, ChartData, ChartEvents, Rect, Series } from './types.js';
import type { SpringConfig } from '../motion/spring.js';
import { svgEl, htmlEl } from './svg.js';
import { computeLayout } from './layout.js';
import { injectBaseStyles } from '../theme/default.css.js';
import { paletteVar } from '../theme/theme.js';
import { applyAria, Announcer } from '../a11y/aria.js';
import { prefersReducedMotion } from '../motion/reduced-motion.js';

export type UpdateReason = 'init' | 'data' | 'options' | 'resize';

type Listener<K extends keyof ChartEvents> = (event: ChartEvents[K]) => void;

/**
 * Abstract chart base: owns the root svg + HTML overlay, layout, resize
 * observation, events, series visibility and a11y wiring. Concrete charts
 * implement `update()` — recompute scales, retarget animated values — and
 * MUST call `this.bootstrap()` at the end of their constructor.
 */
export abstract class Chart<O extends BaseChartOptions = BaseChartOptions> {
  readonly el: HTMLElement;
  protected options: O;
  protected svg: SVGSVGElement;
  protected overlay: HTMLDivElement;
  protected width = 0;
  protected height = 0;
  protected plot: Rect = { x: 0, y: 0, width: 0, height: 0 };
  protected announcer: Announcer;
  protected hiddenSeries = new Set<string>();
  protected destroyed = false;
  private resizeObserver: ResizeObserver | null = null;
  private listeners = new Map<keyof ChartEvents, Set<Listener<keyof ChartEvents>>>();
  private booted = false;

  constructor(el: HTMLElement, options: O) {
    injectBaseStyles();
    this.el = el;
    this.options = options;
    el.classList.add('nova-chart');

    this.svg = svgEl('svg', {}, el);
    this.overlay = htmlEl('div', 'nova-overlay', el);
    this.announcer = new Announcer(el);

    if (options.colors) this.applyPalette(options.colors);
    this.measure();

    if (typeof ResizeObserver === 'function' && !options.width && !options.height) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.destroyed || !this.booted) return;
        const prevW = this.width;
        const prevH = this.height;
        this.measure();
        if (this.width !== prevW || this.height !== prevH) this.update('resize');
      });
      this.resizeObserver.observe(el);
    }
  }

  /** Concrete charts call this at the end of their constructor. */
  protected bootstrap(): void {
    this.booted = true;
    applyAria(this.svg, this.ariaLabel());
    this.update('init');
  }

  get data(): ChartData {
    return this.options.data;
  }

  setData(data: ChartData): void {
    this.options.data = data;
    this.update('data');
    applyAria(this.svg, this.ariaLabel());
    this.announcer.announce('Chart data updated');
  }

  setOptions(patch: Partial<O>): void {
    this.options = { ...this.options, ...patch };
    if (patch.colors) this.applyPalette(patch.colors);
    this.update('options');
  }

  toggleSeries(id: string): void {
    const visible = this.hiddenSeries.has(id);
    if (visible) this.hiddenSeries.delete(id);
    else this.hiddenSeries.add(id);
    this.update('data');
    const series = this.options.data.series.find((s) => s.id === id);
    this.emit('series:toggle', { id, visible });
    this.announcer.announce(`${series?.name ?? id} series ${visible ? 'shown' : 'hidden'}`);
  }

  isSeriesVisible(id: string): boolean {
    return !this.hiddenSeries.has(id);
  }

  protected visibleSeries(): Series[] {
    return this.options.data.series.filter((s) => !this.hiddenSeries.has(s.id));
  }

  protected seriesColor(series: Series, index: number): string {
    return series.color ?? paletteVar(index);
  }

  on<K extends keyof ChartEvents>(event: K, fn: Listener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener<keyof ChartEvents>);
    return () => this.off(event, fn);
  }

  off<K extends keyof ChartEvents>(event: K, fn: Listener<K>): void {
    this.listeners.get(event)?.delete(fn as Listener<keyof ChartEvents>);
  }

  protected emit<K extends keyof ChartEvents>(event: K, payload: ChartEvents[K]): void {
    const set = this.listeners.get(event);
    if (set) for (const fn of set) (fn as Listener<K>)(payload);
  }

  resize(): void {
    this.measure();
    this.update('resize');
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.teardown();
    this.announcer.destroy();
    this.svg.remove();
    this.overlay.remove();
    this.el.classList.remove('nova-chart');
    this.listeners.clear();
  }

  /** True when all animation should be skipped. */
  protected immediate(): boolean {
    return this.options.motion?.disabled === true || prefersReducedMotion();
  }

  protected springConfig(): Partial<SpringConfig> {
    return this.options.motion?.spring ?? {};
  }

  protected enterDuration(): number {
    return this.options.motion?.enter?.duration ?? 900;
  }

  protected enterStagger(): number {
    return this.options.motion?.enter?.stagger ?? 40;
  }

  /** Concrete charts: release animated values, observers, listeners. */
  protected abstract teardown(): void;

  protected abstract update(reason: UpdateReason): void;

  protected abstract chartType(): string;

  protected ariaLabel(): string {
    if (this.options.ariaLabel) return this.options.ariaLabel;
    const n = this.options.data.series.length;
    const pts = this.options.data.series[0]?.data.length ?? 0;
    return `${this.chartType()} chart, ${n} ${n === 1 ? 'series' : 'series'}, ${pts} points`;
  }

  private applyPalette(colors: string[]): void {
    colors.forEach((c, i) => this.el.style.setProperty(`--nova-c${i + 1}`, c));
  }

  private measure(): void {
    const rect = this.el.getBoundingClientRect?.();
    this.width = this.options.width ?? (rect && rect.width > 10 ? rect.width : 640);
    this.height = this.options.height ?? (rect && rect.height > 10 ? rect.height : 360);
    this.svg.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
    if (this.options.width) this.svg.setAttribute('width', String(this.width));
    if (this.options.height) this.svg.setAttribute('height', String(this.height));
    this.plot = computeLayout(this.width, this.height, this.options.margin);
  }
}
