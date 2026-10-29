import {describe, expect, it} from 'vitest';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import {parseMarkdownBlocks} from '../src/local/markdown-blocks';
import type {FastMarkdownCache} from '../src/local/fast-markdown';

const markdown = unified().use(remarkParse).use(remarkGfm);
const parseGeneral = (source: string): any => markdown.parse(source);

function comparable(node: any): any {
  const result: any = {type: node.type};
  if (node.type !== 'root') {
    result.position = {
      start: {offset: node.position.start.offset},
      end: {offset: node.position.end.offset},
    };
  }
  for (const key of ['value', 'ordered', 'start', 'checked', 'align', 'url', 'identifier', 'label', 'referenceType']) {
    if (node[key] !== undefined) result[key] = node[key];
  }
  if (node.children) result.children = node.children.map(comparable);
  return result;
}

/** Materialize fast plans into mdast-shaped nodes at absolute offsets. */
function expand(tree: any): any[] {
  const expanded: any[] = [];
  for (const child of tree.children ?? []) {
    if (child.type !== 'rmdFastBlock') {
      expanded.push(child);
      continue;
    }
    const base = child.position.start.offset;
    const emitted: any[] = (child.plan as any).emit(
      (type: string, from: number, to: number, extra: any = {}) => ({
        type,
        position: {start: {offset: base + from}, end: {offset: base + to}},
        ...extra,
      }),
    );
    expanded.push(...emitted);
  }
  return expanded;
}

function fastBlocks(tree: any): any[] {
  return (tree.children ?? []).filter((child: any) => child.type === 'rmdFastBlock');
}

function walk(nodes: any[], visit: (node: any) => void): void {
  const stack = [...nodes];
  while (stack.length) {
    const node = stack.pop();
    visit(node);
    if (Array.isArray(node?.children)) for (const child of node.children) stack.push(child);
  }
}

function expectMatchesRemark(source: string): {tree: any; stats: any} {
  const result = parseMarkdownBlocks(source, parseGeneral);
  const expected = markdown.parse(source).children.map(comparable);
  expect(expand(result.tree).map(comparable)).toEqual(expected);
  return result;
}

function covers(block: any, offset: number): boolean {
  return block.position.start.offset <= offset && offset < block.position.end.offset;
}

