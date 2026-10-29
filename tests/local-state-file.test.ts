import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import {
  LOCAL_STATE_FORMAT,
  applyLocalState,
  createLocalStateFile,
  localSourceDigest,
  parseLocalState,
  resolveLocalState,
  serializeLocalState,
  type LocalStateFile,
} from '../src/local/state';
import { LOCAL_SYNTAX_VERSION } from '../src/local/version';
import type { LocalDocument, LocalNode, LocalValue } from '../src/local/types';

const SOURCE = [
  '<slider bind="count" label="Count" initial="2" min="0" max="10" step="1">',
  '<toggle bind="flag" label="Flag">',
  '<input bind="name" label="Name" max-length="20">',
  '<multi-select bind="tags" label="Tags">',
  '<option value="a">A</option>',
  '<option value="b">B</option>',
  '</multi-select>',
  '<range-slider label="Range" bind-start="start" bind-end="end" min="0" max="100" initial-start="10" initial-end="90">',
  '<counter label="Anonymous" initial="3">',
].join('\n');

const PUBLIC_KEYS = ['count', 'end', 'flag', 'name', 'start', 'tags'];

function compile(source: string): LocalDocument {
  const result = compileLocal(source);
  if (!result.ok) {
    throw new Error(result.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('\n'));
  }
  return result.document;
}

function all(nodes: LocalNode[]): LocalNode[] {
  return nodes.flatMap((node) => [node, ...all(node.children ?? [])]);
}

function find(document: LocalDocument, name: string, index = 0): LocalNode {
  const matches = all(document.nodes).filter((node) => node.type === 'component' && node.name === name);
  if (!matches[index]) throw new Error(`Missing component ${name} at index ${index}`);
  return matches[index];
}

function jsonClone(file: LocalStateFile): Record<string, unknown> {
  return JSON.parse(serializeLocalState(file)) as Record<string, unknown>;
}

