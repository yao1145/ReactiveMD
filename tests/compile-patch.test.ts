import { describe, expect, it } from 'vitest';
import {
  applyLocalResultPatch,
  applySourceEdit,
  cloneLocalCompileResult,
  diffSourceEdit,
  encodeLocalResultPatch,
  LOCAL_RESULT_PATCH_PROTOCOL,
  type LocalResultPatch,
} from '../src/local/compile-patch';
import type { LocalCompileResult, LocalDocument, LocalNode } from '../src/local/types';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function makeNode(id: string, start: number, value: string): LocalNode {
  const end = start + value.length;
  return {
    type: 'paragraph',
    id,
    range: { start, end },
    children: [{ type: 'text', id: `${id}-text`, range: { start, end }, value }],
  };
}

function shiftNode(node: LocalNode, delta: number): LocalNode {
  return {
    ...node,
    range: { start: node.range.start + delta, end: node.range.end + delta },
    ...(node.children ? { children: node.children.map((child) => shiftNode(child, delta)) } : {}),
  };
}

type OkResult = Extract<LocalCompileResult, { ok: true }>;

function makeResult(
  source: string,
  nodes: LocalNode[],
  extra: Partial<LocalDocument> = {},
): OkResult {
  return {
    ok: true,
    document: {
      syntax: 'local',
      source,
      nodes,
      initialState: {},
      bindings: {},
      ...extra,
    } as LocalDocument,
    diagnostics: [],
  };
}

function byteLength(value: unknown): number {
  return JSON.stringify(value).length;
}

function applyOrThrow(
  base: LocalCompileResult,
  patch: LocalResultPatch,
): Extract<LocalCompileResult, { ok: true }> {
  const applied = applyLocalResultPatch(base, patch);
  expect(applied).not.toBeNull();
  if (applied === null || !applied.ok) throw new Error('expected an applied ok result');
  return applied;
}

describe('source edit transport', () => {
  it('encodes and reapplies a UTF-16 replacement', () => {
    const before = 'alpha 😀 beta';
    const after = 'alpha 😀 gamma beta';
    const edit = diffSourceEdit(before, after);
    expect(edit).not.toBeNull();
    expect(applySourceEdit(before, edit!)).toBe(after);
  });

  it('returns null for identical sources', () => {
    expect(diffSourceEdit('same', 'same')).toBeNull();
  });

  it('rejects edits that do not fit the source', () => {
    expect(applySourceEdit('short', { from: 0, to: 10, insert: 'x' })).toBeNull();
    expect(applySourceEdit('short', { from: 3, to: 1, insert: 'x' })).toBeNull();
    expect(applySourceEdit('short', { from: -1, to: 1, insert: 'x' })).toBeNull();
    expect(applySourceEdit('short', { from: 0, to: 0, insert: 3 as unknown as string })).toBeNull();
  });
});

