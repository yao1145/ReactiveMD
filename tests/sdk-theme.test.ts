import { describe, expect, it } from 'vitest';
import { LOCAL_THEME_PROTOCOL } from '../src/local/theme';
import {
  collectLocalThemeCss,
  composeLocalTheme,
  defineLocalTheme,
  type LocalThemePackage,
} from '../src/sdk/theme';

const rootCss = [
  {
    id: 'tokens',
    css: '[data-rmd-theme="paper"] { --ink: #111111; }\n.card { color: var(--ink); }',
  },
  {
    id: 'dark',
    css: '@media (prefers-color-scheme: dark) { [data-rmd-theme="paper"] { --ink: #eeeeee; } .card { border-color: var(--ink); } }',
  },
];

function paper(): LocalThemePackage {
  return defineLocalTheme({
    id: 'example/paper',
    name: 'paper',
    version: '1.0.0',
    css: rootCss,
  });
}

describe('defineLocalTheme', () => {
  it('freezes a package and scopes every selector to the theme root', () => {
    const theme = paper();

    expect(theme.id).toBe('example/paper');
    expect(theme.name).toBe('paper');
    expect(theme.version).toBe('1.0.0');
    expect(theme.protocol).toBe(LOCAL_THEME_PROTOCOL);
    expect(theme.colorSchemes).toEqual(['light', 'dark']);
    expect(Object.isFrozen(theme)).toBe(true);
    expect(Object.isFrozen(theme.css)).toBe(true);
    expect(Object.isFrozen(theme.colorSchemes)).toBe(true);
    expect(Object.isFrozen(theme.css[0])).toBe(true);

    expect(theme.css[0].css).toContain('[data-rmd-theme="paper"] {');
    expect(theme.css[0].css).toContain('[data-rmd-theme="paper"] .card {');
    expect(theme.css[0].css).not.toContain('[data-rmd-theme="paper"] [data-rmd-theme="paper"]');
    expect(theme.css[1].css).toContain('@media (prefers-color-scheme: dark)');
    expect(theme.css[1].css).toContain('[data-rmd-theme="paper"] .card {');
  });

  it('keeps resource order and accepts inline data URLs', () => {
    const theme = defineLocalTheme({
      id: 'example/icons',
      name: 'icons',
      version: '2.1.0',
      colorSchemes: ['light', 'dark'],
      css: [
        { id: 'first', css: '.icon { background: url("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="); }' },
        { id: 'second', css: '.label { font-weight: 600; }' },
      ],
    });
    expect(collectLocalThemeCss(theme)).toBe(
      `[data-rmd-theme="icons"] .icon { background: url("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="); }\n`
      + '[data-rmd-theme="icons"] .label { font-weight: 600; }',
    );
  });

  it('accepts dotted and namespaced resource ids used by host build outputs', () => {
    const theme = defineLocalTheme({
      id: 'example/files',
      name: 'files',
      version: '1.0.0',
      css: [
        { id: 'example/files.css', css: '.a { color: red; }' },
        { id: 'tokens.css', css: '.b { color: blue; }' },
      ],
    });
    expect(theme.css.map((resource) => resource.id)).toEqual(['example/files.css', 'tokens.css']);
    expect(collectLocalThemeCss(theme)).toContain('[data-rmd-theme="files"] .a');
  });

  it('rejects invalid identity, protocol, schemes and resource declarations', () => {
    const cases: Array<() => unknown> = [
      () => defineLocalTheme({ id: 'Example/Paper', name: 'paper', version: '1.0.0', css: [] }),
      () => defineLocalTheme({ id: 'example/paper', name: 'Paper', version: '1.0.0', css: [] }),
      () => defineLocalTheme({ id: 'example/paper', name: 'default', version: '1.0.0', css: [] }),
      () => defineLocalTheme({ id: 'example/paper', name: 'paper', version: 'v1', css: [] }),
      () => defineLocalTheme({
        id: 'example/paper', name: 'paper', version: '1.0.0',
        protocol: 'reactive-md-theme-2' as never, css: [],
      }),
      () => defineLocalTheme({
        id: 'example/paper', name: 'paper', version: '1.0.0',
        colorSchemes: ['light'], css: [],
      }),
      () => defineLocalTheme({
        id: 'example/paper', name: 'paper', version: '1.0.0',
        css: [{ id: 'a', css: '.a {}' }, { id: 'a', css: '.b {}' }],
      }),
      () => defineLocalTheme({
        id: 'example/paper', name: 'paper', version: '1.0.0',
        css: [{ id: 'Upper', css: '.a {}' }],
      }),
      () => defineLocalTheme({
        id: 'example/paper', name: 'paper', version: '1.0.0',
        css: ['not an object' as never],
      }),
    ];
    for (const call of cases) expect(call).toThrow(/Invalid local theme/);
  });

  it('rejects global selectors, @import, network URLs and style breakouts', () => {
    const invalid = [
      ':root { --ink: #000; }',
      'html .card { color: red; }',
      'body { background: black; }',
      '@import url("data:text/css,.a{}");',
      '.icon { background: url("https://example.com/icon.png"); }',
      '.icon { background: url(//cdn.example.com/icon.png); }',
      '.x::after { content: "</style>"; }',
      '.x { width: expression(document.body.clientWidth); }',
    ];
    for (const css of invalid) {
      expect(() => defineLocalTheme({
        id: 'example/unsafe',
        name: 'unsafe',
        version: '1.0.0',
        css: [{ id: 'main', css }],
      }), css).toThrow(/Invalid local theme/);
    }
  });

  it('rejects escaped tokens, image-set network strings, global at-rules and sibling escapes', () => {
    const invalid = [
      '.x { background: u\\72 l(https://example.com/x); }',
      '@\\69 mport "x.css";',
      '.x { background-image: image-set("https://example.com/x.png" 1x); }',
      '.x { background-image: -webkit-image-set("x.png" 1x); }',
      '[data-rmd-theme="paper"] + .host { color: red; }',
      '[data-rmd-theme="paper"] ~ .host { color: red; }',
      '[data-rmd-theme="paper"]:has(+ .host) { color: red; }',
      '+ .host { color: red; }',
      '@font-face { font-family: x; src: url("data:font/woff2;base64,AA=="); }',
      '@keyframes spin { from { opacity: 0; } to { opacity: 1; } }',
      '@-webkit-keyframes spin { from { opacity: 0; } }',
    ];
    for (const css of invalid) {
      expect(() => defineLocalTheme({
        id: 'example/hardened',
        name: 'hardened',
        version: '1.0.0',
        css: [{ id: 'main', css }],
      }), css).toThrow(/Invalid local theme/);
    }
  });

  it('keeps scoped child selectors, descendant :has() and data image-set entries', () => {
    const theme = defineLocalTheme({
      id: 'example/scoped',
      name: 'scoped',
      version: '1.0.0',
      css: [{
        id: 'main',
        css: [
          '[data-rmd-theme="scoped"] > .inside { color: red; }',
          '[data-rmd-theme="scoped"] .card:has(+ .other) { color: blue; }',
          '.icon { background-image: image-set("data:image/png;base64,AA==" 1x); }',
        ].join('\n'),
      }],
    });
    const css = collectLocalThemeCss(theme);
    expect(css).toContain('[data-rmd-theme="scoped"] > .inside');
    expect(css).toContain('.card:has(+ .other)');
    expect(css).toContain('image-set("data:image/png;base64,AA==" 1x)');
  });

});

