import { htmlEl } from '../core/svg.js';

export interface LegendItemSpec {
  id: string;
  name: string;
  color: string;
  visible: boolean;
}

/**
 * HTML legend of real buttons (keyboard + screen-reader operable for free).
 * Toggling defers to the chart, which choreographs the series exit and the
 * global re-fit morph.
 */
export class Legend {
  private el: HTMLDivElement;
  private buttons = new Map<string, HTMLButtonElement>();

  constructor(host: HTMLElement, private onToggle: (id: string) => void) {
    this.el = htmlEl('div', 'nova-legend', host);
  }

  update(items: LegendItemSpec[]): void {
    const seen = new Set<string>();
    for (const item of items) {
      seen.add(item.id);
      let btn = this.buttons.get(item.id);
      if (!btn) {
        btn = htmlEl('button', 'nova-legend-item', this.el);
        btn.type = 'button';
        htmlEl('span', 'nova-legend-swatch', btn);
        htmlEl('span', 'nova-legend-label', btn);
        btn.addEventListener('click', () => this.onToggle(item.id));
        this.buttons.set(item.id, btn);
      }
      btn.setAttribute('aria-pressed', String(item.visible));
      (btn.querySelector('.nova-legend-swatch') as HTMLElement).style.background = item.color;
      btn.querySelector('.nova-legend-label')!.textContent = item.name;
    }
    for (const [id, btn] of this.buttons) {
      if (!seen.has(id)) {
        btn.remove();
        this.buttons.delete(id);
      }
    }
  }

  destroy(): void {
    this.el.remove();
    this.buttons.clear();
  }
}
