import { describe, expect, it } from 'vitest';
import { parseLocal } from '../src/local/parsing/parser';
import { compileLocal } from '../src/local/compilation/compiler';
import type { LocalCompileOptions, LocalNode } from '../src/local/types';

const flatten = (nodes: LocalNode[]): LocalNode[] => nodes.flatMap(n => [n, ...flatten(n.children ?? [])]);
const of = (nodes: LocalNode[], type: string): LocalNode[] => flatten(nodes).filter(n => n.type === type);
const codes = (source: string, options?: LocalCompileOptions): string[] =>
  parseLocal(source, options).diagnostics.map(d => d.code);

describe('document declaration blocks', () => {
  it.each([false, true])('keeps fence text in raw declarations opaque with author capabilities %s', enabled => {
    const css = '<css>\n/*\n\n~~~\n*/\n</css>';
    const script = '<javascript>\nconst example = `\n\n~~~\n`;\n</javascript>';
    const example = '````\n<css>\n\n~~~\n</css>\n````';
    const source = [css, example, script, '<slider bind="people" label="People" initial="2">', 'People: {{ people }}'].join('\n\n');
    const result = compileLocal(source, { enableCss: enabled, enableJavaScript: enabled });
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;
    expect(result.document.bindings.people).toBeDefined();
    expect(of(result.document.nodes, 'code')[0].value).toContain('<css>');
    expect(of(result.document.nodes, 'interpolation')).toHaveLength(1);
  });

  it('keeps every leading CSS block as exact author source', () => {
    const source = '<css>\r\nh2 { color: #24549a; }\r\n</css>\n\n<css>p{ margin:0 }</css>\n\n## 人数\n\n<slider bind="people" label="人数" initial="2">';
    const parsed = parseLocal(source);
    expect(parsed.diagnostics).toEqual([]);
    const styles = of(parsed.nodes, 'authorCss');
    expect(styles).toHaveLength(2);
    expect(styles.map(n => n.value)).toEqual(['\r\nh2 { color: #24549a; }\r\n', 'p{ margin:0 }']);
    for (const style of styles) {
      expect(source.slice(style.range.start, style.range.end)).toMatch(/^<css>[\s\S]*<\/css>$/);
      const open = source.indexOf('>', style.range.start) + 1;
      expect(style.value).toBe(source.slice(open, style.range.end - '</css>'.length));
    }
    expect(of(parsed.nodes, 'component').map(n => n.name)).toEqual(['slider']);
  });

  it('shares the leading region with the theme and version declarations', () => {
    const source = '<!-- reactive-md: local-draft-3 -->\n<theme name="default">\n<css>a{color:red}</css>\n\n# Body';
    const parsed = parseLocal(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.theme).toBe('default');
    expect(parsed.versionDeclaration?.version).toBe('local-draft-3');
    expect(of(parsed.nodes, 'authorCss')[0].value).toBe('a{color:red}');
  });

  it('reports CSS after body content and keeps it inert', () => {
    const source = '# Body\n\n<css>h1 { color: red }</css>\n\nAfter {{ amount }}';
    const parsed = parseLocal(source);
    expect(parsed.diagnostics).toHaveLength(1);
    expect(parsed.diagnostics[0]).toMatchObject({ code: 'local.author.css-placement', severity: 'warning' });
    expect(parsed.diagnostics[0].range).toEqual({ start: source.indexOf('<css>'), end: source.indexOf('</css>') + 6 });
    expect(of(parsed.nodes, 'authorCss')).toEqual([]);
    expect(of(parsed.nodes, 'fallback')[0].value).toBe('<css>h1 { color: red }</css>');
    expect(of(parsed.nodes, 'interpolation')[0].value).toBe('amount');
  });

  it('treats CSS after a JavaScript declaration as late', () => {
    const source = '<javascript>void 0</javascript>\n\n<css>a{color:red}</css>\n\nBody';
    const parsed = parseLocal(source);
    expect(parsed.diagnostics.map(d => d.code)).toEqual(['local.author.css-placement']);
    expect(of(parsed.nodes, 'authorJavaScript')).toHaveLength(1);
  });

  it('keeps top-level JavaScript blocks in source order with exact bodies', () => {
    const source = '<javascript>\nconst people = 10\nawait rmd.set("people", people)\n</javascript>\n\n## 人数\n\n<javascript>await rmd.set("people", 12)</javascript>';
    const parsed = parseLocal(source);
    expect(parsed.diagnostics).toEqual([]);
    const scripts = of(parsed.nodes, 'authorJavaScript');
    expect(scripts.map(n => n.value)).toEqual([
      '\nconst people = 10\nawait rmd.set("people", people)\n',
      'await rmd.set("people", 12)',
    ]);
    expect(source.indexOf(scripts[0].value!)).toBe(scripts[0].range.start + '<javascript>'.length);
  });

  it('reports nested declarations without disabling their surroundings', () => {
    const source = '<card>\n<css>a{color:red}</css>\n\n<javascript>void 0</javascript>\n</card>\n\n<counter bind="n" label="Count">';
    const parsed = parseLocal(source);
    expect(parsed.diagnostics.map(d => d.code)).toEqual(['local.author.css-placement', 'local.author.script-placement']);
    expect(of(parsed.nodes, 'authorCss')).toEqual([]);
    expect(of(parsed.nodes, 'authorJavaScript')).toEqual([]);
    expect(of(parsed.nodes, 'component').map(n => n.name)).toEqual(['card', 'counter']);
  });

  it('lets a registered component named css win and points at the declaration', () => {
    const options: LocalCompileOptions = {
      hostComponents: [{ name: 'css', form: 'inline', props: {} }],
    };
    const source = '<css>Component text</css>';
    const parsed = parseLocal(source, options);
    expect(parsed.diagnostics).toHaveLength(1);
    expect(parsed.diagnostics[0]).toMatchObject({ code: 'local.author.component-conflict', severity: 'warning' });
    expect(of(parsed.nodes, 'authorCss')).toEqual([]);
    expect(of(parsed.nodes, 'hostComponent')[0]).toMatchObject({ name: 'css', range: { start: 0, end: source.length } });
  });

  it('keeps declaration syntax inside code fences and inline code inert', () => {
    const source = '<css>ok{color:green}</css>\n\n`<css>a{color:red}</css>`\n\n```html\n<css>p{color:blue}</css>\n<javascript>void 0</javascript>\n```';
    const parsed = parseLocal(source);
    expect(parsed.diagnostics).toEqual([]);
    const styles = of(parsed.nodes, 'authorCss');
    expect(styles).toHaveLength(1);
    expect(styles[0].value).toBe('ok{color:green}');
    expect(of(parsed.nodes, 'authorJavaScript')).toEqual([]);
    expect(of(parsed.nodes, 'inlineCode')[0].value).toBe('<css>a{color:red}</css>');
  });

  it('recovers an unclosed declaration at its own fragment', () => {
    const source = '<css>a{color:red}\n\n## 后续\n\n<javascript>await rmd.set("n", 1)</javascript>';
    const parsed = parseLocal(source);
    expect(parsed.diagnostics).toHaveLength(1);
    expect(parsed.diagnostics[0]).toMatchObject({ code: 'local.author.unclosed', severity: 'warning' });
    expect(parsed.diagnostics[0].range.start).toBe(0);
    expect(of(parsed.nodes, 'authorCss')).toEqual([]);
    const literal = of(parsed.nodes, 'fallback')[0];
    expect(source.slice(literal.range.start, literal.range.end)).toBe('<css>a{color:red}');
    expect(of(parsed.nodes, 'heading')).toHaveLength(1);
    expect(of(parsed.nodes, 'authorJavaScript')).toHaveLength(1);
  });

  it('keeps a stray closing declaration local', () => {
    const source = 'Text\n</css>\n\n## 后续';
    const parsed = parseLocal(source);
    expect(parsed.diagnostics.map(d => d.code)).toEqual(['local.author.placement']);
    expect(of(parsed.nodes, 'fallback')[0].value).toBe('</css>');
    expect(of(parsed.nodes, 'heading')).toHaveLength(1);
  });
});

