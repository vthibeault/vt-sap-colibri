/**
 * White-label branding. A BrandConfig is everything a company changes to make
 * Colibri theirs: identity, accent, shape language, type, and the chart
 * palette. It is applied as CSS custom properties on <html>, which both the
 * app styles and nova-charts (--nova-*) consume — so one JSON object rebrands
 * the entire platform, charts included.
 */

export type ColorMode = 'light' | 'dark' | 'system';

export interface ChartPalette {
  id: string;
  name: string;
  /** 8 categorical series colors per surface. Order is the CVD-safety mechanism — never reshuffle. */
  light: string[];
  dark: string[];
}

/**
 * "Signal" is the validated reference palette (lightness band, chroma floor,
 * adjacent-pair CVD ΔE, contrast — all checked per surface). Keep it the
 * default; validate any addition with a palette checker before shipping.
 */
export const CHART_PALETTES: ChartPalette[] = [
  {
    id: 'signal',
    name: 'Signal',
    light: ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'],
    dark: ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767', '#d55181', '#d95926'],
  },
  {
    id: 'aurora',
    name: 'Aurora',
    light: ['#4f46e5', '#0891b2', '#db2777', '#b45309', '#059669', '#7c3aed', '#4d7c0f', '#e11d48'],
    dark: ['#6366f1', '#0891b2', '#ec4899', '#d97706', '#059669', '#8b5cf6', '#65a30d', '#f43f5e'],
  },
];

export type RadiusStyle = 'sharp' | 'soft' | 'round';
export type FontStyle = 'modern' | 'humanist' | 'technical';

export interface BrandConfig {
  /** Product name in the sidebar and window title. */
  name: string;
  tagline: string;
  /** 1–2 letter monogram shown as the logo mark. */
  monogram: string;
  /** Primary brand color (buttons, focus, active nav, highlights). */
  accent: string;
  radius: RadiusStyle;
  font: FontStyle;
  paletteId: string;
  mode: ColorMode;
}

export const BRAND_PRESETS: (BrandConfig & { presetId: string })[] = [
  {
    presetId: 'colibri',
    name: 'Colibri',
    tagline: 'Project System, alive',
    monogram: 'C',
    accent: '#0f766e',
    radius: 'soft',
    font: 'modern',
    paletteId: 'signal',
    mode: 'system',
  },
  {
    presetId: 'nordwind',
    name: 'Nordwind AG',
    tagline: 'Engineering certainty',
    monogram: 'N',
    accent: '#1d4ed8',
    radius: 'sharp',
    font: 'technical',
    paletteId: 'signal',
    mode: 'light',
  },
  {
    presetId: 'vermilion',
    name: 'Vermilion Group',
    tagline: 'Build boldly',
    monogram: 'V',
    accent: '#b91c1c',
    radius: 'round',
    font: 'humanist',
    paletteId: 'aurora',
    mode: 'dark',
  },
  {
    presetId: 'violette',
    name: 'Violette Industries',
    tagline: 'Precision at scale',
    monogram: 'Vi',
    accent: '#6d28d9',
    radius: 'soft',
    font: 'modern',
    paletteId: 'aurora',
    mode: 'system',
  },
];

export const DEFAULT_BRAND: BrandConfig = { ...BRAND_PRESETS[0] };

const RADIUS: Record<RadiusStyle, [string, string, string]> = {
  sharp: ['6px', '9px', '12px'],
  soft: ['10px', '14px', '20px'],
  round: ['14px', '20px', '28px'],
};

const FONTS: Record<FontStyle, string> = {
  modern: "'Inter', 'SF Pro Text', system-ui, -apple-system, 'Segoe UI', sans-serif",
  humanist: "'Seravek', 'Gill Sans', 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif",
  technical: "'IBM Plex Sans', 'Segoe UI', 'Helvetica Neue', system-ui, sans-serif",
};

// ── Color math (tiny, dependency-free) ───────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(hexA: string, hexB: string, t: number): string {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function alpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** WCAG relative luminance — used to pick readable text on the accent. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function resolveMode(mode: ColorMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Write the brand onto <html> as CSS custom properties. */
export function applyBrand(brand: BrandConfig): void {
  const mode = resolveMode(brand.mode);
  const root = document.documentElement;
  const s = root.style;
  const dark = mode === 'dark';

  root.dataset.theme = mode;
  root.dataset.radius = brand.radius;

  const accent = brand.accent;
  s.setProperty('--accent', accent);
  s.setProperty('--accent-contrast', luminance(accent) > 0.45 ? '#0b0b0b' : '#ffffff');
  s.setProperty('--accent-hover', mix(accent, dark ? '#ffffff' : '#000000', 0.12));
  s.setProperty('--accent-soft', alpha(accent, dark ? 0.16 : 0.1));
  s.setProperty('--accent-soft-2', alpha(accent, dark ? 0.28 : 0.18));
  s.setProperty('--accent-ink', dark ? mix(accent, '#ffffff', 0.45) : mix(accent, '#000000', 0.18));
  s.setProperty('--ring', alpha(accent, 0.45));

  const [r1, r2, r3] = RADIUS[brand.radius];
  s.setProperty('--radius-s', r1);
  s.setProperty('--radius-m', r2);
  s.setProperty('--radius-l', r3);
  s.setProperty('--font-sans', FONTS[brand.font]);

  const palette = CHART_PALETTES.find((p) => p.id === brand.paletteId) ?? CHART_PALETTES[0];
  const series = dark ? palette.dark : palette.light;
  series.forEach((c, i) => s.setProperty(`--series-${i + 1}`, c));

  document.title = `${brand.name} · Project System`;
}

const BRAND_KEY = 'colibri.brand';

export function loadBrand(): BrandConfig {
  try {
    const raw = localStorage.getItem(BRAND_KEY);
    if (raw) return { ...DEFAULT_BRAND, ...(JSON.parse(raw) as Partial<BrandConfig>) };
  } catch {
    /* fall through */
  }
  return DEFAULT_BRAND;
}

export function saveBrand(brand: BrandConfig): void {
  localStorage.setItem(BRAND_KEY, JSON.stringify(brand));
}
