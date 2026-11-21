import { compileLocalTracked, type LocalCompilerServices } from './compiler';
import { normalizeSourceRanges, type ParsedLocal } from '../parsing/parser-core';
import { MAX_LOCAL_DOCUMENT_LENGTH } from '../configuration/limits';
import type {
  Diagnostic,
  LocalCompileOptions,
  LocalCompileResult,
  LocalNode,
  SourceRange,
} from '../types';

/** Upper bound on stabilization passes for one streaming snapshot. */
export const LOCAL_STREAMING_MAX_ATTEMPTS = 6;

/**
 * Result of one streaming snapshot. `result` is either a renderable `partial`
 * document plus `transientDiagnostics`, or a deterministic `failed` result.
 * Final compilation never uses this structure.
 */
export interface LocalStreamingTrackedCompile {
  result: LocalCompileResult;
  parsed?: ParsedLocal;
  transientDiagnostics: readonly Diagnostic[];
  /** Source ranges rendered literally while stabilizing this snapshot. */
  literalRanges: readonly SourceRange[];
  attempts: number;
  timings: Record<string, number>;
}

/**
 * Deterministic failures stay fatal even while the source is still being
 * generated: option validation, resource budgets, syntax-version gates,
 * native-HTML policy, security, configuration and registry/capability errors.
 * Everything else (tags, attributes, interpolation, math, bindings,
 * expressions, types, structure, initial values, validation, tables, charts)
 * can be repaired by later source and is therefore transient.
 */
function isDefiniteDiagnostic(diagnostic: Diagnostic, source: string): boolean {
  if (typeof source !== 'string' || source.length > MAX_LOCAL_DOCUMENT_LENGTH) return true;
  // Warnings never make a compile fail; they are collected as transient.
  if (diagnostic.severity !== 'error') return false;
  const code = diagnostic.code;
  const family = (prefix: string): boolean => code === prefix || code.startsWith(`${prefix}.`);
  return family('local.options')
    || family('local.budget')
    || family('local.version')
    || family('local.html')
    || family('local.parse')
    || family('local.security')
    || family('local.config')
    || family('local.registry')
    || family('local.capability');
}

/**
 * Split one failed compile's diagnostics. `local.html` is the Markdown
 * converter's raw-HTML error; a mismatched or stray closing tag produces it
 * next to the structural diagnostic that covers the exact same fragment. Such
 * a pair describes one damaged region that later source can repair, so it is
 * provisional. An unpaired raw-HTML error stays definite.
 */
function partitionDiagnostics(
  diagnostics: readonly Diagnostic[],
  source: string,
): { definite: Diagnostic[]; transient: Diagnostic[] } {
  const transient = diagnostics.filter(diagnostic => !isDefiniteDiagnostic(diagnostic, source));
  const definite: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    if (!isDefiniteDiagnostic(diagnostic, source)) continue;
    const paired = diagnostic.code === 'local.html' && transient.some(item =>
      item.range.start === diagnostic.range.start && item.range.end === diagnostic.range.end);
    if (paired) {
      transient.push(diagnostic);
      continue;
    }
    definite.push(diagnostic);
  }
  return { definite, transient };
}

function diagnosticIdentity(diagnostic: Diagnostic): string {
  return `${diagnostic.code}:${diagnostic.range.start}:${diagnostic.range.end}`;
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return left.range.start - right.range.start
    || left.range.end - right.range.end
    || left.line - right.line
    || left.column - right.column
    || (left.code < right.code ? -1 : left.code > right.code ? 1 : 0);
}

/** Dedupe by code+ranges and publish in stable source order. */
function mergeDiagnostics(groups: readonly (readonly Diagnostic[])[]): Diagnostic[] {
  const seen = new Map<string, Diagnostic>();
  for (const group of groups) {
    for (const diagnostic of group) {
      const key = diagnosticIdentity(diagnostic);
      if (!seen.has(key)) seen.set(key, diagnostic);
    }
  }
  return [...seen.values()].sort(compareDiagnostics);
}

/**
 * Transient diagnostics never repeat entries the stabilized result already
 * reports itself; consumer code can rely on the two lists being disjoint.
 */
