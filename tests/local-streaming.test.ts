import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compilation/compiler';
import { LocalParseSession } from '../src/local/parsing/parse-session';
import { parseLocal } from '../src/local/parsing/parser';
import {
  compileLocalStreamingTracked,
  LOCAL_STREAMING_MAX_ATTEMPTS,
  type LocalStreamingTrackedCompile,
} from '../src/local/compilation/streaming';
import { STREAMING_SOURCE_CASES, type StreamingSourceCase } from './fixtures/streaming-source';
import type { Diagnostic, LocalNode } from '../src/local/types';

/** Plain, structured-clone-safe form used for structural equality. */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

function flatten(nodes: readonly LocalNode[]): LocalNode[] {
  return nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);
}

function diagnosticKey(diagnostic: Diagnostic): string {
  return `${diagnostic.code}:${diagnostic.range.start}:${diagnostic.range.end}`;
}

/** Deterministic families that must stay fatal while the source streams. */
function isDefiniteCode(code: string): boolean {
  return ['local.options', 'local.budget', 'local.version', 'local.html',
    'local.security', 'local.config', 'local.registry', 'local.capability']
    .some(prefix => code === prefix || code.startsWith(`${prefix}.`));
}

function expectRangesWithinSource(
  outcome: LocalStreamingTrackedCompile,
  source: string,
): void {
  const nodes = outcome.result.ok ? flatten(outcome.result.document.nodes) : [];
  const parsed = outcome.parsed ? flatten(outcome.parsed.nodes) : [];
  for (const node of [...nodes, ...parsed]) {
    expect(node.range.start).toBeGreaterThanOrEqual(0);
    expect(node.range.end).toBeGreaterThanOrEqual(node.range.start);
    expect(node.range.end).toBeLessThanOrEqual(source.length);
  }
  for (const diagnostic of [...outcome.result.diagnostics, ...outcome.transientDiagnostics]) {
    expect(diagnostic.range.start).toBeGreaterThanOrEqual(0);
    expect(diagnostic.range.end).toBeGreaterThanOrEqual(diagnostic.range.start);
    expect(diagnostic.range.end).toBeLessThanOrEqual(source.length);
  }
}

function expectDisjointDiagnostics(outcome: LocalStreamingTrackedCompile): void {
  const finalKeys = new Set(outcome.result.diagnostics.map(diagnosticKey));
  for (const transient of outcome.transientDiagnostics) {
    expect(finalKeys.has(diagnosticKey(transient))).toBe(false);
  }
}

function streamingCases(filter: (sourceCase: StreamingSourceCase) => boolean): StreamingSourceCase[] {
  return STREAMING_SOURCE_CASES.filter(filter);
}

describe('streaming snapshot stabilization', () => {
  const cases = streamingCases(sourceCase => sourceCase.expected === 'partial');

  it.each(cases)('$name: every snapshot stays renderable', (sourceCase) => {
    const seenTransient = new Set<string>();
    for (const snapshot of sourceCase.snapshots) {
      const outcome = compileLocalStreamingTracked(snapshot, sourceCase.options);
      expect(outcome.attempts).toBeGreaterThanOrEqual(1);
      expect(outcome.attempts).toBeLessThanOrEqual(LOCAL_STREAMING_MAX_ATTEMPTS);

      expect(outcome.result.ok).toBe(true);
      expect(outcome.result.status).toBe('partial');
      if (!outcome.result.ok) throw new Error('expected a partial document');
      expect(Array.isArray(outcome.result.document.nodes)).toBe(true);

      // Fixable errors never leak into the final diagnostics list.
      expectDisjointDiagnostics(outcome);
      for (const transient of outcome.transientDiagnostics) seenTransient.add(transient.code);

      expectRangesWithinSource(outcome, snapshot);
    }
    for (const code of sourceCase.transientCodes ?? []) {
      expect(seenTransient.has(code)).toBe(true);
    }
  });
});

