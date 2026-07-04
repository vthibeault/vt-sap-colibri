const STYLE_ID = 'nova-charts-base';

const css = `
.nova-chart {
  position: relative;
  --nova-c1: #6366f1;
  --nova-c2: #22d3ee;
  --nova-c3: #f472b6;
  --nova-c4: #34d399;
  --nova-c5: #fbbf24;
  --nova-c6: #a78bfa;
  --nova-c7: #fb7185;
  --nova-c8: #4ade80;
  --nova-fg: #475569;
  --nova-fg-muted: #94a3b8;
  --nova-grid: rgba(148, 163, 184, 0.18);
  --nova-axis: rgba(148, 163, 184, 0.45);
  --nova-tooltip-bg: rgba(15, 23, 42, 0.94);
  --nova-tooltip-fg: #f1f5f9;
  --nova-font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  font-family: var(--nova-font);
}
.nova-chart > svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
  touch-action: pan-y;
  -webkit-tap-highlight-color: transparent;
}
.nova-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.nova-axis text {
  fill: var(--nova-fg-muted);
  font-size: 11px;
  font-family: var(--nova-font);
}
.nova-axis line {
  stroke: var(--nova-axis);
}
.nova-grid line {
  stroke: var(--nova-grid);
}
.nova-tooltip {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  background: var(--nova-tooltip-bg);
  color: var(--nova-tooltip-fg);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.5;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
  white-space: nowrap;
  will-change: transform, opacity;
}
.nova-tooltip-title {
  font-weight: 600;
  margin-bottom: 2px;
  opacity: 0.85;
}
.nova-tooltip-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.nova-tooltip-swatch {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
.nova-tooltip-value {
  margin-left: auto;
  padding-left: 12px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.nova-legend {
  position: absolute;
  top: 2px;
  right: 6px;
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  pointer-events: auto;
}
.nova-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: var(--nova-fg);
  font: 12px var(--nova-font);
  padding: 3px 8px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.18s ease, opacity 0.25s ease;
}
.nova-legend-item:hover {
  background: rgba(148, 163, 184, 0.15);
}
.nova-legend-item[aria-pressed='false'] {
  opacity: 0.45;
}
.nova-legend-item[aria-pressed='false'] .nova-legend-swatch {
  background: var(--nova-fg-muted) !important;
}
.nova-legend-swatch {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex: none;
  transition: background 0.25s ease;
}
.nova-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
`;

/** Inject the base stylesheet once per document. */
export function injectBaseStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}
