import { describe, expect, it, vi } from 'vitest';
import {
  applyLocalResultPatch,
  applySourceEdit,
  cloneLocalCompileResult,
  diffSourceEdit,
  encodeLocalResultPatch,
  encodeLocalResultPatchWithCost,
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

it('measures escaped Unicode payloads as JSON UTF-8 bytes without serializing them', () => {
  const base = makeResult('before', [makeNode('old', 0, 'before')]);
  const source = ('中文🙂\\"\n\t\u0000\ud800').repeat(500);
  const next = makeResult(source, [makeNode('new', 0, source)]);
  const encoded = encodeLocalResultPatchWithCost(base, next)!;
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
  expect(encoded.cost.patchBytes).toBe(bytes(encoded.patch));
  expect(encoded.cost.fullBytes).toBe(bytes(next));
  expect(applyLocalResultPatch(base, encoded.patch)).toEqual(next);
});

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

describe('result patch cost', () => {
  it('keeps a small patch and skips measuring the complete result', () => {
    const texts = Array.from({ length: 120 }, (_, index) => `paragraph ${index}`);
    const source = texts.join('\n\n');
    let offset = 0;
    const nodes = texts.map((text, index) => {
      const node = makeNode(`block-${index}`, offset, text);
      offset += text.length + 2;
      return node;
    });
    const base = deepFreeze(makeResult(source, nodes));
    const nextNodes = base.document.nodes.map((node) => (
      node.id === 'block-60' ? makeNode('block-60', node.range.start, 'changed paragraph') : node
    ));
    const next = makeResult(source.replace(texts[60], 'changed paragraph'), nextNodes);

    const spy = vi.spyOn(JSON, 'stringify');
    let encoding: ReturnType<typeof encodeLocalResultPatchWithCost> = null;
    try {
      encoding = encodeLocalResultPatchWithCost(base, next);
      expect(spy.mock.calls.some((call) => call[0] === next || call[0] === next.document)).toBe(false);
    } finally {
      spy.mockRestore();
    }

    expect(encoding).not.toBeNull();
    const cost = encoding!.cost;
    expect(cost.preferFull).toBe(false);
    expect(cost.reason).toBeUndefined();
    // The patch alone is smaller than the source the complete result must
    // carry, so the whole-document path is never measured.
    expect(cost.patchBytes).toBeLessThanOrEqual(next.document.source.length);
    expect(cost.fullBytes).toBeUndefined();
    expect(cost.fullNodes).toBeUndefined();
    expect(cost.patchNodes).toBe(2);
    expect(encoding!.patch).toEqual(encodeLocalResultPatch(base, next));
    expect(applyOrThrow(base, encoding!.patch)).toEqual(next);
  });

  it('prefers the complete result for a wholesale rewrite without serializing it', () => {
    const baseTexts = Array.from({ length: 80 }, (_, index) => `alpha paragraph ${index} with a deliberately long value`);
    const baseSource = baseTexts.join('\n\n');
    let baseOffset = 0;
    const baseNodes = baseTexts.map((text, index) => {
      const node = makeNode(`alpha-${index}`, baseOffset, text);
      baseOffset += text.length + 2;
      return node;
    });
    const base = deepFreeze(makeResult(baseSource, baseNodes));

    const nextTexts = Array.from({ length: 80 }, (_, index) => `omega paragraph ${index} with a deliberately long value`);
    const nextSource = nextTexts.join('\n\n');
    let nextOffset = 0;
    const nextNodes = nextTexts.map((text, index) => {
      const node = makeNode(`omega-${index}`, nextOffset, text);
      nextOffset += text.length + 2;
      return node;
    });
    const next = makeResult(nextSource, nextNodes);

    const spy = vi.spyOn(JSON, 'stringify');
    let encoding: ReturnType<typeof encodeLocalResultPatchWithCost> = null;
    try {
      encoding = encodeLocalResultPatchWithCost(base, next);
      expect(spy.mock.calls.some((call) => call[0] === next || call[0] === next.document)).toBe(false);
      // Neither may the baseline be serialized to estimate the comparison.
      expect(spy.mock.calls.some((call) => call[0] === base || call[0] === base.document)).toBe(false);
    } finally {
      spy.mockRestore();
    }

    expect(encoding).not.toBeNull();
    const cost = encoding!.cost;
    expect(cost.preferFull).toBe(true);
    expect(cost.reason).toBe('bytes');
    expect(cost.fullBytes).toBeTypeOf('number');
    // Every node is new, so the patch carries both the inserted source and the
    // complete node forest: it is at least as large as the complete result.
    expect(cost.patchBytes).toBeGreaterThanOrEqual(cost.fullBytes!);
    expect(cost.patchNodes).toBe(80);
    expect(cost.fullNodes).toBe(160);
    // The patch contract is untouched: it is still valid and applies exactly.
    const applied = applyOrThrow(base, encoding!.patch);
    expect(applied).toEqual(next);
    expect(encodeLocalResultPatch(base, next)).toEqual(encoding!.patch);
    expect(base.document.source).toBe(baseSource);
  });

  it('reports a node-dominated patch even when its bytes are smaller', () => {
    const baseTexts = Array.from({ length: 40 }, (_, index) => `block ${index}`);
    const baseSource = baseTexts.join('\n\n');
    let baseOffset = 0;
    const baseNodes = baseTexts.map((text, index) => {
      const node = makeNode(`node-${index}`, baseOffset, text);
      baseOffset += text.length + 2;
      return node;
    });
    // Large unchanged metadata keeps the complete result larger in bytes, so
    // only the node-work dimension can identify the unfavourable patch.
    const initialState: Record<string, string> = {};
    for (let index = 0; index < 500; index += 1) initialState[`key-${index}`] = `value-${index}`;
    const base = deepFreeze(makeResult(baseSource, baseNodes, { initialState }));

    const nextTexts = Array.from({ length: 40 }, (_, index) => `x${index}`);
    let nextOffset = 0;
    const nextNodes = nextTexts.map((text, index) => {
      const node = makeNode(`fresh-${index}`, nextOffset, text);
      nextOffset += text.length + 2;
      return node;
    });
    const next = makeResult(nextTexts.join('\n\n'), nextNodes, { initialState });

    const encoding = encodeLocalResultPatchWithCost(base, next);
    expect(encoding).not.toBeNull();
    const cost = encoding!.cost;
    expect(cost.fullBytes).toBeTypeOf('number');
    expect(cost.fullNodes).toBe(80);
    // Every node's payload is resent, so the apply work equals a full result.
    expect(cost.patchBytes).toBeLessThan(cost.fullBytes!);
    expect(cost.reason).toBe('nodes');
    expect(cost.preferFull).toBe(true);
  });
});
