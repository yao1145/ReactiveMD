import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileLocal } from '../src/local/compiler';
import { parseLocal } from '../src/local/parser';
import { createLocalRuntime } from '../src/local/runtime';
import { LocalDocumentView } from '../src/local/LocalDocumentView';
import type { LocalNode } from '../src/local/types';

const flatten = (nodes: LocalNode[]): LocalNode[] => nodes.flatMap(n => [n, ...flatten(n.children ?? [])]);
const formulas = (nodes: LocalNode[]) => flatten(nodes).filter(n => n.type === 'math' || n.type === 'inlineMath');

describe('space-padded dollar math', () => {
  it.each(['$ x $', '$x $', '$ x$', '$\tx + y\t$', '$ \\frac{a}{b} $', '$2 sin x$', '$2 sin x $'])(
    'parses and renders inline math while preserving source whitespace: %s', source => {
      const result = compileLocal(source);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.diagnostics).toEqual([]);
      const [math] = formulas(result.document.nodes);
      expect(math).toMatchObject({type: 'inlineMath', value: source.slice(1, -1), range: {start: 0, end: source.length}});
      const runtime = createLocalRuntime(result.document);
      try {
        const html = renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} />);
        expect(html).toContain('display="inline"');
        expect(html).toContain('application/x-tex');
      } finally { runtime.dispose(); }
    },
  );

  it('retains diagnostic offsets after leading whitespace and emoji', () => {
    const source = '😀 $  x+\\unknown  $';
    const issue = compileLocal(source).diagnostics.find(d => d.code === 'local.math.display');
    expect(issue).toBeDefined();
    expect(source.slice(issue!.range.start, issue!.range.end)).toBe('\\unknown');
  });

  it.each(['$ $', '$\t $', '$ x\ny $', '$ x\r\ny $', '价格 $5 and $10', '价格 $5 $10'])(
    'keeps empty, multiline and currency text literal: %s', source => {
      const result = parseLocal(source);
      expect(result.diagnostics).toEqual([]);
      expect(formulas(result.nodes)).toEqual([]);
    },
  );

  it('supports adjacent padded formulas inside formatting and leaves code literal', () => {
    const result = parseLocal('**$ x $** and $ y $ and `$ z $`');
    expect(result.diagnostics).toEqual([]);
    expect(formulas(result.nodes).map(n => n.value)).toEqual([' x ', ' y ']);
  });

  it.each(['价格 $5、$10，函数 $ x^2 $', 'Costs $5 and $10, then $ x^2 $'])(
    'keeps prices separate from later padded math: %s', source => {
      const result = parseLocal(source);
      expect(result.diagnostics).toEqual([]);
      expect(formulas(result.nodes).map(n => n.value)).toEqual([' x^2 ']);
    },
  );
});

