import { svgEl } from '../core/svg.js';
import { keyedJoin, type JoinItem } from '../core/join.js';
import { AnimatedValue } from '../motion/animated.js';
import type { SpringConfig } from '../motion/spring.js';
import type { Rect } from '../core/types.js';

export interface GridLineSpec {
  key: string;
  /** Pixel position perpendicular to the line (y for horizontal lines). */
  pos: number;
}

interface LineItem extends JoinItem {
  line: SVGLineElement;
  pos: AnimatedValue;
  opacity: AnimatedValue;
  remove?: () => void;
}

/**
 * Grid lines that glide with the domain (keyed like axis ticks).
 * Horizontal lines move along y; vertical lines (e.g. time grids) along x.
 */
export class Grid {
  private g: SVGGElement;
  private items = new Map<string, LineItem>();

  constructor(
    parent: SVGElement,
    private spring: Partial<SpringConfig> = {},
    private orient: 'horizontal' | 'vertical' = 'horizontal',
  ) {
    this.g = svgEl('g', { class: 'nova-grid' }, parent);
  }

  private span(line: SVGLineElement, plot: Rect): void {
    if (this.orient === 'horizontal') {
      line.setAttribute('x1', String(plot.x));
      line.setAttribute('x2', String(plot.x + plot.width));
    } else {
      line.setAttribute('y1', String(plot.y));
      line.setAttribute('y2', String(plot.y + plot.height));
    }
  }

  private place(line: SVGLineElement, pos: number): void {
    line.setAttribute(
      'transform',
      this.orient === 'horizontal' ? `translate(0, ${pos})` : `translate(${pos}, 0)`,
    );
  }

  update(lines: GridLineSpec[], plot: Rect, immediate: boolean): void {
    keyedJoin(this.items, lines.map((l) => [l.key, l] as const), {
      enter: (_key, l) => {
        const line = svgEl('line', {}, this.g);
        this.span(line, plot);
        this.place(line, l.pos);
        const pos = new AnimatedValue(l.pos, this.spring);
        const opacity = new AnimatedValue(0, this.spring);
        const item: LineItem = { line, pos, opacity };
        pos.onChange((v) => this.place(line, v));
        opacity.onChange((v) => {
          line.setAttribute('opacity', String(Math.max(v, 0)));
          if (item.exiting && v < 0.02) {
            line.remove();
            item.remove?.();
          }
        });
        opacity.set(1, { immediate });
        return item;
      },
      update: (item, l) => {
        this.span(item.line, plot);
        item.pos.set(l.pos, { immediate });
        item.opacity.set(1, { immediate });
      },
      exit: (item, remove) => {
        item.remove = remove;
        if (immediate) {
          item.line.remove();
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
