import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/index';
import { parseLocal } from '../src/local/parser';
import { compileLocalDocument } from '../src/local/compiler';
import type { LocalCompileOptions } from '../src/index';

describe('per-call syntax-node budgets', () => {
  it('accepts the exact creation budget and rejects the next node with a source position', () => {
    // A plain paragraph creates a text node and a paragraph node.
    expect(compileLocal('hello', { limits: { maxSyntaxNodes: 2 } }).ok).toBe(true);
    const result = compileLocal('hello', { limits: { maxSyntaxNodes: 1 } });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([expect.objectContaining({
      code: 'local.budget',
      message: '语法节点超过 1 个上限。',
      line: 1,
      column: 1,
      range: { start: 0, end: 5 },
    })]);
  });

  it('can raise the default 10,000-node limit without changing subsequent calls', () => {
    const source = 'paragraph\n\n'.repeat(5_001);
    const raised = compileLocal(source, { limits: { maxSyntaxNodes: 10_002 } });
    expect(raised.ok).toBe(true);
    if (raised.ok) expect(raised.document.nodes).toHaveLength(5_001);
    const defaultResult = compileLocal(source);
    expect(defaultResult.ok).toBe(false);
    expect(defaultResult.diagnostics).toContainEqual(expect.objectContaining({
      code: 'local.budget', message: '语法节点超过 10000 个上限。',
    }));
    expect(compileLocal('hello').ok).toBe(true);
  });

  it('applies the option to parsing and the internal compiler alias', () => {
    const options: LocalCompileOptions = { limits: { maxSyntaxNodes: 1 } };
    expect(parseLocal('hello', options).nodes).toEqual([]);
    expect(compileLocalDocument('hello', options).ok).toBe(false);
  });

  it.each([undefined, {}, { limits: {} }, { limits: { maxSyntaxNodes: undefined } }])(
    'keeps existing behavior when the node budget is omitted: %j', options => {
      expect(compileLocal('hello', options).ok).toBe(true);
    },
  );

  it.each([0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '100', null, true])(
    'rejects an invalid node budget instead of disabling the limit: %j', value => {
      const options = { limits: { maxSyntaxNodes: value } } as unknown as LocalCompileOptions;
      const result = compileLocal('hello', options);
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toEqual([expect.objectContaining({
        code: 'local.options.invalid',
        message: expect.stringContaining('maxSyntaxNodes'),
      })]);
      expect(parseLocal('hello', options).nodes).toEqual([]);
    },
  );

  it.each([null, [], 'options', { limits: null }, { limits: [] }, { limits: 'limits' }].map(value => ({ value })))(
    'rejects malformed options containers without throwing: $value', ({ value }) => {
      const result = compileLocal('hello', value as unknown as LocalCompileOptions);
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'local.options.invalid' })]);
    },
  );

  it('does not mutate host options or make a lower budget persist', () => {
    const options = Object.freeze({ limits: Object.freeze({ maxSyntaxNodes: 1 }) });
    expect(compileLocal('hello', options).ok).toBe(false);
    expect(options.limits.maxSyntaxNodes).toBe(1);
    expect(compileLocal('hello').ok).toBe(true);
  });

  it('accepts the largest safe integer while keeping the source-length budget independent', () => {
    const options: LocalCompileOptions = { limits: { maxSyntaxNodes: Number.MAX_SAFE_INTEGER } };
    expect(compileLocal('hello', options).ok).toBe(true);
    const result = compileLocal('x'.repeat(1_000_001), options);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'local.budget', message: '文档超过 1000000 字符上限。',
    }));
  });
});
