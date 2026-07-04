import { svgEl, htmlEl } from '../core/svg.js';

export function applyAria(svg: SVGSVGElement, label: string, description?: string): void {
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  let title = svg.querySelector(':scope > title');
  if (!title) title = svgEl('title', {}, svg);
  title.textContent = label;
  if (description) {
    let desc = svg.querySelector(':scope > desc');
    if (!desc) desc = svgEl('desc', {}, svg);
    desc.textContent = description;
  }
}

/** Screen-reader live region for announcing data changes and toggles. */
export class Announcer {
  private region: HTMLDivElement;

  constructor(host: HTMLElement) {
    this.region = htmlEl('div', 'nova-sr-only', host);
    this.region.setAttribute('aria-live', 'polite');
    this.region.setAttribute('role', 'status');
  }

  announce(message: string): void {
    // Clearing first ensures repeat messages are re-announced.
    this.region.textContent = '';
    this.region.textContent = message;
  }

  destroy(): void {
    this.region.remove();
  }
}
