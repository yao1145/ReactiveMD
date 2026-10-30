/**
 * SDK protocol identities and package version.
 *
 * These revisions are independent from each other and from the document
 * syntax revision: a package release may move one without changing the others.
 */
export const LOCAL_SDK_VERSION = '0.6.1' as const;
export const LOCAL_COMPONENT_PROTOCOL = 'reactive-md-component/v1' as const;
export const LOCAL_CONFIG_PROTOCOL = 'reactive-md-config/v1' as const;
export const LOCAL_EXTENSIONS_PROTOCOL = 'reactive-md-extensions/v1' as const;

/** Bounded range syntax: exact, `^`, `~`, `=`, `>`, `>=`, `<`, `<=`. */
export const MAX_LOCAL_VERSION_RANGE_LENGTH = 128;
export const MAX_LOCAL_VERSION_COMPARATORS = 8;

interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly (string | number)[];
}

export type LocalVersionOperator = '=' | '>' | '>=' | '<' | '<=';

export interface LocalVersionComparator {
  readonly operator: LocalVersionOperator;
  readonly version: ParsedVersion;
}

export interface LocalVersionRange {
  readonly source: string;
  readonly comparators: readonly LocalVersionComparator[];
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const LEADING_ZERO = /^0\d+$/;

function parsePrerelease(text: string | undefined): readonly (string | number)[] | null {
  if (text === undefined) return Object.freeze([]);
  const parts = text.split('.');
  const parsed: (string | number)[] = [];
  for (const part of parts) {
    if (part.length === 0) return null;
    if (LEADING_ZERO.test(part) && part !== '0' && /^\d+$/.test(part)) return null;
    if (/^\d+$/.test(part) && !Number.isSafeInteger(Number(part))) return null;
    parsed.push(/^\d+$/.test(part) ? Number(part) : part);
  }
  return Object.freeze(parsed);
}

function parseVersion(text: string): ParsedVersion | null {
  const match = VERSION.exec(text);
  if (!match) return null;
  const [, majorText, minorText, patchText, prereleaseText] = match;
  for (const part of [majorText, minorText, patchText]) {
    if (part.length > 1 && part.startsWith('0')) return null;
    if (!Number.isSafeInteger(Number(part))) return null;
  }
  const prerelease = parsePrerelease(prereleaseText);
  if (prerelease === null) return null;
  return {
    major: Number(majorText),
    minor: Number(minorText),
    patch: Number(patchText),
    prerelease,
  };
}

function compareIdentifier(left: string | number, right: string | number): number {
  if (typeof left === 'number' && typeof right === 'number') return left === right ? 0 : left < right ? -1 : 1;
  if (typeof left === 'number') return -1;
  if (typeof right === 'number') return 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const length = Math.min(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const order = compareIdentifier(left.prerelease[index], right.prerelease[index]);
    if (order !== 0) return order;
  }
  return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length < right.prerelease.length ? -1 : 1;
}

function mainVersion(major: number, minor: number, patch: number): ParsedVersion {
  return { major, minor, patch, prerelease: Object.freeze([]) };
}

function expandComparator(operator: LocalVersionOperator | '^' | '~', version: ParsedVersion): LocalVersionComparator[] {
  if (operator === '^') {
    const upper = version.major > 0
      ? mainVersion(version.major + 1, 0, 0)
      : version.minor > 0
        ? mainVersion(0, version.minor + 1, 0)
        : mainVersion(0, 0, version.patch + 1);
    return [
      { operator: '>=', version },
      { operator: '<', version: upper },
    ];
  }
  if (operator === '~') {
    return [
      { operator: '>=', version },
      { operator: '<', version: mainVersion(version.major, version.minor + 1, 0) },
    ];
  }
  return [{ operator, version }];
}

/**
 * Parse a bounded semver range. Unsupported syntax (`*`, `||`, hyphen ranges,
 * wildcards, `v` prefixes, spaced operators) returns null instead of being
 * approximated.
 */
export function parseLocalVersionRange(source: unknown): LocalVersionRange | null {
  if (typeof source !== 'string') return null;
  const text = source.trim();
  if (text.length === 0 || text.length > MAX_LOCAL_VERSION_RANGE_LENGTH) return null;
  const tokens = text.split(/\s+/);
  if (tokens.length === 0 || tokens.length > MAX_LOCAL_VERSION_COMPARATORS) return null;
  const comparators: LocalVersionComparator[] = [];
  try {
    for (const token of tokens) {
      let operator: LocalVersionOperator | '^' | '~' = '=';
      let body = token;
      if (token.startsWith('>=') || token.startsWith('<=')) {
        operator = token.slice(0, 2) as LocalVersionOperator;
        body = token.slice(2);
      } else if (token.startsWith('>') || token.startsWith('<') || token.startsWith('=')) {
        operator = token[0] as LocalVersionOperator;
        body = token.slice(1);
      } else if (token.startsWith('^') || token.startsWith('~')) {
        operator = token[0] as '^' | '~';
        body = token.slice(1);
      }
      const version = parseVersion(body);
      if (version === null) return null;
      comparators.push(...expandComparator(operator, version));
      if (comparators.length > MAX_LOCAL_VERSION_COMPARATORS * 2) return null;
    }
  } catch {
    return null;
  }
  return Object.freeze({ source: text, comparators: Object.freeze(comparators) });
}

/** True when `version` is a valid, complete semantic version. */
export function isLocalVersion(value: unknown): value is string {
  return typeof value === 'string' && parseVersion(value) !== null;
}

/**
 * Check one installed version against a parsed or textual range. Invalid
 * versions or ranges never satisfy the range.
 */
export function localVersionSatisfies(version: string, range: string | LocalVersionRange): boolean {
  try {
    const installed = parseVersion(version);
    if (installed === null) return false;
    const parsed = typeof range === 'string' ? parseLocalVersionRange(range) : range;
    if (!parsed || !Array.isArray(parsed.comparators) || parsed.comparators.length === 0) return false;
    if (installed.prerelease.length && !parsed.comparators.some(({ version: candidate }) =>
      candidate.prerelease.length && candidate.major === installed.major
      && candidate.minor === installed.minor && candidate.patch === installed.patch)) return false;
    for (const comparator of parsed.comparators) {
      const order = compareVersions(installed, comparator.version);
      switch (comparator.operator) {
        case '=':
          if (order !== 0) return false;
          break;
        case '>':
          if (order <= 0) return false;
          break;
        case '>=':
          if (order < 0) return false;
          break;
        case '<':
          if (order >= 0) return false;
          break;
        case '<=':
          if (order > 0) return false;
          break;
        default:
          return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function isLocalVersionRange(value: unknown): value is LocalVersionRange {
  return typeof value === 'object' && value !== null
    && typeof (value as LocalVersionRange).source === 'string'
    && Array.isArray((value as LocalVersionRange).comparators);
}
