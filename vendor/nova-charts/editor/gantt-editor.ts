import { AnimatedVec } from '../motion/animated.js';
import { schedule } from './schedule.js';

export interface EditorTask {
  id: string;
  name: string;
  /** Manual start in days from project start (used when it has no predecessors). */
  start: number;
  duration: number;
  parent?: string;
  dependsOn?: string[];
  progress?: number; // 0..1
  collapsed?: boolean;
  color?: string;
}

export interface GanttEditorOptions {
  tasks: EditorTask[];
  /** Project start date for axis labels; omit to label in day numbers. */
  startDate?: Date;
  /** Pixels per day (default 26). */
  dayWidth?: number;
  rowHeight?: number;
  onChange?: (tasks: EditorTask[]) => void;
}

const DAY = 86_400_000;
const PALETTE = ['#6366f1', '#22d3ee', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#fb7185', '#4ade80'];

const STYLE_ID = 'nova-gantt-editor-css';
const CSS = `
.nge { display:flex; flex-direction:column; height:100%; font:13px var(--nova-font,system-ui,sans-serif);
  color:var(--nge-fg,#cbd5e1); --nge-row:32px; --nge-grid:rgba(148,163,184,.16); border:1px solid var(--nge-grid); border-radius:10px; overflow:hidden; background:var(--nge-bg,#0f1626); }
.nge-toolbar { display:flex; gap:6px; padding:8px; border-bottom:1px solid var(--nge-grid); flex-wrap:wrap; align-items:center; }
.nge-toolbar button { background:rgba(99,102,241,.16); border:1px solid rgba(99,102,241,.35); color:#c7d2fe; border-radius:7px; padding:5px 10px; font:12px var(--nova-font,system-ui); cursor:pointer; }
.nge-toolbar button:hover { background:rgba(99,102,241,.3); }
.nge-toolbar button:disabled { opacity:.4; cursor:default; }
.nge-toolbar .sp { flex:1; }
.nge-body { display:flex; flex:1; min-height:0; overflow:auto; }
.nge-grid { flex:none; border-right:1px solid var(--nge-grid); }
.nge-ghead, .nge-grow { display:grid; grid-template-columns: var(--nge-name,260px) 56px 44px 56px; align-items:center; height:var(--nge-row); }
.nge-ghead { position:sticky; top:0; background:var(--nge-bg,#0f1626); border-bottom:1px solid var(--nge-grid); font-weight:600; color:var(--nova-fg-muted,#94a3b8); z-index:2; }
.nge-grow { border-bottom:1px solid rgba(148,163,184,.07); cursor:pointer; }
.nge-grow.sel { background:rgba(99,102,241,.14); }
.nge-grow.summary { font-weight:700; }
.nge-cell { padding:0 8px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.nge-cell.num { text-align:right; font-variant-numeric:tabular-nums; color:var(--nova-fg-muted,#94a3b8); }
.nge-name { display:flex; align-items:center; gap:4px; }
.nge-chev { width:12px; height:12px; flex:none; cursor:pointer; transition:transform .15s; color:var(--nova-fg-muted,#94a3b8); }
.nge-chev.open { transform:rotate(90deg); }
.nge-cell input { width:100%; box-sizing:border-box; background:#0b1020; border:1px solid #6366f1; color:#fff; border-radius:4px; padding:2px 4px; font:inherit; }
.nge-timeline { position:relative; flex:1; min-width:0; }
.nge-timeline svg { display:block; }
.nge-bar { cursor:grab; }
.nge-bar:active { cursor:grabbing; }
`;

function injectCss(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent?.appendChild(el);
  return el;
}

interface Drag {
  mode: 'move' | 'resize' | 'progress' | 'link';
  id: string;
  startX: number;
  startDay: number;
  startDur: number;
  linkLine?: SVGLineElement;
}

/**
 * GanttEditor — an MS-Project-style editable Gantt: a task grid on the left
 * (inline-edit, add/delete, indent/outdent to build the WBS, expand/collapse)
 * and an interactive timeline on the right (drag a bar to reschedule, drag its
 * right edge to change duration, drag a progress handle, and drag the link
 * handle from one bar to another to create a finish→start dependency). Edits
 * auto-schedule dependents (forward pass); the critical path is highlighted and
 * a saved baseline renders beneath the live bars. Non-dragged bars glide to
 * their new positions via the spring engine.
 */
export class GanttEditor {
  readonly el: HTMLElement;
  private opts: Required<Omit<GanttEditorOptions, 'startDate' | 'onChange'>> &
    Pick<GanttEditorOptions, 'startDate' | 'onChange'>;
  private tasks: EditorTask[];
  private baseline: Map<string, { start: number; duration: number }> | null = null;
  private selected: string | null = null;

  private gridEl!: HTMLDivElement;
  private gridBody!: HTMLDivElement;
  private timelineEl!: HTMLDivElement;
  private svg!: SVGSVGElement;
  private barLayer!: SVGGElement;
  private linkLayer!: SVGGElement;
  private gridLayer!: SVGGElement;
  private bars = new Map<string, { geo: AnimatedVec; rectG: SVGGElement; depUnsub: Array<() => void> }>();
  private sched = schedule([]);
  private rows: { id: string; level: number }[] = [];
  private drag: Drag | null = null;

  constructor(el: HTMLElement, options: GanttEditorOptions) {
    injectCss();
    this.el = el;
    this.opts = {
      tasks: options.tasks,
      dayWidth: options.dayWidth ?? 26,
      rowHeight: options.rowHeight ?? 32,
      startDate: options.startDate,
      onChange: options.onChange,
    };
    this.tasks = options.tasks.map((t) => ({ ...t }));
    this.build();
    this.render(true);
  }

  // ---- public API -----------------------------------------------------------

  getTasks(): EditorTask[] {
    return this.tasks.map((t) => ({ ...t }));
  }

  setTasks(tasks: EditorTask[]): void {
    this.tasks = tasks.map((t) => ({ ...t }));
    this.render(true);
  }

  addTask(): void {
    const id = `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;
    const sel = this.selected ? this.tasks.find((t) => t.id === this.selected) : null;
    const start = sel ? this.sched.nodes.get(sel.id)?.start ?? 0 : this.sched.finish;
    const task: EditorTask = { id, name: 'New task', start, duration: 3, ...(sel?.parent ? { parent: sel.parent } : {}) };
    const idx = sel ? this.tasks.indexOf(sel) + 1 : this.tasks.length;
    this.tasks.splice(idx, 0, task);
    this.selected = id;
    this.commit(true);
  }

  deleteSelected(): void {
    if (!this.selected) return;
    const id = this.selected;
    // Remove the task and any descendants; drop dangling deps.
    const toRemove = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of this.tasks) if (t.parent && toRemove.has(t.parent) && !toRemove.has(t.id)) { toRemove.add(t.id); grew = true; }
    }
    this.tasks = this.tasks
      .filter((t) => !toRemove.has(t.id))
      .map((t) => ({ ...t, dependsOn: t.dependsOn?.filter((d) => !toRemove.has(d)) }));
    this.selected = null;
    this.commit(true);
  }

  indentSelected(): void {
    if (!this.selected) return;
    const i = this.tasks.findIndex((t) => t.id === this.selected);
    if (i <= 0) return;
    // New parent = nearest preceding task at the same level (its previous sibling).
    const prev = this.tasks[i - 1]!;
    this.tasks[i] = { ...this.tasks[i]!, parent: prev.id };
    this.commit(true);
  }

  outdentSelected(): void {
    if (!this.selected) return;
    const t = this.tasks.find((x) => x.id === this.selected);
    if (!t || !t.parent) return;
    const parent = this.tasks.find((x) => x.id === t.parent);
    this.tasks = this.tasks.map((x) =>
      x.id === t.id ? { ...x, ...(parent?.parent ? { parent: parent.parent } : { parent: undefined }) } : x,
    );
    this.commit(true);
  }

  setBaseline(): void {
    this.baseline = new Map(
      [...this.sched.nodes].map(([id, n]) => [id, { start: n.start, duration: n.end - n.start }]),
    );
    this.render(false);
  }

  destroy(): void {
    for (const b of this.bars.values()) {
      b.geo.destroy();
      for (const u of b.depUnsub) u();
    }
    this.bars.clear();
    this.el.replaceChildren();
    this.el.classList.remove('nge');
  }

  // ---- build DOM ------------------------------------------------------------

  private build(): void {
    this.el.classList.add('nge');
    this.el.replaceChildren();

    const toolbar = document.createElement('div');
    toolbar.className = 'nge-toolbar';
    const mkBtn = (label: string, fn: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', fn);
      toolbar.appendChild(b);
      return b;
    };
    mkBtn('+ Task', () => this.addTask());
    mkBtn('Delete', () => this.deleteSelected());
    mkBtn('⇥ Indent', () => this.indentSelected());
    mkBtn('⇤ Outdent', () => this.outdentSelected());
    const sp = document.createElement('span');
    sp.className = 'sp';
    toolbar.appendChild(sp);
    mkBtn('Set baseline', () => this.setBaseline());
    mkBtn('− Zoom', () => { this.opts.dayWidth = Math.max(8, this.opts.dayWidth - 6); this.render(false); });
    mkBtn('+ Zoom', () => { this.opts.dayWidth = Math.min(80, this.opts.dayWidth + 6); this.render(false); });
    this.el.appendChild(toolbar);

    const body = document.createElement('div');
    body.className = 'nge-body';
    this.gridEl = document.createElement('div');
    this.gridEl.className = 'nge-grid';
    const ghead = document.createElement('div');
    ghead.className = 'nge-ghead';
    for (const [c, cls] of [['Task', ''], ['Start', 'num'], ['Dur', 'num'], ['Finish', 'num']] as const) {
      const d = document.createElement('div');
      d.className = `nge-cell ${cls}`;
      d.textContent = c;
      ghead.appendChild(d);
    }
    this.gridBody = document.createElement('div');
    this.gridEl.append(ghead, this.gridBody);

    this.timelineEl = document.createElement('div');
    this.timelineEl.className = 'nge-timeline';
    this.svg = svgEl('svg', {});
    this.gridLayer = svgEl('g', {}, this.svg);
    this.linkLayer = svgEl('g', {}, this.svg);
    this.barLayer = svgEl('g', {}, this.svg);
    this.timelineEl.appendChild(this.svg);
    body.append(this.gridEl, this.timelineEl);
    this.el.appendChild(body);

    this.svg.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  // ---- geometry helpers -----------------------------------------------------

  private get rowH(): number {
    return this.opts.rowHeight;
  }
  private get headerH(): number {
    return 28;
  }
  private dayX(day: number): number {
    return 8 + day * this.opts.dayWidth;
  }
  private hasChildren(id: string): boolean {
    return this.tasks.some((t) => t.parent === id);
  }

  private visibleRows(): { id: string; level: number }[] {
    const out: { id: string; level: number }[] = [];
    const childrenOf = (p: string | undefined) => this.tasks.filter((t) => t.parent === p);
    const walk = (t: EditorTask, level: number): void => {
      out.push({ id: t.id, level });
      if (this.hasChildren(t.id) && !t.collapsed) for (const c of childrenOf(t.id)) walk(c, level + 1);
    };
    for (const r of childrenOf(undefined)) walk(r, 0);
    return out;
  }

  // ---- render ---------------------------------------------------------------

  private commit(structural: boolean): void {
    this.render(structural);
    this.opts.onChange?.(this.getTasks());
  }

  private render(immediate: boolean): void {
    this.sched = schedule(this.tasks);
    this.rows = this.visibleRows();
    const finishDays = Math.max(this.sched.finish + 3, 14);
    const width = this.dayX(finishDays);
    const height = this.headerH + this.rows.length * this.rowH;
    this.el.style.setProperty('--nge-row', `${this.rowH}px`);
    this.svg.setAttribute('width', String(width));
    this.svg.setAttribute('height', String(height));
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    this.renderAxis(width, finishDays);
    this.renderGrid();
    this.renderBars(immediate, width);
  }

  private renderAxis(width: number, finishDays: number): void {
    this.gridLayer.replaceChildren();
    const y = this.headerH;
    // Week columns + day ticks.
    for (let d = 0; d <= finishDays; d++) {
      const x = this.dayX(d);
      const weekly = d % 7 === 0;
      svgEl('line', { x1: x, y1: weekly ? 0 : y - 6, x2: x, y2: this.headerH + this.rows.length * this.rowH,
        stroke: weekly ? 'var(--nge-grid)' : 'rgba(148,163,184,.06)', 'stroke-width': 1 }, this.gridLayer);
      if (weekly) {
        const label = this.opts.startDate
          ? `${new Date(this.opts.startDate.getTime() + d * DAY).getMonth() + 1}/${new Date(this.opts.startDate.getTime() + d * DAY).getDate()}`
          : `D${d}`;
        const t = svgEl('text', { x: x + 3, y: 16, fill: 'var(--nova-fg-muted,#94a3b8)', 'font-size': 10 }, this.gridLayer);
        t.textContent = label;
      }
    }
    // Row striping.
    for (let i = 0; i < this.rows.length; i++) {
      if (i % 2 === 1) {
        svgEl('rect', { x: 0, y: y + i * this.rowH, width, height: this.rowH, fill: 'rgba(148,163,184,.04)' }, this.gridLayer);
      }
    }
  }

  private renderGrid(): void {
    this.gridBody.replaceChildren();
    for (const r of this.rows) {
      const task = this.tasks.find((t) => t.id === r.id)!;
      const node = this.sched.nodes.get(r.id);
      const isSummary = this.hasChildren(r.id);
      const row = document.createElement('div');
      row.className = `nge-grow${isSummary ? ' summary' : ''}${this.selected === r.id ? ' sel' : ''}`;
      row.addEventListener('click', () => {
        this.selected = r.id;
        this.renderGrid();
      });

      // Name cell with indent + chevron.
      const nameCell = document.createElement('div');
      nameCell.className = 'nge-cell nge-name';
      nameCell.style.paddingLeft = `${8 + r.level * 14}px`;
      if (isSummary) {
        const chev = document.createElementNS(SVG_NS, 'svg');
        chev.setAttribute('class', `nge-chev${task.collapsed ? '' : ' open'}`);
        chev.setAttribute('viewBox', '0 0 12 12');
        const tri = document.createElementNS(SVG_NS, 'path');
        tri.setAttribute('d', 'M4,3L8,6L4,9Z');
        tri.setAttribute('fill', 'currentColor');
        chev.appendChild(tri);
        chev.addEventListener('click', (e) => {
          e.stopPropagation();
          task.collapsed = !task.collapsed;
          this.render(false);
        });
        nameCell.appendChild(chev);
      }
      const nameText = document.createElement('span');
      nameText.textContent = task.name;
      nameText.style.flex = '1';
      nameText.style.overflow = 'hidden';
      nameText.style.textOverflow = 'ellipsis';
      nameText.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.editCell(nameCell, nameText, task.name, (v) => { task.name = v || task.name; this.commit(false); });
      });
      nameCell.appendChild(nameText);
      row.appendChild(nameCell);

      const startCell = document.createElement('div');
      startCell.className = 'nge-cell num';
      startCell.textContent = node ? this.fmtDay(node.start) : '';
      row.appendChild(startCell);

      const durCell = document.createElement('div');
      durCell.className = 'nge-cell num';
      durCell.textContent = isSummary ? '' : String(task.duration);
      if (!isSummary) {
        durCell.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          this.editCell(durCell, null, String(task.duration), (v) => {
            const n = Math.max(1, Math.round(Number(v) || task.duration));
            task.duration = n;
            this.commit(false);
          });
        });
      }
      row.appendChild(durCell);

      const finCell = document.createElement('div');
      finCell.className = 'nge-cell num';
      finCell.textContent = node ? this.fmtDay(node.end) : '';
      row.appendChild(finCell);

      this.gridBody.appendChild(row);
    }
    // Match the grid name column width var to chevron indents (fixed for now).
    this.gridEl.style.setProperty('--nge-name', '260px');
  }

  private fmtDay(d: number): string {
    if (!this.opts.startDate) return String(Math.round(d));
    const date = new Date(this.opts.startDate.getTime() + d * DAY);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  private editCell(cell: HTMLElement, label: HTMLElement | null, value: string, commit: (v: string) => void): void {
    const input = document.createElement('input');
    input.value = value;
    if (label) label.style.display = 'none';
    cell.appendChild(input);
    input.focus();
    input.select();
    let finished = false;
    const done = (save: boolean): void => {
      if (finished) return; // Enter + blur must not double-commit.
      finished = true;
      if (save) commit(input.value);
      else this.render(false);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(true);
      else if (e.key === 'Escape') done(false);
    });
    input.addEventListener('blur', () => done(true));
  }

  private renderBars(immediate: boolean, width: number): void {
    const seen = new Set<string>();
    const spring = { stiffness: 200, damping: 26 };
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i]!;
      const task = this.tasks.find((t) => t.id === r.id)!;
      const node = this.sched.nodes.get(r.id);
      if (!node) continue;
      seen.add(r.id);
      const cy = this.headerH + i * this.rowH + this.rowH / 2;
      const x = this.dayX(node.start);
      const w = Math.max(this.dayX(node.end) - x, 2);
      const color = task.color ?? PALETTE[this.colorIndex(r.id) % PALETTE.length]!;

      let bar = this.bars.get(r.id);
      if (!bar) {
        const rectG = svgEl('g', { class: 'nge-barrow' }, this.barLayer);
        const geo = new AnimatedVec([x, cy, w], spring);
        bar = { geo, rectG, depUnsub: [] };
        this.bars.set(r.id, bar);
        geo.onChange(() => this.paintBar(r.id));
      }
      bar.geo.set([x, cy, w], { immediate });
      // store render inputs on the element via data attributes
      bar.rectG.dataset.id = r.id;
      bar.rectG.dataset.summary = String(this.hasChildren(r.id));
      bar.rectG.dataset.color = color;
      bar.rectG.dataset.critical = String(node.critical);
      bar.rectG.dataset.progress = String(task.progress ?? 0);
      this.paintBar(r.id);
    }
    // Remove bars for rows no longer visible.
    for (const [id, bar] of [...this.bars]) {
      if (!seen.has(id)) {
        bar.geo.destroy();
        for (const u of bar.depUnsub) u();
        bar.rectG.remove();
        this.bars.delete(id);
      }
    }
    this.renderLinks();
    void width;
  }

  private colorIndex(id: string): number {
    return this.tasks.findIndex((t) => t.id === id);
  }

  private paintBar(id: string): void {
    const bar = this.bars.get(id);
    if (!bar) return;
    const [x, cy, w] = [bar.geo.values[0]!, bar.geo.values[1]!, bar.geo.values[2]!];
    const g = bar.rectG;
    const summary = g.dataset.summary === 'true';
    const critical = g.dataset.critical === 'true';
    const color = g.dataset.color || '#6366f1';
    const progress = Number(g.dataset.progress || 0);
    const h = summary ? this.rowH * 0.34 : this.rowH * 0.56;
    const y = cy - h / 2;
    g.replaceChildren();

    // Baseline (ghost) bar.
    const bl = this.baseline?.get(id);
    if (bl) {
      const bx = this.dayX(bl.start);
      const bw = Math.max(this.dayX(bl.start + bl.duration) - bx, 2);
      svgEl('rect', { x: bx, y: cy + h / 2 + 2, width: bw, height: 3, rx: 1.5, fill: 'var(--nova-fg-muted,#94a3b8)', opacity: 0.5 }, g);
    }

    if (summary) {
      const leg = 5;
      svgEl('path', {
        d: `M${x},${y}L${x + w},${y}L${x + w},${y + h + leg}L${x + w - 4},${y + h}L${x + 4},${y + h}L${x},${y + h + leg}Z`,
        fill: critical ? '#fb7185' : color,
        class: 'nge-bar', 'data-id': id,
      }, g);
      return;
    }

    // Track + fill (progress) + outline.
    svgEl('rect', { x, y, width: w, height: h, rx: 4, fill: color, 'fill-opacity': 0.35, stroke: critical ? '#fb7185' : color, 'stroke-width': critical ? 2 : 1, class: 'nge-bar', 'data-id': id }, g);
    if (progress > 0) {
      svgEl('rect', { x, y, width: w * Math.min(progress, 1), height: h, rx: 4, fill: critical ? '#fb7185' : color, class: 'nge-bar', 'data-id': id }, g);
    }
    // Progress handle (small triangle at the fill front).
    const px = x + w * Math.min(progress, 1);
    svgEl('path', { d: `M${px - 4},${y + h}L${px + 4},${y + h}L${px},${y + h + 5}Z`, fill: 'var(--nova-fg,#cbd5e1)', class: 'nge-prog', 'data-id': id }, g);
    // Link handle (circle just past the bar's right edge, clear of the resize zone).
    svgEl('circle', { cx: x + w + 6, cy, r: 4, fill: 'var(--nova-fg,#cbd5e1)', class: 'nge-link', 'data-id': id }, g);
  }

  private renderLinks(): void {
    this.linkLayer.replaceChildren();
    let marker = this.svg.querySelector('marker#nge-arrow');
    if (!marker) {
      const defs = svgEl('defs', {}, this.svg);
      marker = svgEl('marker', { id: 'nge-arrow', viewBox: '0 0 8 8', refX: 6, refY: 4, markerWidth: 6, markerHeight: 6, orient: 'auto' }, defs);
      svgEl('path', { d: 'M0,0L8,4L0,8Z', fill: 'var(--nova-fg-muted,#94a3b8)' }, marker as Element);
    }
    for (const t of this.tasks) {
      const target = this.bars.get(t.id);
      if (!target || !t.dependsOn) continue;
      for (const dep of t.dependsOn) {
        const source = this.bars.get(dep);
        if (!source) continue;
        const s = source.geo.values;
        const tg = target.geo.values;
        const sx = s[0]! + s[2]!;
        const sy = s[1]!;
        const tx = tg[0]!;
        const ty = tg[1]!;
        const ex = Math.max(sx + 8, tx - 10);
        svgEl('path', {
          d: `M${sx},${sy}L${ex},${sy}L${ex},${ty}L${tx},${ty}`,
          fill: 'none', stroke: 'var(--nova-fg-muted,#94a3b8)', 'stroke-width': 1.3,
          'marker-end': 'url(#nge-arrow)', opacity: 0.7,
        }, this.linkLayer);
      }
    }
  }

  // ---- interaction ----------------------------------------------------------

  private svgPoint(e: PointerEvent): { x: number; y: number } {
    const rect = this.svg.getBoundingClientRect();
    const vb = this.svg.viewBox.baseVal;
    const sx = rect.width > 0 && vb.width > 0 ? vb.width / rect.width : 1;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sx };
  }

  private onPointerDown(e: PointerEvent): void {
    const el = e.target as Element;
    const id = el.getAttribute('data-id');
    if (!id) return;
    const task = this.tasks.find((t) => t.id === id);
    const node = this.sched.nodes.get(id);
    if (!task || !node) return;
    this.selected = id;
    this.renderGrid();
    const p = this.svgPoint(e);
    const x = this.dayX(node.start);
    const w = this.dayX(node.end) - x;

    if (el.classList.contains('nge-link')) {
      const line = svgEl('line', { x1: x + w + 6, y1: node ? this.barCy(id) : p.y, x2: p.x, y2: p.y, stroke: 'var(--nova-c1,#6366f1)', 'stroke-width': 2, 'stroke-dasharray': '4,3' }, this.linkLayer);
      this.drag = { mode: 'link', id, startX: p.x, startDay: node.start, startDur: task.duration, linkLine: line };
    } else if (el.classList.contains('nge-prog')) {
      this.drag = { mode: 'progress', id, startX: p.x, startDay: node.start, startDur: task.duration };
    } else if (!this.hasChildren(id) && p.x > x + w - 8) {
      this.drag = { mode: 'resize', id, startX: p.x, startDay: node.start, startDur: task.duration };
    } else if (!this.hasChildren(id)) {
      this.drag = { mode: 'move', id, startX: p.x, startDay: task.start, startDur: task.duration };
    }
    if (this.drag) e.preventDefault();
  }

  private barCy(id: string): number {
    return this.bars.get(id)?.geo.values[1]! ?? 0;
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.drag) return;
    const p = this.svgPoint(e);
    const task = this.tasks.find((t) => t.id === this.drag!.id)!;
    const dDays = Math.round((p.x - this.drag.startX) / this.opts.dayWidth);
    if (this.drag.mode === 'move') {
      task.start = Math.max(0, this.drag.startDay + dDays);
      this.render(true);
    } else if (this.drag.mode === 'resize') {
      task.duration = Math.max(1, this.drag.startDur + dDays);
      this.render(true);
    } else if (this.drag.mode === 'progress') {
      const node = this.sched.nodes.get(this.drag.id)!;
      const x = this.dayX(node.start);
      const w = this.dayX(node.end) - x;
      task.progress = Math.max(0, Math.min(1, (p.x - x) / Math.max(w, 1)));
      this.paintBar(this.drag.id);
    } else if (this.drag.mode === 'link' && this.drag.linkLine) {
      this.drag.linkLine.setAttribute('x2', String(p.x));
      this.drag.linkLine.setAttribute('y2', String(p.y));
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    if (d.mode === 'link') {
      d.linkLine?.remove();
      const target = (e.target as Element)?.getAttribute('data-id');
      if (target && target !== d.id && !this.wouldCycle(d.id, target)) {
        const t = this.tasks.find((x) => x.id === target)!;
        const deps = new Set(t.dependsOn ?? []);
        deps.add(d.id);
        t.dependsOn = [...deps];
      }
      this.commit(false);
    } else if (d.mode === 'progress') {
      this.commit(false);
    } else {
      this.commit(false);
    }
  };

  /** Adding dep `from`→`to` would cycle if `from` already depends on `to`. */
  private wouldCycle(from: string, to: string): boolean {
    const stack = [from];
    const seen = new Set<string>();
    while (stack.length) {
      const id = stack.pop()!;
      if (id === to) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      const t = this.tasks.find((x) => x.id === id);
      for (const dep of t?.dependsOn ?? []) stack.push(dep);
    }
    return false;
  }
}
