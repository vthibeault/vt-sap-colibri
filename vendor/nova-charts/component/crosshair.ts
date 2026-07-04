import { svgEl } from '../core/svg.js';
import { AnimatedValue } from '../motion/animated.js';
import type { Rect } from '../core/types.js';

/**
 * Vertical guide line whose x springs toward the snapped point — it glides
 * (with a hint of overshoot) as the pointer crosses the chart.
 */
export class Crosshair {
  private line: SVGLineElement;
  private x = new AnimatedValue(0, { stiffness: 260, damping: 24 });
  private opacity = new AnimatedValue(0, { stiffness: 220, damping: 26 });
  private visible = false;

  constructor(parent: SVGElement) {
    this.line = svgEl(
      'line',
      {
        class: 'nova-crosshair',
        stroke: 'var(--nova-axis)',
        'stroke-dasharray': '3,3',
        opacity: 0,
      },
      parent,
    );
    this.x.onChange((v) => {
      this.line.setAttribute('x1', String(v));
      this.line.setAttribute('x2', String(v));
    });
    this.opacity.onChange((v) => this.line.setAttribute('opacity', String(Math.max(v, 0))));
  }

  show(x: number, plot: Rect, immediate = false): void {
    this.line.setAttribute('y1', String(plot.y));
    this.line.setAttribute('y2', String(plot.y + plot.height));
    const firstShow = !this.visible;
    this.visible = true;
    this.x.set(x, { immediate: immediate || firstShow });
    this.opacity.set(1, { immediate });
  }

  hide(immediate = false): void {
    this.visible = false;
    this.opacity.set(0, { immediate });
  }

  destroy(): void {
    this.x.destroy();
    this.opacity.destroy();
    this.line.remove();
  }
}