function diagnosticsForPartial(
  groups: readonly (readonly Diagnostic[])[],
  allDiagnostics: Diagnostic[],
): { diagnostics: Diagnostic[]; transientDiagnostics: Diagnostic[] } {
  const diagnostics = allDiagnostics.filter(diagnostic => diagnostic.code !== 'local.author.unclosed');
  const unfinished = allDiagnostics.filter(diagnostic => diagnostic.code === 'local.author.unclosed');
  const reported = new Set(diagnostics.map(diagnosticIdentity));
  return {
    diagnostics,
    transientDiagnostics: mergeDiagnostics([...groups, unfinished]).filter(diagnostic => !reported.has(diagnosticIdentity(diagnostic))),
  };
}

function sameRanges(left: readonly SourceRange[], right: readonly SourceRange[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index].start !== right[index].start || left[index].end !== right[index].end) return false;
  }
  return true;
}

function coversSource(ranges: readonly SourceRange[], length: number): boolean {
  return ranges.length === 1 && ranges[0].start === 0 && ranges[0].end === length;
}

/** The outermost parsed node whose range contains the whole diagnostic. */
function outermostNodeFor(
  nodes: readonly LocalNode[],
  start: number,
  end: number,
): LocalNode | undefined {
  for (const node of nodes) {
    if (node.range.start <= start && node.range.end >= end) return node;
  }
  return undefined;
}

/**
 * Literal span that removes one transient failure: its outermost node, else
 * the physical line around its start, else the remaining suffix.
 */
function literalRangeForDiagnostic(
  diagnostic: Diagnostic,
  source: string,
  nodes: readonly LocalNode[],
): SourceRange {
  const length = source.length;
  const start = Math.max(0, Math.min(length, diagnostic.range.start));
  const end = Math.max(start, Math.min(length, diagnostic.range.end));
  const node = outermostNodeFor(nodes, start, end);
  if (node) return { start: node.range.start, end: node.range.end };
  let lineStart = start;
  while (lineStart > 0 && source[lineStart - 1] !== '\n') lineStart -= 1;
  let lineEnd = start;
  while (lineEnd < length && source[lineEnd] !== '\n') lineEnd += 1;
  // Keep the line ending with its text so the fallback token covers the
  // boundary that confused the parser (an unterminated quote often ends there).
  if (lineEnd < length) lineEnd += 1;
  if (lineEnd > lineStart) return { start: lineStart, end: lineEnd };
  return { start, end: length };
}

function earliestStart(diagnostics: readonly Diagnostic[], length: number): number {
  let earliest = length;
  for (const diagnostic of diagnostics) {
    if (diagnostic.range.start < earliest) earliest = diagnostic.range.start;
  }
  return earliest;
}

/**
 * Next literal set after one failed attempt. Growth always happens: when the
 * per-diagnostic spans add nothing, everything from the earliest remaining
 * transient diagnostic to EOF becomes literal, and the final allowed pass also
 * widens to EOF so the last compile renders the unsettled tail as text.
 */
function extendLiteralRanges(
  current: readonly SourceRange[],
  diagnostics: readonly Diagnostic[],
  parsed: ParsedLocal | undefined,
  source: string,
  forceToEof: boolean,
): SourceRange[] {
  const ranges: SourceRange[] = [...current];
  for (const diagnostic of diagnostics) {
    ranges.push(literalRangeForDiagnostic(diagnostic, source, parsed?.nodes ?? []));
  }
  let next = normalizeSourceRanges(ranges, source.length);
  const earliest = earliestStart(diagnostics, source.length);
  if (forceToEof) {
    next = normalizeSourceRanges([...next, { start: earliest, end: source.length }], source.length);
  }
  if (sameRanges(next, current)) {
    next = normalizeSourceRanges([...current, { start: earliest, end: source.length }], source.length);
  }
  return next;
}

function addTimings(total: Record<string, number>, timings: Record<string, number>): void {
  for (const [name, value] of Object.entries(timings)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    total[name] = (total[name] ?? 0) + value;
  }
}

/**
 * Compile one source snapshot that is still being generated. Structural and
 * semantic damage that later source can repair is rendered literally and
 * reported through transient diagnostics; deterministic failures (options,
 * budgets, version/config/security) stay fatal. Final compilation remains the
 * existing `compileLocalTracked` path.
 */
