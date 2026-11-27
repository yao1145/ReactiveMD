import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as sessionEntry from '../src/compiler/session';
import * as scanEntry from '../src/scan/index';
import type { LocalIncrementalStats } from '../src/compiler/session';
import type { AuthorAnalysis, AuthorBinding, AuthorToken } from '../src/scan/index';
import {
  LocalCompileSession as ImplementationSession,
  createLocalCompileSession as implementationFactory,
} from '../src/local/compilation/session/incremental';
import { localCompileOptionsKey as implementationKey } from '../src/assemblies/default-options';
import { localCompileCacheKey } from '../src/local';
import { analyzeLocalSource as implementationAnalyze } from '../src/local/source/authoring';

const REUSABLE_SOURCE = [
  '<number bind="count" label="Count" initial="1">',
  '',
  'Total: {{ count }}',
  '',
  'A second paragraph keeps the block index reusable.',
].join('\n');

describe('narrow compile session entry', () => {
  it('re-exports the existing session implementation only', () => {
    expect(Object.keys(sessionEntry).sort()).toEqual([
      'LocalCompileSession',
      'createLocalCompileSession',
      'localCompileCacheKey',
      'localCompileOptionsKey',
    ]);
    expect(sessionEntry.createLocalCompileSession).toBe(implementationFactory);
    expect(sessionEntry.LocalCompileSession).toBe(ImplementationSession);
    expect(sessionEntry.localCompileOptionsKey).toBe(implementationKey);
  });

  it('compiles, reuses and disposes one session per document', () => {
    const session = sessionEntry.createLocalCompileSession();
    expect(session).toBeInstanceOf(ImplementationSession);
    try {
      const first = session.compile(REUSABLE_SOURCE, undefined, 'final');
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.status).toBe('valid');
      expect(first.document.bindings.count).toMatchObject({ initial: 1 });
      const firstStats: LocalIncrementalStats = session.stats;
      expect(firstStats.mode).toBe('full');

      const repeated = session.compile(REUSABLE_SOURCE, undefined, 'final');
      expect(repeated.ok).toBe(true);
      const repeatedStats: LocalIncrementalStats = session.stats;
      expect(repeatedStats.mode).toBe('cached');
      expect(repeatedStats.reusedBlocks).toBe(firstStats.totalBlocks);

      const edited = session.compile(`${REUSABLE_SOURCE}\n\nAnother clause.`, undefined, 'final');
      expect(edited.ok).toBe(true);
      expect(edited.status).toBe('valid');
    } finally {
      session.dispose();
    }
    expect(() => session.compile(REUSABLE_SOURCE)).toThrow(/disposed/);
  });

  it('exposes the canonical compile option identity', () => {
    expect(sessionEntry.localCompileOptionsKey({ strict: false })).toBe(implementationKey({ strict: false }));
    expect(sessionEntry.localCompileOptionsKey({ strict: false })).not.toBe(sessionEntry.localCompileOptionsKey());
  });

  it('keys the exact source, effective phase, compiler entry, policy and host schemas', () => {
    const source = '<host-widget kind="a" ref="b" />';
    const options = { hostComponents: [{ name: 'host-widget', form: 'leaf',
      props: { kind: { kind: 'string' }, ref: { kind: 'string' } } }] } as const;
    const key = localCompileCacheKey(source, options);
    const finalKey = localCompileCacheKey(source, options, { sourcePhase: 'final' });
    expect(sessionEntry.localCompileCacheKey(source, structuredClone(options))).toBe(key);
    expect(localCompileCacheKey(source, { ...options, sourcePhase: 'streaming' }, { sourcePhase: 'final' })).toBe(finalKey);
    expect(new Set([
      key,
      finalKey,
      localCompileCacheKey(source + '\n', options),
      localCompileCacheKey(source, { ...options, enableCss: false }),
      localCompileCacheKey(source, { ...options, sourcePhase: 'streaming' }),
      localCompileCacheKey(source, options, { entry: 'local' }),
      localCompileCacheKey(source, options, { entry: 'minimal' }),
      localCompileCacheKey(source, options, { policyVersion: '2' }),
      localCompileCacheKey(source),
    ]).size).toBe(9);
    expect(localCompileCacheKey('\ud800')).not.toBe(localCompileCacheKey('\ufffd'));
  });
});