describe('streaming definite failures', () => {
  const cases = streamingCases(sourceCase => sourceCase.expected === 'failed');

  it.each(cases)('$name: deterministic errors stay fatal', (sourceCase) => {
    for (const snapshot of sourceCase.snapshots) {
      const outcome = compileLocalStreamingTracked(snapshot, sourceCase.options);
      expect(outcome.result.ok).toBe(false);
      expect(outcome.result.status).toBe('failed');
      expect(outcome.result.diagnostics.length).toBeGreaterThan(0);
      for (const diagnostic of outcome.result.diagnostics) {
        expect(diagnostic.severity).toBe('error');
        expect(isDefiniteCode(diagnostic.code)).toBe(true);
      }
      for (const code of sourceCase.finalCodes ?? []) {
        expect(outcome.result.diagnostics.map(diagnostic => diagnostic.code)).toContain(code);
      }
      // Provisional diagnostics are never presented as final ones.
      expectDisjointDiagnostics(outcome);
      expectRangesWithinSource(outcome, snapshot);
    }
  });

  it('keeps transient damage out of a deterministic failure', () => {
    // The formula budget is definite; the unknown binding is repairable later.
    const source = `{{ missing }}\n\n$$${'x'.repeat(50_001)}$$`;
    const outcome = compileLocalStreamingTracked(source);
    expect(outcome.result.ok).toBe(false);
    expect(outcome.result.status).toBe('failed');
    const finalCodes = outcome.result.diagnostics.map(diagnostic => diagnostic.code);
    expect(finalCodes).toContain('local.budget.math');
    expect(finalCodes).not.toContain('local.binding.unknown');
    expect(outcome.transientDiagnostics.map(diagnostic => diagnostic.code)).toContain('local.binding.unknown');
    expectDisjointDiagnostics(outcome);
    expectRangesWithinSource(outcome, source);
  });

  it('does not reclassify option errors as transient', () => {
    const outcome = compileLocalStreamingTracked('hello', { limits: { maxSyntaxNodes: 1 } });
    expect(outcome.result.ok).toBe(false);
    expect(outcome.result.status).toBe('failed');
    expect(outcome.result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['local.budget']);
    expect(outcome.transientDiagnostics).toEqual([]);
    expect(outcome.literalRanges).toEqual([]);
    expect(outcome.attempts).toBe(1);
  });
});

describe('completed source matches the final compiler', () => {
  const cases = streamingCases(sourceCase => sourceCase.expected === 'partial');

  it.each(cases)('$name: streaming the completed source equals compileLocal', (sourceCase) => {
    const streamed = compileLocalStreamingTracked(sourceCase.finalSource, sourceCase.options);
    const legacy = compileLocal(sourceCase.finalSource, sourceCase.options);

    expect(streamed.result.ok).toBe(true);
    expect(legacy.ok).toBe(true);
    expect(Object.hasOwn(legacy, 'status')).toBe(false);
    expect(streamed.result.status).toBe('partial');
    if (!streamed.result.ok || !legacy.ok) throw new Error('expected both compiles to succeed');

    expect(streamed.literalRanges).toEqual([]);
    expect(streamed.attempts).toBe(1);
    expect(streamed.transientDiagnostics).toEqual([]);
    expect(plain(streamed.result.document)).toEqual(plain(legacy.document));
    expect(streamed.result.diagnostics).toEqual(legacy.diagnostics);
    expect(streamed.result.recoveries).toEqual(legacy.recoveries);
  });
});

describe('legacy behavior stays untouched', () => {
  it('keeps the existing result shape when no phase is requested', () => {
    const result = compileLocal('hello');
    expect(result.ok).toBe(true);
    expect(Object.hasOwn(result, 'status')).toBe(false);
    expect(Object.hasOwn(result, 'transientDiagnostics')).toBe(false);
  });

  it('keeps loose-mode recovery records and warnings unchanged', () => {
    const source = '<card>\n正文\n\n## 后续\n\n后文 **粗体**';
    const loose = compileLocal(source, { strict: false });
    expect(loose.ok).toBe(true);
    if (!loose.ok) throw new Error('expected loose recovery to succeed');
    expect(loose.recoveries).toHaveLength(1);
    expect(loose.diagnostics).toContainEqual(expect.objectContaining({
      code: 'local.recovery.unclosed',
      severity: 'warning',
    }));

    const streamed = compileLocalStreamingTracked(source, { strict: false });
    expect(streamed.result.ok).toBe(true);
    if (!streamed.result.ok) throw new Error('expected a partial document');
    expect(streamed.literalRanges).toEqual([]);
    expect(streamed.result.recoveries).toEqual(loose.recoveries);
    expect(plain(streamed.result.document)).toEqual(plain(loose.document));

    // Strict mode is still strict: recovery never leaks into the default path.
    const strict = compileLocal(source);
    expect(strict.ok).toBe(false);
    expect(strict.diagnostics.map(diagnostic => diagnostic.code)).toContain('local.tag.unclosed');
    expect(strict.recoveries).toBeUndefined();
  });
});

