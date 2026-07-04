import { Chart, type UpdateReason } from '../core/chart.js';
import type { BaseChartOptions, ChartData } from '../core/types.js';
import { svgEl } from '../core/svg.js';
import { keyedJoin, type JoinItem } from '../core/join.js';
import { AnimatedValue, AnimatedVec } from '../motion/animated.js';
import { Tooltip } from '../component/tooltip.js';
import { PointerTracker, type PointerPos } from '../interaction/pointer.js';
import { paletteVar, resolveColor } from '../theme/theme.js';
import { fmtValue } from '../core/format.js';

export interface SankeyNode {
  id: string;
  name?: string;
  color?: string;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

export interface SankeyChartOptions extends Omit<BaseChartOptions, 'data'> {
  nodes: SankeyNode[];
  links: SankeyLink[];
  /** Node bar width in px (default 16). */
  nodeWidth?: number;
  data?: ChartData;
}

interface NodeItem extends JoinItem {
  g: SVGGElement;
  rect: SVGRectElement;
  label: SVGTextElement;
  /** [x, y, w, h] */
  vec: AnimatedVec;
  opacity: AnimatedValue;
  node: SankeyNode;
  total: number;
  colorResolved: string;
  removeFn: (() => void) | null;
}

interface LinkItem extends JoinItem {
  path: SVGPathElement;
  /** [sx, sy, tx, ty, w] — ribbon endpoints (centerlines) and width */
  vec: AnimatedVec;
  opacity: AnimatedValue;
  link: SankeyLink;
  removeFn: (() => void) | null;
}

interface LayoutNode {
  id: string;
  col: number;
  x: number;
  y: number;
  h: number;
  total: number;
  outOffset: number;
  inOffset: number;
}

/**
 * Sankey diagram: flows between layered nodes. Node bars and link ribbons
 * are all spring vectors, so changing flow values makes the whole diagram
 * re-balance — ribbons thicken, thin, and slide along their nodes.
 */
export class SankeyChart extends Chart<SankeyChartOptions & { data: ChartData }> {
  private linkLayer: SVGGElement;
  private nodeLayer: SVGGElement;
  private nodes = new Map<string, NodeItem>();
  private links = new Map<string, LinkItem>();
  private tooltip: Tooltip | null = null;
  private pointerTracker: PointerTracker;
  private hoveredNode: string | null = null;
  private lastPointer: PointerPos | null = null;
  private entranceDone = false;

  constructor(el: HTMLElement, options: SankeyChartOptions) {
    super(el, { ...options, data: options.data ?? { series: [] } });
    this.linkLayer = svgEl('g', {}, this.svg);
    this.nodeLayer = svgEl('g', {}, this.svg);
    if (options.tooltip !== false) this.tooltip = new Tooltip(this.overlay);
    this.pointerTracker = new PointerTracker(
      this.svg,
      (p) => {
        this.lastPointer = p;
        this.pointerMove(p);
      },
      (p) => this.pointerClick(p),
    );
    this.bootstrap();
  }

  setFlows(nodes: SankeyNode[], links: SankeyLink[]): void {
    this.options.nodes = nodes;
    this.options.links = links;
    this.update('data');
    this.announcer.announce('Flows updated');
  }

  protected override chartType(): string {
    return 'Sankey';
  }

  protected override ariaLabel(): string {
    return (
      this.options.ariaLabel ??
      `Sankey diagram, ${this.options.nodes.length} nodes, ${this.options.links.length} flows`
    );
  }

