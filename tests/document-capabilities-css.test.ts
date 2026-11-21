import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compilation/compiler';
import {
  parseAuthorDeclarations,
  parseAuthorPriority,
  scopeAuthorStyles,
} from '../src/local/css/author-css';

it('preserves multiline selectors and points at filtered global rules', () => {
  expect(scopeAuthorStyles(':scope\n\t h2 { color: red; }')).toMatch(/:scope\s+h2/);
  const source = '<css>\r\n/* note */\r\n@media print {\r\n  @keyframes fade { to { opacity: 1 } }\r\n}\r\n</css>\r\n\r\n# Body';
  const result = compileLocal(source);
  expect(result.ok).toBe(true);
  const [issue] = result.diagnostics;
  expect(issue).toMatchObject({ code: 'local.author.css-global-rule', severity: 'warning', line: 4, column: 3 });
  expect(source.slice(issue.range.start, issue.range.end)).toBe('@keyframes');
});

describe('author declaration parsing', () => {
  it('converts CSS properties to React keys and keeps custom properties', () => {
    expect(parseAuthorDeclarations('max-width: 24rem; margin-block: 1rem; color: red')).toEqual({
      maxWidth: '24rem',
      marginBlock: '1rem',
      color: 'red',
    });
    expect(parseAuthorDeclarations('--rmd-accent: #24549a; -webkit-line-clamp: 2')).toEqual({
      '--rmd-accent': '#24549a',
      WebkitLineClamp: '2',
    });
  });

  it('is serializable and deterministic', () => {
    const source = 'z-index: 2; color: red; background-color: rgb(1 2 3)';
    const first = parseAuthorDeclarations(source);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(parseAuthorDeclarations(source)).toEqual(first);
  });

  it('serializes priority in the value and exposes the CSSOM strategy', () => {
    const parsed = parseAuthorDeclarations('color: red !IMPORTANT; margin-top: 1px');
    expect(parsed).toEqual({ color: 'red !important', marginTop: '1px' });
    expect(parseAuthorPriority(parsed.color)).toEqual({ value: 'red', important: true });
    expect(parseAuthorPriority(parsed.marginTop)).toEqual({ value: '1px', important: false });
  });

  it('follows cascade order, including important precedence', () => {
    expect(parseAuthorDeclarations('color: red; color: blue')).toEqual({ color: 'blue' });
    expect(parseAuthorDeclarations('color: blue; color: red !important; color: green')).toEqual({ color: 'red !important' });
    expect(parseAuthorDeclarations('color: red !important; color: blue')).toEqual({ color: 'red !important' });
  });

  it('skips individual invalid or external declarations and keeps the rest', () => {
    const parsed = parseAuthorDeclarations([
      'color: red',
      'background-image: url(https://example.test/bg.png)',
      'margin: 0',
      'font-family: "a; color: red"',
      'padding: 4px',
      'width: 10px} body { display: none',
      'background: url("data:image/png;base64,iVBORw0KGgo=")',
    ].join('; '));
    expect(parsed).toEqual({
      color: 'red',
      margin: '0',
      fontFamily: '"a; color: red"',
      padding: '4px',
      background: 'url("data:image/png;base64,iVBORw0KGgo=")',
    });
  });

  it('decodes CSS escapes before rejecting resource loading', () => {
    expect(parseAuthorDeclarations('background-image: u\\72 l(https://example.test/x.png)')).toEqual({});
    expect(parseAuthorDeclarations('background: expression(alert(1))')).toEqual({});
    expect(parseAuthorDeclarations('background: url(javascript:alert(1))')).toEqual({});
  });

  it('rejects markup-shaped and control text that could escape serialization', () => {
    expect(parseAuthorDeclarations('<script>alert(1)</script>')).toEqual({});
    expect(parseAuthorDeclarations('color: red\u0000; width: 1px')).toEqual({ width: '1px' });
    expect(parseAuthorDeclarations('color: "red')).toEqual({});
    expect(parseAuthorDeclarations('width: calc(100% - 2px')).toEqual({});
    expect(parseAuthorDeclarations('')).toEqual({});
    expect(parseAuthorDeclarations('not a declaration')).toEqual({});
  });

  it('accepts functional values and strings with separators', () => {
    expect(parseAuthorDeclarations('color: rgb(1, 2, 3); font-family: "A, B", serif')).toEqual({
      color: 'rgb(1, 2, 3)',
      fontFamily: '"A, B", serif',
    });
    expect(parseAuthorDeclarations('color: red ! important')).toEqual({ color: 'red !important' });
  });
});