export function compileLocalStreamingTracked(
  source: string,
  options?: LocalCompileOptions,
  services?: LocalCompilerServices,
): LocalStreamingTrackedCompile {
  let literalRanges: SourceRange[] = [];
  const collected: Diagnostic[][] = [];
  const timings: Record<string, number> = {};
  let tracked: ReturnType<typeof compileLocalTracked> | undefined;
  let attempts = 0;

  for (let attempt = 1; attempt <= LOCAL_STREAMING_MAX_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    tracked = compileLocalTracked(source, options, services, literalRanges);
    addTimings(timings, tracked.timings);
    const result = tracked.result;

    if (result.ok) {
      const partial = diagnosticsForPartial(collected, result.diagnostics);
      return {
        result: { ...result, status: 'partial', ...partial },
        ...(tracked.parsed ? { parsed: tracked.parsed } : {}),
        transientDiagnostics: partial.transientDiagnostics,
        literalRanges: [...literalRanges],
        attempts,
        timings,
      };
    }

    const { definite, transient } = partitionDiagnostics(result.diagnostics, source);
    if (definite.length > 0) {
      const mergedTransient = mergeDiagnostics([...collected, transient]);
      return {
        result: {
          ok: false,
          diagnostics: definite,
          ...(result.recoveries ? { recoveries: [...result.recoveries] } : {}),
          status: 'failed',
          transientDiagnostics: mergedTransient,
        },
        ...(tracked.parsed ? { parsed: tracked.parsed } : {}),
        transientDiagnostics: mergedTransient,
        literalRanges: [...literalRanges],
        attempts,
        timings,
      };
    }

    collected.push(transient);
    if (attempt === LOCAL_STREAMING_MAX_ATTEMPTS) break;
    const next = extendLiteralRanges(
      literalRanges,
      transient,
      tracked.parsed,
      source,
      attempt >= LOCAL_STREAMING_MAX_ATTEMPTS - 1,
    );
    if (sameRanges(next, literalRanges)) break;
    literalRanges = next;
    if (coversSource(literalRanges, source.length)) {
      // The whole snapshot is now literal; one more compile publishes it.
      continue;
    }
  }

  // Only transient damage remains after the budget of passes. Render the whole
  // snapshot literally rather than publish a failure with no diagnostics: a
  // literal-only source cannot raise structural or semantic errors, so any
  // remaining diagnostic is deterministic and stays visible.
  if (typeof source === 'string' && source.length <= MAX_LOCAL_DOCUMENT_LENGTH
    && !coversSource(literalRanges, source.length)) {
    const whole = [{ start: 0, end: source.length }];
    const fullLiteral = compileLocalTracked(source, options, services, whole);
    addTimings(timings, fullLiteral.timings);
    attempts += 1;
    if (fullLiteral.result.ok) {
      const partial = diagnosticsForPartial(collected, fullLiteral.result.diagnostics);
      return {
        result: { ...fullLiteral.result, status: 'partial', ...partial },
        ...(fullLiteral.parsed ? { parsed: fullLiteral.parsed } : {}),
        transientDiagnostics: partial.transientDiagnostics,
        literalRanges: whole,
        attempts,
        timings,
      };
    }
    const { definite, transient } = partitionDiagnostics(fullLiteral.result.diagnostics, source);
    const mergedTransient = mergeDiagnostics([...collected, transient]);
    if (definite.length > 0) {
      return {
        result: {
          ok: false,
          diagnostics: definite,
          ...(fullLiteral.result.recoveries ? { recoveries: [...fullLiteral.result.recoveries] } : {}),
          status: 'failed',
          transientDiagnostics: mergedTransient,
        },
        ...(fullLiteral.parsed ? { parsed: fullLiteral.parsed } : {}),
        transientDiagnostics: mergedTransient,
        literalRanges: whole,
        attempts,
        timings,
      };
    }
    literalRanges = whole;
  }

  const last = tracked;
  const mergedTransient = mergeDiagnostics(collected);
  const failureDiagnostics = last !== undefined && last.result.ok === false && last.result.diagnostics.length > 0
    ? [...last.result.diagnostics]
    : mergedTransient.length > 0
      ? mergedTransient
      : [{
          code: 'local.parse',
          message: 'The streaming snapshot could not be compiled.',
          severity: 'error' as const,
          range: { start: 0, end: 0 },
          line: 1,
          column: 1,
        }];
  return {
    result: {
      ok: false,
      diagnostics: failureDiagnostics,
      ...(last?.result.recoveries ? { recoveries: [...last.result.recoveries] } : {}),
      status: 'failed',
      transientDiagnostics: mergedTransient,
    },
    ...(last?.parsed ? { parsed: last.parsed } : {}),
    transientDiagnostics: mergedTransient,
    literalRanges: [...literalRanges],
    attempts,
    timings,
  };
}
