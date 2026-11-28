import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { completeLocalSource, createLocalAuthoringLookup } from '../src/authoring';
import { localCompileOptionsKey } from '../src/assemblies/default-options';
import { createLocalCompileSession } from '../src/compiler/session';
import { createLocalExportPlan, defineLocalStandaloneBundle } from '../src/export';
import { compileLocal } from '../src/local/compilation/compiler';
import { createLocalRuntime } from '../src/local/runtime/runtime';
import { createReactHost } from '../src/react';
import { LocalDocumentView } from '../src/react/rendering/document/LocalDocumentView';
import { createLocalConfig, readLocalConfig } from '../src/sdk/config';
import { defineLocalFont } from '../src/sdk/font';
import { composeLocalTheme, defineLocalTheme } from '../src/sdk/theme';

const face = '@font-face { font-family: "Paper Display"; src: url("data:font/woff2;base64,AA=="); }';
const paper = () => defineLocalTheme({
  id: 'test/paper', name: 'paper', version: '1.0.0',
  css: [{ id: 'test/paper.css', css: face }],
  fonts: { brand: 'Paper Display', 'paper-only': 'Paper Display' },
});

describe('host and theme font aliases', () => {
  it('validates aliases in the active theme and completes values from that scope', () => {
    const config = readLocalConfig(JSON.parse(JSON.stringify(createLocalConfig({
      fonts: { brand: 'Host Body' }, themes: [paper()],
    }))));
    const options = { config };
    expect(compileLocal('<text font="brand">Host</text>', options).ok).toBe(true);
    expect(compileLocal('<text font="paper-only">Other theme</text>', options).ok).toBe(false);
    expect(compileLocal('<theme name="paper">\n\n<text font="paper-only">Paper</text>', options).ok).toBe(true);
    expect(compileLocal('<theme name="missing">\n\n<text font="paper-only">Missing theme</text>', options).ok).toBe(false);
    const prefix = '<theme name="paper">\n\n<text font="';
    expect(completeLocalSource(prefix, prefix.length, options).map(item => item.label)).toEqual([
      'sans', 'serif', 'mono', 'brand', 'paper-only',
    ]);
    expect(createLocalAuthoringLookup(options, 'en', 'paper').attribute('text', 'font')?.values).toContain('paper-only');
    expect(createLocalAuthoringLookup(options, 'en').attribute('text', 'font')?.values).not.toContain('paper-only');
    expect(localCompileOptionsKey(options)).not.toBe(localCompileOptionsKey({ config: createLocalConfig() }));

    const session = createLocalCompileSession();
    expect(session.compile('<theme name="paper">\n\n<text font="paper-only">Paper</text>', options).ok).toBe(true);
    expect(session.compile('<theme name="default">\n\n<text font="paper-only">Paper</text>', options).ok).toBe(false);
  });

  it('preserves theme font scoping and prefers a theme family for the same alias', () => {
    const theme = paper();
    const composed = composeLocalTheme({
      id: 'test/variant', name: 'variant', version: '1.0.0', base: theme, overrides: [],
    });
    expect(theme.fonts?.brand).toMatch(/^rmd-theme-paper-font-/);
    expect(composed.fonts?.brand).toMatch(/^rmd-theme-variant-font-/);
    expect(composed.css[0].css).toContain(composed.fonts?.brand);
    const resource = { id: 'test/host-font.css', css: face.replace('Paper Display', 'Host Body') };
    const host = createReactHost({ fonts: { brand: 'Host Body' }, themes: [theme], resources: [resource] });
    expect(host.resources).toContainEqual(resource);
    for (const [selected, family] of [['default', 'Host Body'], ['paper', theme.fonts?.brand]] as const) {
      const result = compileLocal(`<theme name="${selected}">\n\n<text font="brand" size="20">Sample</text>`, host.compileOptions);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const runtime = createLocalRuntime(result.document);
      try {
        const html = renderToStaticMarkup(<LocalDocumentView
          document={result.document} runtime={runtime} reactConfig={host.reactConfig}
        />);
        expect(html).toContain(`font-family:&quot;${family}&quot;`);
        expect(html).toContain('font-size:20px');
      } finally {
        runtime.dispose();
      }
    }
  });

  it('reserves built-in choices and rejects CSS syntax in registered families', () => {
    expect(() => createLocalConfig({ fonts: { serif: 'Replacement' } })).toThrow(/serif/);
    expect(() => createLocalConfig({ fonts: { brand: 'Brand; color: red' } })).toThrow(/brand/);
  });

  it('exports an inline font resource and checks the bundle font registry', () => {
    const font = defineLocalFont({ alias: 'brand', source: 'data:font/woff2;base64,AA==' });
    const host = createReactHost({ fonts: font.fonts, resources: [font.resource] });
    const compiled = compileLocal('<text font="brand">Example</text>', host.compileOptions);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const bundle = defineLocalStandaloneBundle('void 0;', host.config);
    const plan = createLocalExportPlan({
      config: host.config, document: compiled.document, target: 'offline', resources: host.resources, bundle,
    });
    expect(plan.ok).toBe(true);
    expect(plan.css).toContain(font.fonts.brand);
    expect(plan.css).toContain('data:font/woff2;base64,AA==');
    expect(createLocalExportPlan({
      config: createLocalConfig({ fonts: { brand: 'Different font' } }), document: compiled.document, target: 'offline', bundle,
    }).diagnostics.map(diagnostic => diagnostic.code)).toContain('local.extension.bundle-assembly');
    expect(() => defineLocalFont({ alias: 'remote', source: 'https://example.test/font.woff2' })).toThrow(/data URL/);
  });
});
