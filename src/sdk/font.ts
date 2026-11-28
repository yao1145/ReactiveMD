import { readLocalFontAliases, type LocalFontAliases } from '../contracts/font-aliases';
import { localHash } from './hash';
import type { LocalStyleResource } from './theme';

export interface LocalFontInput {
  readonly alias: string;
  /** Inline WOFF or WOFF2 data from the host's asset loader. */
  readonly source: string;
}

export interface LocalFontRegistration {
  readonly fonts: LocalFontAliases;
  readonly resource: LocalStyleResource;
}

/** Produce a host alias and a portable @font-face resource for one font. */
export function defineLocalFont(input: LocalFontInput): LocalFontRegistration {
  if (!input || typeof input.alias !== 'string' || typeof input.source !== 'string'
    || input.source.length > 4 * 1024 * 1024 - 512) {
    throw new TypeError('defineLocalFont requires an alias and a bounded inline font.');
  }
  const source = /^data:font\/(woff2?);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.source);
  if (!source || source[0] !== input.source || source[2].length % 4 !== 0) {
    throw new TypeError('defineLocalFont accepts a base64 data URL for WOFF or WOFF2.');
  }
  const family = `rmd-host-font-${localHash(input.source)}`;
  const fonts = readLocalFontAliases({ [input.alias]: family }, 'fonts')!;
  const resource = Object.freeze({
    id: `reactive-md/fonts/${family}.css`,
    css: `@font-face { font-family: "${family}"; src: url("${input.source}") format("${source[1]}"); font-display: swap; }`,
  });
  return Object.freeze({ fonts, resource });
}
