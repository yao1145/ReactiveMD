import { describe, expect, it } from 'vitest';
import {
  collectLocalThemeCss,
  composeLocalTheme,
  defineLocalTheme,
  type LocalThemePackage,
} from '../src/sdk/theme';

const FONT_SRC = 'data:font/woff2;base64,AA==';
const OTHER_FONT_SRC = 'data:font/woff2;base64,BB==';

function fontFace(family: string, src = FONT_SRC): string {
  return `@font-face { font-family: ${family}; src: url("${src}") format("woff2"); font-weight: 400; }`;
}

function fontTheme(name: string, family = 'Inter'): LocalThemePackage {
  return defineLocalTheme({
    id: `example/${name}`,
    name,
    version: '1.0.0',
    css: [
      { id: 'faces', css: fontFace(`"${family}"`) },
      { id: 'usage', css: `.card { font-family: ${family}, sans-serif; }` },
    ],
  });
}

function familiesIn(css: string): string[] {
  return [...css.matchAll(/rmd-theme-[a-z][a-z0-9-]*-font-[0-9a-f]+/g)]
    .map((match) => match[0]);
}

function uniqueFamilies(css: string): string[] {
  return [...new Set(familiesIn(css))];
}

describe('defineLocalTheme font scoping', () => {
  it('namespaces @font-face and every matching reference, including shorthand', () => {
    const theme = defineLocalTheme({
      id: 'example/typography',
      name: 'typography',
      version: '1.0.0',
      css: [
        { id: 'faces', css: fontFace('"Brand Sans"') },
        {
          id: 'usage',
          css: [
            '.heading { font-family: "Brand Sans", sans-serif; }',
            '.body { font: italic 700 16px/1.5 "Brand Sans", serif; }',
          ].join('\n'),
        },
      ],
    });
    const css = collectLocalThemeCss(theme);
    const family = uniqueFamilies(css);

    expect(family).toHaveLength(1);
    expect(family[0]).toMatch(/^rmd-theme-typography-font-[0-9a-f]+$/);

    // The declaration, the longhand reference and the shorthand reference all
    // point at the same generated family.
    expect(css.match(new RegExp(`"${family[0]}"`, 'g'))).toHaveLength(3);
    expect(css).not.toContain('font-family: "Brand Sans"');
    expect(css).toContain('@font-face {');
    expect(css).toContain(', sans-serif;');
    expect(css).toContain('font: italic 700 16px/1.5 "');
    expect(css).toContain(', serif;');
  });

  it('isolates themes that declare the same family name', () => {
    const first = collectLocalThemeCss(fontTheme('paper'));
    const second = collectLocalThemeCss(fontTheme('night'));

    const firstFamily = uniqueFamilies(first)[0];
    const secondFamily = uniqueFamilies(second)[0];
    expect(firstFamily).toMatch(/^rmd-theme-paper-font-/);
    expect(secondFamily).toMatch(/^rmd-theme-night-font-/);
    expect(firstFamily).not.toBe(secondFamily);

    expect(first).not.toContain(secondFamily);
    expect(second).not.toContain(firstFamily);
    expect(first).toContain('[data-rmd-theme="paper"] .card');
    expect(second).toContain('[data-rmd-theme="night"] .card');
  });

  it('resolves a reference declared in another resource and leaves comments and unrelated strings alone', () => {
    const theme = defineLocalTheme({
      id: 'example/cross',
      name: 'cross',
      version: '1.0.0',
      css: [
        { id: 'faces', css: fontFace('"Shared Face"') },
        {
          id: 'usage',
          css: [
            '/* keep "Shared Face" in the comment */',
            '.quote::after { content: "Shared Face"; }',
            '.label { font-family: "Shared Face"; }',
          ].join('\n'),
        },
      ],
    });
    const css = collectLocalThemeCss(theme);
    const family = uniqueFamilies(css);

    expect(family).toHaveLength(1);
    expect(css).toContain('/* keep "Shared Face" in the comment */');
    expect(css).toContain('content: "Shared Face";');
    expect(css).toContain(`.label { font-family: "${family[0]}"; }`);
  });

  it('matches family names case-insensitively and supports unquoted ident sequences', () => {
    const theme = defineLocalTheme({
      id: 'example/case',
      name: 'case',
      version: '1.0.0',
      css: [
        { id: 'faces', css: fontFace('My Display') },
        { id: 'usage', css: '.title { font-family: my display, sans-serif; }' },
      ],
    });
    const css = collectLocalThemeCss(theme);
    const family = uniqueFamilies(css);

    expect(family).toHaveLength(1);
    expect(css).toContain(`font-family: "${family[0]}", sans-serif;`);
  });

  it('is idempotent when an already defined package is validated again', () => {
    const first = fontTheme('repeat');
    const second = defineLocalTheme({
      id: first.id,
      name: first.name,
      version: first.version,
      css: first.css,
    });

    expect(collectLocalThemeCss(second)).toBe(collectLocalThemeCss(first));
    expect(Object.isFrozen(second.css[0])).toBe(true);
  });

  it('keeps non-font declarations and data URLs untouched', () => {
    const theme = defineLocalTheme({
      id: 'example/mixed',
      name: 'mixed',
      version: '1.0.0',
      css: [{
        id: 'main',
        css: [
          fontFace('"Mixed"'),
          '.icon { background: url("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="); }',
          '.plain { color: red; font-weight: 600; }',
          '.system { font-family: var(--font-mono); }',
        ].join('\n'),
      }],
    });
    const css = collectLocalThemeCss(theme);

    expect(css).toContain('url("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")');
    expect(css).toContain('[data-rmd-theme="mixed"] .plain { color: red; font-weight: 600; }');
    expect(css).toContain('font-family: var(--font-mono);');
  });
});

