import { XYChart } from './xy.js';
import type { UpdateReason } from '../core/chart.js';
import type { BaseChartOptions, OHLC } from '../core/types.js';
import { svgEl } from '../core/svg.js';
import { keyedJoin, type JoinItem } from '../core/join.js';
import { AnimatedValue, AnimatedVec } from '../motion/animated.js';
import { stagger } from '../motion/stagger.js';
import { scaleLinear, type LinearScale } from '../scale/linear.js';
import { scaleBand, type BandScale } from '../scale/band.js';
import { niceDomain } from '../scale/ticks.js';
import { resolveColor } from '../theme/theme.js';
import { fmtValue } from '../core/format.js';
import type { PointerPos } from '../interaction/pointer.js';

export interface CandlestickChartOptions extends BaseChartOptions {
  /** Bullish candle color (close >= open). */
  upColor?: string;
  /** Bearish candle color. */
  downColor?: string;
}

interface CandleItem extends JoinItem {
  g: SVGGElement;
  body: SVGRectElement;
  wick: SVGLineElement;
  /** [x, yBodyTop, w, hBody, yHigh, yLow] */
  vec: AnimatedVec;
  opacity: AnimatedValue;
  index: number;
  d: OHLC;
  colorResolved: string;
  removeFn: (() => void) | null;
}

const IDLE_OPACITY = 0.95;
const DIM_OPACITY = 0.4;

/**
 * Candlestick (OHLC) chart. Bodies and wicks are spring vectors, so price
 * updates stretch and squash the candles — live tickers stay liquid.
 */
export class CandlestickChart extends XYChart<CandlestickChartOptions> {
  private candles = new Map<string, CandleItem>();
  private band!: BandScale;
  private yScale!: LinearScale;
  private hoveredIndex = -1;
  private entranceDone = false;

  constructor(el: HTMLElement, options: CandlestickChartOptions) {
    super(el, { legend: false, ...options });
    this.bootstrap();
  }

  protected override chartType(): string {
    return 'Candlestick';
  }

  private ohlc(): OHLC[] {
    const series = this.options.data.series[0];
    if (!series) return [];
    return series.data.map((d) => {
      if (typeof d === 'number') return { o: d, h: d, l: d, c: d };
      if ('o' in d) return d;
      return { o: d.y, h: d.y, l: d.y, c: d.y };
    });
  }

  protected override update(reason: UpdateReason): void {
    const immediate = this.immediate() || reason === 'resize';
    const spring = this.springConfig();
    const candles = this.ohlc();
    const labels = this.labels();
    const n = candles.length;

    let lo = Infinity;
    let hi = -Infinity;
    for (const c of candles) {
      lo = Math.min(lo, c.l);
      hi = Math.max(hi, c.h);
    }
    if (lo === Infinity) {
      lo = 0;
      hi = 1;
    }
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const [d0, d1] = niceDomain(lo, hi, this.options.axes?.y?.ticks ?? 5);
    this.yScale = scaleLinear({
      domain: [d0, d1],
      range: [this.plot.y + this.plot.height, this.plot.y],
    });
    this.band = scaleBand({
      domain: candles.map((_, i) => i),
      range: [this.plot.x, this.plot.x + this.plot.width],
      paddingInner: 0.4,
      paddingOuter: 0.15,
    });

    const chromeImmediate = this.immediate() || reason === 'resize';
    this.xAxis.update(
      this.xTickIndices(n).map((i) => ({
        key: labels[i]!,
        label: labels[i]!,
        pos: this.band.center(i),
      })),
      this.plot,
      chromeImmediate,
    );
    const yTicks = this.yScale.ticks(this.options.axes?.y?.ticks ?? 5);
    this.yAxis.update(
      yTicks.map((v) => ({ key: String(v), label: fmtValue(v), pos: this.yScale(v) })),
      this.plot,
      chromeImmediate,
    );
    if (this.options.axes?.y?.gridLines !== false) {
      this.grid.update(
        yTicks.map((v) => ({ key: String(v), pos: this.yScale(v) })),
        this.plot,
        chromeImmediate,
      );
    }

    const w = this.band.bandwidth();
    const upColor = this.options.upColor ?? 'var(--nova-c4)';
    const downColor = this.options.downColor ?? 'var(--nova-c7)';

    keyedJoin(
      this.candles,
      candles.map((d, i) => [`${labels[i]}|${i}`, { d, i }] as const),
      {
        enter: (_key, { d, i }) => {
          const up = d.c >= d.o;
          const spec = up ? upColor : downColor;
          const x = this.band(i);
          const yTop = this.yScale(Math.max(d.o, d.c));
          const hBody = Math.max(Math.abs(this.yScale(d.o) - this.yScale(d.c)), 1);
          const yHigh = this.yScale(d.h);
          const yLow = this.yScale(d.l);
          const mid = (yHigh + yLow) / 2;
          const g = svgEl('g', { class: 'nova-candle' }, this.seriesLayer);
          const wick = svgEl('line', { stroke: spec, 'stroke-width': 1.5 }, g);
          const body = svgEl('rect', { fill: spec, rx: 1.5 }, g);
          const grow = !this.immediate();
          const vec = new AnimatedVec(
            grow ? [x, mid, w, 0, mid, mid] : [x, yTop, w, hBody, yHigh, yLow],
            spring,
          );
          const opacity = new AnimatedValue(grow ? 0 : IDLE_OPACITY, {
            stiffness: 200,
            damping: 26,
          });
          const item: CandleItem = {
            g,
            body,
            wick,
            vec,
            opacity,
            index: i,
            d,
            colorResolved: resolveColor(this.el, spec),
            removeFn: null,
          };
          vec.onChange((v) => {
            body.setAttribute('x', String(v[0]!));
            body.setAttribute('y', String(v[1]!));
            body.setAttribute('width', String(Math.max(v[2]!, 0)));
            body.setAttribute('height', String(Math.max(v[3]!, 1)));
            const cx = v[0]! + v[2]! / 2;
            wick.setAttribute('x1', String(cx));
            wick.setAttribute('x2', String(cx));
            wick.setAttribute('y1', String(v[4]!));
            wick.setAttribute('y2', String(v[5]!));
          });
          vec.onRest(() => {
            if (item.exiting) {
              g.remove();
              this.disposeCandle(item);
              item.removeFn?.();
            }
          });
          opacity.onChange((v) => g.setAttribute('opacity', String(Math.max(v, 0))));
          vec.reset(vec.values);
          if (grow) {
            // Candles unfold from their mid price, rippling left to right.
            const delay = this.entranceDone ? 0 : stagger(i, n, { each: this.enterStagger() });
            vec.set([x, yTop, w, hBody, yHigh, yLow], {
              delays: Float64Array.of(delay, delay, delay, delay, delay, delay),
            });
            opacity.set(IDLE_OPACITY, { delay });
          }
          return item;
        },
        update: (item, { d, i }) => {
          item.d = d;
          item.index = i;
          const up = d.c >= d.o;
          const spec = up ? upColor : downColor;
          item.colorResolved = resolveColor(this.el, spec);
          item.body.setAttribute('fill', spec);
          item.wick.setAttribute('stroke', spec);
          const yTop = this.yScale(Math.max(d.o, d.c));
          const hBody = Math.max(Math.abs(this.yScale(d.o) - this.yScale(d.c)), 1);
          const delay = immediate ? 0 : stagger(i, n, { each: 10 });
          item.vec.set(
            [this.band(i), yTop, w, hBody, this.yScale(d.h), this.yScale(d.l)],
            { immediate, delays: Float64Array.of(delay, delay, delay, delay, delay, delay) },
          );
          item.opacity.set(this.opacityFor(item), { immediate });
        },
        exit: (item, remove) => {
          item.removeFn = remove;
          if (immediate) {
            item.g.remove();
            this.disposeCandle(item);
            remove();
          } else {
            const t = item.vec.getTargets();
            const mid = (t[4]! + t[5]!) / 2;
            item.vec.set([t[0]!, mid, t[2]!, 0, mid, mid]);
            item.opacity.set(0);
          }
        },
      },
    );
    this.entranceDone = true;
    this.refreshHover();
  }