  /** Layered layout: columns via longest path, nodes stacked by flow. */
  private layout(): Map<string, LayoutNode> {
    const { nodes, links } = this.options;
    const ids = new Set(nodes.map((n) => n.id));
    const valid = links.filter(
      (l) => ids.has(l.source) && ids.has(l.target) && l.source !== l.target && l.value > 0,
    );

    // Column assignment: relax col[target] >= col[source] + 1.
    const col = new Map<string, number>(nodes.map((n) => [n.id, 0]));
    for (let pass = 0; pass < nodes.length; pass++) {
      let changed = false;
      for (const l of valid) {
        const want = col.get(l.source)! + 1;
        if (col.get(l.target)! < want && want < nodes.length) {
          col.set(l.target, want);
          changed = true;
        }
      }
      if (!changed) break;
    }
    const maxCol = Math.max(0, ...col.values());

    // Node totals: max of in-flow and out-flow.
    const totals = new Map<string, number>();
    for (const n of nodes) {
      const out = valid.filter((l) => l.source === n.id).reduce((s, l) => s + l.value, 0);
      const inn = valid.filter((l) => l.target === n.id).reduce((s, l) => s + l.value, 0);
      totals.set(n.id, Math.max(out, inn, 0.0001));
    }

    // Vertical stacking per column.
    const colNodes = new Map<number, string[]>();
    for (const n of nodes) {
      const c = col.get(n.id)!;
      if (!colNodes.has(c)) colNodes.set(c, []);
      colNodes.get(c)!.push(n.id);
    }
    let maxColTotal = 0;
    for (const idsInCol of colNodes.values()) {
      maxColTotal = Math.max(
        maxColTotal,
        idsInCol.reduce((s, id) => s + totals.get(id)!, 0),
      );
    }
    const nodeGap = 14;
    const scale =
      maxColTotal > 0
        ? (this.plot.height - nodeGap * Math.max(...[...colNodes.values()].map((c) => c.length - 1), 0)) /
          maxColTotal
        : 1;

    const nodeW = this.options.nodeWidth ?? 16;
    const xOf = (c: number): number =>
      maxCol === 0
        ? this.plot.x
        : this.plot.x + (c / maxCol) * (this.plot.width - nodeW);

    const out = new Map<string, LayoutNode>();
    for (const [c, idsInCol] of colNodes) {
      const colTotal = idsInCol.reduce((s, id) => s + totals.get(id)! * scale, 0);
      const used = colTotal + nodeGap * (idsInCol.length - 1);
      let y = this.plot.y + Math.max((this.plot.height - used) / 2, 0);
      for (const id of idsInCol) {
        const h = Math.max(totals.get(id)! * scale, 2);
        out.set(id, {
          id,
          col: c,
          x: xOf(c),
          y,
          h,
          total: totals.get(id)!,
          outOffset: 0,
          inOffset: 0,
        });
        y += h + nodeGap;
      }
    }
    return out;
  }

