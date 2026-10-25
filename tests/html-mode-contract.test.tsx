import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import { LocalDocumentView } from '../src/local/LocalDocumentView';
import type { LocalCompileOptions } from '../src/local/types';
import { parseFragment } from 'parse5';

describe('temporary HTML routing contract', () => {
  it('renders P0 HTML with Markdown and live bindings in the default path', () => {
    const result = compileLocal('<details open><summary>Read <strong>more</strong></summary>\n\n# Heading\n\n<sup>2</sup> <sub>n</sub>\n\n<counter bind="count" label="Count" initial="2">\n\nValue: {{ count }}\n</details>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
    const runtime = createLocalRuntime(result.document);
    try {
      const markup = renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} />);
      expect(markup).toContain('<strong>');
      expect(markup).toContain('<sup>');
      expect(markup).toContain('<sub>');
      expect(markup).toContain('aria-expanded="true"');
      expect(markup).toContain('Heading');
      expect(runtime.getParameter('count')).toBe(2);
    } finally { runtime.dispose(); }
  });

  for (const flag of ['enableCss', 'enableJavaScript', 'enableExtendedHtml'] as const) {
    it(`routes the entire source to HTML when ${flag} is enabled`, () => {
      const source = '# Literal Markdown\n<p>{{ deliberately_invalid_expression }}</p><input value="native">';
      const result = compileLocal(source, { [flag]: true } as LocalCompileOptions);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect((result.document as any).html?.[flag]).toBe(true);
      expect(result.document.bindings).toEqual({});
      const runtime = createLocalRuntime(result.document);
      try {
        const markup = renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} />);
        expect(markup).toContain('<iframe');
        expect(markup).toContain('sandbox=');
        expect(markup).not.toContain('allow-same-origin');
      } finally { runtime.dispose(); }
    });
  }

  it('rejects non-boolean capability flags', () => {
    const result = compileLocal('text', { enableCss: 'false' } as unknown as LocalCompileOptions);
    expect(result.ok).toBe(false);
  });

  it('keeps the native HTML path while disabling author JavaScript in static mode', () => {
    const result = compileLocal('<p>Native HTML</p><script>window.authorRan = true</script>', { enableJavaScript: true } as LocalCompileOptions);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const runtime = createLocalRuntime(result.document);
    try {
      const markup = renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} mode="static" />);
      const findFrame = (node: any): any => node.tagName === 'iframe' ? node
        : (node.childNodes ?? []).map(findFrame).find(Boolean);
      const frame = findFrame(parseFragment(markup));
      expect(frame).toBeTruthy();
      const attrs = Object.fromEntries(frame.attrs.map((attr: any) => [attr.name, attr.value]));
      expect(attrs.sandbox).not.toContain('allow-scripts');
      expect(attrs.srcdoc).toContain('Native HTML');
      expect(attrs.srcdoc).not.toMatch(/<script[\s>]/i);
    } finally { runtime.dispose(); }
  });
});
