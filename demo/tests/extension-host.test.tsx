import { describe, expect, it } from 'vitest';
import { compileLocal, createLocalRuntime } from 'reactive-md';
import { renderLocalStaticDocument } from 'reactive-md/react/server';
import { createDemoExtensions } from '../src/extension-host';
import { componentCss, tetrisImplementation } from 'reactive-md-tetris-package/react';

const tetris = { components: [tetrisImplementation], resources: [{ id: 'example/tetris.css', css: componentCss }] };

describe('Demo extension assembly', () => {
  it('shares one configuration and supplies styles for real external SSR', () => {
    const host = createDemoExtensions([tetris]);
    expect(host.reactConfig.config).toBe(host.config);
    const compiled = compileLocal('<tetris width="8">', { config: host.config });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const runtime = createLocalRuntime(compiled.document);
    try {
      const result = renderLocalStaticDocument({ document: compiled.document, runtime, reactConfig: host.reactConfig, resources: host.resources });
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      expect(result.markup).toContain('data-tetris-static');
      expect(host.css).toContain('.rmd-tetris');
    } finally { runtime.dispose(); }
  });

  it('rejects duplicate components, missing styles and conflicting resources at registration', () => {
    expect(() => createDemoExtensions([tetris, tetris])).toThrow();
    expect(() => createDemoExtensions([{ components: [tetrisImplementation] }])).toThrow('example/tetris.css');
    expect(() => createDemoExtensions([tetris, { resources: [{ id: 'example/tetris.css', css: '.different {}' }] }])).toThrow('conflicting');
  });

  it('rejects CSS that would require a network request', () => {
    expect(() => createDemoExtensions([{ resources: [{ id: 'unsafe', css: '@import "https://example.com/a.css";' }] }])).toThrow();
  });

  it('keeps the default preset when no extensions are registered', () => {
    const host = createDemoExtensions([]);
    const result = compileLocal('<slider bind="n" label="Count" initial="2" min="0" max="10">', { config: host.config });
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(host.examples).toEqual([]);
  });
});