  protected override update(reason: UpdateReason): void {
    const immediate = this.immediate() || reason === 'resize';
    const spring = this.springConfig();
    const nodeW = this.options.nodeWidth ?? 16;
    const layout = this.layout();
    const nodes = this.options.nodes.filter((n) => layout.has(n.id));
    const ids = new Set(nodes.map((n) => n.id));
    const validLinks = this.options.links.filter(
      (l) => ids.has(l.source) && ids.has(l.target) && l.source !== l.target && l.value > 0,
    );

    const colorOf = (id: string): string => {
      const i = this.options.nodes.findIndex((n) => n.id === id);
      return this.options.nodes[i]?.color ?? paletteVar(Math.max(i, 0));
    };

    // Nodes.
    keyedJoin(
      this.nodes,
      nodes.map((n) => [n.id, n] as const),
      {
        enter: (_key, n, i) => {
          const ln = layout.get(n.id)!;
          const spec = colorOf(n.id);
          const g = svgEl('g', {}, this.nodeLayer);
          const rect = svgEl('rect', { fill: spec, rx: 3 }, g);
          const label = svgEl('text', { fill: 'var(--nova-fg)', 'font-size': 11 }, g);
          const grow = !this.immediate();
          const vec = new AnimatedVec(
            grow ? [ln.x, ln.y + ln.h / 2, nodeW, 0] : [ln.x, ln.y, nodeW, ln.h],
            spring,
          );
          const opacity = new AnimatedValue(1, spring);
          const item: NodeItem = {
            g,
            rect,
            label,
            vec,
            opacity,
            node: n,
            total: ln.total,
            colorResolved: resolveColor(this.el, spec),
            removeFn: null,
          };
          vec.onChange((v) => this.renderNode(item, v, nodeW));
          vec.onRest(() => {
            if (item.exiting) {
              g.remove();
              this.disposeNode(item);
              item.removeFn?.();
            }
          });
          opacity.onChange((v) => g.setAttribute('opacity', String(Math.max(v, 0))));
          vec.reset(vec.values);
          if (grow) {
            const delay = this.entranceDone ? 0 : ln.col * 130 + i * 15;
            vec.set([ln.x, ln.y, nodeW, ln.h], {
              delays: Float64Array.of(delay, delay, delay, delay),
            });
          }
          item.label.textContent = n.name ?? n.id;
          return item;
        },
        update: (item, n) => {
          const ln = layout.get(n.id)!;
          item.node = n;
          item.total = ln.total;
          const spec = colorOf(n.id);
          item.colorResolved = resolveColor(this.el, spec);
          item.rect.setAttribute('fill', spec);
          item.label.textContent = n.name ?? n.id;
          item.vec.set([ln.x, ln.y, nodeW, ln.h], { immediate });
          item.opacity.set(1, { immediate });
        },
        exit: (item, remove) => {
          item.removeFn = remove;
          if (immediate) {
            item.g.remove();
            this.disposeNode(item);
            remove();
          } else {
            const t = item.vec.getTargets();
            item.vec.set([t[0]!, t[1]! + t[3]! / 2, t[2]!, 0]);
            item.opacity.set(0);
          }
        },
      },
    );

    // Link slot offsets along each node edge (in target value space).
    const outCursor = new Map<string, number>();
    const inCursor = new Map<string, number>();
    const slots = validLinks.map((l) => {
      const sl = layout.get(l.source)!;
      const tl = layout.get(l.target)!;
      const sScale = sl.h / sl.total;
      const tScale = tl.h / tl.total;
      const w = Math.max(Math.min(l.value * sScale, l.value * tScale), 1.5);
      const so = outCursor.get(l.source) ?? 0;
      const to = inCursor.get(l.target) ?? 0;
      outCursor.set(l.source, so + l.value * sScale);
      inCursor.set(l.target, to + l.value * tScale);
      return {
        key: `${l.source}→${l.target}`,
        link: l,
        sx: sl.x + nodeW,
        sy: sl.y + so + (l.value * sScale) / 2,
        tx: tl.x,
        ty: tl.y + to + (l.value * tScale) / 2,
        w,
      };
    });

    keyedJoin(
      this.links,
      slots.map((s) => [s.key, s] as const),
      {
        enter: (_key, s) => {
          const spec = colorOf(s.link.source);
          const path = svgEl(
            'path',
            { fill: 'none', stroke: spec, 'stroke-opacity': 0.3 },
            this.linkLayer,
          );
          const grow = !this.immediate();
          const vec = new AnimatedVec(
            grow ? [s.sx, s.sy, s.tx, s.ty, 0] : [s.sx, s.sy, s.tx, s.ty, s.w],
            spring,
          );
          const opacity = new AnimatedValue(1, spring);
          const item: LinkItem = {
            path,
            vec,
            opacity,
            link: s.link,
            removeFn: null,
          };
          vec.onChange((v) => this.renderLink(item, v));
          vec.onRest(() => {
            if (item.exiting) {
              path.remove();
              this.disposeLink(item);
              item.removeFn?.();
            }
          });
          opacity.onChange((v) =>
            path.setAttribute('stroke-opacity', String(Math.max(v * 0.3, 0))),
          );
          vec.reset(vec.values);
          if (grow) {
            const delay = this.entranceDone ? 0 : 350;
            vec.set([s.sx, s.sy, s.tx, s.ty, s.w], {
              delays: Float64Array.of(delay, delay, delay, delay, delay),
            });
          }
          return item;
        },
        update: (item, s) => {
          item.link = s.link;
          item.path.setAttribute('stroke', colorOf(s.link.source));
          item.vec.set([s.sx, s.sy, s.tx, s.ty, s.w], { immediate });
          item.opacity.set(this.linkOpacityFor(item), { immediate });
        },
        exit: (item, remove) => {
          item.removeFn = remove;
          if (immediate) {
            item.path.remove();
            this.disposeLink(item);
            remove();
          } else {
            const t = item.vec.getTargets();
            item.vec.set([t[0]!, t[1]!, t[2]!, t[3]!, 0]);
            item.opacity.set(0);
          }
        },
      },
    );

    this.entranceDone = true;
    if (this.lastPointer) this.pointerMove(this.lastPointer);
  }

