import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import {
  LOCAL_STATE_FORMAT,
  exportLocalState,
  importLocalState,
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
  '<multi-select bind="tags" label="Tags">',
  '<option value="a">A</option>',
  '<option value="b">B</option>',
  '<option value="c">C</option>',
  '</multi-select>',
  '<range-slider label="Range" bind-start="start" bind-end="end" min="0" max="100" initial-start="10" initial-end="90">',
  '<counter label="Anonymous" initial="3">',
].join('\n');

const PUBLIC_KEYS = ['count', 'end', 'flag', 'start', 'tags'];

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

interface StateJson {
  parameters: Record<string, LocalValue>;
  [key: string]: unknown;
}

function jsonClone(file: LocalStateFile): StateJson {
  return JSON.parse(serializeLocalState(file)) as StateJson;
}

function without(parameters: Record<string, LocalValue>, key: string): Record<string, LocalValue> {
  const clone = { ...parameters };
  delete clone[key];
  return clone;
}

describe('runtime state export', () => {
  it('captures public parameters only with format metadata and generator', () => {
    const document = compile(SOURCE);
    const runtime = createLocalRuntime(document);
    const counter = find(document, 'counter');
    expect(runtime.set(counter, 9)).toEqual([]);

    const file = exportLocalState(runtime, { name: 'reactive-md-test', version: '1.0.0' });

    expect(file.format).toBe(LOCAL_STATE_FORMAT);
    expect(file.syntax).toBe(LOCAL_SYNTAX_VERSION);
    expect(file.sourceDigest).toBe(localSourceDigest(SOURCE));
    expect(file.generator).toEqual({ name: 'reactive-md-test', version: '1.0.0' });
    expect(Object.keys(file.parameters)).toEqual(PUBLIC_KEYS);
    expect(file.parameters).toEqual({
      count: 2,
      end: 90,
      flag: false,
      start: 10,
      tags: [],
    });

    const internalKey = Object.keys(document.bindings).find((key) => key.startsWith('@'));
    if (!internalKey) throw new Error('Expected the document to contain an internal binding.');
    expect(runtime.snapshot().state[internalKey]).toBe(9);
    expect(Object.keys(file.parameters).some((key) => key.startsWith('@'))).toBe(false);
    expect(serializeLocalState(file)).not.toContain(internalKey);
    expect(exportLocalState(runtime).generator).toBeUndefined();

    runtime.dispose();
    expect(() => exportLocalState(runtime)).toThrow(/disposed/i);
  });

  it('round trips mutated values through strings and parsed objects', () => {
    const document = compile(SOURCE);
    const live = createLocalRuntime(document);
    const slider = find(document, 'slider');
    const toggle = find(document, 'toggle');
    const multiSelect = find(document, 'multi-select');
    const range = find(document, 'range-slider');
    const counter = find(document, 'counter');

    expect(live.set(slider, 7)).toEqual([]);
    expect(live.set(toggle, true)).toEqual([]);
    expect(live.set(multiSelect, ['c', 'a'])).toEqual([]);
    expect(live.set(range, 20, 'start')).toEqual([]);
    expect(live.set(range, 80, 'end')).toEqual([]);
    expect(live.set(counter, 5)).toEqual([]);

    const file = exportLocalState(live);
    expect(file.parameters).toEqual({
      count: 7,
      end: 80,
      flag: true,
      start: 20,
      tags: ['a', 'c'],
    });

    const serialized = serializeLocalState(file);
    const parsed = parseLocalState(serialized);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const fromString = createLocalRuntime(document);
    const fromObject = createLocalRuntime(document);
    expect(importLocalState(fromString, serialized)).toEqual([]);
    expect(importLocalState(fromObject, parsed.file)).toEqual([]);

    for (const runtime of [fromString, fromObject]) {
      expect(runtime.get(slider)).toBe(7);
      expect(runtime.get(toggle)).toBe(true);
      expect(runtime.get(multiSelect)).toEqual(['a', 'c']);
      expect(runtime.get(range, 'start')).toBe(20);
      expect(runtime.get(range, 'end')).toBe(80);
      // Anonymous controls are not part of the state file and keep their initial value.
      expect(runtime.get(counter)).toBe(3);
      expect(runtime.snapshot().state).toMatchObject({
        count: 7,
        end: 80,
        flag: true,
        start: 20,
        tags: ['a', 'c'],
      });
      runtime.dispose();
    }
    live.dispose();
  });

  it('resolves the exported file against the document', () => {
    const document = compile(SOURCE);
    const runtime = createLocalRuntime(document);
    expect(runtime.set(find(document, 'slider'), 4)).toEqual([]);

    const file = exportLocalState(runtime);
    const resolution = resolveLocalState(document, serializeLocalState(file));
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;

    expect(resolution.state).toEqual(file.parameters);
    expect(resolution.state).toEqual({
      count: 4,
      end: 90,
      flag: false,
      start: 10,
      tags: [],
    });
    runtime.dispose();
  });
});

describe('runtime state import', () => {
  it('leaves the runtime untouched when import fails', () => {
    const document = compile(SOURCE);
    const runtime = createLocalRuntime(document);
    const slider = find(document, 'slider');
    expect(runtime.set(slider, 6)).toEqual([]);

    const base = jsonClone(exportLocalState(runtime));
    const before = runtime.snapshot();
    const cases: { input: string | unknown; code: string }[] = [
      { input: '{', code: 'local.state.json' },
      { input: { ...base, sourceDigest: 'fnv1a32:00000000' }, code: 'local.state.source' },
      { input: { ...base, parameters: { ...base.parameters, extra: 1 } }, code: 'local.state.parameter.unknown' },
      { input: { ...base, parameters: without(base.parameters, 'flag') }, code: 'local.state.parameter.missing' },
      { input: { ...base, parameters: { ...base.parameters, count: 99 } }, code: 'local.runtime.value' },
    ];

    for (const testCase of cases) {
      const diagnostics = importLocalState(runtime, testCase.input);
      expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(testCase.code);
      expect(runtime.snapshot()).toBe(before);
      expect(runtime.snapshot().revision).toBe(before.revision);
      expect(runtime.get(slider)).toBe(6);
    }
    runtime.dispose();
  });

  it('honors maxLength and still throws for invalid limits', () => {
    const document = compile(SOURCE);
    const runtime = createLocalRuntime(document);
    const file = exportLocalState(runtime);
    const serialized = serializeLocalState(file);
    const before = runtime.snapshot();

    const tooSmall = importLocalState(runtime, serialized, { maxLength: 16 });
    expect(tooSmall.map((diagnostic) => diagnostic.code)).toContain('local.state.size');

    const parsed = parseLocalState(serialized);
    if (!parsed.ok) throw new Error('Exported state did not parse.');
    const tooSmallObject = importLocalState(runtime, parsed.file, { maxLength: 16 });
    expect(tooSmallObject.map((diagnostic) => diagnostic.code)).toContain('local.state.size');

    expect(runtime.snapshot()).toBe(before);
    expect(() => importLocalState(runtime, serialized, { maxLength: 0 })).toThrow(RangeError);
    expect(() => importLocalState(runtime, serialized, { maxLength: 1.5 })).toThrow(RangeError);
    expect(() => importLocalState(runtime, serialized, { maxLength: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    runtime.dispose();
  });
});
