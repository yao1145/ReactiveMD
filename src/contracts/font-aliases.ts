/** Maps stable source names to CSS font-family names. Font files belong to style resources. */
export type LocalFontAliases = Readonly<Record<string, string>>;

export const LOCAL_TEXT_FONT_CHOICES = ['sans', 'serif', 'mono'] as const;
export const LOCAL_TEXT_COMPONENT_ID = 'reactive-md/text';

const RESERVED = new Set<string>([...LOCAL_TEXT_FONT_CHOICES, 'constructor', 'prototype']);
const ALIAS = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const FAMILY = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} ._-]*$/u;
const EMPTY: LocalFontAliases = Object.freeze({});
const MAX_ALIASES = 64;

/** Validate metadata without reading a stylesheet or loading any font. */
export function readLocalFontAliases(value: unknown, path: string): LocalFontAliases | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must map font aliases to family names.`);
  }
  const aliases = Object.keys(value).sort();
  if (aliases.length > MAX_ALIASES) throw new TypeError(`${path} accepts at most ${MAX_ALIASES} aliases.`);
  if (!aliases.length) return undefined;
  const record = value as Record<string, unknown>;
  const entries = aliases.map(alias => {
    if (alias.length > 64 || alias.trim() !== alias || !ALIAS.test(alias) || RESERVED.has(alias)) {
      throw new TypeError(`${path} has an invalid or reserved font alias "${alias}".`);
    }
    const family = record[alias];
    if (typeof family !== 'string' || family.length > 600 || family.trim() !== family || !FAMILY.test(family)) {
      throw new TypeError(`${path}.${alias} must be a single font family name.`);
    }
    return [alias, family] as const;
  });
  return Object.freeze(Object.fromEntries(entries));
}

interface FontRegistry {
  readonly fonts?: LocalFontAliases;
  readonly themes: readonly { readonly name: string; readonly fonts?: LocalFontAliases }[];
}

export function activeLocalFontAliases(config: FontRegistry | undefined, theme?: string): LocalFontAliases {
  const host = config?.fonts;
  const local = config?.themes.find(item => item.name === theme)?.fonts;
  return local ? { ...host, ...local } : host ?? EMPTY;
}

export function localTextFontChoices(
  aliases: LocalFontAliases,
  base: readonly string[] = LOCAL_TEXT_FONT_CHOICES,
): readonly string[] {
  return [...new Set([...base, ...Object.keys(aliases).sort()])];
}

/** Font family or resource changes do not change compile semantics. */
export function localFontAvailabilityKey(config: FontRegistry): string {
  const host = Object.keys(config.fonts ?? EMPTY).sort();
  const themes = config.themes.flatMap(theme => {
    const aliases = Object.keys(theme.fonts ?? EMPTY).sort();
    return aliases.length ? [[theme.name, aliases]] : [];
  });
  return host.length || themes.length ? JSON.stringify([host, themes]) : '';
}
