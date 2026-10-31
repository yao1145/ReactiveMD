import { describe, expect, it } from 'vitest';
import { compileLocal, createLocalRuntime } from 'reactive-md';
import { createReactHost, defineReactComponentPackage } from 'reactive-md/react';
import { renderLocalStaticDocument } from 'reactive-md/react/server';
import { tetrisPackage } from 'reactive-md-tetris-package/react';

describe('Demo extension host composition', () => {
  it('shares one configuration and supplies styles for real external SSR', () => {
    const host = createReactHost({ packages: [tetrisPackage] });
    expect(host.reactConfig.config).toBe(host.config);
    expect(host.compileOptions.config).toBe(host.config);
    const compiled = compileLocal('<tetris width="8">', host.compileOptions);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const runtime = createLocalRuntime(compiled.document);
    try {
      const result = renderLocalStaticDocument({ document: compiled.document, runtime, reactConfig: host.reactConfig, resources: host.resources });
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      expect(result.markup).toContain('data-tetris-static');
      expect(host.css).toContain('.rmd-tetris');
    } finally { runtime.dispose(); }
  });

  it('rejects duplicate packages, missing styles and conflicting resources at registration', () => {
    expect(() => createReactHost({ packages: [tetrisPackage, tetrisPackage] })).toThrow();
    expect(() => defineReactComponentPackage({ ...tetrisPackage.definition, render: () => null })).toThrow('example/tetris.css');
    expect(() => createReactHost({
      packages: [tetrisPackage],
      resources: [{ id: 'example/tetris.css', css: '.different {}' }],
    })).toThrow('conflicting');
  });

  it('rejects CSS that would require a network request', () => {
    expect(() => createReactHost({
      resources: [{ id: 'unsafe', css: '@import "https://example.com/a.css";' }],
    })).toThrow();
  });

  it('keeps the default preset when no extensions are registered', () => {
    const host = createReactHost();
    const result = compileLocal('<slider bind="n" label="Count" initial="2" min="0" max="10">', host.compileOptions);
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(host.resources).toEqual([]);
    expect(host.notices).toEqual([]);
  });
});