describe('author stylesheet scoping', () => {
  it('wraps the stylesheet in @scope with the document lower bound', () => {
    const scoped = scopeAuthorStyles('h2 { color: #24549a; }', '#root');
    expect(scoped).toMatch(/^@scope \(#root\) to \(#root \[data-rmd-document\]\) \{/);
    expect(scoped).toContain('h2 {');
    expect(scoped).toContain('color: #24549a;');
    expect(scoped.trimEnd().endsWith('}')).toBe(true);
    expect(scoped.match(/\{/g)).toHaveLength(scoped.match(/\}/g)!.length);
  });

  it('keeps source order, multiple selectors and nested queries inside the scope', () => {
    const source = `
      h2, .title { color: #24549a; }
      @media (prefers-color-scheme: dark) {
        h2 { color: #e8eefc; }
      }
      @supports (display: grid) {
        .grid { display: grid; }
      }
      .later { margin-block: 1rem; }
    `;
    const scoped = scopeAuthorStyles(source, '#root.local-document');
    expect(scoped).toMatch(/^@scope \(#root\.local-document\) to \(#root\.local-document \[data-rmd-document\]\)/);
    const order = ['h2, .title', '@media (prefers-color-scheme: dark)', '@supports (display: grid)', '.later'];
    const positions = order.map((token) => scoped.indexOf(token));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(scoped.indexOf('@media') < scoped.lastIndexOf('.later {')).toBe(true);
    expect(scoped.match(/\{/g)).toHaveLength(scoped.match(/\}/g)!.length);
  });

  it('preserves priority and duplicate declarations', () => {
    const scoped = scopeAuthorStyles('p { color: blue; color: red !important; margin: 0 !important; }', '#root');
    expect(scoped).toContain('color: red !important;');
    expect(scoped).toContain('margin: 0 !important;');
  });

  it('drops external resources and page-global rules', () => {
    const source = `
      @import url("https://example.test/x.css");
      @font-face { font-family: X; src: url("https://example.test/x.woff2"); }
      @layer base { h2 { color: red; } }
      @keyframes spin { from { rotate: 0deg; } to { rotate: 1turn; } }
      h2 { color: #24549a; }
      p { background: url(https://example.test/x.png); color: green; }
      a { background-image: u\\72 l(https://example.test/y.png); }
      html { margin: 0; }
      body { padding: 0; }
      :root { color: red; }
    `;
    const scoped = scopeAuthorStyles(source, '#root');
    expect(scoped).not.toMatch(/@import|@font-face|@layer|@keyframes/);
    expect(scoped).not.toContain('https://example.test');
    expect(scoped).not.toMatch(/(?:^|[\s>+~,])(?:html|body)(?:$|[\s.#:[>+~,])/m);
    expect(scoped).not.toContain(':root');
    expect(scoped).toContain('h2 {');
    expect(scoped).toContain('color: green;');
    expect(scoped).not.toContain('background');
  });

  it('escapes `<` so the result cannot end a style element', () => {
    const scoped = scopeAuthorStyles('h2::before { content: "<style>"; }', '#root');
    expect(scoped).not.toContain('<');
    expect(scoped).toContain('content: "\\3c style>";');
  });

  it('recovers from an unterminated trailing block and skips invalid declarations', () => {
    const scoped = scopeAuthorStyles('h2 { color: red; } p { color: blue', '#root');
    expect(scoped).toContain('h2 {');
    expect(scoped).not.toContain('p {');
    const partial = scopeAuthorStyles('h2 { color: red; background: url(https://x.test/a); margin: 0; }', '#root');
    expect(partial).toContain('color: red;');
    expect(partial).toContain('margin: 0;');
    expect(partial).not.toContain('url(');
  });

  it('returns an empty string for unusable input or selectors', () => {
    expect(scopeAuthorStyles('', '#root')).toBe('');
    expect(scopeAuthorStyles('h2 { color: red; }', '')).toBe('');
    expect(scopeAuthorStyles('h2 { color: red; }', '#root {')).toBe('');
    expect(scopeAuthorStyles('h2 { color: red; }', '#root >')).toBe('');
    expect(scopeAuthorStyles('h2 { color: red; }', '#root [')).toBe('');
    expect(scopeAuthorStyles('h2 { color: red; }', '<style>')).toBe('');
    expect(scopeAuthorStyles('/* only a comment */', '#root')).toBe('');
  });

  it('is deterministic and runs without DOM globals', () => {
    const source = '@media (min-width: 600px) { .a { color: red; } }';
    expect(scopeAuthorStyles(source, '#root')).toBe(scopeAuthorStyles(source, '#root'));
    expect(typeof globalThis.document).toBe('undefined');
  });
});
