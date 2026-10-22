import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { parseLocal } from '../src/local/parser';
import { createLocalRuntime } from '../src/local/runtime';
import type { LocalNode } from '../src/local/types';

const flatten = (nodes: LocalNode[]): LocalNode[] => nodes.flatMap(n => [n, ...flatten(n.children ?? [])]);

function compiled(source: string) {
  const result = compileLocal(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return { document: result.document, diagnostics: result.diagnostics };
}

describe('unknown components become inert fallback text', () => {
  it('preserves the whole paired region, its source position and a warning', () => {
    const source = '开头文本\n\n<fancy-box tone="x">\n内部 <input bind="hidden" label="隐藏"> 与 {{ hidden }}\n</fancy-box>\n\n<counter bind="after" label="之后">';
    const start = source.indexOf('<fancy-box');
    const end = source.indexOf('</fancy-box>') + '</fancy-box>'.length;
    const { document, diagnostics } = compiled(source);
    const fallback = flatten(document.nodes).find(node => node.type === 'fallback')!;

    expect(fallback.value).toBe(source.slice(start, end));
    expect(fallback.range).toEqual({ start, end });
    expect(fallback.children).toBeUndefined();
    expect(fallback.attrs).toBeUndefined();

    const warning = diagnostics.find(diagnostic => diagnostic.code === 'local.component.unknown')!;
    expect(warning.severity).toBe('warning');
    expect(warning.range).toEqual({ start, end });
    expect(warning.line).toBe(3);
    expect(warning.column).toBe(1);

    // The known control inside the region must not become a binding, and the
    // interpolation must not survive as an evaluable node.
    expect(document.bindings.hidden).toBeUndefined();
    expect(document.initialState.hidden).toBeUndefined();
    expect(flatten(document.nodes).some(node => node.type === 'interpolation')).toBe(false);
    expect(flatten(document.nodes).filter(node => node.type === 'component').map(node => node.name)).toEqual(['counter']);
    expect(document.bindings.after).toBeTruthy();
  });

  it('keeps spelling suggestions and treats self-closing tags as single fallbacks', () => {
    const parsed = parseLocal('<panl>正文</panl>');
    expect(parsed.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['local.component.unknown']);
    expect(parsed.diagnostics[0].severity).toBe('warning');
    expect(parsed.diagnostics[0].message).toContain('<panel>');
    expect(parsed.nodes[0].type).toBe('fallback');

    const source = '<widget bind="ghost" label="Ghost" />\n\n<counter bind="count" label="计数">';
    const { document } = compiled(source);
    const fallback = flatten(document.nodes).find(node => node.type === 'fallback')!;
    expect(fallback.value).toBe('<widget bind="ghost" label="Ghost" />');
    expect(document.bindings.ghost).toBeUndefined();
    expect(document.bindings.count).toBeTruthy();
  });

  it('keeps controls before and after a region usable', () => {
    const source = '<counter bind="before" label="前">\n\n<unknown-widget>内部 {{ absent }} 与 <slider bind="ghost" label="G"> 不执行</unknown-widget>\n\n<counter bind="after" label="后">';
    const { document } = compiled(source);
    const runtime = createLocalRuntime(document);
    const counters = flatten(document.nodes).filter(node => node.name === 'counter');
    expect(counters).toHaveLength(2);
    expect(runtime.set(counters[0], 4)).toEqual([]);
    expect(runtime.snapshot().state.before).toBe(4);
    expect(runtime.snapshot().state.after).toBe(0);
    expect(runtime.snapshot().state.ghost).toBeUndefined();
    runtime.dispose();
  });

  it('never diagnoses malformed controls or expressions hidden inside a region', () => {
    const result = compileLocal('<mysterious><slider onClick="x"> 与 {{ 1 + }}</mysterious>');
    expect(result.ok).toBe(true);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['local.component.unknown']);
  });

  it('shields unknown-looking tags inside inline and fenced code', () => {
    const source = '`<phantom>{{ absent }}</phantom>`\n\n```md\n<phantom>{{ absent }}</phantom>\n```\n\n<phantom>真实区域 {{ absent }}</phantom>';
    const parsed = parseLocal(source);
    expect(parsed.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['local.component.unknown']);
    const fallbacks = flatten(parsed.nodes).filter(node => node.type === 'fallback');
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0].value).toBe('<phantom>真实区域 {{ absent }}</phantom>');

    const comment = parseLocal('<!-- {{ absent }} <phantom>x</phantom> -->\n\n<counter bind="n" label="N">');
    expect(comment.diagnostics).toEqual([]);
    expect(flatten(comment.nodes).some(node => node.type === 'fallback' || node.type === 'interpolation')).toBe(false);
    expect(flatten(comment.nodes).filter(node => node.type === 'component').map(node => node.name)).toEqual(['counter']);
  });
});

