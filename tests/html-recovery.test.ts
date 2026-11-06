import { describe, expect, it } from 'vitest';
import { recoverLocalHtml } from '../src/local/html-recovery';
import type { LocalNode, SourceRange } from '../src/local/types';

type RecoveryNode = LocalNode & { synthetic?: boolean; syntheticBoundary?: SourceRange };
type Recovery = {
  code: string;
  causeRange: SourceRange;
  affectedRange: SourceRange;
  action: 'html-repair' | 'literal-fallback';
  boundary: 'token' | 'fragment' | 'container-end' | 'heading' | 'eof';
};
type Result = { nodes: RecoveryNode[]; recovery: Recovery; end: number };

function factory(): (type: string, start: number, end: number, extra?: Partial<LocalNode>) => LocalNode {
  let serial = 0;
  return (type, start, end, extra = {}) => ({
    type,
    id: `recovery-${serial++}`,
    range: { start, end },
    ...extra,
  });
}

function recover(
  source: string,
  start: number,
  end: number,
  options: { names?: ReadonlySet<string>; contextTag?: string } = {},
): Result | null {
  return recoverLocalHtml(
    source,
    start,
    end,
    factory(),
    options.names ?? new Set<string>(),
    options.contextTag,
  ) as Result | null;
}

function within(range: SourceRange, start: number, end: number): boolean {
  return range.start >= start && range.end <= end && range.start <= range.end;
}

function walk(nodes: readonly RecoveryNode[]): RecoveryNode[] {
  const output: RecoveryNode[] = [];
  for (const node of nodes) {
    output.push(node);
    if (node.children) output.push(...walk(node.children));
  }
  return output;
}