describe('narrow scan entry', () => {
  it('exposes only the read-only analysis API', () => {
    expect(Object.keys(scanEntry)).toEqual(['analyzeLocalSource']);
    expect(scanEntry.analyzeLocalSource).toBe(implementationAnalyze);
    for (const name of [
      'completeLocalSource',
      'renameLocalBinding',
      'formatLocalSource',
      'insertTemplate',
      'insertLocalComponent',
      'createLocalComponentCatalog',
      'getNativeComponentCatalog',
    ]) {
      expect(name in scanEntry).toBe(false);
    }
  });

  it('reports tags, attributes, interpolations, bindings and UTF-16 ranges', () => {
    const source = '<number bind="count" label="Count" initial="1">\n\nTotal: {{ count }}';
    const analysis: AuthorAnalysis = scanEntry.analyzeLocalSource(source);
    expect(analysis.tokens.some((token) => token.kind === 'tag' && token.range.start === 1)).toBe(true);
    expect(analysis.tokens.some((token) => token.kind === 'attribute')).toBe(true);
    const expression: AuthorToken | undefined = analysis.tokens.find((token) => token.kind === 'expression');
    expect(expression).toBeDefined();
    if (expression) expect(expression.range).toEqual({ start: source.indexOf('{{ count }}'), end: source.length });
    const binding: AuthorBinding | undefined = analysis.bindings.find((item) => item.name === 'count');
    expect(binding).toBeDefined();
    if (binding) {
      expect(source.slice(binding.declarations[0].start, binding.declarations[0].end)).toBe('count');
      expect(source.slice(binding.references[0].start, binding.references[0].end)).toBe('count');
    }
    expect(analysis.diagnostics).toEqual([]);
  });

  it('keeps UTF-16 offsets in the presence of astral characters', () => {
    const source = '# 😀\n\n<number bind="count" label="Count">\n\n{{ count }}';
    const analysis = scanEntry.analyzeLocalSource(source);
    const expression = analysis.tokens.find((token) => token.kind === 'expression');
    expect(expression?.range.start).toBe(source.indexOf('{{ count }}'));
  });

  it('returns compiler diagnostics unless the host opts out', () => {
    const failing = scanEntry.analyzeLocalSource('<number bind="count">');
    expect(failing.diagnostics.some((diagnostic) => diagnostic.code === 'local.label.required')).toBe(true);
    const quiet = scanEntry.analyzeLocalSource('<number bind="count">', undefined, { diagnostics: false });
    expect(quiet.diagnostics).toEqual([]);
  });
});

describe('narrow entry source boundaries', () => {
  it('imports implementation modules without the root or authoring entries', () => {
    for (const path of ['../src/compiler/session.ts', '../src/scan/index.ts']) {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      expect(source).not.toMatch(/from\s+['"]reactive-md/);
      expect(source).not.toMatch(/from\s+['"][^'"]*authoring\/index/);
      expect(source).not.toMatch(/from\s+['"][^'"]*\/compiler\/(?:index|standard)/);
      expect(source).not.toMatch(/from\s+['"][^'"]*\/index['"]/);
    }
  });

  it('keeps the chat-session example on the two narrow entries', () => {
    const source = readFileSync(
      new URL('../examples/integration/chat-session/index.mjs', import.meta.url),
      'utf8',
    );
    const specifiers = [...source.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((match) => match[1]);
    expect(specifiers.sort()).toEqual(['reactive-md/compiler/session', 'reactive-md/scan']);
  });
});
