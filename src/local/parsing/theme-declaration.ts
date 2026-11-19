import { isLocalThemeName } from '../../themes/document-theme';

interface ThemeTag { start: number; end: number; rest: string; closing: boolean; selfClosing: boolean; unclosed: boolean }

/** Cheap pre-check so ordinary `<` characters never pay for a tag scan. */
export function isThemeTagAt(source: string, index: number): boolean {
  const closing = source.startsWith('</theme', index);
  const opening = !closing && source.startsWith('<theme', index);
  if (!closing && !opening) return false;
  const boundary = source[index + (closing ? 7 : 6)];
  return boundary !== undefined && (boundary === '>' || boundary === '/' || /\s/.test(boundary));
}

export function themeTagAt(source: string, start: number, limit: number): ThemeTag | null {
  const match = /^<(\/?)theme(?=[\s/>])/.exec(source.slice(start, limit));
  if (!match) return null;
  const nameEnd = start + match[0].length;
  // Metadata occupies one source line. A missing bracket must never borrow
  // the next component's closing bracket and consume that component.
  const newline = source.indexOf('\n', nameEnd);
  const lineEnd = newline < 0 ? limit : Math.min(limit, newline);
  let quote = '';
  let index = nameEnd;
  for (; index < lineEnd; index += 1) {
    const character = source[index];
    if (quote) { if (character === quote) quote = ''; }
    else if (character === '"' || character === "'") quote = character;
    else if (character === '>') break;
  }
  const closing = Boolean(match[1]);
  if (index >= lineEnd) {
    // An unclosed declaration only claims its own line so the following
    // controls survive the malformed metadata.
    const stop = lineEnd;
    return { start, end: stop, rest: source.slice(nameEnd, stop), closing, selfClosing: false, unclosed: true };
  }
  const rest = source.slice(nameEnd, index);
  return { start, end: index + 1, rest, closing, selfClosing: /\/\s*$/.test(rest), unclosed: false };
}

/** Whitespace, BOM and leading comments may precede the declaration. */
export function skipThemePrefix(source: string, from: number, to: number): number {
  let index = from;
  while (index < to) {
    const character = source[index];
    if (character.charCodeAt(0) === 0xfeff || character === ' ' || character === '\t' || character === '\r' || character === '\n') {
      index += 1;
      continue;
    }
    if (source.startsWith('<!--', index)) {
      const close = source.indexOf('-->', index + 4);
      if (close < 0 || close + 3 > to) return -1;
      index = close + 3;
      continue;
    }
    break;
  }
  return index;
}

export function standaloneTheme(source: string, tag: ThemeTag): boolean {
  if (tag.unclosed) return false;
  let index = tag.end;
  while (index < source.length && (source[index] === ' ' || source[index] === '\t' || source[index] === '\r')) index += 1;
  return index >= source.length || source[index] === '\n';
}

export function themeNameFrom(rest: string): { name?: string; code?: string; key?: string; params?: Record<string, string | number>; message?: string } {
  if (/\{\{|\}\}/.test(rest)) {
    return {
      code: 'local.theme.expression',
      key: 'local.theme.expression',
      message: 'Theme names must be static text, not expressions.',
    };
  }
  const body = rest.replace(/\/\s*$/, '');
  const match = /^\s*name\s*=\s*(?:"([^"]*)"|'([^']*)')\s*$/.exec(body);
  if (!match) {
    if (!/\bname\s*=/.test(body)) {
      return {
        code: 'local.theme.name',
        key: 'local.theme.name.missing',
        message: 'A theme declaration requires a quoted name attribute.',
      };
    }
    return {
      code: 'local.theme.attribute',
      key: 'local.theme.attribute',
      message: 'Theme declarations only accept a quoted name attribute.',
    };
  }
  const name = match[1] ?? match[2] ?? '';
  if (!isLocalThemeName(name)) {
    return {
      code: 'local.theme.name',
      key: 'local.theme.name.invalid',
      params: { name, limit: 64 },
      message: `Theme name "${name}" must use lowercase letters, digits and single hyphens (maximum 64 characters).`,
    };
  }
  return { name };
}
