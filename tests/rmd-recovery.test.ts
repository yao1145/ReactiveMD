import { describe, expect, it } from 'vitest';
import { parseLocal } from '../src/local/parsing/parser';
import type { LocalNode } from '../src/local/contracts/types';

const flat = (nodes: LocalNode[]): LocalNode[] => nodes.flatMap((node) => [node, ...flat(node.children ?? [])]);
const loose = { strict: false } as const;

describe('loose RMD structure recovery', () => {
  it.each(['pre', 'code', 'script', 'style', 'xmp'])('keeps an unclosed raw HTML %s region opaque across blank lines', tag => {
    const source = `<${tag}>\nliteral\n\n## Still raw\n\n<counter bind="hidden" label="Hidden" initial="1">`;
    const parsed = parseLocal(source, loose);
    expect(parsed.diagnostics.some(diagnostic => diagnostic.severity === 'error')).toBe(false);
    const nodes = flat(parsed.nodes);
    expect(nodes.some(item => item.name === 'counter')).toBe(false);
    expect(nodes.some(item => item.type === 'heading')).toBe(false);
    expect(parsed.recoveries?.length).toBeGreaterThan(0);
  });

  it('charges unmatched closing-tag searches against the work budget', () => {
    const source = '<card>\n'.repeat(1000) + '</unknown>\n'.repeat(1000);
    const parsed = parseLocal(source, { strict: false, limits: { maxParseWork: source.length * 12 } });
    expect(parsed.diagnostics.some(diagnostic => diagnostic.code === 'local.budget' && diagnostic.severity === 'error')).toBe(true);
    expect(parsed.nodes).toEqual([]);
  });

  it('resynchronizes an unclosed container at a later ATX heading', () => {
    const source = '前文\n\n<card>\n片段 {{ hidden }}\n\n## 后续\n\n后文 **粗体**';
    const parsed = parseLocal(source, loose);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.recoveries).toHaveLength(1);
    expect(parsed.recoveries?.[0].boundary).toBe('heading');
    expect(parsed.recoveries?.[0].affectedRange).toEqual({
      start: source.indexOf('<card>'),
      end: source.indexOf('## 后续'),
    });

    const all = flat(parsed.nodes);
    expect(all.some((node) => node.name === 'card')).toBe(false);
    expect(all.some((node) => node.type === 'interpolation')).toBe(false);
    expect(all.find((node) => node.type === 'heading')?.depth).toBe(2);
    expect(all.some((node) => node.type === 'strong')).toBe(true);
  });

  it('keeps a legally paired container that spans headings', () => {
    const source = '<card>\n\n## 内部\n\n正文\n\n</card>\n\n后文';
    const parsed = parseLocal(source, loose);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.recoveries).toBeUndefined();
    const card = parsed.nodes.find((node) => node.name === 'card');
    expect(card).toBeTruthy();
    expect(flat(card?.children ?? []).find((node) => node.type === 'heading')?.depth).toBe(2);
  });

  it('uses an outer closing tag to rescue the outer container', () => {
    const source = '<card>\n<alert>\n内文\n</card>';
    const parsed = parseLocal(source, loose);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.recoveries).toHaveLength(1);
    expect(parsed.recoveries?.[0].boundary).toBe('container-end');
    expect(parsed.recoveries?.[0].affectedRange).toEqual({
      start: source.indexOf('<alert>'),
      end: source.indexOf('</card>'),
    });

    const all = flat(parsed.nodes);
    expect(all.find((node) => node.name === 'card')).toBeTruthy();
    expect(all.some((node) => node.name === 'alert')).toBe(false);
  });

  it('degrades only an isolated closing tag', () => {
    const source = '前文\n\n</alert>\n\n后文';
    const parsed = parseLocal(source, loose);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.recoveries).toHaveLength(1);
    expect(parsed.recoveries?.[0].boundary).toBe('token');
    expect(parsed.recoveries?.[0].affectedRange).toEqual({
      start: source.indexOf('</alert>'),
      end: source.indexOf('</alert>') + '</alert>'.length,
    });
    expect(flat(parsed.nodes).some((node) => node.type === 'fallback')).toBe(true);
  });

  it('does not resynchronize at a heading inside fenced code or a comment', () => {
    const fenced = '<card>\n```md\n## 代码标题\n```\n\n正文';
    const parsedFence = parseLocal(fenced, loose);
    expect(parsedFence.recoveries?.[0].boundary).toBe('eof');
    expect(parsedFence.recoveries?.[0].affectedRange.end).toBe(fenced.length);
    expect(flat(parsedFence.nodes).some((node) => node.type === 'heading')).toBe(false);

    const commented = '<card>\n<!--\n## 注释标题\n-->\n\n正文';
    const parsedComment = parseLocal(commented, loose);
    expect(parsedComment.recoveries?.[0].boundary).toBe('eof');
    expect(parsedComment.recoveries?.[0].affectedRange.end).toBe(commented.length);
  });

  it('uses the conservative boundary when the opening tag is lexically incomplete', () => {
    const source = '<card title="never\n## 标题';
    const parsed = parseLocal(source, loose);

    expect(parsed.recoveries).toHaveLength(1);
    expect(parsed.recoveries?.[0].boundary).toBe('eof');
    expect(parsed.recoveries?.[0].affectedRange).toEqual({ start: 0, end: source.length });
    expect(flat(parsed.nodes).some((node) => node.type === 'heading')).toBe(false);
  });

  it('recovers an unknown line-leading tag but keeps inline prose lazy', () => {
    const unclosed = '<widget>\n内容\n\n## 后续';
    const parsed = parseLocal(unclosed, loose);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.recoveries).toHaveLength(1);
    expect(parsed.recoveries?.[0].boundary).toBe('heading');

    const inline = '正文 <widget> 继续';
    const prose = parseLocal(inline, loose);
    expect(prose.recoveries).toBeUndefined();
    expect(prose.diagnostics).toEqual([]);
  });

  it('keeps registered leaf components and their shape errors out of recovery', () => {
    const leaf = '<input bind="x" label="X">\n\n正文';
    const parsedLeaf = parseLocal(leaf, loose);
    expect(parsedLeaf.recoveries).toBeUndefined();
    expect(flat(parsedLeaf.nodes).some((node) => node.name === 'input')).toBe(true);

    const closing = '<input></input>';
    const parsedClosing = parseLocal(closing, loose);
    expect(parsedClosing.recoveries).toBeUndefined();
    expect(parsedClosing.diagnostics.some((item) => item.code === 'local.tag.mismatch')).toBe(true);
  });

  it('keeps strict diagnostics and adds no recoveries when strict is true', () => {
    const source = '<card>\n正文';
    const strict = parseLocal(source);
    expect(strict.recoveries).toBeUndefined();
    expect(strict.diagnostics.map((item) => item.code)).toContain('local.tag.unclosed');
  });

  it('preserves original UTF-16 ranges with Unicode and CRLF sources', () => {
    const source = '😀 前\r\n<card>\r\n文\r\n\r\n## 后\r\n尾';
    const parsed = parseLocal(source, loose);
    expect(parsed.recoveries).toHaveLength(1);
    expect(parsed.recoveries?.[0].affectedRange).toEqual({
      start: source.indexOf('<card>'),
      end: source.indexOf('## 后'),
    });
    expect(source.slice(parsed.recoveries![0].affectedRange.start, parsed.recoveries![0].affectedRange.end))
      .toBe('<card>\r\n文\r\n\r\n');
  });
});