  private opacityFor(item: CandleItem): number {
    if (this.hoveredIndex < 0) return IDLE_OPACITY;
    return item.index === this.hoveredIndex ? 1 : DIM_OPACITY;
  }

  protected override pointerMove(p: PointerPos | null): void {
    const inside =
      p !== null &&
      p.x >= this.plot.x &&
      p.x <= this.plot.x + this.plot.width &&
      p.y >= this.plot.y - 8 &&
      p.y <= this.plot.y + this.plot.height + 8;
    if (!inside) {
      this.clearHover();
      return;
    }
    const index = this.band.indexAt(p.x);
    const item = [...this.candles.values()].find((c) => c.index === index && !c.exiting);
    if (!item) {
      this.clearHover();
      return;
    }
    const immediate = this.immediate();
    if (index !== this.hoveredIndex) {
      this.hoveredIndex = index;
      for (const c of this.candles.values()) {
        if (!c.exiting) c.opacity.set(this.opacityFor(c), { immediate });
      }
      this.emit('point:enter', this.candleEvent(item, p));
    }
    this.crosshair.show(this.band.center(index), this.plot, immediate);
    const label = this.labels()[index] ?? String(index);
    const c = item.colorResolved;
    this.tooltip?.show(
      {
        title: label,
        rows: [
          { color: c, label: 'Open', value: fmtValue(item.d.o) },
          { color: c, label: 'High', value: fmtValue(item.d.h) },
          { color: c, label: 'Low', value: fmtValue(item.d.l) },
          { color: c, label: 'Close', value: fmtValue(item.d.c) },
        ],
      },
      { x: this.band.center(index), y: p.y },
      immediate,
    );
  }

  protected override pointerClick(p: PointerPos): void {
    const item = [...this.candles.values()].find(
      (c) => c.index === this.hoveredIndex && !c.exiting,
    );
    if (item) this.emit('point:click', this.candleEvent(item, p));
  }

  private candleEvent(item: CandleItem, p: PointerPos) {
    return {
      seriesId: this.options.data.series[0]?.id ?? 'ohlc',
      index: item.index,
      value: item.d.c,
      label: this.labels()[item.index] ?? String(item.index),
      clientX: p.clientX,
      clientY: p.clientY,
    };
  }

  private clearHover(): void {
    if (this.hoveredIndex !== -1) {
      const item = [...this.candles.values()].find((c) => c.index === this.hoveredIndex);
      if (item && this.lastPointer) {
        this.emit('point:leave', this.candleEvent(item, this.lastPointer));
      }
      this.hoveredIndex = -1;
      for (const c of this.candles.values()) {
        if (!c.exiting) c.opacity.set(IDLE_OPACITY);
      }
    }
    this.crosshair.hide(this.immediate());
    this.tooltip?.hide(this.immediate());
  }

  private disposeCandle(item: CandleItem): void {
    item.vec.destroy();
    item.opacity.destroy();
  }

  protected override teardown(): void {
    super.teardown();
    for (const c of this.candles.values()) this.disposeCandle(c);
    this.candles.clear();
  }
}
