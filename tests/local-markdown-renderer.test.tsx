import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createLocalRuntime } from '../src/local/runtime';
import { LocalDocumentView } from '../src/local/LocalDocumentView';
import type { LocalDocument, LocalNode } from '../src/local/types';

/** Footnote identity fields are optional so hand-built trees stay usable. */
type FootnoteFields = { identifier?: string; label?: string };

function node(
  type: string,
  id: string,
  extra: Omit<Partial<LocalNode>, 'type' | 'id'> & FootnoteFields = {},
): LocalNode {
  return { type, id, range: { start: 0, end: 0 }, ...extra } as LocalNode;
}

const text = (id: string, value: string): LocalNode => node('text', id, { value });
const paragraph = (id: string, ...children: LocalNode[]): LocalNode =>
  node('paragraph', id, { children });
const reference = (id: string, identifier: string, label?: string): LocalNode =>
  node('footnoteReference', id, label ? { identifier, label } : { identifier });
const definition = (id: string, identifier: string, ...children: LocalNode[]): LocalNode =>
  node('footnoteDefinition', id, { identifier, children });

function makeDocument(nodes: LocalNode[]): LocalDocument {
  return { syntax: 'local', source: '', nodes, initialState: {}, bindings: {} };
}

function renderDocument(document: LocalDocument, mode: 'static' | 'interactive' = 'interactive'): string {
  const runtime = createLocalRuntime(document);
  try {
    return renderToStaticMarkup(
      <LocalDocumentView document={document} runtime={runtime} mode={mode} />,
    );
  } finally {
    runtime.dispose();
  }
}

