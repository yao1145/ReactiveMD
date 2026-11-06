/**
 * Small lexical scanners shared by the strict parser and the recovery planner.
 *
 * These routines answer only "where does this token end". Callers decide
 * whether a missing closer is an error, a recovery boundary or literal text.
 */

/**
 * End offset (exclusive) of the `{{ ... }}` opened at `start`, honoring quoted
 * strings and backslash escapes. Returns -1 when the closer is missing.
 */
export function scanInterpolationEnd(source: string, start: number, limit: number): number {
  let quote = '';
  for (let index = start + 2; index < limit - 1; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '}' && source[index + 1] === '}') {
      return index + 2;
    }
  }
  return -1;
}

/** End of an escaped `\X ... X` pair opening at `from`. */
export function escapedPairEnd(source: string, from: number, end: number, close: string): number | null {
  for (let index = from; index + 1 < end; index += 1) {
    if (source[index] !== '\\') continue;
    if (source[index + 1] === close) return index + 2;
    index += 1;
  }
  return null;
}

/** End of an escaped `\\[ ... \\]` display wrapper. */
export function escapedDisplayEnd(source: string, from: number, end: number): number | null {
  for (let index = from; index + 2 < end; index += 1) {
    if (source[index] !== '\\') continue;
    // A padded `\\]` wrapper closes the formula; the preceding space is the
    // same guard the strict lexical reader uses.
    if (source[index + 1] === '\\' && source[index + 2] === ']'
      && /\s/.test(source[index - 1] ?? '')) return index + 3;
    index += 1;
  }
  return null;
}

/**
 * End of the formula token starting at `start`, or null when the token is not
 * a formula. Formula spans are opaque so tags inside TeX never look
 * structural.
 */
export function mathTokenEnd(source: string, start: number, end: number): number | null {
  if (source.startsWith('\\\\[', start)) {
    return escapedDisplayEnd(source, start + 3, end) ?? start + 3;
  }
  if (source[start] === '\\' && source[start + 1] === '(') {
    return escapedPairEnd(source, start + 2, end, ')') ?? start + 2;
  }
  if (source[start] === '\\' && source[start + 1] === '[') {
    return escapedPairEnd(source, start + 2, end, ']') ?? start + 2;
  }
  if (source[start] !== '$') return null;
  if (source[start + 1] === '$') {
    for (let index = start + 2; index + 1 < end; index += 1) {
      if (source[index] === '\\') index += 1;
      else if (source[index] === '$' && source[index + 1] === '$') return index + 2;
    }
    return start + 2;
  }
  for (let index = start + 1; index < end; index += 1) {
    const character = source[index];
    if (character === '\\') { index += 1; continue; }
    if (character === '\n' || character === '\r') break;
    if (character !== '$') continue;
    const value = source.slice(start + 1, index);
    const after = source[index + 1];
    if (!value.trim()) break;
    if (after !== undefined && after >= '0' && after <= '9') break;
    return index + 1;
  }
  return start + 1;
}
