import type { SpringConfig } from '../motion/spring.js';
import type { EasingName } from '../motion/easing.js';
import type { CurveType } from '../shape/curve.js';

export interface Point {
  x: number | Date | string;
  y: number;
  /** Optional radius encoding (bubble charts). */
  r?: number;
}

/** Open/high/low/close datum for candlestick charts. */
export interface OHLC {
  x?: number | Date | string;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface Series {
  id: string;
  name?: string;
  data: number[] | Point[] | OHLC[];
  color?: string;
}

export interface ChartData {
  labels?: (string | number | Date)[];
  series: Series[];
}

export interface MotionOptions {
  /** Spring used for data morphs and hover states. */
  spring?: Partial<SpringConfig>;
  /** Entrance choreography. */
  enter?: { duration?: number; easing?: EasingName; stagger?: number };
  /** Disable all animation for this chart (prefers-reduced-motion also applies). */
  disabled?: boolean;
}

export interface AxisOptions {
  ticks?: number;
  gridLines?: boolean;
  nice?: boolean;
  format?: (value: number | string | Date) => string;
}

export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TooltipRow {
  color: string;
  label: string;
  value: string;
}

export interface TooltipContent {
  title?: string;
  rows: TooltipRow[];
}

export interface HoverPoint {
  seriesId: string;
  seriesName: string;
  index: number;
  value: number;
  label: string;
  color: string;
  x: number;
  y: number;
}

export interface PointEvent {
  seriesId: string;
  index: number;
  value: number;
  label: string;
  clientX: number;
  clientY: number;
}

export interface ChartEvents {
  'point:enter': PointEvent;
  'point:leave': PointEvent;
  'point:click': PointEvent;
  'series:toggle': { id: string; visible: boolean };
}

export interface BaseChartOptions {
  data: ChartData;
  /** Fixed size; defaults to the host element's size (with sane fallbacks). */
  width?: number;
  height?: number;
  margin?: Partial<Margin>;
  motion?: MotionOptions;
  axes?: { x?: AxisOptions; y?: AxisOptions };
  legend?: boolean;
  tooltip?: boolean | { formatter?: (points: HoverPoint[]) => TooltipContent };
  /** Palette override; defaults to the CSS custom-property palette. */
  colors?: string[];
  ariaLabel?: string;
  a11y?: { table?: boolean };
}

export type { CurveType };
