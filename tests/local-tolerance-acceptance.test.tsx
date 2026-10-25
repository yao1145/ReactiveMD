import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { compileLocal, createLocalRuntime, type LocalNode } from '../src/index';
import { LocalDocumentView } from '../src/local/LocalDocumentView';
import { MAX_LOCAL_DIAGNOSTICS } from '../src/local/limits';

const flatten = (nodes: LocalNode[]): LocalNode[] => nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);

it('keeps a normal document interactive around unsupported tags and real footnotes', () => {
  const source = '# 正文\n\n<counter bind="count" label="数量" initial="2">\n\n' +
    '前文[^note]。\n\n<slidr label="拼错" />\n\n后文：{{ count }}。\n\n[^note]: 脚注内容';
  const result = compileLocal(source);
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) return;
  expect(result.diagnostics.map(item => item.code)).toContain('local.component.unknown');
  expect(result.diagnostics.map(item => item.code)).not.toContain('local.footnote.unsupported');
  expect(result.diagnostics.every(item => item.severity === 'warning')).toBe(true);
  const runtime = createLocalRuntime(result.document);
  try {
    const counter = flatten(result.document.nodes).find(node => node.attrs?.bind === 'count')!;
    expect(runtime.set(counter, 5)).toEqual([]);
    const html = renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} />);
    expect(html).toContain('前文');
    expect(html).toContain('后文');
    expect(html).toContain('脚注内容');
    expect(html).not.toContain('[^note]');
    expect(html).toContain('&lt;slidr');
    expect(html).toContain('>5<');
  } finally {
    runtime.dispose();
  }
});

it('keeps executable-looking content inside unsupported regions inert', () => {
  const source = '<unknown-box>\n<counter bind="hidden" label="隐藏">\n{{ absent }}\n' +
    '<script>alert(1)</script>\n</unknown-box>\n\n[^note]: {{ missing }} <counter bind="secret" label="脚注控件">\n\n正文[^note]';
  const result = compileLocal(source);
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) return;
  expect(Object.keys(result.document.bindings)).toEqual([]);
  const runtime = createLocalRuntime(result.document);
  try {
    const html = renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} />);
    expect(html).toContain('{{ absent }}');
    expect(html).toContain('{{ missing }}');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('local-inactive');
  } finally {
    runtime.dispose();
  }
});

it.each(['<card>', '<counter label="计数" onclick="bad">', '{{ missing }}'])('keeps real errors fatal after the warning budget is full: %s', invalid => {
  const result = compileLocal('<unknown />\n\n'.repeat(MAX_LOCAL_DIAGNOSTICS + 1) + invalid);
  expect(result.ok).toBe(false);
  expect(result.diagnostics.some(item => item.severity === 'error')).toBe(true);
  expect(result.diagnostics.length).toBeLessThanOrEqual(MAX_LOCAL_DIAGNOSTICS);
});

it('keeps a footnote inside an indented card inert before lexical validation', () => {
  const source = '<card>\n  正文[^note]\n\n  [^note]: {{ missing }} <counter bind="secret" label="脚注">\n</card>';
  const result = compileLocal(source);
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) return;
  expect(Object.keys(result.document.bindings)).toEqual([]);
  expect(result.diagnostics.map(item => item.code)).not.toContain('local.footnote.unsupported');
  expect(flatten(result.document.nodes).some(node => node.type === 'footnoteReference')).toBe(true);
  expect(flatten(result.document.nodes).some(node => node.type === 'footnoteDefinition')).toBe(true);
});

it.each(['', '    '])('shields a footnote immediately inside a container with indentation %j', indent => {
  const source = `<card>\n${indent}[^note]: {{ broken <slider onClick="bad">\n</card>\n\n后文`;
  const result = compileLocal(source);
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) return;
  expect(Object.keys(result.document.bindings)).toEqual([]);
  expect(result.diagnostics.map(item => item.code)).not.toContain('local.footnote.unsupported');
  expect(flatten(result.document.nodes).some(node => node.type === 'footnoteDefinition')).toBe(true);
});
