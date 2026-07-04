import { clamp, lerp } from './number.js';

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  transparent: 'rgba(0,0,0,0)',
};

/** Parse #hex (3/4/6/8), rgb()/rgba(), hsl()/hsla() and a few named colors. */
export function parseColor(input: string): RGBA | null {
  let s = input.trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s]!;

  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0]! + hex[0]!, 16);
      const g = parseInt(hex[1]! + hex[1]!, 16);
      const b = parseInt(hex[2]! + hex[2]!, 16);
      const a = hex.length === 4 ? parseInt(hex[3]! + hex[3]!, 16) / 255 : 1;
      if ([r, g, b].some(Number.isNaN)) return null;
      return { r, g, b, a };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      if ([r, g, b].some(Number.isNaN)) return null;
      return { r, g, b, a };
    }
    return null;
  }

  const fn = /^(rgba?|hsla?)\(([^)]+)\)$/.exec(s);
  if (fn) {
    const parts = fn[2]!
      .split(/[,/\s]+/)
      .filter(Boolean)
      .map((p) => p.trim());
    if (parts.length < 3) return null;
    const nums = parts.map((p) =>
      p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p),
    );
    if (nums.some(Number.isNaN)) return null;
    const a = clamp(parts.length > 3 ? nums[3]! : 1, 0, 1);
    if (fn[1]!.startsWith('rgb')) {
      const scale = (i: number): number =>
        clamp(parts[i]!.endsWith('%') ? nums[i]! * 255 : nums[i]!, 0, 255);
      return { r: scale(0), g: scale(1), b: scale(2), a };
    }
    // hsl
    const h = ((nums[0]! % 360) + 360) % 360;
    const sl = clamp(nums[1]!, 0, 1);
    const l = clamp(nums[2]!, 0, 1);
    return { ...hslToRgb(h, sl, l), a };
  }

  return null;
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export function formatRgba(c: RGBA): string {
  const r = Math.round(clamp(c.r, 0, 255));
  const g = Math.round(clamp(c.g, 0, 255));
  const b = Math.round(clamp(c.b, 0, 255));
  const a = Math.round(clamp(c.a, 0, 1) * 1000) / 1000;
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Interpolator between two CSS color strings (sRGB space). */
export function interpolateColor(from: string, to: string): (t: number) => string {
  const a = parseColor(from) ?? { r: 0, g: 0, b: 0, a: 1 };
  const b = parseColor(to) ?? { r: 0, g: 0, b: 0, a: 1 };
  return (t) =>
    formatRgba({
      r: lerp(a.r, b.r, t),
      g: lerp(a.g, b.g, t),
      b: lerp(a.b, b.b, t),
      a: lerp(a.a, b.a, t),
    });
}

export function rgbaToVec(c: RGBA): Float64Array {
  return Float64Array.of(c.r, c.g, c.b, c.a);
}

export function vecToRgba(v: ArrayLike<number>): string {
  return formatRgba({ r: v[0] ?? 0, g: v[1] ?? 0, b: v[2] ?? 0, a: v[3] ?? 1 });
}
