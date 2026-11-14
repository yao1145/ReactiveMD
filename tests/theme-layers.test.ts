import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { collectLocalThemeCss, composeLocalTheme, defineLocalTheme } from '../src/sdk/theme';
import { LOCAL_STYLE_LAYER_ORDER } from '../src/themes/contract';

const define = (css: string) => defineLocalTheme({ id: 'test/layer', name: 'paper', version: '1.0.0', css: [{ id: 'main', css }] });

describe('theme cascade boundary', () => {
  it('shares the same order between runtime resources and CSS module bootstrapping', () => {
    const bootstrap = readFileSync(new URL('../src/themes/layers.css', import.meta.url), 'utf8');
    expect(bootstrap).toContain(LOCAL_STYLE_LAYER_ORDER);
  });

  it('places legacy unlayered resources in the theme layer', () => {
    const theme = define('.card { color: red; }');
    expect(theme.css[0].css).toContain('@layer rmd.themes {');
    expect(theme.css[0].css).toMatch(/^@layer rmd\.reset, rmd\.defaults, rmd\.components, rmd\.themes, rmd\.overrides;/);
    expect(theme.css[0].css).toContain('[data-rmd-theme="paper"] .card');
  });

  it('normalizes an explicitly layered package without nesting the public layer', () => {
    const theme = define('@layer rmd.themes { .card { color: red; } }');
    expect(theme.css[0].css.match(/@layer rmd\.themes/g)).toHaveLength(1);
    expect(defineLocalTheme(theme).css).toEqual(theme.css);
  });

  it('retargets composed layers while keeping overrides after the base', () => {
    const base = define('.card { color: red; }');
    const composed = composeLocalTheme({ id: 'test/derived', name: 'derived', version: '1.0.0', base, overrides: [{ id: 'override', css: '.card { color: blue; }' }] });
    expect(composed.css).toHaveLength(2);
    for (const resource of composed.css) {
      expect(resource.css).toContain('@layer rmd.themes {');
      expect(resource.css).toContain('[data-rmd-theme="derived"] .card');
      expect(resource.css).not.toContain('[data-rmd-theme="paper"]');
    }
    expect(composed.css[1].css).toContain('color: blue');
  });

  it('normalizes a serialized legacy package when collecting its CSS', () => {
    const legacy = { ...define('.card { color: red; }'), css: [{ id: 'main', css: '[data-rmd-theme="paper"] .card { color: red; }' }] };
    expect(collectLocalThemeCss(legacy)).toContain('@layer rmd.themes {');
  });

  it('preserves an identically named sublayer inside an authored layer', () => {
    const theme = define('@layer controls { .card { color: blue; } @layer rmd.themes { .card { color: red; } } }');
    expect(theme.css[0].css.match(/@layer rmd\.themes\s*\{/g)).toHaveLength(2);
    expect(defineLocalTheme(theme).css).toEqual(theme.css);
  });

  it('recognizes comments in the public layer declaration', () => {
    const theme = define('@layer /* shared */ rmd.themes { .card { color: red; } }');
    expect(theme.css[0].css).not.toContain('@layer /* shared */');
    expect(theme.css[0].css.match(/@layer rmd\.themes\s*\{/g)).toHaveLength(1);
  });

  it('keeps authored layer identifiers case-sensitive', () => {
    const theme = define('@LAYER RMD.THEMES { .card { color: red; } }');
    expect(theme.css[0].css).toContain('@LAYER RMD.THEMES {');
    expect(defineLocalTheme(theme).css).toEqual(theme.css);
  });

  it('preserves a public-named sublayer directly inside the public layer', () => {
    const theme = define('@layer rmd.themes { .card { color: blue; } @layer rmd.themes { .card { color: red; } } }');
    expect(theme.css[0].css.match(/@layer rmd\.themes\s*\{/g)).toHaveLength(2);
    expect(defineLocalTheme(theme).css).toEqual(theme.css);
  });

  it('rejects normalized output that would exceed a resource budget at define time', () => {
    const css = `/*${'x'.repeat(262_140)}*/`;
    expect(() => define(css)).toThrow(/scoped CSS.*262144/);
  });

  it('applies the total budget to normalized resources', () => {
    const css = [200_000, 200_000, 124_100].map((length, index) => ({ id: `r${index}`, css: `/*${'x'.repeat(length - 4)}*/` }));
    expect(() => defineLocalTheme({ id: 'test/budget', name: 'budget', version: '1.0.0', css })).toThrow(/scoped CSS.*524288/);
  });

  it('preserves serialization and collection for an accepted near-limit package', () => {
    const theme = define(`/*${'x'.repeat(261_880)}*/`);
    expect(collectLocalThemeCss(JSON.parse(JSON.stringify(theme)))).toBe(theme.css[0].css);
  });

  it('enforces the normalized resource budget during composition', () => {
    expect(() => composeLocalTheme({ id: 'test/composed', name: 'composed', version: '1.0.0', base: define('.card {}'), overrides: [{ id: 'large', css: `/*${'x'.repeat(262_140)}*/` }] })).toThrow(/scoped CSS.*262144/);
  });
});