describe('result patches', () => {
  it('sends only changed nodes and reuses untouched baseline objects', () => {
    const texts = Array.from({ length: 120 }, (_, index) => `paragraph ${index}`);
    const source = texts.join('\n\n');
    let offset = 0;
    const nodes = texts.map((text, index) => {
      const node = makeNode(`block-${index}`, offset, text);
      offset += text.length + 2;
      return node;
    });
    const base = deepFreeze(makeResult(source, nodes));

    const changedText = 'changed paragraph';
    const nextSource = source.replace(texts[60], changedText);
    const nextNodes = base.document.nodes.map((node) => (
      node.id === 'block-60' ? makeNode('block-60', node.range.start, changedText) : node
    ));
    const next = makeResult(nextSource, nextNodes);

    const patch = encodeLocalResultPatch(base, next);
    expect(patch).not.toBeNull();
    expect(patch!.protocol).toBe(LOCAL_RESULT_PATCH_PROTOCOL);
    // A patch must be a real diff, not the complete document in disguise.
    expect(byteLength(patch)).toBeLessThan(byteLength(next) / 5);

    const applied = applyOrThrow(base, patch!);
    expect(applied).toEqual(next);
    expect(applied.document.nodes[10]).toBe(base.document.nodes[10]);
    expect(applied.document.nodes[60]).not.toBe(base.document.nodes[60]);
    // The frozen baseline is untouched by encoding or applying.
    expect(base.document.nodes[60].children?.[0].value).toBe(texts[60]);
  });

  it('encodes a uniform range shift without resending subtrees', () => {
    const texts = Array.from({ length: 30 }, (_, index) => `block ${index}`);
    const source = texts.join('\n\n');
    let offset = 0;
    const nodes = texts.map((text, index) => {
      const node = makeNode(`block-${index}`, offset, text);
      offset += text.length + 2;
      return node;
    });
    const base = makeResult(source, nodes);
    const next = makeResult(`XX${source}`, nodes.map((node) => shiftNode(node, 2)));

    const patch = encodeLocalResultPatch(base, next);
    expect(patch).not.toBeNull();
    expect(patch!.document.source).toEqual({ from: 0, to: 0, insert: 'XX' });
    expect(patch!.document.nodes).toHaveLength(30);
    expect(patch!.document.nodes?.every((entry) => entry.subtree === true && entry.shift === 2)).toBe(true);
    expect(byteLength(patch)).toBeLessThan(byteLength(next) / 2);

    const applied = applyOrThrow(base, patch!);
    expect(applied).toEqual(next);
    expect(applied.document.nodes[0]).not.toBe(base.document.nodes[0]);
  });

  it('differs record metadata and keeps unchanged entries shared', () => {
    const base = makeResult('x', [makeNode('a', 0, 'x')], {
      initialState: { first: 'one', keep: 'same' },
      bindings: {
        keep: { name: 'keep', nodeIds: ['a'], type: 'string', initial: 'same' },
      },
    });
    const next = makeResult('x', [makeNode('a', 0, 'x')], {
      initialState: { first: 'two', keep: 'same' },
      bindings: {
        keep: { name: 'keep', nodeIds: ['a'], type: 'string', initial: 'same' },
      },
    });

    const patch = encodeLocalResultPatch(base, next);
    expect(patch).not.toBeNull();
    expect(patch!.document.records?.initialState).toEqual({ set: { first: 'two' } });
    expect(patch!.document.records?.bindings).toBeUndefined();
    expect(patch!.document.nodes).toBeUndefined();

    const applied = applyOrThrow(base, patch!);
    expect(applied).toEqual(next);
    expect(applied.document.bindings).toBe(base.document.bindings);
    expect((applied.document.initialState as Record<string, unknown>).keep).toBe('same');
  });

  it('applies a descendant change through unchanged ancestor ids', () => {
    const base = makeResult('outer', [
      {
        type: 'section',
        id: 'section',
        range: { start: 0, end: 5 },
        children: [makeNode('inner', 0, 'outer')],
      },
    ]);
    const next = makeResult('outer!', [
      {
        type: 'section',
        id: 'section',
        range: { start: 0, end: 6 },
        children: [makeNode('inner', 0, 'outer!')],
      },
    ]);
    const patch = encodeLocalResultPatch(base, next);
    expect(patch).not.toBeNull();
    const applied = applyOrThrow(base, patch!);
    expect(applied).toEqual(next);
    expect((applied.document.nodes[0].children?.[0].children?.[0] as LocalNode).value).toBe('outer!');
  });

  it('never mutates the baseline when applying malformed or stale patches', () => {
    const base = deepFreeze(makeResult('one', [makeNode('a', 0, 'one')]));
    const serialized = JSON.stringify(base);

    expect(applyLocalResultPatch(base, null as unknown as LocalResultPatch)).toBeNull();
    expect(applyLocalResultPatch(base, {
      kind: 'result-patch',
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      document: { roots: ['missing'] },
    })).toBeNull();
    expect(applyLocalResultPatch(base, {
      kind: 'result-patch',
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      document: {
        nodes: [{ id: 'a', data: { type: 'paragraph', id: 'other', range: { start: 0, end: 1 } } }],
        roots: ['a'],
      },
    })).toBeNull();
    expect(applyLocalResultPatch(base, {
      kind: 'result-patch',
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      document: { source: { from: 0, to: 99, insert: 'x' } },
    })).toBeNull();
    expect(JSON.stringify(base)).toBe(serialized);
  });

  it('clones incoming patch data so later message mutation cannot reach the result', () => {
    const base = makeResult('one', [makeNode('a', 0, 'one')]);
    const next = makeResult('two', [makeNode('a', 0, 'two')]);
    const patch = encodeLocalResultPatch(base, next)!;
    const applied = applyOrThrow(base, patch);
    const record = patch.document.nodes?.find((entry) => entry.data !== undefined);
    expect(record).toBeDefined();
    (record!.data as unknown as { range: { start: number } }).range.start = 999;
    expect(applied.document.nodes[0].range.start).toBe(0);
  });

  it('clones results independently of frozen internal values', () => {
    const source = deepFreeze(makeResult('x', [makeNode('a', 0, 'x')]));
    const copy = cloneLocalCompileResult(source);
    expect(copy).toEqual(source);
    expect(copy).not.toBe(source);
    expect(copy.ok).toBe(true);
    expect(source.ok).toBe(true);
    if (!copy.ok || !source.ok) return;
    expect(copy.document.nodes[0]).not.toBe(source.document.nodes[0]);
    expect(Object.isFrozen(copy)).toBe(false);
    copy.document.source = 'mutated';
    expect(source.document.source).toBe('x');
  });
});
