import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CodeBlockView, MAX_HIGHLIGHT_CHARS } from '../src/local/code-block';
import { LocalLocaleProvider, type LocalLocale } from '../src/local/i18n';

function render(
  value: string,
  language?: string,
  mode: 'interactive' | 'static' = 'interactive',
  locale: LocalLocale = 'en',
): string {
  return renderToStaticMarkup(
    <LocalLocaleProvider locale={locale}>
      <CodeBlockView value={value} language={language} mode={mode} />
    </LocalLocaleProvider>,
  );
}

function decodeText(value: string): string {
  return value
    .replace(/<!--.*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function codeMarkup(html: string): string {
  const match = /<pre class="md-code">\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/.exec(html);
  if (match === null) throw new Error('Rendered markup has no code block');
  return match[1];
}

function codeText(html: string): string {
  return decodeText(codeMarkup(html));
}

describe('CodeBlockView highlighting', () => {
  it('highlights JavaScript and preserves every whitespace character', () => {
    const value = 'function greet(name) {\n\tconst message = `Hello, ${name}!`;\n\treturn message;\n}\n';
    const html = render(value, 'js');

    expect(html).toContain('hljs-keyword');
    expect(html).toContain('class="hljs language-js"');
    expect(codeText(html)).toBe(value);
  });

  it('renders only text and span nodes inside the code element', () => {
    const html = render('<div class="x">hi</div>', 'html');
    const tags = [...codeMarkup(html).matchAll(/<([a-zA-Z][\w-]*)/g)].map((match) => match[1]);
    expect(new Set(tags)).toEqual(new Set(['span']));
  });

  it.each([
    ['js', 'const x = 1;'],
    ['javascript', 'const x = 1;'],
    ['jsx', 'const x = 1;'],
    ['language-js', 'const x = 1;'],
    ['ts', 'interface A { x: number }'],
    ['typescript', 'interface A { x: number }'],
    ['py', 'def f():\n    return 1'],
    ['python', 'def f():\n    return 1'],
    ['json', '{"a": 1}'],
    ['jsonc', '{"a": 1}'],
    ['bash', 'if true; then echo ok; fi'],
    ['sh', 'if true; then echo ok; fi'],
    ['shell', 'if true; then echo ok; fi'],
    ['html', '<div>hi</div>'],
    ['xml', '<div>hi</div>'],
    ['css', 'body { color: red; }'],
    ['latex', String.raw`\begin{aligned}x&=\frac{a}{b}\end{aligned}`],
    ['tex', String.raw`\frac{a}{b} % comment`],
    ['cattca', '</let hp = 100; if hp > 0 -> goto start;/>'],
    ['mermaid', 'flowchart TD\n  A[Start] --> B[End]\n%% comment'],
    ['jinja', '{% for user in users %}{{ user.name }}{% endfor %}'],
    ['jinja2', '{% if user %}{{ user.name }}{% endif %}'],
    ['dockerfile', 'FROM node:22\nWORKDIR /app\nRUN npm ci'],
    ['docker', 'FROM node:22\nRUN npm ci'],
    ['vue', '<template><p>{{ count + 1 }}</p></template>\n<script setup lang="ts">const count: number = 1;</script>'],
  ])('highlights the %s alias', (language, value) => {
    const html = render(value, language);
    expect(html).toContain('hljs-');
    expect(codeText(html)).toBe(value);
  });

  it('keeps an unknown language as plain text', () => {
    const value = 'not quite a language';
    const html = render(value, 'brainfuck');

    expect(html).not.toContain('hljs-');
    expect(codeText(html)).toBe(value);
  });

  it('keeps code without a language as plain text and labels it', () => {
    const value = '  keep\n    this exactly\n';
    const html = render(value);

    expect(html).not.toContain('hljs-');
    expect(html).toContain('>Text</span>');
    expect(codeText(html)).toBe(value);
  });

  it.each([undefined, '', '  '])('detects unlabeled code with language=%s', language => {
    const value = 'function greet(name) {\n  const result = `Hello ${name}`;\n  return result;\n}\n';
    const html = render(value, language);
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('language-');
    expect(codeText(html)).toBe(value);
  });

  it.each(['text', 'txt', 'plaintext', 'plain', 'nohighlight'])('keeps explicit %s blocks plain', language => {
    const value = 'function greet() { return true; }';
    const html = render(value, language);
    expect(html).not.toContain('hljs-keyword');
    expect(codeText(html)).toBe(value);
  });

  it('highlights Vue script, styles, directives and interpolations', () => {
    const value = '<template><button v-if="ready" @click="count++">{{ count + 1 }}</button></template>\n<script setup lang="ts">interface State { count: number }\nconst ready = true;</script>\n<style scoped>.button { color: red; }</style>';
    const html = render(value, 'vue');
    expect(html).toContain('hljs-tag');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('hljs-number');
    expect(html).toContain('hljs-attribute');
    expect(codeText(html)).toBe(value);
  });

  it('highlights Cattca commands inside blocks and Markdown outside them', () => {
    const value = '# Story\nYou say let and goto.\n</let hp = 100; /* test */ input case: "Go" -> goto start;/>\n**Continue**';
    const html = render(value, 'cattca');
    expect(html).toContain('hljs-section');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('hljs-string');
    expect(html).toContain('hljs-comment');
    expect(html).toContain('You say let and goto.');
    expect(codeText(html)).toBe(value);
  });

  it('leaves oversized sources unhighlighted', () => {
    const value = 'const x = 1;\n'.repeat(Math.ceil((MAX_HIGHLIGHT_CHARS + 1) / 13));
    expect(value.length).toBeGreaterThan(MAX_HIGHLIGHT_CHARS);

    const html = render(value, 'js');
    expect(html).not.toContain('hljs-');
    expect(codeText(html)).toBe(value);
    expect(render(value)).not.toContain('hljs-keyword');
  });

  it('renders empty code without failing', () => {
    const html = render('', 'js');
    expect(html).not.toContain('hljs-');
    expect(codeText(html)).toBe('');
  });
});

describe('CodeBlockView safety', () => {
  it('never emits source HTML or attributes', () => {
    const value = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const html = render(value, 'html');

    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(codeText(html)).toBe(value);
    const detected = render(value);
    expect(detected).not.toContain('<img');
    expect(detected).not.toContain('<script');
    expect(codeText(detected)).toBe(value);
  });

  it('does not put an unsafe language string into a class', () => {
    const html = render('const x = 1;', '"><script>alert(1)</script>');

    expect(html).not.toContain('<script');
    expect(html).not.toContain('language-');
  });
});

describe('CodeBlockView modes', () => {
  it('renders copy controls in interactive mode', () => {
    const html = render('const x = 1;', 'js', 'interactive');

    expect(html).toContain('<button');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Copy code"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('>Copy</button>');
    expect(html).toContain('hljs-keyword');
  });

  it('keeps highlighting but drops copy controls in static mode', () => {
    const html = render('const x = 1;', 'js', 'static');

    expect(html).not.toContain('<button');
    expect(html).not.toContain('aria-live');
    expect(html).not.toContain('role="status"');
    expect(html).toContain('hljs-keyword');
    expect(codeText(html)).toBe('const x = 1;');
  });

  it('localizes the label and copy control for Chinese', () => {
    const html = render('ordinary prose', undefined, 'interactive', 'zh');

    expect(html).toContain('>文本</span>');
    expect(html).toContain('aria-label="复制代码"');
    expect(html).toContain('>复制</button>');
  });
});

describe('CodeBlockView stylesheet', () => {
  const css = readFileSync(new URL('../src/local/code-block.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('scopes every selector to .md-document', () => {
    const selectors = [...css.matchAll(/([^{}]+)\{/g)]
      .map((match) => match[1].trim())
      .filter((selector) => selector !== '' && !selector.startsWith('@'))
      .flatMap((selector) => selector.split(',').map((part) => part.trim()));

    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector.startsWith('.md-document ')).toBe(true);
    }
  });

  it('gives the copy button a 44px hit area and hides the toolbar in print', () => {
    expect(css).toContain('min-width: 44px');
    expect(css).toContain('min-height: 44px');
    expect(css).toContain('@media print');
    expect(css).toContain('.md-document .md-code-block-toolbar');
  });
});