describe('composeLocalTheme font redirection', () => {
  it('redirects base families to the composed theme and maps override references to them', () => {
    const base = fontTheme('paper', 'Inter');
    const composed = composeLocalTheme({
      id: 'example/warm-paper',
      name: 'warm-paper',
      version: '1.1.0',
      base,
      overrides: [
        { id: 'face-body', css: fontFace('"Body Face"', OTHER_FONT_SRC) },
        {
          id: 'override-usage',
          css: [
            '.sub { font-family: Inter; }',
            '.body { font: 14px "Body Face", sans-serif; }',
          ].join('\n'),
        },
      ],
    });
    const css = collectLocalThemeCss(composed);
    const families = uniqueFamilies(css);

    expect(css).not.toContain('rmd-theme-paper-font-');
    expect(families).toHaveLength(2);
    expect(families.every((family) => family.startsWith('rmd-theme-warm-paper-font-'))).toBe(true);

    const baseReference = /\.card \{ font-family: "([^"]+)"/.exec(css)?.[1];
    const overrideReference = /\.sub \{ font-family: "([^"]+)"/.exec(css)?.[1];
    expect(overrideReference).toBe(baseReference);

    const shorthandReference = /\.body \{ font: 14px "([^"]+)"/.exec(css)?.[1];
    expect(shorthandReference).not.toBe(baseReference);
  });
});

describe('defineLocalTheme font validation', () => {
  it('rejects remote font sources', () => {
    expect(() => defineLocalTheme({
      id: 'example/remote',
      name: 'remote',
      version: '1.0.0',
      css: [{
        id: 'main',
        css: '@font-face { font-family: "Remote"; src: url("https://example.com/remote.woff2"); }',
      }],
    })).toThrow(/Invalid local theme/);
  });

  it('requires exactly one valid font-family descriptor', () => {
    const invalid = [
      `@font-face { src: url("${FONT_SRC}"); }`,
      `@font-face { font-family: "One"; font-family: "Two"; src: url("${FONT_SRC}"); }`,
      `@font-face { font-family: One, Two; src: url("${FONT_SRC}"); }`,
      `@font-face { font-family: serif; src: url("${FONT_SRC}"); }`,
      `@font-face { font-family: inherit; src: url("${FONT_SRC}"); }`,
      `@font-face { font-family: var(--family); src: url("${FONT_SRC}"); }`,
      `@font-face { font-family: ""; src: url("${FONT_SRC}"); }`,
    ];
    for (const css of invalid) {
      expect(() => defineLocalTheme({
        id: 'example/descriptor',
        name: 'descriptor',
        version: '1.0.0',
        css: [{ id: 'main', css }],
      }), css).toThrow(/font-family/);
    }
  });

  it('still rejects keyframes while accepting @font-face', () => {
    expect(() => defineLocalTheme({
      id: 'example/keyframes',
      name: 'keyframes',
      version: '1.0.0',
      css: [{ id: 'main', css: '@keyframes spin { from { opacity: 0; } to { opacity: 1; } }' }],
    })).toThrow(/keyframes/);

    expect(() => defineLocalTheme({
      id: 'example/font-face',
      name: 'font-face',
      version: '1.0.0',
      css: [{ id: 'main', css: fontFace('"Accepted"') }],
    })).not.toThrow();
  });
});

describe('theme font boundary regressions', () => {
  it('revalidates long author family names after namespace expansion', () => {
    const first = fontTheme('long-family', 'a'.repeat(130));
    expect(defineLocalTheme(first).css).toEqual(first.css);
  });
  it('rewrites public font tokens while preserving unrelated custom values', () => {
    const theme = defineLocalTheme({ id:'example/tokens',name:'tokens',version:'1.0.0',css:[{id:'main',css:
      fontFace('"Brand"') + '.card { --font-sans: "Brand", sans-serif; --font-mono: Brand, monospace; --label: "Brand"; font-family: var(--font-sans); }'
    }] });
    const css = collectLocalThemeCss(theme);
    const generated = uniqueFamilies(css)[0];
    expect(css).toContain('--font-sans: "'+generated+'", sans-serif');
    expect(css).toContain('--font-mono: "'+generated+'", monospace');
    expect(css).toContain('--label: "Brand"');
  });
});

