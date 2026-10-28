import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { parsePlainParagraphs } from '../src/local/plain-paragraphs';
import { parseLocal } from '../src/local/parser';
import type { LocalNode } from '../src/local/types';

const markdown = unified().use(remarkParse).use(remarkGfm);
function factory() {
  let serial = 0;
  return (type: string, start: number, end: number, extra: Partial<LocalNode> = {}): LocalNode =>
    ({ type, id: `local-${serial++}`, range: { start, end }, ...extra });
}
function ordinaryMarkdown(source: string): LocalNode[] {
  const node = factory();
  const transform = (raw: any): LocalNode => {
    const children = raw.children?.map(transform);
    return node(raw.type, raw.position.start.offset, raw.position.end.offset, {
      ...(children ? { children } : {}), ...(raw.value === undefined ? {} : { value: raw.value }),
    });
  };
  return markdown.parse(source).children.map(transform);
}

describe('ordinary paragraph parsing', () => {
  it.each([
    '', '\n\n', 'Hello, world.', '中文段落。\n\n第二段，带 emoji 🙂。',
    'first\nsecond\n\nthird\n', '\n\nfirst\n\nsecond\n\n',
    'first\r\nsecond\r\n\r\nthird\r\n', 'first\rsecond\r\rthird\r',
    'It is 25.5 degrees, day-to-day work: normal prose (plain).',
    '1234567890. This is ordinary text, with a ten digit prefix.',
    'one\n\ntwo   ', 'one\n\nword\n\n'.repeat(50),
  ])('matches remark nodes, IDs and UTF-16 ranges for %j', source => {
    expect(parsePlainParagraphs(source, false, factory())).toEqual(ordinaryMarkdown(source));
  });

  it('preserves CRLF break ranges and node creation order', () => {
    expect(parsePlainParagraphs('first\r\nsecond\r\n\r\nlast ', true, factory())).toEqual([
      { type: 'paragraph', id: 'local-3', range: { start: 0, end: 13 }, children: [
        { type: 'text', id: 'local-0', range: { start: 0, end: 5 }, value: 'first' },
        { type: 'break', id: 'local-1', range: { start: 5, end: 7 } },
        { type: 'text', id: 'local-2', range: { start: 7, end: 13 }, value: 'second' },
      ] },
      { type: 'paragraph', id: 'local-5', range: { start: 17, end: 22 }, children: [
        { type: 'text', id: 'local-4', range: { start: 17, end: 21 }, value: 'last' },
      ] },
    ]);
  });

  it('matches remark across generated prose, blank lines and line ending styles', () => {
    const words = ['ordinary', '中文', '🙂', '25.5', 'day-to-day', '(text)', 'value:', 'end.'];
    const endings = ['\n', '\r\n', '\r'];
    let seed = 7;
    const next = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
    for (let i = 0; i < 100; i++) {
      const ending = endings[next(endings.length)];
      const paragraphs = Array.from({ length: 1 + next(6) }, () =>
        Array.from({ length: 1 + next(3) }, () =>
          Array.from({ length: 1 + next(5) }, () => words[next(words.length)]).join(' ')).join(ending));
      const source = ending.repeat(next(3)) + paragraphs.join(ending + ending) + ' '.repeat(next(3));
      expect(parsePlainParagraphs(source, false, factory())).toEqual(ordinaryMarkdown(source));
    }
  });

  it('keeps a long trailing space run in the paragraph range and trims the text', () => {
    const source = 'word' + ' '.repeat(100_000);
    expect(parsePlainParagraphs(source, false, factory())).toEqual([
      { type: 'paragraph', id: 'local-1', range: { start: 0, end: source.length }, children: [
        { type: 'text', id: 'local-0', range: { start: 0, end: 4 }, value: 'word' },
      ] },
    ]);
  });

  it.each([
    '# heading', 'title\n===', 'title\n---', '- list', '+ list', '1. list', '1) list',
    '> quote', '  indented', '\tcode', 'a\tb', 'a  \nb', 'a \nb',
    '**bold**', 'under_score', '~~delete~~', '`code`', '```\ncode\n```',
    '[label][ref]\n\n[ref]: https://example.com', '[^note]: text', '&amp;', '\\*escaped',
    '<panel>text</panel>', '<!-- reactive-md: local-draft-2 -->', '{{ n }}', '$x$',
    'contact@example.com', 'https://example.com', 'www.example.com', 'WWW.example.com',
    '| a | b |\n| - | - |', 'zero\0byte', '\ufeffhello',
  ])('leaves syntax and normalization to the existing parser for %j', source => {
    expect(parsePlainParagraphs(source, false, factory())).toBeUndefined();
  });

  it('checks the whole document before choosing the ordinary text path', () => {
    const source = 'word\n\n'.repeat(5_100) + '[link][target]\n\n[target]: /destination';
    expect(parsePlainParagraphs(source, false, factory())).toBeUndefined();
  });

  it('keeps exact budget diagnostics, including the first rejected source range', () => {
    const result = parseLocal('word\n\n'.repeat(5_001));
    expect(result.nodes).toEqual([]);
    expect(result.diagnostics).toEqual([expect.objectContaining({
      code: 'local.budget', messageKey: 'local.budget.nodes',
      range: { start: 30_000, end: 30_004 }, line: 10_001, column: 1,
    })]);
    expect(parseLocal('first\nsecond', { markdownBreaks: true, limits: { maxSyntaxNodes: 3 } }).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'local.budget', range: { start: 0, end: 12 } }));
  });
});
