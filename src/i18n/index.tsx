import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { CATALOGS, EN_CATALOG, LOCALE_META, type Locale, type MessageKey } from './locales';
import { setFormatLocale } from '@/lib/format';

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Translate a catalog key, interpolating `{param}` placeholders. */
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18nState | null>(null);
const LOCALE_KEY = 'colibri.locale';

function loadLocale(): Locale {
  const saved = localStorage.getItem(LOCALE_KEY);
  return saved === 'de' || saved === 'fr' ? saved : 'en';
}

export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const l = loadLocale();
    setFormatLocale(LOCALE_META[l].intl);
    return l;
  });

  const value = useMemo<I18nState>(
    () => ({
      locale,
      setLocale: (l) => {
        localStorage.setItem(LOCALE_KEY, l);
        setFormatLocale(LOCALE_META[l].intl);
        setLocaleState(l);
      },
      t: (key, params) => interpolate(CATALOGS[locale][key] ?? EN_CATALOG[key] ?? key, params),
    }),
    [locale],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}

export { LOCALE_META, type Locale, type MessageKey };
