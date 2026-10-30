/**
 * Restricted regular-expression subset shared by host schemas and SDK
 * manifests. Rejected constructs are the ones that can backtrack
 * super-linearly on document-controlled input.
 */

function patternQuantifier(source: string, index: number): { length: number } | null {
  const char = source[index];
  if (char === '*' || char === '+' || char === '?') {
    return { length: source[index + 1] === '?' ? 2 : 1 };
  }
  if (char !== '{') return null;
  const match = /^\{(\d+)(?:,(\d*))?\}/.exec(source.slice(index));
  if (!match) return null;
  return { length: match[0].length + (source[index + match[0].length] === '?' ? 1 : 0) };
}

/**
 * True when `source` uses only linear-time-safe regex syntax: no
 * backreferences, lookarounds, named groups, and no quantifier applied to a
 * group that itself contains a quantifier or alternation.
 */
export function isSafeLocalPattern(source: string): boolean {
  const groups: { quantified: boolean; alternation: boolean }[] = [];
  let escaped = false;
  let inClass = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      const next = source[index + 1];
      if (next !== undefined && next >= '1' && next <= '9') return false;
      if (next === 'k' && source[index + 2] === '<') return false;
      escaped = true;
      continue;
    }
    if (inClass) {
      if (char === ']') inClass = false;
      continue;
    }
    if (char === '[') {
      inClass = true;
      continue;
    }
    if (char === '(') {
      // Non-capturing groups stay in the subset; lookarounds, named groups
      // and atomic groups do not.
      if (source[index + 1] === '?') {
        if (source[index + 2] !== ':') return false;
        groups.push({ quantified: false, alternation: false });
        index += 2;
        continue;
      }
      groups.push({ quantified: false, alternation: false });
      continue;
    }
    if (char === '|') {
      const group = groups[groups.length - 1];
      if (group) group.alternation = true;
      continue;
    }
    if (char === ')') {
      const group = groups.pop();
      if (!group) return false;
      const quantifier = patternQuantifier(source, index + 1);
      if (quantifier && (group.quantified || group.alternation)) return false;
      const parent = groups[groups.length - 1];
      if (parent) {
        parent.quantified = parent.quantified || group.quantified || quantifier !== null;
        parent.alternation = parent.alternation || group.alternation;
      }
      if (quantifier) index += quantifier.length;
      continue;
    }
    const quantifier = patternQuantifier(source, index);
    if (quantifier) {
      const group = groups[groups.length - 1];
      if (group) group.quantified = true;
      index += quantifier.length - 1;
    }
  }
  return groups.length === 0 && !escaped && !inClass;
}
