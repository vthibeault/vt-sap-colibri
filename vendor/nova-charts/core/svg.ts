export const SVG_NS = 'http://www.w3.org/2000/svg';

export type AttrValue = string | number;

export function setAttrs(el: Element, attrs: Record<string, AttrValue>): void {
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
}

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, AttrValue> = {},
  parent?: Element,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  setAttrs(el, attrs);
  parent?.appendChild(el);
  return el;
}

export function htmlEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  parent?: Element,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  parent?.appendChild(el);
  return el;
}
