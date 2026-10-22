import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import { LocalDocumentView } from '../src/local/LocalDocumentView';
import type { LocalDocument } from '../src/local/types';

function plain(html: string): string {
  return html
    .replace(/<!--.*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mount(source: string): { html: string; text: string } {
  const result = compileLocal(source);
  if (!result.ok) {
    throw new Error(result.diagnostics.map((item) => item.message).join('；'));
  }
  const runtime = createLocalRuntime(result.document);
  try {
    const html = renderToStaticMarkup(
      <LocalDocumentView document={result.document} runtime={runtime} />,
    );
    return { html, text: plain(html) };
  } finally {
    runtime.dispose();
  }
}

function fallbackMarkup(html: string): string[] {
  return [...html.matchAll(/<span[^>]*class="local-fallback[^"]*"[^>]*>([\s\S]*?)<\/span>/g)]
    .map((match) => match[1]);
}

function expectInert(pieces: string[]): void {
  for (const piece of pieces) {
    expect(piece).not.toMatch(/<(?:input|button|select|textarea|option|a|script|img|iframe)\b/i);
  }
}

describe('fallback source rendering', () => {
  it('keeps surrounding text and controls around an unknown tag region', () => {
    const { html, text } = mount(
      '开头段落。\n\n' +
        '<unknown-widget mode="demo">\n内部 **粗体** {{ 1 + 1 }}\n</unknown-widget>\n\n' +
        '结尾段落。\n\n' +
        '<slider bind="people" label="人数" min="1" max="20">\n',
    );

    expect(text).toContain('开头段落');
    expect(text).toContain('结尾段落');
    expect(html).toContain('type="range"');
    expect(html).toContain('人数');

    const pieces = fallbackMarkup(html);
    expect(pieces.length).toBeGreaterThan(0);
    const source = pieces.join('\n');
    // The full original region is present and React-escaped as text.
    expect(source).toContain('&lt;unknown-widget');
    expect(source).toContain('mode=');
    expect(source).toContain('demo');
    expect(source).toContain('内部 **粗体** {{ 1 + 1 }}');
    expect(source).toContain('&lt;/unknown-widget&gt;');
    // Present but not interpreted: no bold element, no evaluated expression.
    expect(source).not.toContain('<strong');
    expectInert(pieces);
  });

  it('escapes scripts and event attributes instead of executing them', () => {
    const { html } = mount(
      '<mystery-box>\n' +
        '<script>alert("boom")</script>\n' +
        '<img src=x onerror="alert(1)">\n' +
        '</mystery-box>\n\n' +
        '后文。\n',
    );

    const pieces = fallbackMarkup(html);
    expect(pieces.length).toBeGreaterThan(0);
    const source = pieces.join('\n');
    expect(source).toContain('&lt;script&gt;');
    expect(source).toContain('alert(&quot;boom&quot;)');
    expect(source).toContain('&lt;img');
    expect(source).toContain('onerror=');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(plain(html)).toContain('后文');
    expectInert(pieces);
  });

  it('keeps footnote references and definitions visible without duplicating them', () => {
    const { html, text } = mount(
      '前文[^note] 后文。\n\n' +
        '[^note]: 脚注定义 {{ 1 + 1 }} <b>原样</b>\n\n' +
        '<toggle label="开关">\n',
    );

    expect(text).toContain('前文');
    expect(text).toContain('后文');
    expect(html).toContain('md-toggle');
    expect(html).toContain('开关');

    const pieces = fallbackMarkup(html);
    expect(pieces.length).toBeGreaterThan(0);
    const source = pieces.join('\n');
    expect(source).toContain('[^note]');
    expect(source).toContain('脚注定义 {{ 1 + 1 }} &lt;b&gt;原样&lt;/b&gt;');
    expect(source).not.toContain('<b>');
    // One inline reference plus the definition prefix; nothing is shown twice.
    expect((html.match(/\[\^note\]/g) ?? []).length).toBe(2);
    expect((html.match(/脚注定义/g) ?? []).length).toBe(1);
    expect(html).toContain('local-fallback-inline');
    expectInert(pieces);
  });

  it('renders a fallback nested in a card without losing the card or its controls', () => {
    const { html, text } = mount(
      '<card title="示例卡片">\n\n' +
        '卡片正文。\n\n' +
        '<vendor-widget data-x="1">\n内部源码\n</vendor-widget>\n\n' +
        '<counter label="计数" initial="1" min="0" max="5">\n\n' +
        '</card>\n',
    );

    expect(html).toContain('md-card');
    expect(html).toContain('示例卡片');
    expect(text).toContain('卡片正文');
    expect(html).toContain('计数');
    expect(html).toContain('aria-label="计数 增加"');

    const pieces = fallbackMarkup(html);
    expect(pieces.length).toBeGreaterThan(0);
    const source = pieces.join('\n');
    expect(source).toContain('vendor-widget');
    expect(source).toContain('data-x=');
    expect(source).toContain('内部源码');
    expectInert(pieces);
  });

  it('renders a bare fallback node as inert block text and preserves newlines', () => {
    const value = '<script>alert(1)</script>\n第二行 {{ 1 + 1 }}';
    const document: LocalDocument = {
      syntax: 'local',
      source: value,
      nodes: [{ type: 'fallback', id: 'fallback-1', range: { start: 0, end: value.length }, value }],
      initialState: {},
      bindings: {},
    };
    const runtime = createLocalRuntime(document);
    try {
      const html = renderToStaticMarkup(
        <LocalDocumentView document={document} runtime={runtime} />,
      );
      expect(html).toContain('local-fallback-block');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;\n第二行 {{ 1 + 1 }}');
      expect(html).not.toContain('<script');
      expect(html).not.toContain('<pre');
      expect(html).not.toContain('<div class="local-fallback');
      expect(fallbackMarkup(html).every((piece) => !/<[a-z]/i.test(piece))).toBe(true);
    } finally {
      runtime.dispose();
    }
  });

  it('still supports an inline fallback inside a paragraph', () => {
    const document: LocalDocument = {
      syntax: 'local',
      source: 'x',
      nodes: [
        {
          type: 'paragraph',
          id: 'p-1',
          range: { start: 0, end: 1 },
          children: [
            { type: 'text', id: 't-1', range: { start: 0, end: 0 }, value: '前' },
            { type: 'fallback', id: 'f-1', range: { start: 0, end: 0 }, value: '[^x]' },
            { type: 'text', id: 't-2', range: { start: 1, end: 1 }, value: '后' },
          ],
        },
      ],
      initialState: {},
      bindings: {},
    };
    const runtime = createLocalRuntime(document);
    try {
      const html = renderToStaticMarkup(
        <LocalDocumentView document={document} runtime={runtime} />,
      );
      expect(html).toContain('<p>');
      expect(html).toContain('local-fallback-inline');
      expect(html).not.toContain('local-fallback-block');
      expect(fallbackMarkup(html)).toEqual(['[^x]']);
      expect(plain(html)).toBe('前 [^x] 后');
      expect(html).not.toContain('<pre');
    } finally {
      runtime.dispose();
    }
  });
});
