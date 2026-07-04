import { Chart, type UpdateReason } from '../core/chart.js';
import type { BaseChartOptions } from '../core/types.js';
import { svgEl } from '../core/svg.js';
import { AnimatedValue, AnimatedVec } from '../motion/animated.js';
import { runTween } from '../motion/tween.js';
import { buildArcPath } from '../shape/arc.js';
import { parseColor, vecToRgba } from '../interpolate/color.js';
import { resolveColor, paletteVar } from '../theme/theme.js';
import { fmtValue, datumValue } from '../core/format.js';
import { clamp } from '../interpolate/number.js';

export interface GaugeChartOptions extends BaseChartOptions {
  min?: number;
  max?: number;
  /** Sweep start/end in radians; 0 is up, clockwise. Default ±2.1 (~240°). */
  startAngle?: number;
  endAngle?: number;
  /** Ring thickness as inner-radius fraction of the outer (default 0.74). */
  innerRadius?: number;
  /** Value formatter for the center readout. */
  format?: (value: number) => string;
  /** Color the arc by value: first stop whose `until` >= value wins. */
  colorStops?: { until: number; color: string }[];
}

/**
 * Radial gauge. The value arc sweeps on a spring, its color springs through
 * rgba space as it crosses stops, and the center number counts along.
 */
export class GaugeChart extends Chart<GaugeChartOptions> {
  private track: SVGPathElement;
  private arc: SVGPathElement;
  private valueText: SVGTextElement;
  private nameText: SVGTextElement;
  private minText: SVGTextElement;
  private maxText: SVGTextElement;
  private angle: AnimatedValue;
  private color: AnimatedVec;
  private displayed = 0;
  private cancelCount: (() => void) | null = null;
  private cx = 0;
  private cy = 0;
  private outerR = 0;
  private innerR = 0;

  constructor(el: HTMLElement, options: GaugeChartOptions) {
    super(el, options);
    this.track = svgEl('path', { fill: 'var(--nova-grid)' }, this.svg);
    this.arc = svgEl('path', {}, this.svg);
    this.valueText = svgEl(
      'text',
      { 'text-anchor': 'middle', fill: 'var(--nova-fg)', 'font-size': 32, 'font-weight': 700 },
      this.svg,
    );
    this.nameText = svgEl(
      'text',
      { 'text-anchor': 'middle', fill: 'var(--nova-fg-muted)', 'font-size': 12 },
      this.svg,
    );
    this.minText = svgEl(
      'text',
      { 'text-anchor': 'middle', fill: 'var(--nova-fg-muted)', 'font-size': 11 },
      this.svg,
    );
    this.maxText = svgEl(
      'text',
      { 'text-anchor': 'middle', fill: 'var(--nova-fg-muted)', 'font-size': 11 },
      this.svg,
    );

    // Angle is in radians, so use a tighter-than-pixel rest threshold to
    // avoid a visible terminal snap when the arc settles.
    this.angle = new AnimatedValue(this.startAngle(), {
      stiffness: 120,
      damping: 20,
      restDelta: 0.0012,
      restSpeed: 0.08,
    });
    const initial = parseColor(this.targetColor()) ?? { r: 99, g: 102, b: 241, a: 1 };
    this.color = new AnimatedVec([initial.r, initial.g, initial.b, initial.a], {
      stiffness: 120,
      damping: 24,
    });
    const repaint = (): void => {
      this.arc.setAttribute(
        'd',
        buildArcPath({
          cx: this.cx,
          cy: this.cy,
          innerRadius: this.innerR,
          outerRadius: this.outerR,
          startAngle: this.startAngle(),
          endAngle: this.angle.get(),
        }),
      );
      this.arc.setAttribute('fill', vecToRgba(this.color.get()));
    };
    this.angle.onChange(repaint);
    this.color.onChange(repaint);
    this.bootstrap();
  }

  /** Convenience: gauges usually track one number. */
  setValue(value: number): void {
    const series = this.options.data.series[0];
    this.setData({
      ...this.options.data,
      series: [{ id: series?.id ?? 'value', name: series?.name, data: [value] }],
    });
  }

  get value(): number {
    const d = this.options.data.series[0]?.data[0];
    return d === undefined ? 0 : datumValue(d);
  }

  protected override chartType(): string {
    return 'Gauge';
  }

  protected override ariaLabel(): string {
    return this.options.ariaLabel ?? `Gauge, ${fmtValue(this.value)}`;
  }

  private startAngle(): number {
    return this.options.startAngle ?? -2.1;
  }

  private endAngle(): number {
    return this.options.endAngle ?? 2.1;
  }

  private targetColor(): string {
    const stops = this.options.colorStops;
    let spec = this.options.data.series[0]?.color ?? paletteVar(0);
    if (stops && stops.length > 0) {
      const sorted = [...stops].sort((a, b) => a.until - b.until);
      spec = (sorted.find((s) => this.value <= s.until) ?? sorted[sorted.length - 1]!).color;
    }
    return resolveColor(this.el, spec);
  }

  protected override update(reason: UpdateReason): void {
    const immediate = this.immediate() || reason === 'resize';
    const min = this.options.min ?? 0;
    const max = this.options.max ?? 100;
    const a0 = this.startAngle();
    const a1 = this.endAngle();

    this.cx = this.plot.x + this.plot.width / 2;
    this.cy = this.plot.y + this.plot.height / 2 + this.plot.height * 0.06;
    this.outerR = Math.max(Math.min(this.plot.width, this.plot.height * 1.5) / 2 - 8, 10);
    this.innerR = this.outerR * clamp(this.options.innerRadius ?? 0.74, 0, 0.95);

    this.track.setAttribute(
      'd',
      buildArcPath({
        cx: this.cx,
        cy: this.cy,
        innerRadius: this.innerR,
        outerRadius: this.outerR,
        startAngle: a0,
        endAngle: a1,
      }),
    );

    const t = max === min ? 0 : clamp((this.value - min) / (max - min), 0, 1);
    this.angle.set(a0 + t * (a1 - a0), { immediate });
    const target = parseColor(this.targetColor());
    if (target) {
      this.color.set([target.r, target.g, target.b, target.a], { immediate });
    }

    // Counting center readout.
    const format = this.options.format ?? ((v: number) => fmtValue(Math.round(v)));
    this.valueText.setAttribute('x', String(this.cx));
    this.valueText.setAttribute('y', String(this.cy + 2));
    this.cancelCount?.();
    if (immediate) {
      this.displayed = this.value;
      this.valueText.textContent = format(this.value);
    } else {
      this.cancelCount = runTween(
        { from: this.displayed, to: this.value, duration: 800 },
        (v) => {
          this.displayed = v;
          this.valueText.textContent = format(v);
        },
        () => (this.cancelCount = null),
      );
    }

    this.nameText.textContent = this.options.data.series[0]?.name ?? '';
    this.nameText.setAttribute('x', String(this.cx));
    this.nameText.setAttribute('y', String(this.cy + 22));

    const edge = (this.innerR + this.outerR) / 2;
    this.minText.textContent = fmtValue(min);
    this.minText.setAttribute('x', String(this.cx + edge * Math.sin(a0)));
    this.minText.setAttribute('y', String(this.cy - edge * Math.cos(a0) + 18));
    this.maxText.textContent = fmtValue(max);
    this.maxText.setAttribute('x', String(this.cx + edge * Math.sin(a1)));
    this.maxText.setAttribute('y', String(this.cy - edge * Math.cos(a1) + 18));
  }

  protected override teardown(): void {
    this.cancelCount?.();
    this.angle.destroy();
    this.color.destroy();
  }
}
