import { describe, expect, it } from 'vitest';
import { compileLocal, type LocalDocument } from 'reactive-md';
import { documentOutline, flattenOutline, outlineHeadingAt } from '../src/document-outline-model';

function outline(source: string) {
  const result = compileLocal(source);
  expect(result.ok).toBe(true);
  return documentOutline((result as { ok: true; document: LocalDocument }).document);
}

describe('document outline', () => {
  it('builds the heading hierarchy, including skipped levels and multiple roots', () => {
    const roots = outline('# Root\n\n### Child\n\n#### Grandchild\n\n## Sibling\n\n# Next');
    expect(roots.map(item => item.title)).toEqual(['Root', 'Next']);
    expect(roots[0].children.map(item => item.title)).toEqual(['Child', 'Sibling']);
    expect(roots[0].children[0].children[0].title).toBe('Grandchild');
    expect(flattenOutline(roots).map(item => item.depth)).toEqual([1, 3, 4, 2, 1]);
  });

  it('uses parsed headings and readable inline text, including Setext and nested headings', () => {
    const roots = outline('# **Bold** and `code` [link](https://example.com)\n\nSetext\n------\n\n> ### Quoted\n\n```md\n# Code\n```\n\n\\# Escaped');
    expect(flattenOutline(roots).map(item => item.title)).toEqual(['Bold and code link', 'Setext', 'Quoted']);
  });

  it('keeps duplicate titles distinct and preserves their source ranges', () => {
    const source = '# Same\r\n\r\n## Same\r\n\r\n## Same';
    const headings = flattenOutline(outline(source));
    expect(new Set(headings.map(item => item.key)).size).toBe(3);
    expect(headings.map(item => source.slice(item.range.start, item.range.end))).toEqual(['# Same', '## Same', '## Same']);
    expect(headings.map(item => item.index)).toEqual([0, 1, 2]);
  });

  it('tracks the enclosing section and handles documents without headings', () => {
    const headings = flattenOutline(outline('Intro\n\n# First\n\nText\n\n## Second\n\nMore'));
    expect(outlineHeadingAt(headings, 0)).toBeNull();
    expect(outlineHeadingAt(headings, headings[1].range.start - 1)?.title).toBe('First');
    expect(outlineHeadingAt(headings, 1000)?.title).toBe('Second');
    expect(outline('Just text.')).toEqual([]);
    expect(documentOutline(null)).toEqual([]);
  });

  it('keeps collapse keys stable when prose before a heading changes', () => {
    const before = flattenOutline(outline('# Root\n\nText\n\n## Child'));
    const after = flattenOutline(outline('New intro\n\n# Root\n\nMore text\n\n## Child'));
    expect(after.map(item => item.key)).toEqual(before.map(item => item.key));
  });
});
