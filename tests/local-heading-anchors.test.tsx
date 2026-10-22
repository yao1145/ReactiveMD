import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import { LocalDocumentView, type LocalUrlPolicy } from '../src/local/LocalDocumentView';

function fixture(source: string) {
  const result = compileLocal(source);
  if (!result.ok) throw new Error(result.diagnostics.map((item) => item.message).join('; '));
  return { document: result.document, runtime: createLocalRuntime(result.document) };
}

function headingIds(html: string): string[] {
  return [...html.matchAll(/<h[1-6]\b[^>]*\bid="([^"]+)"/g)].map((match) => match[1]);
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((match) => match[1]);
}

function render(source: string, urlPolicy?: LocalUrlPolicy): string {
  const { document, runtime } = fixture(source);
  try {
    return renderToStaticMarkup(<LocalDocumentView document={document} runtime={runtime} urlPolicy={urlPolicy} />);
  } finally {
    runtime.dispose();
  }
}

describe('Markdown heading anchors', () => {
  it('renders SSR targets for Chinese and formatted English headings and resolves encoded fragments', () => {
    const html = render(
      '[中文](#说明) [English](#hello-world-code) [编码](#%E8%AF%B4%E6%98%8E)\n\n' +
      '# 说明\n\n## **Hello** *World* `code`!\n',
    );
    const ids = headingIds(html);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/-说明$/);
    expect(ids[1]).toMatch(/-hello-world-code$/);
    expect(hrefs(html)).toEqual([`#${ids[0]}`, `#${ids[1]}`, `#${ids[0]}`]);
  });

  it('disambiguates repeated headings and collisions with explicit numeric suffixes in source order', () => {
    const html = render(
      '[a](#foo) [b](#foo-1) [c](#foo-1-1) [d](#foo-2)\n\n' +
      '# Foo\n\n## Foo\n\n### Foo-1\n\n#### Foo\n',
    );
    const ids = headingIds(html);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(ids.map((id) => id.replace(/^.*?-foo/, 'foo'))).toEqual(['foo', 'foo-1', 'foo-1-1', 'foo-2']);
    expect(hrefs(html)).toEqual(ids.map((id) => `#${id}`));
  });

  it('keeps identical documents and nested component headings in separate instance namespaces', () => {
    const { document, runtime } = fixture('[说明](#说明)\n\n<panel title="面板">\n\n## 说明\n\n</panel>');
    try {
      const html = renderToStaticMarkup(<>
        <LocalDocumentView document={document} runtime={runtime} />
        <LocalDocumentView document={document} runtime={runtime} />
      </>);
      const ids = headingIds(html);
      expect(ids).toHaveLength(2);
      expect(ids[0]).not.toBe(ids[1]);
      expect(hrefs(html)).toEqual(ids.map((id) => `#${id}`));
    } finally {
      runtime.dispose();
    }
  });

  it('derives interpolated slugs from source initial values even when the runtime already changed', () => {
    const { document, runtime } = fixture('<number bind="n" label="参数" initial="2">\n\n[结果](#结果-2)\n\n# 结果 {{ n }}');
    try {
      const control = document.nodes.find((node) => node.name === 'number')!;
      expect(runtime.set(control, 3)).toEqual([]);
      const html = renderToStaticMarkup(<LocalDocumentView document={document} runtime={runtime} />);
      const ids = headingIds(html);
      expect(ids).toHaveLength(1);
      expect(ids[0]).toMatch(/-结果-2$/);
      expect(html).toContain('class="local-interpolation">3</span>');
      expect(hrefs(html)).toEqual([`#${ids[0]}`]);
    } finally {
      runtime.dispose();
    }
  });

  it('resolves links rendered inside inline local components', () => {
    const html = render('<badge>[跳转](#说明)</badge>\n\n# 说明');
    const ids = headingIds(html);
    expect(ids).toHaveLength(1);
    expect(hrefs(html)).toEqual([`#${ids[0]}`]);
  });

  it('validates original URLs with host policy before rewriting matching fragments', () => {
    const calls: string[] = [];
    const html = render('[跳转](#说明) [外部](/other#说明) [缺失](#missing)\n\n# 说明', (url, kind) => {
      expect(kind).toBe('link');
      calls.push(url);
      return true;
    });
    expect(calls).toEqual(['#说明', '/other#说明', '#missing']);
    expect(hrefs(html)).toEqual([`#${headingIds(html)[0]}`, '/other#说明', '#missing']);
    expect(hrefs(render('[拒绝](#说明)\n\n# 说明', () => false))).toEqual([]);
    expect(hrefs(render('[拒绝](#说明)\n\n# 说明', () => { throw new Error('denied'); }))).toEqual([]);
    expect(hrefs(render('[危险](javascript:alert(1))\n\n# 说明', () => true))).toEqual([]);
  });
});