describe('font reference syntax regressions', () => {
  function scoped(source: string): LocalThemePackage {
    return defineLocalTheme({ id: 'example/references', name: 'references', version: '1.0.0',
      css: [{ id: 'main', css: fontFace('Brand') + source }] });
  }

  it.each(['clamp(1rem, 2vw, 2rem)', 'calc(1rem + 2px)', 'min(2rem, 4vw)', 'max(1rem, 2vw)'])(
    'rewrites font shorthand with %s and no line-height', size => {
      const theme = scoped(`.card { font: italic 700 ${size} Brand, sans-serif; }`);
      const css = collectLocalThemeCss(theme);
      expect(css).toContain(`font: italic 700 ${size} "${uniqueFamilies(css)[0]}", sans-serif;`);
      expect(defineLocalTheme(theme).css).toEqual(theme.css);
    },
  );

  it('rewrites recursive var() fallback lists and preserves variable names and trivia', () => {
    const theme = scoped('.card { font-family: var(--Brand, /* keep Brand */ var(--backup, Brand, serif)), sans-serif !important; }');
    const css = collectLocalThemeCss(theme);
    expect(css).toContain(`font-family: var(--Brand, /* keep Brand */ var(--backup, "${uniqueFamilies(css)[0]}", serif)), sans-serif !important;`);
    expect(defineLocalTheme(theme).css).toEqual(theme.css);
  });

  it('rewrites nested selectors, conditional rules and declarations after nested blocks', () => {
    const theme = scoped(`.card {
      &:hover { font-family: Brand; }
      @media (width > 400px) { font: clamp(1rem, 2vw, 2rem) Brand; .child:hover { font-family: var(--brand, Brand); } }
      font-family: Brand;
      --payload: { font-family: Brand; };
      content: 'font-family: Brand';
    }`);
    const css = collectLocalThemeCss(theme);
    const family = uniqueFamilies(css)[0];
    expect(css).toContain(`&:hover { font-family: "${family}"; }`);
    expect(css).toContain(`font: clamp(1rem, 2vw, 2rem) "${family}";`);
    expect(css).toContain(`.child:hover { font-family: var(--brand, "${family}"); }`);
    expect(css).toContain(`\n      font-family: "${family}";`);
    expect(css).toContain('--payload: { font-family: Brand; };');
    expect(css).toContain("content: 'font-family: Brand';");
    expect(defineLocalTheme(theme).css).toEqual(theme.css);
    const composed = composeLocalTheme({ id: 'example/composed-references', name: 'composed-references', version: '1.0.0', base: theme, overrides: [] });
    expect(collectLocalThemeCss(composed)).not.toContain('rmd-theme-references-font-');
  });

  it('handles function sizes and line-heights after an oblique angle', () => {
    const theme = scoped('.card { font: oblique 12deg clamp(1rem, 2vw, 2rem) / calc(1 + .2) var(--brand, Brand), serif; }');
    const css = collectLocalThemeCss(theme);
    expect(css).toContain('font: oblique 12deg clamp(1rem, 2vw, 2rem) / calc(1 + .2) var(--brand, "' + uniqueFamilies(css)[0] + '"), serif;');
  });

  it('recognizes property-name trivia and keeps unrelated custom property case intact', () => {
    const css = collectLocalThemeCss(scoped('.card { font-family/**/: Brand; --Font-Sans: Brand; font: var(--all); }'));
    expect(css).toContain('font-family/**/: "' + uniqueFamilies(css)[0] + '";');
    expect(css).toContain('--Font-Sans: Brand;');
    expect(css).toContain('font: var(--all);');
  });

  it('reports excessive variable fallback and rule nesting explicitly', () => {
    expect(() => scoped('.card { font-family: ' + 'var(--x,'.repeat(66) + 'Brand' + ')'.repeat(66) + '; }')).toThrow(/fallback nesting/);
    expect(() => scoped('.card {' + '&:hover {'.repeat(66) + 'font-family: Brand;' + '}'.repeat(67))).toThrow(/nested font declarations/);
  });

  it('rejects ambiguous shorthand and unsupported family functions instead of retaining renamed references', () => {
    expect(() => scoped('.card { font: var(--size) Brand; }')).toThrow(/font.*shorthand/i);
    expect(() => scoped('.card { font-family: attr(data-font, Brand); }')).toThrow(/font-family/);
  });
});
