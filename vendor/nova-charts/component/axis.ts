import { svgEl } from '../core/svg.js';
import { keyedJoin, type JoinItem } from '../core/join.js';
import { AnimatedValue } from '../motion/animated.js';
import type { SpringConfig } from '../motion/spring.js';
import type { Rect } from '../core/types.js';

export interface TickSpec {
  key: string;
  label: string;
  /** Pixel position along the axis (x for bottom, y for left). */
  pos: number;
}

interface TickItem extends JoinItem {
  g: SVGGElement;
  pos: AnimatedValue;
  opacity: AnimatedValue;
  remove?: () => void;
}

/**
 * An axis whose ticks are first-class animated citizens: entering ticks fade
 * in at their position, leaving ticks fade out, surviving ticks glide to
 * their new spot. Domain changes read as motion, not repaints.
 */
export class Axis {
  private g: SVGGElement;
  private items = new Map<string, TickItem>();

  constructor(
    parent: SVGElement,
    private orient: 'bottom' | 'left',
    private spring: Partial<SpringConfig> = {},
  ) {
    this.g = svgEl('g', { class: `nova-axis nova-axis-${orient}` }, parent);
  }

  update(ticks: TickSpec[], plot: Rect, immediate: boolean): void {
    const origin =
      this.orient === 'bottom'
        ? `translate(0, ${plot.y + plot.height})`
        : `translate(${plot.x}, 0)`;
    this.g.setAttribute('transform', origin);

    keyedJoin(this.items, ticks.map((t) => [t.key, t] as const), {
      enter: (_key, t) => {
        const g = svgEl('g', {}, this.g);
        if (this.orient === 'bottom') {
          svgEl('line', { y2: 5 }, g);
          svgEl('text', { y: 18, 'text-anchor': 'middle' }, g).textContent = t.label;
        } else {
          svgEl('line', { x2: -5 }, g);
          svgEl('text', { x: -9, dy: '0.32em', 'text-anchor': 'end' }, g).textContent =
            t.label;
        }
        const pos = new AnimatedValue(t.pos, this.spring);
        const opacity = new AnimatedValue(0, this.spring);
        const item: TickItem = { g, pos, opacity };
        pos.onChange((v) => {
          g.setAttribute(
            'transform',
            this.orient === 'bottom' ? `translate(${v}, 0)` : `translate(0, ${v})`,
          );
        });
        opacity.onChange((v) => {
          g.setAttribute('opacity', String(Math.max(v, 0)));
          if (item.exiting && v < 0.02) {
            g.remove();
            item.remove?.();
          }
        });
        g.setAttribute(
          'transform',
          this.orient === 'bottom' ? `translate(${t.pos}, 0)` : `translate(0, ${t.pos})`,
        );
        opacity.set(1, { immediate });
        return item;
      },
      update: (item, t) => {
        item.pos.set(t.pos, { immediate });
        item.opacity.set(1, { immediate });
      },
      exit: (item, remove) => {
        item.remove = remove;
        if (immediate) {
          item.g.remove();
          remove();
        } else {
          item.opacity.set(0);
        }
      },
    });
  }

  destroy(): void {
    for (const item of this.items.values()) {
      item.pos.destroy();
      item.opacity.destroy();
    }
    this.items.clear();
    this.g.remove();
  }
}