function plain(html: string): string {
  return html
    .replace(/<!--.*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function ids(html: string): string[] {
  return [...html.matchAll(/\bid="([^"]*)"/g)].map((match) => match[1]);
}

function fragments(html: string): string[] {
  return [...html.matchAll(/\bhref="#([^"]*)"/g)].map((match) => match[1]);
}

function endnoteNumbers(html: string): string[] {
  return [...html.matchAll(/<li[^>]*\bdata-local-footnote-number="(\d+)"/g)].map(
    (match) => match[1],
  );
}

function referenceNumbers(html: string): string[] {
  return [...html.matchAll(/\bdata-local-footnote-number="(\d+)"/g)].map((match) => match[1]);
}

function expectResolvedFragments(html: string): void {
  const available = ids(html);
  for (const fragment of fragments(html)) expect(available).toContain(fragment);
}

describe('footnote rendering', () => {
  it('renders a numbered superscript reference and one endnote section', () => {
    const html = renderDocument(
      makeDocument([
        paragraph('p-1', text('t-1', '正文'), reference('r-1', 'alpha'), text('t-2', '。')),
        definition('d-1', 'alpha', paragraph('dp-1', text('dt-1', '脚注内容'))),
      ]),
    );

    expect(html).toContain('<sup');
    expect(html).toContain('role="doc-noteref"');
    expect(html).toContain('role="doc-endnotes"');
    expect(html).toContain('role="doc-backlink"');
    expect(html).toContain('<ol');
    expect(html).toContain('<li');
    expect(html).toContain('aria-labelledby');
    expect(html).toContain('>Footnotes<');
    expect(html).toContain('aria-label="Footnote 1"');
    expect(endnoteNumbers(html)).toEqual(['1']);
    expect(plain(html)).toContain('脚注内容');
    // The definition is not repeated where it was authored.
    expect((html.match(/脚注内容/g) ?? []).length).toBe(1);
    expectResolvedFragments(html);
    expect(new Set(ids(html)).size).toBe(ids(html).length);
  });

  it('numbers by first reference, not by definition order', () => {
    const html = renderDocument(
      makeDocument([
        definition('d-second', 'second', paragraph('ds', text('ts', '第二条'))),
        definition('d-first', 'first', paragraph('df', text('tf', '第一条'))),
        paragraph('p-1', reference('r-1', 'first')),
        paragraph('p-2', reference('r-2', 'second')),
      ]),
    );

    expect(endnoteNumbers(html)).toEqual(['1', '2']);
    const firstBody = html.indexOf('第一条');
    const secondBody = html.indexOf('第二条');
    expect(firstBody).toBeGreaterThan(-1);
    expect(secondBody).toBeGreaterThan(firstBody);
  });

  it('shares one number across repeats and returns to every reference', () => {
    const html = renderDocument(
      makeDocument([
        paragraph(
          'p-1',
          text('t-1', '甲'),
          reference('r-1', 'alpha'),
          text('t-2', '乙'),
          reference('r-2', 'alpha'),
          text('t-3', '丙'),
        ),
        definition('d-1', 'alpha', paragraph('dp-1', text('dt-1', '重复脚注'))),
      ]),
    );

    expect(endnoteNumbers(html)).toEqual(['1']);
    // Two body references plus the list item itself.
    expect(referenceNumbers(html).filter((number) => number === '1').length).toBe(3);
    const backlinks = html.match(/<a\b[^>]*role="doc-backlink"[^>]*>/g) ?? [];
    expect(backlinks.length).toBe(2);
    const refIds = ids(html).filter((id) => id.includes('-fnref-'));
    expect(refIds.length).toBe(2);
    expect(new Set(refIds).size).toBe(2);
    for (const backlink of backlinks) {
      expect(refIds.some((id) => backlink.includes(`href="#${id}"`))).toBe(true);
    }
    expectResolvedFragments(html);
  });

  it('keeps an undefined reference as its original source text', () => {
    const html = renderDocument(
      makeDocument([
        paragraph(
          'p-1',
          text('t-1', '前文'),
          reference('r-1', 'missing', 'Missing Note'),
          text('t-2', '后文'),
        ),
      ]),
    );

    expect(html).toContain('local-footnote-missing');
    expect(html).toContain('[^Missing Note]');
    expect(html).not.toContain('role="doc-endnotes"');
    expect(html).not.toContain('role="doc-noteref"');
    expect(plain(html)).toContain('前文 [^Missing Note] 后文');
  });

  it('omits definitions that no reference reaches', () => {
    const html = renderDocument(
      makeDocument([
        paragraph('p-1', reference('r-1', 'used')),
        definition('d-used', 'used', paragraph('du', text('tu', '被引用'))),
        definition('d-orphan', 'orphan', paragraph('do', text('to', '孤立脚注'))),
      ]),
    );

    expect(endnoteNumbers(html)).toEqual(['1']);
    expect(plain(html)).toContain('被引用');
    expect(plain(html)).not.toContain('孤立脚注');
  });

  it('keeps the first of duplicate definitions and renders it once', () => {
    const html = renderDocument(
      makeDocument([
        paragraph('p-1', reference('r-1', 'dup'), text('t-1', '与'), reference('r-2', 'dup')),
        definition('d-1', 'dup', paragraph('dp-1', text('dt-1', '第一条定义'))),
        definition('d-2', 'dup', paragraph('dp-2', text('dt-2', '第二条定义'))),
      ]),
    );

    expect(endnoteNumbers(html)).toEqual(['1']);
    expect(plain(html)).toContain('第一条定义');
    expect(plain(html)).not.toContain('第二条定义');
    expect((html.match(/第一条定义/g) ?? []).length).toBe(1);
  });

  it('collects references and definitions inside layout containers', () => {
    const html = renderDocument(
      makeDocument([
        node('component', 'card-1', {
          name: 'card',
          children: [paragraph('cp-1', text('ct-1', '卡片'), reference('cr-1', 'inside'))],
        }),
        node('blockquote', 'quote-1', {
          children: [paragraph('bp-1', text('bt-1', '引用'), reference('br-1', 'inside'))],
        }),
        node('component', 'card-2', {
          name: 'card',
          children: [definition('nested-def', 'inside', paragraph('np-1', text('nt-1', '容器内定义')))],
        }),
      ]),
    );

    expect(html).toContain('md-card');
    expect(html).toContain('<blockquote>');
    expect((html.match(/role="doc-noteref"/g) ?? []).length).toBe(2);
    expect(endnoteNumbers(html)).toEqual(['1']);
    expect(plain(html)).toContain('容器内定义');
    expect((html.match(/容器内定义/g) ?? []).length).toBe(1);
    expectResolvedFragments(html);
  });

  it('renders multi-block and formatted definition content', () => {
    const html = renderDocument(
      makeDocument([
        paragraph('p-1', reference('r-1', 'rich')),
        definition(
          'd-1',
          'rich',
          paragraph(
            'dp-1',
            text('dpt-1', '首段'),
            node('strong', 'strong-1', { children: [text('st-1', '加粗')] }),
            node('underline', 'u-1', { children: [text('ut-1', '下划线')] }),
            node('link', 'l-1', {
              url: 'https://example.com/docs',
              children: [text('lt-1', '链接')],
            }),
          ),
          paragraph('dp-2', text('dpt-2', '第二段')),
          node('list', 'list-1', {
            ordered: false,
            children: [
              node('listItem', 'li-1', { children: [paragraph('lp-1', text('lt-2', '列表项'))] }),
            ],
          }),
        ),
      ]),
    );

    expect(html).toContain('<strong><span>加粗</span></strong>');
    expect(html).toContain('<u><span>下划线</span></u>');
    expect(html).toContain('href="https://example.com/docs"');
    expect(plain(html)).toContain('第二段');
    expect(html).toContain('<ul');
    expect(plain(html)).toContain('列表项');
    expectResolvedFragments(html);
  });

  it('gives two documents on one page distinct ids and resolved links', () => {
    const document = makeDocument([
      paragraph('p-1', reference('r-1', 'shared')),
      definition('d-1', 'shared', paragraph('dp-1', text('dt-1', '共享定义'))),
    ]);
    const first = createLocalRuntime(document);
    const second = createLocalRuntime(document);
    try {
      const html = renderToStaticMarkup(
        <div>
          <LocalDocumentView document={document} runtime={first} />
          <LocalDocumentView document={document} runtime={second} />
        </div>,
      );
      const allIds = ids(html);
      expect(new Set(allIds).size).toBe(allIds.length);
      expect((html.match(/role="doc-noteref"/g) ?? []).length).toBe(2);
      expectResolvedFragments(html);
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  it('never turns a hostile label into markup or a DOM id', () => {
    const hostile = 'x"><img src=x onerror="alert(1)">';
    const html = renderDocument(
      makeDocument([
        paragraph(
          'p-1',
          reference('r-1', hostile, hostile),
          reference('r-2', 'absent', '坏<script>alert(2)</script>'),
        ),
        definition('d-1', hostile, paragraph('dp-1', text('dt-1', '安全正文'))),
      ]),
    );

    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('onerror=');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('安全正文');
    for (const id of ids(html)) {
      expect(id).not.toMatch(/[<>"'`\s]/);
      expect(id.toLowerCase()).not.toContain('script');
      expect(id.toLowerCase()).not.toContain('img');
    }
    expectResolvedFragments(html);
  });

  it('renders the same footnote structure in static mode', () => {
    const document = makeDocument([
      paragraph('p-1', reference('r-1', 'alpha')),
      definition('d-1', 'alpha', paragraph('dp-1', text('dt-1', '静态脚注'))),
    ]);
    const staticHtml = renderDocument(document, 'static');
    const interactiveHtml = renderDocument(document, 'interactive');

    for (const html of [staticHtml, interactiveHtml]) {
      expect(html).toContain('role="doc-noteref"');
      expect(html).toContain('role="doc-endnotes"');
      expect(html).toContain('role="doc-backlink"');
      expect(plain(html)).toContain('静态脚注');
      expectResolvedFragments(html);
    }
    expect(staticHtml).toContain('data-render-mode="static"');
  });

  it('survives mutually recursive definitions without recursing forever', () => {
    const html = renderDocument(
      makeDocument([
        paragraph('p-1', reference('r-top', 'a')),
        definition(
          'd-a',
          'a',
          paragraph('ap-1', reference('r-a-self', 'a'), reference('r-a-b', 'b')),
        ),
        definition('d-b', 'b', paragraph('bp-1', reference('r-b-a', 'a'))),
      ]),
    );

    expect(endnoteNumbers(html)).toEqual(['1', '2']);
    expect((html.match(/role="doc-endnotes"/g) ?? []).length).toBe(1);
    expect((html.match(/role="doc-backlink"/g) ?? []).length).toBe(4);
    expectResolvedFragments(html);
  });

  it('renders basic HTML formatting as plain React tags without attributes', () => {
    const html = renderDocument(
      makeDocument([
        paragraph(
          'p-1',
          node('underline', 'u-1', {
            attrs: { onclick: 'alert(1)', style: 'color:red' },
            children: [text('ut-1', '下划线')],
          }),
          node('mark', 'm-1', {
            attrs: { onmouseover: 'alert(1)' },
            children: [text('mt-1', '高亮')],
          }),
        ),
      ]),
    );

    expect(html).toContain('<u><span>下划线</span></u>');
    expect(html).toContain('<mark><span>高亮</span></mark>');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('onmouseover');
    expect(html).not.toContain('color:red');
    expect(html).not.toContain('local-fallback');
  });
});
