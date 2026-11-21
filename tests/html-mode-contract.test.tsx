import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileLocal } from '../src/local/compilation/compiler';
import { createLocalRuntime } from '../src/local/runtime/runtime';
import { createLocalStateFile } from '../src/local/runtime/state';
import { LocalDocumentView } from '../src/local/rendering/document/LocalDocumentView';
import { createShareableHtml } from '../src/shareable';
import type { LocalCompileOptions } from '../src/local/types';

const MIXED = [
  '<css>', 'h2 { color: #24549a; }', '</css>',
  '', '## People', '',
  '<slider bind="people" label="People" initial="2" min="1" max="20" css="max-width: 24rem; margin-block: 1rem">',
  '', 'People: {{ people }}', '',
  '<iframe title="Example" srcdoc="<p>Example</p>"></iframe>', '',
  '<javascript>', 'await rmd.set("people", 10)', '</javascript>',
].join('\n');

describe('independent document capability contract', () => {
  it('rejects an Extended HTML snapshot when exporting with the capability off', () => {
    const source = '<dl><dt>Term</dt><dd>Definition</dd></dl>';
    const result = compileLocal(source, { enableExtendedHtml: true });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const { document } = result;
    const runtime = createLocalRuntime(document);
    try {
      const staticMarkup = renderToStaticMarkup(<LocalDocumentView document={document} runtime={runtime}
        mode="static" capabilityGrants={{ enableExtendedHtml: true }} />);
      expect(staticMarkup).toContain('<dl>');
      expect(() => createShareableHtml({ title: 'HTML snapshot', source, staticMarkup,
        state: createLocalStateFile(document, runtime.snapshot().state), mode: 'static', css: 'article{}',
        compileOptions: { enableExtendedHtml: false } })).toThrow(/Extended HTML/i);
    } finally { runtime.dispose(); }
  });

  it.each([
    '<css>h2 { color: red; }</css>\n\n## People',
    '<slider bind="people" label="People" css="margin-left:3px">',
  ])('checks the static snapshot CSS grant before exporting %s', source => {
    const result = compileLocal(source);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const { document } = result;
    const runtime = createLocalRuntime(document);
    try {
      const markup = (enableCss: boolean) => renderToStaticMarkup(<LocalDocumentView document={document}
        runtime={runtime} mode="static" capabilityGrants={{ enableCss }} />);
      const options = {
        title: 'CSS snapshot', source, state: createLocalStateFile(document, runtime.snapshot().state),
        css: 'article{}', mode: 'static' as const, compileOptions: { enableCss: false },
      };
      expect(() => createShareableHtml({ ...options, staticMarkup: markup(true) })).toThrow(/author CSS/i);
      expect(createShareableHtml({ ...options, staticMarkup: markup(false) })).not.toMatch(/@scope|margin-left:3px/);
    } finally { runtime.dispose(); }
  });

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

  it.each(Array.from({ length: 8 }, (_, policy) => ({
    enableCss: Boolean(policy & 1),
    enableJavaScript: Boolean(policy & 2),
    enableExtendedHtml: Boolean(policy & 4),
  })))('keeps RMD bindings and independently applies $enableCss/$enableJavaScript/$enableExtendedHtml', options => {
      const result = compileLocal(MIXED, options);
      if (!result.ok) throw new Error(result.diagnostics.map(item => item.message).join('\n'));
      expect(result.document.html).toBeUndefined();
      expect(result.document.bindings.people.initial).toBe(2);
      expect(Boolean(result.document.capabilities?.scripts.length)).toBe(options.enableJavaScript);
      const runtime = createLocalRuntime(result.document);
      try {
        expect(runtime.setParameter('people', 12)).toEqual([]);
        const markup = renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} capabilityGrants={options} mode="static" />);
        expect(markup).toMatch(/<h2[^>]*><span>People<\/span><\/h2>/);
        expect(markup).toContain('<p><span>People: </span><span class="local-interpolation">12</span></p>');
        expect(markup.includes('data-rmd-author-css')).toBe(options.enableCss);
        expect(markup.includes('max-width:24rem')).toBe(options.enableCss);
        expect(markup.includes('<iframe')).toBe(options.enableExtendedHtml);
        expect(markup).not.toContain('allow-scripts');
        expect(markup).not.toContain('await rmd.set');
      } finally { runtime.dispose(); }
  });

  it('rejects non-boolean capability flags', () => {
    const result = compileLocal('text', { enableCss: 'false' } as unknown as LocalCompileOptions);
    expect(result.ok).toBe(false);
  });

  it.each([true, false])('preserves extension-owned css properties with author CSS %s', enableCss => {
    const result = compileLocal('<widget css="custom-value">', {
      enableCss,
      hostComponents: [{ name: 'widget', form: 'leaf', props: { css: { kind: 'string' } } }],
    });
    if (!result.ok) throw new Error(result.diagnostics.map(item => item.message).join('\n'));
    expect(result.document.nodes[0]).toMatchObject({ name: 'widget', attrs: { css: 'custom-value' } });
    expect(result.document.capabilities?.componentStyles).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'local.author.css-owned', range: { start: 8, end: 26 },
    }));
  });

  it('uses the default CSS grant and requires separate opt-in for precompiled extended fragments', () => {
    const result = compileLocal(MIXED, { enableExtendedHtml: true });
    if (!result.ok) throw new Error(result.diagnostics.map(item => item.message).join('\n'));
    expect(result.document.capabilities?.policy).toEqual({
      enableCss: true, enableJavaScript: false, enableExtendedHtml: true,
    });
    const runtime = createLocalRuntime(result.document);
    try {
      const markup = renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} />);
      expect(markup).toContain('data-rmd-author-css');
      expect(markup).not.toContain('<iframe');
      expect(markup).toContain('&lt;iframe');
    } finally { runtime.dispose(); }
  });
});
