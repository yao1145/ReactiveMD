import { describe, expect, it } from 'vitest';
import { portableCompileOptions } from '../src/local/configuration/portable-options';
import { compileLocal } from '../src/local/compilation/compiler';
import { analyzeLocalSource } from '../src/local/source/authoring';
import { createLocalStateFile } from '../src/local/runtime/state';
import { createLocalRuntime } from '../src/local/runtime/runtime';
import { parseMountPayload } from '../src/standalone/payload';
import { prepareStandaloneDocument } from '../src/standalone/prepare';
import { createShareableHtml } from '../src/shareable';
import { createLocalShareableHtml } from '../src/export';
import { findUnavailableExtensionMarkup, unavailableExtensionMessage } from '../src/export/render-markup';
import { renderLocalStaticDocument } from '../src/react/server';
import { createLocalConfig } from '../src/sdk/config';
import type { LocalCompileOptions } from '../src/local/types';

/** One structural repair: the unclosed <card> is literal until the next heading. */
const RECOVERED_SOURCE = '<card>\n正文\n\n## 后续\n\n后文 **粗体**';

describe('unavailable extension markup detection', () => {
  it('ignores the marker strings in prose, code and attribute-like text', () => {
    const cases = [
      '<p>Set local-sdk-unavailable on the span.</p>',
      '<pre><code>data-rmd-extension-error="true"</code></pre>',
      '<p>&lt;span data-rmd-extension-error="x"&gt;broken&lt;/span&gt;</p>',
      '<p><code>class="local-sdk-unavailable"</code></p>',
      '<p title="local-sdk-unavailable">An attribute value, not a class.</p>',
      '<span class="local-sdk-unavailable">Author class without the host marker.</span>',
      '<p>local-sdk-unavailable</p>',
      '<!-- <div data-rmd-extension-error="quoted"></div> -->',
      '<iframe srcdoc="&lt;span class=&quot;local-sdk-unavailable&quot;&gt;&lt;/span&gt;"></iframe>',
    ];
    for (const markup of cases) {
      expect(findUnavailableExtensionMarkup(markup), markup).toBeNull();
    }
  });

  it('finds real renderer markers regardless of quoting or class order', () => {
    expect(findUnavailableExtensionMarkup('<div data-rmd-extension-error="Extended components are unavailable."></div>'))
      .toMatchObject({ reason: 'extension-error', detail: 'Extended components are unavailable.' });
    expect(findUnavailableExtensionMarkup("<div data-rmd-extension-error='single quoted'></div>"))
      .toMatchObject({ reason: 'extension-error', detail: 'single quoted' });
    expect(findUnavailableExtensionMarkup('<div data-rmd-extension-error></div>'))
      .toMatchObject({ reason: 'extension-error' });
    expect(findUnavailableExtensionMarkup('<div data-rmd-extension-error=unquoted></div>'))
      .toMatchObject({ reason: 'extension-error', detail: 'unquoted' });
    expect(findUnavailableExtensionMarkup('<DIV DATA-RMD-EXTENSION-ERROR="upper"></DIV>'))
      .toMatchObject({ reason: 'extension-error', detail: 'upper' });
    expect(findUnavailableExtensionMarkup('<div data-local-extension-error=""></div>'))
      .toMatchObject({ reason: 'extension-error' });
    expect(findUnavailableExtensionMarkup(
      '<span class="local-host-component local-sdk-unavailable" data-local-host-component="note"></span>',
    )).toMatchObject({ reason: 'sdk-unavailable', component: 'note' });
    expect(findUnavailableExtensionMarkup(
      '<span data-local-host-component=card class=md-other></span><span class=local-sdk-unavailable></span>',
    )).toBeNull();
    expect(findUnavailableExtensionMarkup(
      '<span class=" md-other local-sdk-unavailable " data-local-host-component="note">x</span>',
    )).toMatchObject({ reason: 'sdk-unavailable' });
    expect(findUnavailableExtensionMarkup(
      '<template><span class="local-sdk-unavailable" data-local-host-component="card"></span></template>',
    )).toMatchObject({ reason: 'sdk-unavailable', component: 'card' });
  });
});

describe('strict static rendering and export ignore marker text', () => {
  const SOURCE = '# Markers\n\nProse mentions local-sdk-unavailable.\n\n'
    + '`data-rmd-extension-error="true"`\n\n```html\n<span class="local-sdk-unavailable"></span>\n```\n';

  it('renders static markup that only quotes the marker names', () => {
    const compiled = compileLocal(SOURCE);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const runtime = createLocalRuntime(compiled.document);
    try {
      const rendered = renderLocalStaticDocument({ document: compiled.document, runtime });
      expect(rendered.diagnostics.filter(item => item.code === 'local.extension.ssr-render')).toEqual([]);
      expect(rendered.ok).toBe(true);
    } finally {
      runtime.dispose();
    }
  });

  it('still reports renderer markers instead of trusting the string check', () => {
    const marker = findUnavailableExtensionMarkup('<div data-rmd-extension-error="Extended components are unavailable."></div>');
    expect(marker?.reason).toBe('extension-error');
    if (!marker) return;
    expect(unavailableExtensionMessage(marker)).toContain('Extended components are unavailable.');
    const placeholder = findUnavailableExtensionMarkup(
      '<span class="local-sdk-unavailable" data-local-host-component="note"></span>',
    );
    expect(placeholder).toMatchObject({ reason: 'sdk-unavailable', component: 'note' });
    if (placeholder) expect(unavailableExtensionMessage(placeholder)).toContain('<note>');
  });

  it('exports markup that quotes marker names and rejects a real marker', () => {
    const config = createLocalConfig();
    const compiled = compileLocal(SOURCE, { config });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const state = createLocalStateFile(compiled.document, {});
    const quoted = '<article><p>Prose mentions local-sdk-unavailable.</p>'
      + '<pre><code>data-rmd-extension-error="true"</code></pre></article>';
    expect(() => createLocalShareableHtml({
      document: compiled.document,
      config,
      source: SOURCE,
      state,
      title: 'Markers',
      staticMarkup: quoted,
      css: '.md-document{}',
      mode: 'static',
    })).not.toThrow();
    expect(() => createLocalShareableHtml({
      document: compiled.document,
      config,
      source: SOURCE,
      state,
      title: 'Markers',
      staticMarkup: '<article><span class="local-sdk-unavailable" data-local-host-component="note"></span></article>',
      css: '.md-document{}',
      mode: 'static',
    })).toThrow(/unavailable/);
  });
});