describe('local state file round trip', () => {
  it('exports writable parameters from snapshots containing computed collections', () => {
    const document = compile([
      '<computed name="double" value="{{ count * 2 }}">',
      '<const name="values" value="{{ [1, 2, 3] }}">',
      '<counter bind="count" label="Count" initial="2">',
    ].join('\n'));
    const runtime = createLocalRuntime(document);
    try {
      expect(runtime.snapshot().state).toMatchObject({ double: 4, values: [1, 2, 3] });
      const file = createLocalStateFile(document, runtime.snapshot().state);
      expect(file.parameters).toEqual({ count: 2 });
      expect(resolveLocalState(document, file).ok).toBe(true);
    } finally {
      runtime.dispose();
    }
  });

  it.each([
    '<input bind="value" label="Name" required="true">',
    '<textarea bind="value" label="Notes" required="true">',
    '<date bind="value" label="Date" required="true">',
  ])('preserves an empty required author default: %s', (source) => {
    const document = compile(`${source}\n<counter bind="count" label="Count">`);
    const file = createLocalStateFile(document, { ...document.initialState, count: 2 });
    const resolved = resolveLocalState(document, file);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.state).toEqual({ count: 2, value: '' });

    const runtime = createLocalRuntime(document);
    try {
      expect(applyLocalState(runtime, file)).toEqual([]);
      expect(runtime.getParameters()).toEqual({ count: 2, value: '' });
      // Actual writes still enforce required validation.
      const value = find(document, source.startsWith('<date') ? 'date'
        : source.startsWith('<textarea') ? 'textarea' : 'input');
      const filled = source.startsWith('<date') ? '2026-10-24' : 'Ada';
      expect(runtime.set(value, filled)).toEqual([]);
      expect(applyLocalState(runtime, file).length).toBeGreaterThan(0);
      expect(runtime.get(value)).toBe(filled);
    } finally {
      runtime.dispose();
    }
  });

  it('exports public bindings only and round trips initial and mutated state', () => {
    const document = compile(SOURCE);
    const initialFile = createLocalStateFile(document, document.initialState);

    expect(initialFile.format).toBe(LOCAL_STATE_FORMAT);
    expect(initialFile.syntax).toBe(LOCAL_SYNTAX_VERSION);
    expect(initialFile.sourceDigest).toBe(localSourceDigest(SOURCE));
    expect(Object.keys(initialFile.parameters)).toEqual(PUBLIC_KEYS);
    expect(initialFile.parameters).toEqual({
      count: 2,
      end: 90,
      flag: false,
      name: '',
      start: 10,
      tags: [],
    });
    expect(Object.keys(initialFile.parameters).some((key) => key.startsWith('@'))).toBe(false);

    const initialParsed = parseLocalState(serializeLocalState(initialFile));
    expect(initialParsed.ok).toBe(true);
    if (!initialParsed.ok) return;
    expect(initialParsed.file).toEqual(initialFile);
    const initialResolved = resolveLocalState(document, initialParsed.file);
    expect(initialResolved.ok).toBe(true);
    if (!initialResolved.ok) return;
    expect(initialResolved.state).toEqual(initialFile.parameters);

    const runtime = createLocalRuntime(document);
    const slider = find(document, 'slider');
    const toggle = find(document, 'toggle');
    const input = find(document, 'input');
    const multiSelect = find(document, 'multi-select');
    const range = find(document, 'range-slider');
    const counter = find(document, 'counter');
    expect(runtime.set(slider, 7)).toEqual([]);
    expect(runtime.set(toggle, true)).toEqual([]);
    expect(runtime.set(input, 'Ada')).toEqual([]);
    expect(runtime.set(multiSelect, ['b', 'a'])).toEqual([]);
    expect(runtime.set(range, 20, 'start')).toEqual([]);
    expect(runtime.set(range, 80, 'end')).toEqual([]);
    expect(runtime.set(counter, 5)).toEqual([]);

    const file = createLocalStateFile(document, runtime.snapshot().state, {
      name: 'reactive-md-test',
      version: '1.0.0',
    });
    expect(file.generator).toEqual({ name: 'reactive-md-test', version: '1.0.0' });
    expect(Object.keys(file.parameters)).toEqual(PUBLIC_KEYS);
    expect(file.parameters).toEqual({
      count: 7,
      end: 80,
      flag: true,
      name: 'Ada',
      start: 20,
      tags: ['a', 'b'],
    });

    const serialized = serializeLocalState(file);
    const parsed = parseLocalState(serialized);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.file).toEqual(file);

    const resolved = resolveLocalState(document, serialized);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.state).toEqual(file.parameters);

    const fresh = createLocalRuntime(document);
    expect(applyLocalState(fresh, parsed.file)).toEqual([]);
    expect(fresh.get(find(document, 'slider'))).toBe(7);
    expect(fresh.get(find(document, 'toggle'))).toBe(true);
    expect(fresh.get(find(document, 'input'))).toBe('Ada');
    expect(fresh.get(find(document, 'multi-select'))).toEqual(['a', 'b']);
    expect(fresh.get(find(document, 'range-slider'), 'start')).toBe(20);
    expect(fresh.get(find(document, 'range-slider'), 'end')).toBe(80);
    expect(fresh.get(find(document, 'counter'))).toBe(3);
    fresh.dispose();
    runtime.dispose();
  });
});