  private renderNode(item: NodeItem, v: Float64Array, nodeW: number): void {
    item.rect.setAttribute('x', String(v[0]!));
    item.rect.setAttribute('y', String(v[1]!));
    item.rect.setAttribute('width', String(Math.max(v[2]!, 0)));
    item.rect.setAttribute('height', String(Math.max(v[3]!, 0)));
    // Label on the outer side: right of last column, left of others.
    const pastMiddle = v[0]! > this.plot.x + this.plot.width / 2;
    item.label.setAttribute('text-anchor', pastMiddle ? 'end' : 'start');
    item.label.setAttribute('x', String(pastMiddle ? v[0]! - 6 : v[0]! + nodeW + 6));
    item.label.setAttribute('y', String(v[1]! + v[3]! / 2 + 4));
  }

  private renderLink(item: LinkItem, v: Float64Array): void {
    const [sx, sy, tx, ty, w] = [v[0]!, v[1]!, v[2]!, v[3]!, v[4]!];
    const mid = (sx + tx) / 2;
    item.path.setAttribute('stroke-width', String(Math.max(w, 0)));
    item.path.setAttribute('d', `M${sx},${sy}C${mid},${sy},${mid},${ty},${tx},${ty}`);
  }

  private linkOpacityFor(item: LinkItem): number {
    if (!this.hoveredNode) return 1;
    return item.link.source === this.hoveredNode || item.link.target === this.hoveredNode
      ? 1.8 // rendered as 0.3 * value, so highlighted ribbons hit ~0.54
      : 0.35;
  }

  private nodeAt(p: PointerPos): NodeItem | null {
    for (const item of this.nodes.values()) {
      if (item.exiting) continue;
      const t = item.vec.getTargets();
      if (
        p.x >= t[0]! - 4 &&
        p.x <= t[0]! + t[2]! + 4 &&
        p.y >= t[1]! - 4 &&
        p.y <= t[1]! + t[3]! + 4
      ) {
        return item;
      }
    }
    return null;
  }

  private pointerMove(p: PointerPos | null): void {
    const item = p ? this.nodeAt(p) : null;
    const immediate = this.immediate();
    const nextId = item ? item.node.id : null;
    if (nextId !== this.hoveredNode) {
      const prev = this.hoveredNode ? this.nodes.get(this.hoveredNode) : null;
      this.hoveredNode = nextId;
      for (const l of this.links.values()) {
        if (!l.exiting) l.opacity.set(this.linkOpacityFor(l), { immediate });
      }
      if (prev && p) this.emitNode('point:leave', prev, p);
      if (item && p) this.emitNode('point:enter', item, p);
    }
    if (item && p) {
      const inn = this.options.links
        .filter((l) => l.target === item.node.id)
        .reduce((s, l) => s + l.value, 0);
      const out = this.options.links
        .filter((l) => l.source === item.node.id)
        .reduce((s, l) => s + l.value, 0);
      const c = item.colorResolved;
      const rows = [
        ...(inn > 0 ? [{ color: c, label: 'In', value: fmtValue(inn) }] : []),
        ...(out > 0 ? [{ color: c, label: 'Out', value: fmtValue(out) }] : []),
      ];
      this.tooltip?.show(
        { title: item.node.name ?? item.node.id, rows },
        { x: p.x, y: p.y },
        immediate,
      );
    } else {
      this.tooltip?.hide(immediate);
    }
  }

  private pointerClick(p: PointerPos): void {
    const item = this.nodeAt(p);
    if (item) this.emitNode('point:click', item, p);
  }

  private emitNode(
    type: 'point:enter' | 'point:leave' | 'point:click',
    item: NodeItem,
    p: PointerPos,
  ): void {
    this.emit(type, {
      seriesId: item.node.id,
      index: this.options.nodes.findIndex((n) => n.id === item.node.id),
      value: item.total,
      label: item.node.name ?? item.node.id,
      clientX: p.clientX,
      clientY: p.clientY,
    });
  }

  private disposeNode(item: NodeItem): void {
    item.vec.destroy();
    item.opacity.destroy();
  }

  private disposeLink(item: LinkItem): void {
    item.vec.destroy();
    item.opacity.destroy();
  }

  protected override teardown(): void {
    this.pointerTracker.destroy();
    this.tooltip?.destroy();
    for (const n of this.nodes.values()) this.disposeNode(n);
    this.nodes.clear();
    for (const l of this.links.values()) this.disposeLink(l);
    this.links.clear();
  }
}
