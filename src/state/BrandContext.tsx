import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  applyBrand,
  loadBrand,
  resolveMode,
  saveBrand,
  type BrandConfig,
} from '@/theme/branding';

interface BrandState {
  brand: BrandConfig;
  setBrand: (brand: BrandConfig) => void;
  /** Resolved light/dark (after 'system'). */
  mode: 'light' | 'dark';
  /**
   * Bumped on every brand/mode application. nova-charts resolves CSS colors at
   * draw time, so charts remount on this key to pick up a new palette.
   */
  themeKey: number;
}

const Ctx = createContext<BrandState | null>(null);

export function BrandProvider({ children }: { children: ReactNode }) {
  const [brand, setBrandState] = useState<BrandConfig>(() => loadBrand());
  const [themeKey, setThemeKey] = useState(0);
  const [mode, setMode] = useState<'light' | 'dark'>(() => resolveMode(loadBrand().mode));

  useEffect(() => {
    applyBrand(brand);
    setMode(resolveMode(brand.mode));
    setThemeKey((k) => k + 1);
    if (brand.mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      applyBrand(brand);
      setMode(resolveMode(brand.mode));
      setThemeKey((k) => k + 1);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [brand]);

  const value = useMemo<BrandState>(
    () => ({
      brand,
      mode,
      themeKey,
      setBrand: (b) => {
        setBrandState(b);
        saveBrand(b);
      },
    }),
    [brand, mode, themeKey],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBrand(): BrandState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useBrand outside BrandProvider');
  return ctx;
}
