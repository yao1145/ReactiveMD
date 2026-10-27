import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { compileExpression } from '../src/local/expression';
import { createLocalRuntime } from '../src/local/runtime';
import { LocalReactiveDocument } from '../src/local/LocalDocumentView';
import { parseLocal } from '../src/local/parser';
import { isLocalEmail, MAX_LOCAL_DIAGNOSTICS, MAX_LOCAL_STRING_LENGTH } from '../src/local/limits';
import type { LocalNode } from '../src/local/types';

const flatten = (nodes: LocalNode[]): LocalNode[] => nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);

describe('security regression boundaries', () => {
  it.each([
    '{{ constructor.constructor("return globalThis")() }}',
    '{{ process }}',
    '{{ globalThis }}',
    '{{ eval("1") }}',
    '<input label="x" onclick="alert(1)">',
    '<input bind="__proto__" label="x">',
  ])('keeps executable input outside the language: %s', source => {
    expect(compileLocal(source).ok).toBe(false);
  });

  it('preserves script tags as escaped source without executing them', () => {
    const source = '<script>alert(1)</script>';
    const result = compileLocal(source);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([expect.objectContaining({
      code: 'local.html.fallback', severity: 'warning',
    })]);
    const html = renderToStaticMarkup(createElement(LocalReactiveDocument, { source }));
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script');
  });

  it('validates email with bounded work and preserves common valid addresses', () => {
    expect(isLocalEmail('user+tag@example.com')).toBe(true);
    for (const value of ['', 'a@b', '@example.com', 'a@.com', 'a@example.', 'a@@example.com', 'a @example.com', 'a@' + '.'.repeat(32000) + '@']) {
      expect(isLocalEmail(value)).toBe(false);
    }
  });

  it('bounds conflict diagnostics before expanding every conflicting location', () => {
    const result = compileLocal('<input bind="a" label="x" initial="v">\n'.repeat(800));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeLessThanOrEqual(MAX_LOCAL_DIAGNOSTICS);
    expect(result.diagnostics.reduce((sum, item) => sum + item.message.length, 0)).toBeLessThan(20_000);
  });

  it('does not restore entity-encoded internal markers as components', () => {
    const parsed = parseLocal('&#57344;0&#57345;\n\n<counter label="x">');
    const nodes = flatten(parsed.nodes);
    expect(nodes.filter(node => node.type === 'component')).toHaveLength(1);
    expect(nodes.filter(node => node.type === 'text').map(node => node.value).join('')).toContain('\uE0000\uE001');
  });

  it.each(['&#x1F600;', '&NotEqualTilde;', '&amp;', '&unknown;', '\\*literal\\*'])('restores real interpolation after Markdown text %s', prefix => {
    const parsed = parseLocal(prefix + ' {{ 1 + 2 }}');
    expect(flatten(parsed.nodes).filter(node => node.type === 'interpolation')).toHaveLength(1);
    expect(parsed.diagnostics).toEqual([]);
  });

  it.each(['{{ 1 }}`code`', '`code`{{ 1 }}', '**{{ 1 }}**', '[{{ 1 }}](/safe)', '&NotEqualTilde;'.repeat(2000) + '{{ 1 }}'])('preserves interpolation next to Markdown constructs', source => {
    const parsed = parseLocal(source);
    expect(flatten(parsed.nodes).filter(node => node.type === 'interpolation')).toHaveLength(1);
    expect(parsed.diagnostics).toEqual([]);
  });

  it('rejects oversized documents before preprocessing or indexing them', () => {
    const source = 'x\n'.repeat(500_001);
    expect(parseLocal(source).diagnostics[0]?.code).toBe('local.budget');
    expect(compileLocal(source).diagnostics[0]?.code).toBe('local.budget');
    expect(compileLocal(null as unknown as string).ok).toBe(false);
  });

  it('rejects source strings that exceed the common runtime limit', () => {
    const result = compileLocal('<input label="x" initial="' + 'a'.repeat(MAX_LOCAL_STRING_LENGTH + 1) + '">');
    expect(result.ok).toBe(false);
    expect(() => compileExpression('len(s)').evaluate({ s: 'a'.repeat(MAX_LOCAL_STRING_LENGTH + 1) })).toThrow();
  });

  it('prevents source-level multiplication of plotting work', () => {
    expect(compileLocal('<plot samples="2000">\n' + '$$ y = x $$\n\n'.repeat(17) + '</plot>').ok).toBe(false);
    expect(compileLocal(('<plot samples="2000">\n' + '$$ y = x $$\n\n'.repeat(6) + '</plot>\n').repeat(2)).ok).toBe(false);
  });

  it('does not return mutable internal checklist state', () => {
    const result = compileLocal('<checklist bind="items" label="list">\n- [ ] one\n</checklist>');
    if (!result.ok) throw new Error('fixture did not compile');
    const runtime = createLocalRuntime(result.document);
    const value = runtime.evaluate('items') as string[];
    try { value.push('forged'); } catch { /* A frozen value is also safe. */ }
    expect(runtime.evaluate('items')).toEqual([]);
    expect(runtime.snapshot().state.items).toEqual([]);
    runtime.dispose();
  });

  it('enforces every writer constraint on a shared binding', () => {
    const result = compileLocal('<input bind="s" label="strict" max-length="3">\n<input bind="s" label="relaxed">');
    if (!result.ok) throw new Error('fixture did not compile');
    const runtime = createLocalRuntime(result.document);
    const relaxed = flatten(result.document.nodes).find(node => node.attrs?.label === 'relaxed')!;
    expect(runtime.set(relaxed, 'longvalue').length).toBeGreaterThan(0);
    expect(runtime.snapshot().state.s).toBe('');
    runtime.dispose();
  });

  it('blocks automatic image requests unless a host policy opts in', () => {
    const html = renderToStaticMarkup(createElement(LocalReactiveDocument, { source: '![x](/api/audit-probe)' }));
    expect(html).not.toContain('<img');
  });
});