describe('backslash LaTeX delimiters', () => {
  it('parses inline and display delimiters without rewriting original source ranges', () => {
    const source = String.raw`前文 \(\frac{a}{b}\) 后文。

\[
x^2 + y^2
\]`;
    const result = compileLocal(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
    const math = formulas(result.document.nodes);
    expect(math.map(n => n.type)).toEqual(['inlineMath', 'math']);
    expect(math.map(n => n.value?.trim())).toEqual([String.raw`\frac{a}{b}`, 'x^2 + y^2']);
    expect(source.slice(math[0].range.start, math[0].range.end)).toBe(String.raw`\(\frac{a}{b}\)`);
    expect(source.slice(math[1].range.start, math[1].range.end)).toBe('\\[\nx^2 + y^2\n\\]');
    const runtime = createLocalRuntime(result.document);
    try {
      const markup = renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} />);
      expect((markup.match(/<math\b/g) ?? [])).toHaveLength(2);
      expect(markup).toContain('<mfrac>');
      expect(markup).toContain('display="inline"');
      expect(markup).toContain('display="block"');
    } finally { runtime.dispose(); }
  });

  it('works inside Markdown, HTML and ReactiveMD containers alongside dollar math', () => {
    const source = String.raw`<card>
**Inline \(a+b\)** and $c$.

<div align="center">\[d^2\]</div>

$$e^2$$
</card>`;
    const result = compileLocal(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
    expect(formulas(result.document.nodes).map(n => n.value)).toEqual(['a+b', 'c', 'd^2', 'e^2']);
  });

  it('shields code, escaped delimiters, comments and literal HTML code', () => {
    const source = [String.raw`\\(literal\\)`, '`\\(code\\)`',
      '```tex\n\\[fenced\\]\n```', '<!-- \\(comment\\) -->', '<pre>\\[pre\\]</pre>',
      String.raw`\\[escaped\\]`].join('\n\n');
    const result = parseLocal(source);
    expect(result.diagnostics).toEqual([]);
    expect(formulas(result.nodes)).toEqual([]);
  });

  it('keeps escaped closing markers inside the formula body', () => {
    const source = String.raw`\(a \\) + b\)`;
    const result = parseLocal(source);
    expect(result.diagnostics).toEqual([]);
    expect(formulas(result.nodes).map(n => n.value)).toEqual([String.raw`a \\) + b`]);
  });

  it('keeps escaped brackets in Markdown destinations literal', () => {
    const source = String.raw`[Link](https://example.com/\(part\))

![Image](images/\[photo.png)

<card>
[Nested](docs/\(intro\))
</card>

<div>
[HTML nested](docs/\(html\))
</div>`;
    const result = parseLocal(source);
    expect(result.diagnostics).toEqual([]);
    expect(formulas(result.nodes)).toEqual([]);
    expect(flatten(result.nodes).filter(n => n.type === 'link' || n.type === 'image').map(n => n.url))
      .toEqual(['https://example.com/(part)', 'images/[photo.png', 'docs/(intro)', 'docs/(html)']);
  });

  it.each([String.raw`\(unclosed`, String.raw`\[unclosed`])('reports an unclosed opener: %s', source => {
    expect(compileLocal(source).diagnostics.some(d => d.code === 'local.math.unclosed')).toBe(true);
  });

  it.each([['\\(', '\\)'], ['\\[', '\\]']])('locates display diagnostics after %s', (open, close) => {
    const source = `😀 before ${open}a+\\unknown{x}${close}`;
    const issue = compileLocal(source).diagnostics.find(d => d.code === 'local.math.display');
    expect(issue).toBeDefined();
    expect(source.slice(issue!.range.start, issue!.range.end)).toBe('\\unknown');
  });

  it('preserves the display source-length budget', () => {
    const result = compileLocal('\\[' + 'x'.repeat(50_001) + '\\]');
    expect(result.diagnostics.some(d => d.code === 'local.budget.math')).toBe(true);
  });

  it('keeps plot restricted to dollar display blocks', () => {
    expect(compileLocal('<plot min="0" max="1">\\[y=x\\]</plot>').ok).toBe(false);
    expect(compileLocal('<plot min="0" max="1">$$y=x$$</plot>').ok).toBe(true);
  });

  it('supports inline formulas in link labels and retains CRLF offsets', () => {
    const source = '[Math \\(x^2\\)](https://example.com)\r\n\r\n\\[\r\na+\\unknown\r\n\\]';
    const result = compileLocal(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(formulas(result.document.nodes).map(n => n.type)).toEqual(['inlineMath', 'math']);
    const issue = result.diagnostics.find(d => d.code === 'local.math.display')!;
    expect(source.slice(issue.range.start, issue.range.end)).toBe('\\unknown');
    expect(issue.line).toBe(4);
  });

  it('keeps native HTML mode literal', () => {
    const result = compileLocal('<p>\\(x\\)</p>\\[y\\]', { enableCss: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.html).toBeDefined();
    expect(formulas(result.document.nodes)).toEqual([]);
  });
});