describe('local state file validation', () => {
  it('rejects a wrong source digest, syntax and digest format', () => {
    const document = compile(SOURCE);
    const file = createLocalStateFile(document, document.initialState);
    const base = jsonClone(file);

    const wrongDigest = { ...base, sourceDigest: 'fnv1a32:00000000' };
    expect(parseLocalState(wrongDigest).ok).toBe(true);
    const resolvedWrongDigest = resolveLocalState(document, wrongDigest);
    expect(resolvedWrongDigest.ok).toBe(false);
    if (!resolvedWrongDigest.ok) {
      expect(resolvedWrongDigest.diagnostics.map((diagnostic) => diagnostic.code)).toContain('local.state.source');
    }

    const wrongSyntax = parseLocalState({ ...base, syntax: 'local-draft-1' });
    expect(wrongSyntax.ok).toBe(false);
    if (!wrongSyntax.ok) {
      expect(wrongSyntax.diagnostics.map((diagnostic) => diagnostic.code)).toContain('local.state.syntax');
    }

    const malformedDigest = parseLocalState({ ...base, sourceDigest: 'md5:1234' });
    expect(malformedDigest.ok).toBe(false);
    if (!malformedDigest.ok) {
      expect(malformedDigest.diagnostics.map((diagnostic) => diagnostic.code)).toContain('local.state.digest');
    }

    const wrongFormat = parseLocalState({ ...base, format: 'reactive-md-state/v2' });
    expect(wrongFormat.ok).toBe(false);
    if (!wrongFormat.ok) {
      expect(wrongFormat.diagnostics.map((diagnostic) => diagnostic.code)).toContain('local.state.format');
    }
  });

  it('rejects missing, unknown and internal parameter keys', () => {
    const document = compile(SOURCE);
    const file = createLocalStateFile(document, document.initialState);
    const base = jsonClone(file) as {
      parameters: Record<string, LocalValue>;
      [key: string]: unknown;
    };

    const missing = { ...base, parameters: { ...base.parameters } };
    delete missing.parameters.name;
    const missingResult = resolveLocalState(document, missing);
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) {
      expect(missingResult.diagnostics.some(
        (diagnostic) => diagnostic.code === 'local.state.parameter.missing'
          && diagnostic.message.includes('"name"'),
      )).toBe(true);
    }

    const unknown = { ...base, parameters: { ...base.parameters, extra: 1 } };
    const unknownResult = resolveLocalState(document, unknown);
    expect(unknownResult.ok).toBe(false);
    if (!unknownResult.ok) {
      expect(unknownResult.diagnostics.some(
        (diagnostic) => diagnostic.code === 'local.state.parameter.unknown'
          && diagnostic.message.includes('"extra"'),
      )).toBe(true);
    }

    const internal = parseLocalState({
      ...base,
      parameters: { ...base.parameters, '@node:start': 1 },
    });
    expect(internal.ok).toBe(false);
    if (!internal.ok) {
      expect(internal.diagnostics.map((diagnostic) => diagnostic.code)).toContain('local.state.parameter.internal');
    }
  });

  it('rejects missing, unknown and non-serializable values when creating a file', () => {
    const document = compile(SOURCE);
    const missing = { ...document.initialState };
    delete missing.count;
    expect(() => createLocalStateFile(document, missing)).toThrow(/count/);

    expect(() => createLocalStateFile(document, { ...document.initialState, extra: 1 })).toThrow(/extra/);
    expect(() => createLocalStateFile(document, { ...document.initialState, '@missing': 1 })).toThrow(/@missing/);
    expect(() => createLocalStateFile(document, {
      ...document.initialState,
      count: Number.NaN,
    })).toThrow(/count/);
    expect(() => createLocalStateFile(document, {
      ...document.initialState,
      tags: ['a', 1] as unknown as LocalValue,
    })).toThrow(/tags/);
  });

  it('rejects invalid constrained values without changing a live runtime', () => {
    const document = compile(SOURCE);
    const live = createLocalRuntime(document);
    const slider = find(document, 'slider');
    expect(live.set(slider, 6)).toEqual([]);
    const before = live.snapshot();

    const constrainedFile = createLocalStateFile(document, { ...before.state, count: 99 });
    const constrainedResolution = resolveLocalState(document, constrainedFile);
    expect(constrainedResolution.ok).toBe(false);
    if (!constrainedResolution.ok) {
      expect(constrainedResolution.diagnostics.some((diagnostic) => diagnostic.code === 'local.runtime.value')).toBe(true);
    }

    const constrainedDiagnostics = applyLocalState(live, constrainedFile);
    expect(constrainedDiagnostics.length).toBeGreaterThan(0);
    expect(constrainedDiagnostics.some((diagnostic) => diagnostic.message.includes('"count"'))).toBe(true);
    expect(live.snapshot()).toBe(before);
    expect(live.get(slider)).toBe(6);
    expect(live.snapshot().state.count).toBe(6);

    const range = find(document, 'range-slider');
    const reversedFile = createLocalStateFile(document, {
      ...before.state,
      start: 90,
      end: 20,
    });
    const reversedDiagnostics = applyLocalState(live, reversedFile);
    expect(reversedDiagnostics.length).toBeGreaterThan(0);
    expect(reversedDiagnostics.some((diagnostic) => /range start/i.test(diagnostic.message))).toBe(true);
    expect(live.snapshot()).toBe(before);
    expect(live.get(range, 'start')).toBe(10);
    expect(live.get(range, 'end')).toBe(90);
    live.dispose();
  });

  it('rejects prototype pollution, oversized payloads, malformed JSON and malformed UTF', () => {
    const polluted = [
      '{"format":"reactive-md-state/v1","syntax":"local-draft-3",',
      '"sourceDigest":"fnv1a32:00000000",',
      '"parameters":{"__proto__":{"polluted":true}}}',
    ].join('');
    const pollutedResult = parseLocalState(polluted);
    expect(pollutedResult.ok).toBe(false);
    if (!pollutedResult.ok) {
      expect(pollutedResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        'local.state.parameter.prototype',
      );
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    const nested = [
      '{"format":"reactive-md-state/v1","syntax":"local-draft-3",',
      '"sourceDigest":"fnv1a32:00000000",',
      '"parameters":{"constructor":{"prototype":{"polluted":true}}}}',
    ].join('');
    const nestedResult = parseLocalState(nested);
    expect(nestedResult.ok).toBe(false);
    if (!nestedResult.ok) {
      expect(nestedResult.diagnostics.some((diagnostic) => diagnostic.code === 'local.state.parameter.value')).toBe(true);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    const oversized = 'x'.repeat(1024 * 1024 + 1);
    const oversizedResult = parseLocalState(oversized);
    expect(oversizedResult.ok).toBe(false);
    if (!oversizedResult.ok) {
      expect(oversizedResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain('local.state.size');
    }

    const customLimit = parseLocalState('{"format":"reactive-md-state/v1"}', { maxLength: 8 });
    expect(customLimit.ok).toBe(false);
    if (!customLimit.ok) {
      expect(customLimit.diagnostics.map((diagnostic) => diagnostic.code)).toContain('local.state.size');
    }
    expect(() => parseLocalState('{}', { maxLength: 0 })).toThrow(RangeError);
    expect(() => parseLocalState('{}', { maxLength: 1.5 })).toThrow(RangeError);
    expect(() => parseLocalState('{}', { maxLength: Number.POSITIVE_INFINITY })).toThrow(RangeError);

    const malformedJson = parseLocalState('{');
    expect(malformedJson.ok).toBe(false);
    if (!malformedJson.ok) {
      expect(malformedJson.diagnostics.map((diagnostic) => diagnostic.code)).toContain('local.state.json');
    }

    const malformedUtf = parseLocalState('\ud800');
    expect(malformedUtf.ok).toBe(false);
    if (!malformedUtf.ok) {
      expect(malformedUtf.diagnostics.map((diagnostic) => diagnostic.code)).toContain('local.state.utf');
    }
  });
});

describe('local state deterministic output', () => {
  it('produces deterministic digests and canonical serialization without mutating callers', () => {
    const document = compile(SOURCE);
    const digest = localSourceDigest(SOURCE);
    expect(digest).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(localSourceDigest(SOURCE)).toBe(digest);
    expect(localSourceDigest(`${SOURCE}\n`)).not.toBe(digest);

    const tags = ['b', 'a'];
    const state: Record<string, LocalValue> = {
      count: 1,
      end: 80,
      flag: true,
      name: 'x',
      start: 20,
      tags,
    };
    const first = createLocalStateFile(document, state, { name: 'gen', version: '1' });
    const second = createLocalStateFile(document, state, { name: 'gen', version: '1' });
    expect(first.sourceDigest).toBe(digest);
    expect(serializeLocalState(first)).toBe(serializeLocalState(second));

    const serialized = serializeLocalState(first);
    expect(Object.isFrozen(tags)).toBe(false);
    expect(state.tags).toEqual(['b', 'a']);
    tags.push('c');
    expect(first.parameters.tags).toEqual(['b', 'a']);
    expect(serializeLocalState(first)).toBe(serialized);

    const reordered: LocalStateFile = {
      generator: { version: '1', name: 'gen' },
      parameters: {
        tags: ['b', 'a'],
        start: 20,
        name: 'x',
        flag: true,
        end: 80,
        count: 1,
      },
      sourceDigest: first.sourceDigest,
      syntax: LOCAL_SYNTAX_VERSION,
      format: LOCAL_STATE_FORMAT,
    };
    expect(serializeLocalState(reordered)).toBe(serialized);
    expect(serialized.indexOf('"format"')).toBeLessThan(serialized.indexOf('"parameters"'));
    expect(serialized.indexOf('"parameters"')).toBeLessThan(serialized.indexOf('"generator"'));
    expect(serialized).toContain(
      '"parameters":{"count":1,"end":80,"flag":true,"name":"x","start":20,"tags":["b","a"]}',
    );
  });
});

describe('local state application', () => {
  it('normalizes arrays and slot values and leaves anonymous controls untouched', () => {
    const document = compile(SOURCE);
    const live = createLocalRuntime(document);
    const counter = find(document, 'counter');
    expect(live.set(counter, 5)).toEqual([]);

    const state = {
      ...live.snapshot().state,
      tags: ['b', 'a'],
      start: 25,
      end: 75,
    };
    const file = createLocalStateFile(document, state);
    expect(file.parameters.tags).toEqual(['b', 'a']);

    const parsed = parseLocalState(serializeLocalState(file));
    if (!parsed.ok) throw new Error('Serialized state did not parse.');
    expect(applyLocalState(live, parsed.file)).toEqual([]);

    expect(live.get(find(document, 'multi-select'))).toEqual(['a', 'b']);
    const range = find(document, 'range-slider');
    expect(live.get(range, 'start')).toBe(25);
    expect(live.get(range, 'end')).toBe(75);
    expect(live.get(counter)).toBe(5);
    expect(live.snapshot().state.tags).toEqual(['a', 'b']);
    expect(live.snapshot().state.start).toBe(25);
    live.dispose();
  });

  it('checks a public slot against the live value of its anonymous counterpart', () => {
    const document = compile(
      '<range-slider label="Range" bind-start="low" min="0" max="100">',
    );
    const runtime = createLocalRuntime(document);
    const range = find(document, 'range-slider');
    expect(runtime.set(range, 20, 'end')).toEqual([]);
    const before = runtime.snapshot();

    // The initial end is 100, so resolving alone would accept low=50; the live
    // end is 20, so applying must reject it before touching any public state.
    const file = createLocalStateFile(document, { ...before.state, low: 50 });
    const diagnostics = applyLocalState(runtime, file);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((diagnostic) => /range start/i.test(diagnostic.message))).toBe(true);
    expect(runtime.snapshot()).toBe(before);
    expect(runtime.get(range, 'start')).toBe(0);
    expect(runtime.get(range, 'end')).toBe(20);
    runtime.dispose();
  });
});