describe('stabilized partial documents', () => {
  it('renders removed regions as fallback text with valid ranges', () => {
    const source = '<card title="Streamed">\n\nBody';
    const outcome = compileLocalStreamingTracked(source);
    expect(outcome.result.ok).toBe(true);
    expect(outcome.literalRanges.length).toBeGreaterThan(0);
    if (!outcome.result.ok) throw new Error('expected a partial document');
    const fallback = flatten(outcome.result.document.nodes).filter(node => node.type === 'fallback');
    expect(fallback.length).toBeGreaterThan(0);
    for (const node of fallback) {
      expect(node.range.start).toBeGreaterThanOrEqual(0);
      expect(node.range.end).toBeLessThanOrEqual(source.length);
      expect(node.value).toBe(source.slice(node.range.start, node.range.end));
    }
  });

  it('marks a not-yet-declared binding as transient instead of failing', () => {
    const source = 'Current total: {{ total }}';
    const outcome = compileLocalStreamingTracked(source);
    expect(outcome.result.ok).toBe(true);
    expect(outcome.result.status).toBe('partial');
    expect(outcome.transientDiagnostics.map(diagnostic => diagnostic.code)).toContain('local.binding.unknown');
    expect(outcome.result.diagnostics.map(diagnostic => diagnostic.code)).not.toContain('local.binding.unknown');
  });
});

describe('forced literal source ranges', () => {
  const literalSource = 'before <card title="x">after';

  it('renders an explicit literal range as fallback text', () => {
    const parsed = parseLocal(literalSource, undefined, undefined, undefined, undefined, [
      { start: 7, end: 21 },
    ]);
    const fallback = flatten(parsed.nodes).find(node => node.type === 'fallback');
    expect(fallback?.value).toBe(literalSource.slice(7, 21));
    expect(fallback?.range).toEqual({ start: 7, end: 21 });
    expect(parsed.diagnostics).toEqual([]);
  });

  it('clamps, drops empty spans and merges overlaps', () => {
    const parsed = parseLocal('abc', undefined, undefined, undefined, undefined, [
      { start: -4, end: 2 },
      { start: 1, end: 99 },
      { start: 2, end: 2 },
    ]);
    const fallbacks = flatten(parsed.nodes).filter(node => node.type === 'fallback');
    expect(fallbacks.map(node => node.range)).toEqual([{ start: 0, end: 3 }]);
    expect(fallbacks[0].value).toBe('abc');
  });

  it('bypasses session caches for callers that force literal spans', () => {
    const table = '|A|B|\n|-|-|\n|same|same|';
    const session = new LocalParseSession();
    session.parse(table);
    const entries = session.stats.entries;
    const parsed = session.parse(table, undefined, undefined, undefined, [{ start: 0, end: 3 }]);
    expect(flatten(parsed.nodes).some(node => node.type === 'fallback')).toBe(true);
    expect(session.stats.entries).toBe(entries);
    // Ordinary parses still reuse the untouched entries.
    expect(session.parse(table).work?.reusedBlocks ?? 0).toBeGreaterThan(0);
  });
});

describe('determinism', () => {
  it.each(STREAMING_SOURCE_CASES)('$name: identical snapshots repeat exactly', (sourceCase) => {
    for (const snapshot of sourceCase.snapshots) {
      const first = compileLocalStreamingTracked(snapshot, sourceCase.options);
      const second = compileLocalStreamingTracked(snapshot, sourceCase.options);
      expect(plain(second.result)).toEqual(plain(first.result));
      expect(second.transientDiagnostics).toEqual(first.transientDiagnostics);
      expect(second.literalRanges).toEqual(first.literalRanges);
      expect(second.attempts).toBe(first.attempts);
    }
  });
});

describe('streaming diagnostics stay within the snapshot', () => {
  it.each(STREAMING_SOURCE_CASES)('$name: all ranges belong to the source', (sourceCase) => {
    for (const snapshot of sourceCase.snapshots) {
      const outcome = compileLocalStreamingTracked(snapshot, sourceCase.options);
      expectRangesWithinSource(outcome, snapshot);
      for (const range of outcome.literalRanges) {
        expect(range.start).toBeGreaterThanOrEqual(0);
        expect(range.end).toBeGreaterThan(range.start);
        expect(range.end).toBeLessThanOrEqual(snapshot.length);
      }
    }
  });
});

