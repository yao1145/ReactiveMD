/** A localized English/Chinese string selector. */
export type Localize = (english: string, chinese: string) => string;

/** English-only localization for code outside a React render tree. */
export const defaultLocalize: Localize = (english) => english;

/** Select one of the two built-in locale strings. */
export function localize(locale: 'en' | 'zh', english: string, chinese: string): string {
  return locale === 'zh' ? chinese : english;
}