describe('composeLocalTheme', () => {
  it('retargets base selectors and appends overrides under the composed name', () => {
    const composed = composeLocalTheme({
      id: 'example/paper-warm',
      name: 'warm-paper',
      version: '1.1.0',
      base: paper(),
      overrides: [{ id: 'warm', css: '[data-rmd-theme="paper"] { --accent: #c2410c; }\n.badge { color: var(--accent); }' }],
    });

    expect(composed.name).toBe('warm-paper');
    expect(composed.id).toBe('example/paper-warm');
    expect(composed.protocol).toBe(LOCAL_THEME_PROTOCOL);
    expect(composed.colorSchemes).toEqual(['light', 'dark']);
    expect(composed.css.map((resource) => resource.id)).toEqual(['tokens', 'dark', 'warm']);

    const all = collectLocalThemeCss(composed);
    expect(all).not.toContain('[data-rmd-theme="paper"]');
    expect(all).toContain('[data-rmd-theme="warm-paper"] { --ink: #111111; }');
    expect(all).toContain('[data-rmd-theme="warm-paper"] .card {');
    expect(all).toContain('[data-rmd-theme="warm-paper"] { --accent: #c2410c; }');
    expect(all).toContain('[data-rmd-theme="warm-paper"] .badge {');
    expect(Object.isFrozen(composed)).toBe(true);
    expect(Object.isFrozen(composed.css)).toBe(true);
  });

  it('rejects duplicate resource ids and invalid bases', () => {
    expect(() => composeLocalTheme({
      id: 'example/paper-warm',
      name: 'warm-paper',
      version: '1.1.0',
      base: paper(),
      overrides: [{ id: 'tokens', css: '.x {}' }],
    })).toThrow(/already declared/);

    expect(() => composeLocalTheme({
      id: 'example/paper-warm',
      name: 'warm-paper',
      version: '1.1.0',
      base: { ...paper(), protocol: 'other' } as unknown as LocalThemePackage,
      overrides: [],
    })).toThrow(/protocol/);
  });
});

describe('collectLocalThemeCss', () => {
  it('returns scoped CSS and validates the package', () => {
    expect(collectLocalThemeCss(paper())).toContain('[data-rmd-theme="paper"] .card {');
    expect(() => collectLocalThemeCss({ css: 'nope' } as unknown as LocalThemePackage))
      .toThrow(/Invalid local theme/);
  });
});