describe('block-local Markdown planning', () => {
  it('keeps many simple blocks fast around one inline link and one escape', () => {
    const blocks: string[] = [];
    for (let index = 0; index < 12; index++) blocks.push(`Simple paragraph ${index} with plain words.`);
    blocks.push('A [link](/path) sits here.');
    blocks.push('An escaped \\* marker sits here.');
    for (let index = 12; index < 24; index++) blocks.push(`Simple paragraph ${index} with plain words.`);
    blocks.push('- one\n- two', '| A | B |\n| - | - |\n| x | y |');
    const source = blocks.join('\n\n');

    const {tree, stats} = expectMatchesRemark(source);
    expect(fastBlocks(tree).length).toBeGreaterThan(10);
    expect(stats.fastCharacters).toBeGreaterThan(0);
    expect(stats.generalCharacters).toBeLessThan(source.length);
    for (const marker of [source.indexOf('[link]'), source.indexOf('\\*')]) {
      expect(fastBlocks(tree).some(block => covers(block, marker))).toBe(false);
    }
  });

  it('keeps footnote lazy continuation text inside the footnote', () => {
    const source = [
      'Intro paragraph.',
      '',
      '[^note]: first line',
      'lazy continuation text.',
      '',
      'Outro paragraph.',
    ].join('\n');
    const {tree} = expectMatchesRemark(source);

    const lazy = source.indexOf('lazy continuation');
    expect(fastBlocks(tree).some(block => covers(block, lazy))).toBe(false);
    let footnotes = 0;
    walk(expand(tree), node => {
      if (node.type === 'footnoteDefinition') footnotes++;
    });
    expect(footnotes).toBe(1);
  });

  it('does not detach a lazy continuation of a multi-block footnote', () => {
    const source = [
      '[^note]: first line',
      '',
      '    indented paragraph inside the note',
      'lazy continuation inside the note',
      '',
      'Simple tail.',
    ].join('\n');
    const {tree} = expectMatchesRemark(source);

    const lazy = source.indexOf('lazy continuation');
    expect(fastBlocks(tree).some(block => covers(block, lazy))).toBe(false);
    let footnotes = 0;
    walk(expand(tree), node => {
      if (node.type === 'footnoteDefinition') footnotes++;
    });
    expect(footnotes).toBe(1);
  });

  it('resolves link reference definitions across fast paragraphs', () => {
    const source = [
      '[guide]: /docs/guide',
      '',
      'First simple paragraph.',
      '',
      'Second simple paragraph.',
      '',
      'Read the [guide][guide] before continuing.',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      'Final simple paragraph.',
    ].join('\n');
    const {tree, stats} = expectMatchesRemark(source);

    const linkLine = source.indexOf('[guide][guide]');
    expect(fastBlocks(tree).some(block => covers(block, linkLine))).toBe(false);
    expect(fastBlocks(tree).length).toBeGreaterThan(1);
    expect(stats.generalCharacters).toBeLessThan(source.length);
    let definitions = 0;
    walk(expand(tree), node => {
      if (node.type === 'definition' && node.url === '/docs/guide') definitions++;
    });
    expect(definitions).toBe(1);
  });

  it('handles CR, LF and CRLF line endings identically to remark', () => {
    const template = [
      'First simple paragraph.',
      '',
      '- one',
      '- two',
      '',
      'A [link](/path) sits here.',
      '',
      '| A | B |',
      '| - | - |',
      '| x | y |',
      '',
      'Last simple paragraph.',
    ].join('\n');
    for (const ending of ['\n', '\r\n', '\r']) {
      const source = template.replace(/\n/g, ending);
      const {tree} = expectMatchesRemark(source);
      expect(fastBlocks(tree).length).toBeGreaterThan(0);
    }
  });

  it('keeps safe blocks fast next to fences, indented code, HTML and components', () => {
    const source = [
      'Simple before.',
      '',
      '```js',
      'const value = 1;',
      '```',
      '',
      'Simple after a fence.',
      '',
      '    indented code',
      '',
      '<div>raw html</div>',
      '',
      'A {{ count }} component line.',
      '',
      '- one',
      '- two',
      '',
      'Simple tail.',
    ].join('\n');
    const {tree, stats} = expectMatchesRemark(source);

    expect(fastBlocks(tree).length).toBeGreaterThan(0);
    expect(stats.generalCharacters).toBeGreaterThan(0);
    for (const marker of ['```', 'indented code', '<div>', '{{ count }}']) {
      const offset = source.indexOf(marker);
      expect(fastBlocks(tree).some(block => covers(block, offset))).toBe(false);
    }
  });

  it('does not split loose lists, blockquote lazy lines or list lazy lines', () => {
    for (const source of [
      '- one\n\n- two',
      '> quote\nlazy continuation',
      '- one\nlazy continuation\n- two',
      '- one\n  - nested',
    ]) {
      const {tree} = expectMatchesRemark(source);
      expect(fastBlocks(tree)).toHaveLength(0);
    }
  });

  it('allows a fast list immediately after a heading', () => {
    const source = '# Heading\n- one\n- two\n\nSimple tail.';
    const {tree} = expectMatchesRemark(source);
    expect(fastBlocks(tree).length).toBeGreaterThan(0);
  });

  it('allows adjacent fast blocks when a table interrupts a paragraph', () => {
    const source = 'Simple paragraph.\n| A | B |\n| - | - |\n| x | y |';
    const {tree} = expectMatchesRemark(source);
    expect(fastBlocks(tree).length).toBeGreaterThan(1);
  });

  it('allows a fast block after a normal link reference definition', () => {
    const source = '[guide]: /docs/guide\n- one\n- two\n\nSimple tail.';
    const {tree} = expectMatchesRemark(source);
    expect(fastBlocks(tree).length).toBeGreaterThan(0);
  });

  it('wraps a wholly fast document in one block with the exact range', () => {
    const source = '- one\n- two\n\n| A | B |\n| - | - |\n| x | y |\n\nSimple paragraph.';
    const {tree, stats} = expectMatchesRemark(source);
    expect(tree.children).toHaveLength(1);
    const child = tree.children[0];
    expect(child.type).toBe('rmdFastBlock');
    expect(child.position).toEqual({start: {offset: 0}, end: {offset: source.length}});
    expect(child).not.toHaveProperty('children');
    expect(stats.fastBlocks).toBe(child.plan.blockCount);
    expect(stats.generalBlocks).toBe(0);
    expect(stats.fastCharacters).toBe(source.length);
    expect(stats.generalCharacters).toBe(0);
  });

  it('reports total source lines, including CR and CRLF variants', () => {
    expect(parseMarkdownBlocks('a\nb\nc', parseGeneral).stats.lines).toBe(3);
    expect(parseMarkdownBlocks('a\r\nb\r\nc', parseGeneral).stats.lines).toBe(3);
    expect(parseMarkdownBlocks('a\rb\rc', parseGeneral).stats.lines).toBe(3);
  });

  it('never gives fast wrappers children', () => {
    const source = 'Simple one.\n\nA [link](/path).\n\nSimple two.';
    const {tree} = expectMatchesRemark(source);
    for (const block of fastBlocks(tree)) {
      expect(block).not.toHaveProperty('children');
      expect(block.position.start.offset).toBeGreaterThanOrEqual(0);
      expect(block.position.end.offset).toBeLessThanOrEqual(source.length);
    }
  });

  it('forwards whole-block plan lookups through a session cache', () => {
    const source = '| A | B |\n| - | - |\n| x | y |\n\nSimple tail.';
    const seen: string[] = [];
    const cache: FastMarkdownCache = {
      readPlan(text) { seen.push(text); return {hit: false}; },
      writePlan() {},
      readInline() { return {hit: false}; },
      writeInline() {},
    };
    const {tree, stats} = parseMarkdownBlocks(source, parseGeneral, undefined, cache);
    expect(seen).toContain(source);
    expect(stats.fastCharacters).toBeGreaterThan(0);
    expect(fastBlocks(tree).length).toBeGreaterThan(0);
  });
});
