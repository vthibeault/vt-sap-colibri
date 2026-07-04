import { fmtNum as f } from './curve.js';

export interface ArcSpec {
  cx: number;
  cy: number;
  innerRadius: number;
  outerRadius: number;
  /** Radians; 0 points up (12 o'clock), increasing clockwise. */
  startAngle: number;
  endAngle: number;
  /** Angular gap (radians) shaved off each side of the slice. */
  padAngle?: number;
  /**
   * Constant gap *width in pixels* between adjacent slices. Unlike padAngle,
   * the gap edges are parallel straight lines (same width at every radius),
   * and the gap shrinks smoothly to zero on slices too narrow to hold it.
   */
  padPx?: number;
}

const TAU = Math.PI * 2;

function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  // angle 0 = up, clockwise positive (screen coordinates)
  return [cx + r * Math.sin(angle), cy - r * Math.cos(angle)];
}

/**
 * SVG path `d` for a donut/pie slice. Angles are animated values rebuilt
 * each frame — arc d-strings are never string-morphed.
 * Handles zero-extent slices and full circles.
 */
export function buildArcPath(spec: ArcSpec): string {
  const { cx, cy, innerRadius, outerRadius } = spec;
  let a0 = spec.startAngle;
  let a1 = spec.endAngle;
  if (a1 < a0) [a0, a1] = [a1, a0];

  const extent = a1 - a0;
  if (extent <= 1e-6) return '';

  // Constant-width gap: offset each edge by a fixed perpendicular distance
  // from its radial divider, so the gap reads as a straight strip of even
  // width rather than a wedge. The offset shrinks with the slice so narrow
  // slices lose the gap gracefully instead of popping.
  const padPx = spec.padPx ?? 0;
  if (padPx > 0 && extent < TAU - 1e-6) {
    return buildPaddedArc(cx, cy, innerRadius, outerRadius, a0, a1, extent, padPx);
  }

  // Legacy constant-angle pad (kept for callers that opt into it).
  const pad = spec.padAngle ?? 0;
  if (pad > 0 && extent > pad * 2 && extent < TAU - 1e-6) {
    a0 += pad;
    a1 -= pad;
  }
  return buildPlainArc(cx, cy, innerRadius, outerRadius, a0, a1, a1 - a0);
}

function buildPaddedArc(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  a0: number,
  a1: number,
  extent: number,
  padPx: number,
): string {
  const sinHalf = Math.sin(extent / 2);
  // Half-gap, clamped so the outer arc never inverts (gap fades on narrow slices).
  const d = Math.min(padPx / 2, outerRadius * sinHalf * 0.999);
  if (d <= 1e-4) return buildPlainArc(cx, cy, innerRadius, outerRadius, a0, a1, extent);

  const offOuter = Math.asin(Math.min(d / outerRadius, 1));
  const oa0 = a0 + offOuter;
  const oa1 = a1 - offOuter;
  const largeArc = oa1 - oa0 > Math.PI ? 1 : 0;
  const [sox, soy] = polar(cx, cy, outerRadius, oa0);
  const [eox, eoy] = polar(cx, cy, outerRadius, oa1);

  // Radius where the two offset edges meet. Below it there's no room for an
  // inner arc, so the slice comes to a point (covers pies and thin donuts).
  const apexRadius = sinHalf > 1e-6 ? d / sinHalf : 0;

  if (innerRadius <= apexRadius + 1e-4) {
    const mid = (a0 + a1) / 2;
    const [apx, apy] = polar(cx, cy, Math.max(apexRadius, innerRadius), mid);
    return (
      `M${f(sox)},${f(soy)}` +
      `A${f(outerRadius)},${f(outerRadius)} 0 ${largeArc} 1 ${f(eox)},${f(eoy)}` +
      `L${f(apx)},${f(apy)}` +
      'Z'
    );
  }

  const offInner = Math.asin(Math.min(d / innerRadius, 1));
  const ia0 = a0 + offInner;
  const ia1 = a1 - offInner;
  const [six, siy] = polar(cx, cy, innerRadius, ia0);
  const [eix, eiy] = polar(cx, cy, innerRadius, ia1);
  return (
    `M${f(sox)},${f(soy)}` +
    `A${f(outerRadius)},${f(outerRadius)} 0 ${largeArc} 1 ${f(eox)},${f(eoy)}` +
    `L${f(eix)},${f(eiy)}` +
    `A${f(innerRadius)},${f(innerRadius)} 0 ${largeArc} 0 ${f(six)},${f(siy)}` +
    'Z'
  );
}

function buildPlainArc(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  a0: number,
  a1: number,
  extent: number,
): string {
  if (extent <= 1e-6) return '';

  if (extent >= TAU - 1e-6) {
    // Full ring: two semicircle arcs (a single arc can't span 360°).
    const [ox0, oy0] = polar(cx, cy, outerRadius, 0);
    const [ox1, oy1] = polar(cx, cy, outerRadius, Math.PI);
    let d =
      `M${f(ox0)},${f(oy0)}` +
      `A${f(outerRadius)},${f(outerRadius)} 0 1 1 ${f(ox1)},${f(oy1)}` +
      `A${f(outerRadius)},${f(outerRadius)} 0 1 1 ${f(ox0)},${f(oy0)}`;
    if (innerRadius > 0) {
      const [ix0, iy0] = polar(cx, cy, innerRadius, 0);
      const [ix1, iy1] = polar(cx, cy, innerRadius, Math.PI);
      d +=
        `M${f(ix0)},${f(iy0)}` +
        `A${f(innerRadius)},${f(innerRadius)} 0 1 0 ${f(ix1)},${f(iy1)}` +
        `A${f(innerRadius)},${f(innerRadius)} 0 1 0 ${f(ix0)},${f(iy0)}`;
    }
    return d + 'Z';
  }

  const largeArc = extent > Math.PI ? 1 : 0;
  const [sox, soy] = polar(cx, cy, outerRadius, a0);
  const [eox, eoy] = polar(cx, cy, outerRadius, a1);

  if (innerRadius <= 0) {
    return (
      `M${f(cx)},${f(cy)}` +
      `L${f(sox)},${f(soy)}` +
      `A${f(outerRadius)},${f(outerRadius)} 0 ${largeArc} 1 ${f(eox)},${f(eoy)}` +
      'Z'
    );
  }

  const [six, siy] = polar(cx, cy, innerRadius, a0);
  const [eix, eiy] = polar(cx, cy, innerRadius, a1);
  return (
    `M${f(sox)},${f(soy)}` +
    `A${f(outerRadius)},${f(outerRadius)} 0 ${largeArc} 1 ${f(eox)},${f(eoy)}` +
    `L${f(eix)},${f(eiy)}` +
    `A${f(innerRadius)},${f(innerRadius)} 0 ${largeArc} 0 ${f(six)},${f(siy)}` +
    'Z'
  );
}

/** Midpoint of a slice — anchor for labels and hover offsets. */
export function arcCentroid(spec: ArcSpec): [number, number] {
  const mid = (spec.startAngle + spec.endAngle) / 2;
  const r = (spec.innerRadius + spec.outerRadius) / 2;
  return polar(spec.cx, spec.cy, r, mid);
}
