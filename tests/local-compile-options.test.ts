import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/index';
import { parseLocal } from '../src/local/parser';
import { compileLocalDocument } from '../src/local/compiler';
import { localCompileOptionsKey } from '../src/local/options';
import type { LocalCompileOptions, LocalNode } from '../src/index';

function flatten(nodes: LocalNode[]): LocalNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

describe('per-call syntax-node budgets', () => {
  it('accepts the exact creation budget and rejects the next node with a source position', () => {
    // A plain paragraph creates a text node and a paragraph node.
    expect(compileLocal('hello', { limits: { maxSyntaxNodes: 2 } }).ok).toBe(true);
    const result = compileLocal('hello', { limits: { maxSyntaxNodes: 1 } });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([expect.objectContaining({
      code: 'local.budget',
      message: 'Syntax nodes exceed the limit of 1.',
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
      code: 'local.budget', message: 'Syntax nodes exceed the limit of 10000.',
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
      code: 'local.budget', message: 'Document exceeds the 1000000-character limit.',
    }));
  });
});

describe('markdownBreaks soft line breaks', () => {
  const source = 'first\nsecond\nthird';

  it('keeps the historical soft-break text by default', () => {
    const parsed = parseLocal(source);
    const breaks = flatten(parsed.nodes).filter((node) => node.type === 'break');
    const texts = flatten(parsed.nodes).filter((node) => node.type === 'text');
    expect(breaks).toEqual([]);
    expect(texts.map((node) => node.value)).toEqual([source]);
    expect(texts[0].range).toEqual({ start: 0, end: source.length });
  });

  it.each([undefined, { markdownBreaks: false }, { markdownBreaks: undefined }])(
    'does not change the default tree when the option is %j',
    (options) => {
      const parsed = parseLocal(source, options as LocalCompileOptions);
      expect(flatten(parsed.nodes).filter((node) => node.type === 'break')).toEqual([]);
      expect(flatten(parsed.nodes).filter((node) => node.type === 'text').map((node) => node.value))
        .toEqual([source]);
    },
  );

  it('turns each source soft break into one break node with original offsets', () => {
    const result = compileLocal(source, { markdownBreaks: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paragraph = result.document.nodes[0];
    expect(paragraph.type).toBe('paragraph');
    expect((paragraph.children ?? []).map((node) => [node.type, node.value, node.range])).toEqual([
      ['text', 'first', { start: 0, end: 5 }],
      ['break', undefined, { start: 5, end: 6 }],
      ['text', 'second', { start: 6, end: 12 }],
      ['break', undefined, { start: 12, end: 13 }],
      ['text', 'third', { start: 13, end: 18 }],
    ]);
    // The source string is untouched and every slice still matches its text.
    expect(result.document.source).toBe(source);
    for (const node of paragraph.children ?? []) {
      if (node.type === 'text') {
        expect(source.slice(node.range.start, node.range.end)).toBe(node.value);
      }
    }
  });

  it('keeps CRLF offsets aligned without normalizing the source', () => {
    const crlf = 'first\r\nsecond';
    const result = compileLocal(crlf, { markdownBreaks: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.source).toBe(crlf);
    const children = result.document.nodes[0].children ?? [];
    expect(children.map((node) => node.type)).toEqual(['text', 'break', 'text']);
    expect(children[0].range).toEqual({ start: 0, end: 5 });
    expect(children[1].range).toEqual({ start: 5, end: 7 });
    expect(children[2].range).toEqual({ start: 7, end: 13 });
    expect(children[0].value).toBe('first');
    expect(children[2].value).toBe('second');
  });

  it('does not duplicate an existing hard break', () => {
    const mixed = 'first\nsecond  \nthird';
    const result = compileLocal(mixed, { markdownBreaks: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const children = result.document.nodes[0].children ?? [];
    // One converted soft break plus the original hard break.
    expect(children.filter((node) => node.type === 'break')).toHaveLength(2);
    expect(children.map((node) => node.type)).toEqual(['text', 'break', 'text', 'break', 'text']);
    expect(children.filter((node) => node.type === 'text').map((node) => node.value))
      .toEqual(['first', 'second', 'third']);
  });

  it('keeps blockquote markers out of the split text ranges', () => {
    const blockquote = '> first\n> second';
    const result = compileLocal(blockquote, { markdownBreaks: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const texts = flatten(result.document.nodes).filter((node) => node.type === 'text');
    expect(texts.map((node) => node.value)).toEqual(['first', 'second']);
    for (const text of texts) {
      expect(blockquote.slice(text.range.start, text.range.end)).toBe(text.value);
    }
  });

  it('leaves literal <br>, code, formulas and native HTML content untouched', () => {
    const html = '<pre>a\nb</pre>';
    const result = compileLocal(
      `a<br>b\n\n\`code\nline\`\n\n${html}\n\n$$x +\ny$$\n\nInline $x$`,
      { markdownBreaks: true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const nodes = flatten(result.document.nodes);
    const breaks = nodes.filter((node) => node.type === 'break');
    // The literal <br> is the only break: no text soft break survived above,
    // while the code, code block, formulas and <pre> content stay literal.
    expect(breaks).toHaveLength(1);
    expect(nodes.filter((node) => node.type === 'inlineCode')).toHaveLength(1);
    expect(nodes.filter((node) => node.type === 'code').map((node) => node.value))
      .toEqual(['a\nb']);
    expect(nodes.filter((node) => node.type === 'math').map((node) => node.value))
      .toEqual(['x +\ny']);
    expect(nodes.filter((node) => node.type === 'inlineMath').map((node) => node.value))
      .toEqual(['x']);
  });

  it.each(['yes', 1, 0, null, {}])('rejects a non-boolean option value: %j', (value) => {
    const options = { markdownBreaks: value } as unknown as LocalCompileOptions;
    const result = compileLocal('a\nb', options);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([expect.objectContaining({
      code: 'local.options.invalid',
      messageKey: 'local.options.invalid.markdown-breaks',
      message: 'Compile option markdownBreaks must be a boolean.',
    })]);
    expect(parseLocal('a\nb', options).nodes).toEqual([]);
  });

  it('changes the canonical options key so caches and schedulers recompile', () => {
    const off = localCompileOptionsKey(undefined);
    const explicitOff = localCompileOptionsKey({ markdownBreaks: false });
    const on = localCompileOptionsKey({ markdownBreaks: true });
    const invalid = localCompileOptionsKey({ markdownBreaks: 'yes' } as unknown as LocalCompileOptions);
    expect(off).not.toBe(on);
    expect(explicitOff).not.toBe(on);
    expect(invalid).not.toBe(off);
    expect(invalid).not.toBe(on);
    expect(localCompileOptionsKey({ markdownBreaks: true })).toBe(on);
  });

  it('charges the split nodes against the syntax-node budget', () => {
    const result = compileLocal('a\nb', { markdownBreaks: true, limits: { maxSyntaxNodes: 3 } });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'local.budget' }));
  });
});
