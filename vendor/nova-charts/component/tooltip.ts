import { htmlEl } from '../core/svg.js';
import { AnimatedValue } from '../motion/animated.js';
import type { TooltipContent } from '../core/types.js';

/**
 * HTML tooltip whose position is spring-driven — it chases the cursor
 * between points instead of teleporting. Snappier spring than chart marks
 * so it feels responsive, not laggy.
 */
export class Tooltip {
  private el: HTMLDivElement;
  private x = new AnimatedValue(0, { stiffness: 320, damping: 30 });
  private y = new AnimatedValue(0, { stiffness: 320, damping: 30 });
  private opacity = new AnimatedValue(0, { stiffness: 260, damping: 26 });
  private visible = false;

  constructor(private host: HTMLElement) {
    this.el = htmlEl('div', 'nova-tooltip', host);
    this.el.style.opacity = '0';
    const apply = (): void => {
      this.el.style.transform = `translate3d(${this.x.get()}px, ${this.y.get()}px, 0)`;
    };
    this.x.onChange(apply);
    this.y.onChange(apply);
    this.opacity.onChange((v) => {
      const o = Math.max(v, 0);
      this.el.style.opacity = String(o);
      this.el.style.visibility = o < 0.01 ? 'hidden' : 'visible';
    });
  }

  show(content: TooltipContent, anchor: { x: number; y: number }, immediate = false): void {
    this.render(content);

    // Measure and keep inside the host bounds, flipping sides near edges.
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const bounds = this.host.getBoundingClientRect();
    let tx = anchor.x + 14;
    if (tx + w > bounds.width - 4) tx = anchor.x - w - 14;
    let ty = anchor.y - h / 2;
    ty = Math.max(4, Math.min(ty, bounds.height - h - 4));

    const firstShow = !this.visible;
    this.visible = true;
    // First appearance: materialize at the anchor instead of flying in.
    this.x.set(tx, { immediate: immediate || firstShow });
    this.y.set(ty, { immediate: immediate || firstShow });
    this.opacity.set(1, { immediate });
  }

  hide(immediate = false): void {
    this.visible = false;
    this.opacity.set(0, { immediate });
  }

  destroy(): void {
    this.x.destroy();
    this.y.destroy();
    this.opacity.destroy();
    this.el.remove();
  }

  private render(content: TooltipContent): void {
    this.el.textContent = '';
    if (content.title) {
      htmlEl('div', 'nova-tooltip-title', this.el).textContent = content.title;
    }
    for (const row of content.rows) {
      const r = htmlEl('div', 'nova-tooltip-row', this.el);
      htmlEl('span', 'nova-tooltip-swatch', r).style.background = row.color;
      htmlEl('span', 'nova-tooltip-label', r).textContent = row.label;
      htmlEl('span', 'nova-tooltip-value', r).textContent = row.value;
    }
  }
}