describe('footnotes become inert fallback text', () => {
  it('preserves references and definitions with exact offsets and warnings', () => {
    const source = '正文[^note]后文\n\n[^note]: 定义中的 <input bind="hidden" label="隐藏"> 与 {{ hidden }}\n';
    const { document, diagnostics } = compiled(source);
    const fallbacks = flatten(document.nodes).filter(node => node.type === 'fallback');

    expect(fallbacks).toHaveLength(2);
    const reference = fallbacks.find(node => node.value === '[^note]')!;
    const definition = fallbacks.find(node => node.value?.startsWith('[^note]:'))!;
    expect(reference.range.start).toBe(source.indexOf('[^note]'));
    expect(reference.value).toBe(source.slice(reference.range.start, reference.range.end));
    expect(definition.range.start).toBe(source.indexOf('[^note]:'));
    expect(definition.value).toBe(source.slice(definition.range.start, definition.range.end));

    const warnings = diagnostics.filter(diagnostic => diagnostic.code === 'local.footnote.unsupported');
    expect(warnings).toHaveLength(2);
    expect(warnings.every(diagnostic => diagnostic.severity === 'warning')).toBe(true);

    expect(document.bindings.hidden).toBeUndefined();
    expect(flatten(document.nodes).some(node => node.type === 'interpolation')).toBe(false);
  });

  it('does not warn for footnote syntax inside inline or fenced code', () => {
    const source = '`[^1]` 与 `[^1]: 代码定义`\n\n```md\n[^1]\n[^1]: 代码定义\n```\n\n真实[^1]\n\n[^1]: 真实定义';
    const parsed = parseLocal(source);
    const warnings = parsed.diagnostics.filter(diagnostic => diagnostic.code === 'local.footnote.unsupported');
    expect(warnings).toHaveLength(2);
    const fallbacks = flatten(parsed.nodes).filter(node => node.type === 'fallback');
    expect(fallbacks.every(node => !node.value?.includes('```'))).toBe(true);
    expect(flatten(parsed.nodes).some(node => node.type === 'code')).toBe(true);
  });

  it('never executes malformed controls or expressions inside a definition', () => {
    const result = compileLocal('[^bad]: <slider onClick="x"> 与 {{ 1 + }}');
    expect(result.ok).toBe(true);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['local.footnote.unsupported']);
    expect(result.ok && result.document.initialState).toEqual({});
  });

  it('leaves undefined footnote references as ordinary text without warnings', () => {
    const parsed = parseLocal('这里[^missing]没有定义');
    expect(parsed.diagnostics).toEqual([]);
    expect(flatten(parsed.nodes).some(node => node.type === 'fallback')).toBe(false);
    expect(flatten(parsed.nodes).filter(node => node.type === 'text').map(node => node.value).join('')).toContain('[^missing]');
  });
});

describe('structural errors stay fatal', () => {
  it('still rejects known-component attribute, expression and binding errors', () => {
    expect(compileLocal('<slider onClick="x">').ok).toBe(false);
    expect(compileLocal('{{ 1 + }}').ok).toBe(false);
    expect(compileLocal('<counter bind="x" label="X" min="2" max="1">').ok).toBe(false);
  });

  it('still rejects unclosed and mismatched tag structures', () => {
    const unknown = compileLocal('<mystery>\n<counter bind="x" label="X">');
    expect(unknown.ok).toBe(false);
    expect(unknown.diagnostics.map(diagnostic => diagnostic.code)).toContain('local.tag.unclosed');

    const known = compileLocal('<card>\n正文');
    expect(known.ok).toBe(false);
    expect(known.diagnostics.map(diagnostic => diagnostic.code)).toContain('local.tag.unclosed');

    const mismatch = compileLocal('<panel></card>');
    expect(mismatch.ok).toBe(false);
    expect(mismatch.diagnostics.map(diagnostic => diagnostic.code)).toContain('local.tag.mismatch');
  });
});