describe('extended HTML subtrees', () => {
  it.each([false, true])('keeps an inline iframe and surrounding Markdown with Extended HTML %s', enabled => {
    const source = '<slider bind="people" label="People" initial="2">\n\n**Before** <iframe title="Example" srcdoc="<p>Example</p>"></iframe> after {{ people }}.';
    const result = compileLocal(source, { enableExtendedHtml: enabled });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const nodes = result.document.nodes;
    expect(of(nodes, enabled ? 'extendedHtml' : 'fallback')[0]?.value).toMatch(/^<iframe/);
    expect(of(nodes, 'strong')).toHaveLength(1);
    expect(of(nodes, 'interpolation')).toHaveLength(1);
  });

  it('captures recognized extended subtrees with raw source ranges', () => {
    const source = '<dl>\n<dt>Term</dt><dd>Definition</dd>\n</dl>\n\nAfter {{ n }}';
    const parsed = parseLocal(source);
    expect(parsed.diagnostics).toEqual([]);
    const raw = of(parsed.nodes, 'extendedHtmlRaw');
    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({ range: { start: 0, end: source.indexOf('</dl>') + 5 } });
    expect(raw[0].value).toBe(source.slice(0, raw[0].range.end));
    expect(of(parsed.nodes, 'interpolation')[0].value).toBe('n');
  });

  it('keeps iframe bodies as raw text until their real close tag', () => {
    const source = '<iframe title="嵌入样例" srcdoc="<p>嵌入样例</p>"></iframe>\n\nAfter';
    const parsed = parseLocal(source);
    const raw = of(parsed.nodes, 'extendedHtmlRaw')[0];
    expect(raw.value).toBe('<iframe title="嵌入样例" srcdoc="<p>嵌入样例</p>"></iframe>');
  });

  it('keeps basic HTML and registered RMD components ahead of extended names', () => {
    const source = '<p>Basic</p>\n\n<section color="#123">Body</section>\n\n<input bind="n" label="N">';
    const parsed = parseLocal(source);
    expect(of(parsed.nodes, 'extendedHtmlRaw')).toEqual([]);
    const all = flatten(parsed.nodes);
    expect(all.some(n => n.type === 'paragraph')).toBe(true);
    expect(all.filter(n => n.type === 'component').map(n => n.name)).toEqual(['section', 'input']);
  });

  it('keeps an unpaired extended opening from consuming later nodes', () => {
    const source = '<dl>\n<dt>Term</dt>\n\n<counter bind="n" label="Count">';
    const parsed = parseLocal(source);
    expect(of(parsed.nodes, 'extendedHtmlRaw')).toEqual([]);
    expect(of(parsed.nodes, 'fallback')[0].value).toBe('<dl>\n<dt>Term</dt>');
    expect(of(parsed.nodes, 'component').map(n => n.name)).toEqual(['counter']);
  });

  it('keeps extended syntax inside code and ordinary prose literal', () => {
    const source = '`<iframe></iframe>`\n\n```html\n<dl><dt>Term</dt></dl>\n```\n\nUse <dl> as an example.';
    const parsed = parseLocal(source);
    expect(of(parsed.nodes, 'extendedHtmlRaw')).toEqual([]);
    expect(of(parsed.nodes, 'inlineCode')[0].value).toBe('<iframe></iframe>');
    expect(parsed.diagnostics.every(d => d.severity === 'warning')).toBe(true);
  });

  it('does not preprocess text inside either kind of raw block', () => {
    const source = '<css>a::before { content: "\\201C <x>  "</css>\n\n<javascript>const s = "<div>"</javascript>';
    const parsed = parseLocal(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(of(parsed.nodes, 'authorCss')[0].value).toBe('a::before { content: "\\201C <x>  "');
    expect(of(parsed.nodes, 'authorJavaScript')[0].value).toBe('const s = "<div>"');
    expect(codes(source)).toEqual([]);
  });
});