describe('recoverLocalHtml', () => {
  it('repairs an implied paragraph close at the next paragraph', () => {
    const source = '<p>one<p>two';
    const result = recover(source, 0, source.length);

    expect(result).not.toBeNull();
    expect(result!.end).toBe(source.length);
    expect(result!.nodes.map((node) => node.type)).toEqual(['paragraph', 'paragraph']);
    expect(result!.nodes[0].range).toEqual({ start: 0, end: 6 });
    expect(result!.nodes[1].range).toEqual({ start: 6, end: 12 });
    expect(result!.nodes[0].children?.[0]).toMatchObject({ type: 'text', value: 'one' });
    expect(result!.nodes[1].children?.[0]).toMatchObject({ type: 'text', value: 'two' });
    expect(result!.recovery).toMatchObject({
      code: 'local.html.repair',
      action: 'html-repair',
      boundary: 'fragment',
    });
    expect(within(result!.recovery.causeRange, 0, source.length)).toBe(true);
    expect(result!.recovery.affectedRange).toEqual({ start: 0, end: source.length });
  });

  it('repairs list items without explicit closes and keeps source ranges', () => {
    const source = '<ul><li>one<li>two</ul>';
    const result = recover(source, 0, source.length);

    expect(result).not.toBeNull();
    const list = result!.nodes[0];
    expect(list.type).toBe('list');
    expect(list.ordered).toBe(false);
    expect(list.range).toEqual({ start: 0, end: source.length });
    expect(list.children?.map((node) => [node.type, node.range.start, node.range.end])).toEqual([
      ['listItem', 4, 11],
      ['listItem', 11, 18],
    ]);
  });

  it('repairs a mismatched close by implying the inner close', () => {
    const source = '<div><b>text</div>';
    const result = recover(source, 0, source.length);

    expect(result).not.toBeNull();
    const div = result!.nodes[0];
    expect(div.type).toBe('div');
    expect(div.range).toEqual({ start: 0, end: 18 });
    const strong = div.children?.[0];
    expect(strong?.type).toBe('strong');
    expect(strong?.range).toEqual({ start: 5, end: 12 });
    expect(strong?.children?.[0]).toMatchObject({ type: 'text', value: 'text' });
    expect(result!.recovery.causeRange).toEqual({ start: 5, end: 8 });
  });

  it('never consumes source outside the requested range', () => {
    const source = 'before <p>one<p>two after';
    const start = source.indexOf('<p>');
    const end = source.indexOf(' after');
    const untouched = source;
    const result = recover(source, start, end);

    expect(result).not.toBeNull();
    expect(result!.end).toBe(end);
    expect(source).toBe(untouched);
    expect(result!.recovery.affectedRange).toEqual({ start, end });
    expect(within(result!.recovery.causeRange, start, end)).toBe(true);
    for (const node of walk(result!.nodes)) {
      expect(within(node.range, start, end)).toBe(true);
      expect(source.slice(node.range.start, node.range.end)).not.toContain('before');
      expect(source.slice(node.range.start, node.range.end)).not.toContain('after');
    }
  });

  it('recovers a table row in table context with a synthetic tbody', () => {
    const source = '<tr><td>a<td>b</tr>';
    const result = recover(source, 0, source.length, { contextTag: 'table' });

    expect(result).not.toBeNull();
    const body = result!.nodes[0];
    expect(body).toMatchObject({ type: 'htmlTableElement', name: 'tbody', synthetic: true });
    expect(body.range).toEqual({ start: 0, end: source.length });
    expect(body.syntheticBoundary).toEqual(body.range);
    const row = body.children?.[0];
    expect(row).toMatchObject({ type: 'htmlTableElement', name: 'tr' });
    expect(row?.children?.map((cell) => [cell.type, cell.name, cell.range.start, cell.range.end])).toEqual([
      ['htmlTableElement', 'td', 4, 9],
      ['htmlTableElement', 'td', 9, 14],
    ]);
    expect(body.children?.some((node) => node.synthetic)).toBeFalsy();
  });

  it('synthesizes implicit table nodes without inventing tag offsets', () => {
    const source = '<table><tr><td>x</td></tr></table>';
    const result = recover(source, 0, source.length);

    expect(result).not.toBeNull();
    const table = result!.nodes[0];
    expect(table).toMatchObject({ type: 'htmlTable' });
    expect(table.range).toEqual({ start: 0, end: source.length });
    const body = table.children?.[0];
    expect(body).toMatchObject({ type: 'htmlTableElement', name: 'tbody', synthetic: true });
    const row = body?.children?.[0];
    expect(row).toMatchObject({ type: 'htmlTableElement', name: 'tr' });
    expect(body?.range).toEqual(row?.range);
    expect(body?.range.start).toBe(source.indexOf('<tr>'));
    expect(body?.syntheticBoundary).toEqual(body?.range);
    expect(source.slice(body!.range.start, body!.range.start + 6)).not.toBe('<tbody');
  });

  it('maps headings, blockquotes, inline emphasis, links and details', () => {
    const source = '<h2>Title</h2><blockquote><em>x</em></blockquote>'
      + '<a href="https://example.com">Link</a>'
      + '<details><summary>More</summary><p>Body</p></details>';
    const result = recover(source, 0, source.length);

    expect(result).not.toBeNull();
    const [heading, quote, link, details] = result!.nodes;
    expect(heading).toMatchObject({ type: 'heading', depth: 2 });
    expect(quote.type).toBe('blockquote');
    expect(quote.children?.[0]).toMatchObject({ type: 'emphasis' });
    expect(link).toMatchObject({ type: 'link', url: 'https://example.com' });
    expect(details.type).toBe('details');
    expect(details.children?.[0]).toMatchObject({ type: 'summary' });
    expect(details.children?.[1]).toMatchObject({ type: 'paragraph' });
  });

  it('decodes entities while keeping original UTF-16 ranges', () => {
    const source = '<p>a &amp; b</p>';
    const result = recover(source, 0, source.length);

    expect(result).not.toBeNull();
    const text = result!.nodes[0].children?.[0];
    expect(text).toMatchObject({ type: 'text', value: 'a & b' });
    expect(text?.range).toEqual({ start: 3, end: 12 });
    expect(source.slice(text!.range.start, text!.range.end)).toBe('a &amp; b');
  });

  it.each([
    ['script', '<script>alert(1)</script>'],
    ['style', '<style>p{color:red}</style>'],
    ['event handler', '<div onclick="alert(1)">x</div>'],
    ['javascript url', '<a href="javascript:alert(1)">x</a>'],
    ['unsafe image url', '<img src="javascript:alert(1)">'],
    ['unknown element', '<article>x</article>'],
    ['class attribute', '<div class="note">x</div>'],
    ['style attribute', '<div style="color:red">x</div>'],
    ['unknown attribute', '<div data-ok="1" unknown="x">y</div>'],
    ['unterminated tag', '<div title="unclosed'],
    ['table child without context', '<tr><td>x</td></tr>'],
  ])('returns null for unsupported %s', (_label, source) => {
    expect(recover(source, 0, source.length)).toBeNull();
  });

  it('returns null instead of activating a registered component tag', () => {
    const source = '<div><alert>x</alert></div>';
    expect(recover(source, 0, source.length, { names: new Set(['alert']) })).toBeNull();
  });

  it('returns null for interpolation in recovered text or decoded entities', () => {
    for (const source of [
      '<div>{{ value }}</div>',
      '<div>&#123;&#123; value &#125;&#125;</div>',
      '<p>{{value}}<p>next',
    ]) {
      expect(recover(source, 0, source.length)).toBeNull();
    }
  });

  it('keeps interpolation inert inside code and pre raw text', () => {
    const inline = '<code>{{ value }}</code>';
    const inlineResult = recover(inline, 0, inline.length);
    expect(inlineResult).not.toBeNull();
    expect(inlineResult!.nodes[0]).toMatchObject({ type: 'inlineCode', value: '{{ value }}' });

    const block = '<pre>{{ value }}</pre>';
    const blockResult = recover(block, 0, block.length);
    expect(blockResult).not.toBeNull();
    expect(blockResult!.nodes[0]).toMatchObject({ type: 'code', value: '{{ value }}' });
  });

  it('rejects a range that is empty, out of bounds or inverted', () => {
    expect(recover('<p>x</p>', 0, 0)).toBeNull();
    expect(recover('<p>x</p>', 3, 2)).toBeNull();
    expect(recover('<p>x</p>', 0, 99)).toBeNull();
  });
});