describe('portable strict semantics', () => {
  it('retains the selected mode in normalized and standalone payload options', () => {
    const options = { strict: false } as LocalCompileOptions;
    expect(portableCompileOptions(options)).toMatchObject({ strict: false });
    const compiled = compileLocal('# Title');
    if (!compiled.ok) throw new Error('Invalid fixture');
    const state = createLocalStateFile(compiled.document, {});
    const parsed = parseMountPayload({ version: 1, target: 'document', source: '# Title', state, compileOptions: options });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.payload.compileOptions).toMatchObject({ strict: false });
    const html = createShareableHtml({
      source: '# Title', state, title: 'Title', staticMarkup: '<article>Title</article>',
      css: '.md-document{}', mode: 'interactive', runtimeScript: 'void 0;', compileOptions: options,
    });
    expect(html).toContain('"strict":false');
  });

  it('rejects non-boolean strict instead of losing it during serialization', () => {
    expect(() => portableCompileOptions({ strict: 'false' } as unknown as LocalCompileOptions)).toThrow();
  });

  it('replays recovered source in standalone and keeps authoring inert', () => {
    const source = '<alert>\n<const name="hidden" value="{{ 1 }}">\n{{ missing }}\n\n## Next\n\n<counter bind="n" label="Count" initial="2">';
    const options = { strict: false } as LocalCompileOptions;
    const prepared = prepareStandaloneDocument(source, undefined, undefined, options);
    expect(prepared.document.bindings.n?.initial).toBe(2);
    expect(prepared.document.computations?.hidden).toBeUndefined();
    const analysis = analyzeLocalSource(source, options);
    expect(analysis.bindings.some(binding => binding.name === 'hidden' || binding.name === 'missing')).toBe(false);
    expect(analysis.diagnostics.some(diagnostic => diagnostic.severity === 'error')).toBe(false);
    expect(() => prepareStandaloneDocument(source)).toThrow();
  });
});

describe('recovered warning export', () => {
  const options: LocalCompileOptions = { strict: false };

  it('replays recovered source in standalone without turning warnings into failure', () => {
    const compiled = compileLocal(RECOVERED_SOURCE, options);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.recoveries).toHaveLength(1);
    const recovery = compiled.recoveries?.[0];
    if (!recovery) return;
    const warning = compiled.diagnostics.find(item => item.code === recovery.code);
    expect(warning).toMatchObject({ severity: 'warning', range: recovery.causeRange });
    expect(compiled.diagnostics.some(item => item.severity === 'error')).toBe(false);

    const prepared = prepareStandaloneDocument(RECOVERED_SOURCE, undefined, undefined, options);
    expect(prepared.document.source).toBe(RECOVERED_SOURCE);
    expect(prepared.diagnostics).toEqual(compiled.diagnostics);
    expect(prepared.document.nodes.length).toBeGreaterThan(0);
    // Omitting the options keeps the strict default, so the same source fails.
    expect(() => prepareStandaloneDocument(RECOVERED_SOURCE)).toThrow();
  });

  it('keeps recovered compile options in the HTML payload and replays them', () => {
    expect(portableCompileOptions(options)).toMatchObject({ strict: false });
    const compiled = compileLocal(RECOVERED_SOURCE, options);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const state = createLocalStateFile(compiled.document, {});
    const html = createShareableHtml({
      source: RECOVERED_SOURCE,
      state,
      title: 'Recovered',
      staticMarkup: '<article>Recovered</article>',
      css: '.md-document{}',
      mode: 'interactive',
      runtimeScript: 'void 0;',
      compileOptions: options,
    });
    expect(html).toContain('"strict":false');

    const script = /<script type="application\/reactive-md\+json" data-reactive-md-auto>([\s\S]*?)<\/script>/.exec(html);
    expect(script).not.toBeNull();
    if (!script) return;
    const parsed = parseMountPayload(JSON.parse(script[1]));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.source).toBe(RECOVERED_SOURCE);
    expect(parsed.payload.compileOptions).toMatchObject({ strict: false });

    const replay = prepareStandaloneDocument(parsed.payload.source, undefined, undefined, parsed.payload.compileOptions);
    expect(replay.document.source).toBe(RECOVERED_SOURCE);
    expect(replay.diagnostics.some(item => item.severity === 'error')).toBe(false);
  });
});
