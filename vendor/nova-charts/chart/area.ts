import { LineChart, type LineChartOptions } from './line.js';

export interface AreaChartOptions extends LineChartOptions {}

/**
 * A LineChart with a translucent fill dropped to an animated baseline.
 * The y-domain always includes zero so the floor is meaningful.
 */
export class AreaChart extends LineChart {
  protected override get filled(): boolean {
    return true;
  }
}
