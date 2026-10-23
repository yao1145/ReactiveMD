import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { LocalLocale } from './locale';

export type { LocalLocale } from './locale';

/**
 * A localizer pair supplied at the call site. The English half is returned for
 * `en`, so the default renderer output stays byte-identical to the original
 * English strings.
 */
export type Localize = (en: string, zh: string) => string;

/** The English-only localizer used by helpers outside a React render. */
export const defaultLocalize: Localize = (en) => en;

const LocalLocaleContext = createContext<LocalLocale>('en');

export function LocalLocaleProvider({
  locale = 'en',
  children,
}: {
  locale?: LocalLocale;
  children: ReactNode;
}) {
  return <LocalLocaleContext.Provider value={locale}>{children}</LocalLocaleContext.Provider>;
}

export function useLocalLocale(): LocalLocale {
  return useContext(LocalLocaleContext);
}

export function localize(locale: LocalLocale, en: string, zh: string): string {
  return locale === 'zh' ? zh : en;
}

export function useLocalize(): Localize {
  const locale = useLocalLocale();
  return useMemo(() => (en: string, zh: string) => localize(locale, en, zh), [locale]);
}
