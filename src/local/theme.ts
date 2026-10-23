import type { Diagnostic, SourceRange } from './types';

/**
 * Versioned theme contract. A host registers CSS for a theme name and declares
 * that contract here; the document only carries a name, never CSS or a URL.
 */
export const LOCAL_THEME_PROTOCOL = 'reactive-md-theme-1' as const;

export type LocalColorScheme = 'light' | 'dark' | 'auto';

export interface LocalThemeDefinition {
  readonly name: string;
  readonly protocol: typeof LOCAL_THEME_PROTOCOL;
  readonly colorSchemes: readonly ('light' | 'dark')[];
}

/** Built-in theme supplied by the package, so old documents keep working. */
export const DEFAULT_LOCAL_THEME: LocalThemeDefinition = Object.freeze({
  name: 'default',
  protocol: LOCAL_THEME_PROTOCOL,
  colorSchemes: Object.freeze(['light', 'dark'] as const),
});

const THEME_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MAX_THEME_NAME_LENGTH = 64;

/** Bounded, URL-free theme identifier used by documents and host manifests. */
export function isLocalThemeName(value: unknown): value is string {
  return (
    typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_THEME_NAME_LENGTH
    && THEME_NAME.test(value)
  );
}

export interface LocalThemeResolution {
  name: string;
  diagnostics: Diagnostic[];
}

function clampRange(range: SourceRange | undefined, source: string | undefined): SourceRange {
  const length = typeof source === 'string' ? source.length : Number.POSITIVE_INFINITY;
  if (!range || typeof range.start !== 'number' || typeof range.end !== 'number'
    || !Number.isFinite(range.start) || !Number.isFinite(range.end)) {
    return { start: 0, end: 0 };
  }
  const start = Math.max(0, Math.min(length, Math.floor(range.start)));
  const end = Math.max(start, Math.min(length, Math.floor(range.end)));
  return { start, end };
}

function positionOf(source: string | undefined, start: number): { line: number; column: number } {
  if (typeof source !== 'string' || source.length === 0) return { line: 1, column: 1 };
  const limit = Math.min(start, source.length);
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < limit; index += 1) {
    if (source[index] === '\n') {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: start - lineStart + 1 };
}

function themeDiagnostic(
  code: string,
  message: string,
  range: SourceRange | undefined,
  source: string | undefined,
): Diagnostic {
  const safe = clampRange(range, source);
  const { line, column } = positionOf(source, safe.start);
  return { code, message, severity: 'warning', range: safe, line, column };
}

/**
 * Resolve the document-selected theme against a host-supplied manifest.
 *
 * This is a pure validation step: it never mutates the registry, loads CSS,
 * runs host code or throws. Any malformed selection or manifest degrades to
 * the built-in `default` theme with a warning so healthy controls keep working.
 * Unknown names are not compiler errors; this function is called where the
 * renderer actually chooses a theme.
 */
export function resolveLocalTheme(
  requested?: string,
  themes?: readonly LocalThemeDefinition[],
  range?: SourceRange,
  source?: string,
): LocalThemeResolution {
  const fallback = (code: string, message: string): LocalThemeResolution => ({
    name: DEFAULT_LOCAL_THEME.name,
    diagnostics: [themeDiagnostic(code, message, range, source)],
  });

  const candidate: unknown = requested;
  if (candidate === undefined || candidate === null || candidate === '') {
    // No declaration is normal: old and hand-built documents use the built-in.
    return { name: DEFAULT_LOCAL_THEME.name, diagnostics: [] };
  }
  if (!isLocalThemeName(candidate)) {
    return fallback(
      'local.theme.name',
      `Theme name "${String(candidate)}" must use lowercase letters, digits and single hyphens (maximum ${MAX_THEME_NAME_LENGTH} characters).`,
    );
  }
  const name = candidate;
  if (name === DEFAULT_LOCAL_THEME.name) {
    // `default` is reserved and built in; a host definition cannot replace it.
    return { name: DEFAULT_LOCAL_THEME.name, diagnostics: [] };
  }
  if (!Array.isArray(themes)) {
    return fallback(
      'local.theme.missing',
      `Theme "${name}" is not registered by the host; using the default theme.`,
    );
  }

  let matches = 0;
  let selected: unknown = null;
  try {
    for (const entry of themes as readonly unknown[]) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
      if ((entry as { name?: unknown }).name === name) {
        matches += 1;
        selected = entry;
      }
    }
  } catch {
    return fallback(
      'local.theme.manifest',
      `The host theme registry could not be read; using the default theme.`,
    );
  }

  if (matches === 0) {
    return fallback(
      'local.theme.missing',
      `Theme "${name}" is not registered by the host; using the default theme.`,
    );
  }
  if (matches > 1) {
    return fallback(
      'local.theme.duplicate',
      `Theme "${name}" is registered more than once; using the default theme.`,
    );
  }

  try {
    const entry = selected as Partial<LocalThemeDefinition> | null;
    if (!entry || typeof entry !== 'object') {
      return fallback('local.theme.manifest', `The selected theme "${name}" is not a valid definition; using the default theme.`);
    }
    if (entry.protocol !== LOCAL_THEME_PROTOCOL) {
      return fallback(
        'local.theme.protocol',
        `Theme "${name}" does not support the ${LOCAL_THEME_PROTOCOL} protocol; using the default theme.`,
      );
    }
    const schemes = (entry as { colorSchemes?: unknown }).colorSchemes;
    if (!Array.isArray(schemes) || !schemes.includes('light') || !schemes.includes('dark')) {
      return fallback(
        'local.theme.modes',
        `Theme "${name}" must supply both light and dark color schemes; using the default theme.`,
      );
    }
  } catch {
    return fallback(
      'local.theme.manifest',
      `The selected theme "${name}" could not be read; using the default theme.`,
    );
  }

  return { name, diagnostics: [] };
}
