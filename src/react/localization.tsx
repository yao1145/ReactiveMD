import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { LocalLocale } from '../contracts/runtime-types';
import { localize } from '../contracts/localization';

export { defaultLocalize, localize } from '../contracts/localization';
export type { LocalLocale } from '../contracts/runtime-types';

/**
 * A localizer pair supplied at the call site. The English half is returned for
 * `en`, so the default renderer output stays byte-identical to the original
 * English strings.
 */
export type { Localize } from '../contracts/localization';
import type { Localize } from '../contracts/localization';

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

export function useLocalize(): Localize {
  const locale = useLocalLocale();
  return useMemo(() => (en: string, zh: string) => localize(locale, en, zh), [locale]);
}
