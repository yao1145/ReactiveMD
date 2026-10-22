import { expect, it } from 'vitest';
import { parseLocal } from '../src/local/parser';
import type { LocalNode } from '../src/local/types';
const flat = (nodes: LocalNode[]): LocalNode[] => nodes.flatMap(n => [n, ...flat(n.children ?? [])]);

it('parses nested containers, Markdown, inline tags and quoted greater-than characters', () => {
  const source = '<panel\n title="a > b">\n# 标题\n\n**当前** {{ people }} <badge>状态</badge>\n\n<slider bind="people" label="人数">\n</panel>';
  const parsed = parseLocal(source);
  expect(parsed.diagnostics).toEqual([]);
  const all = flat(parsed.nodes);
  expect(all.find(n => n.name === 'panel')?.attrs?.title).toBe('a > b');
  expect(all.some(n => n.type === 'heading')).toBe(true);
  expect(all.find(n => n.type === 'interpolation')?.value).toBe('people');
  expect(all.find(n => n.name === 'slider')?.range.start).toBe(source.indexOf('<slider'));
});

it('shields fenced and inline code, comments, escaped interpolation and LaTeX', () => {
  const parsed = parseLocal('`<counter label="code"> {{ absent }}`\n\n<!-- {{ absent }} -->\n\n\\{{ absent }}\n\n```md\n<input bind="code" label="code">\n{{ absent }}\n```\n\n$$ y = x^2 $$');
  expect(parsed.diagnostics).toEqual([]);
  const all = flat(parsed.nodes);
  expect(all.filter(n => n.type === 'interpolation')).toEqual([]);
  expect(all.filter(n => n.type === 'component')).toEqual([]);
  expect(all.find(n => n.type === 'math')?.value?.trim()).toBe('y = x^2');
});

it('reports tag mismatch and duplicate attributes with source positions', () => {
  const parsed = parseLocal('<card title="one" title="two">\n</panel>');
  expect(parsed.diagnostics.map(d => d.code)).toContain('local.attribute.duplicate');
  expect(parsed.diagnostics.map(d => d.code)).toContain('local.tag.mismatch');
  expect(parsed.diagnostics.every(d => d.line > 0 && d.column > 0)).toBe(true);
});

it('dedents container content while keeping source offsets', () => {
  const source = '<card>\n    ## 标题\n\n    正文 **{{ a }}**\n\n    <slider bind="a" label="A">\n</card>';
  const parsed = parseLocal(source);
  expect(parsed.diagnostics).toEqual([]);
  const card = parsed.nodes[0];
  expect(card.name).toBe('card');
  const all = flat(card.children ?? []);
  expect(all.find(n => n.type === 'heading')?.depth).toBe(2);
  expect(all.find(n => n.type === 'strong')).toBeTruthy();
  const interpolation = all.find(n => n.type === 'interpolation');
  expect(interpolation?.value).toBe('a');
  expect(all.find(n => n.name === 'slider')?.range.start).toBe(source.indexOf('<slider'));
});

it('shields fenced code inside indented containers', () => {
  const source = '<card>\n    ```md\n    <slider bind="a" label="A">\n    {{ a }}\n    ```\n</card>';
  const parsed = parseLocal(source);
  expect(parsed.diagnostics).toEqual([]);
  const all = flat(parsed.nodes);
  expect(all.find(n => n.type === 'code')?.lang).toBe('md');
  expect(all.filter(n => n.type === 'component').map(n => n.name)).toEqual(['card']);
  expect(all.some(n => n.type === 'interpolation')).toBe(false);
});

it('parses nested containers with independent dedenting', () => {
  const source = '<panel>\n  <card title="x">\n    正文 {{ a }}\n  </card>\n</panel>';
  const parsed = parseLocal(source);
  expect(parsed.diagnostics).toEqual([]);
  const panel = parsed.nodes[0];
  expect(panel.name).toBe('panel');
  const card = panel.children?.[0];
  expect(card?.name).toBe('card');
  expect(card?.attrs?.title).toBe('x');
  expect(card?.range.start).toBe(source.indexOf('<card'));
  const body = card?.children?.[0];
  expect(body?.type).toBe('paragraph');
  expect(flat(card?.children ?? []).find(n => n.type === 'interpolation')?.value).toBe('a');
});

it('recognizes inline badges and tooltips with decoded attributes', () => {
  const source = '点击 <badge tone="success">已 **完成**</badge>，按住 <tooltip text="说明 &quot;引号&quot; 与 > 符号">提示</tooltip>。';
  const parsed = parseLocal(source);
  expect(parsed.diagnostics).toEqual([]);
  const all = flat(parsed.nodes);
  const badge = all.find(n => n.name === 'badge');
  expect(badge?.attrs?.tone).toBe('success');
  expect(badge?.children?.some(n => n.type === 'strong')).toBe(true);
  expect(all.find(n => n.name === 'tooltip')?.attrs?.text).toBe('说明 "引号" 与 > 符号');
});

it('keeps Markdown escapes literal for tags and interpolation', () => {
  const parsed = parseLocal('示例 \\<slider> 与 \\{{ x }}');
  expect(parsed.diagnostics).toEqual([]);
  const all = flat(parsed.nodes);
  expect(all.some(n => n.type === 'component')).toBe(false);
  expect(all.some(n => n.type === 'interpolation')).toBe(false);
  const text = all.filter(n => n.type === 'text').map(n => n.value).join('');
  expect(text).toContain('<slider>');
  expect(text).toContain('{{ x }}');

  const money = parseLocal('价格 \\$5');
  expect(money.diagnostics).toEqual([]);
  expect(flat(money.nodes).some(n => n.type === 'inlineMath')).toBe(false);
});

it('decodes escaped table pipes before expressions reach the evaluator', () => {
  const source = '| 条件 | 结果 |\n| --- | --- |\n| 或 | {{ a \\|\\| b }} |\n| 文本 | a \\| b |';
  const parsed = parseLocal(source);
  expect(parsed.diagnostics).toEqual([]);
  const table = flat(parsed.nodes).find(n => n.type === 'table');
  expect(table).toBeTruthy();
  const cells = flat(table?.children ?? []).filter(n => n.type === 'tableCell');
  expect(cells).toHaveLength(6);
  expect(flat(table?.children ?? []).find(n => n.type === 'interpolation')?.value).toBe('a || b');
  const text = flat(table?.children ?? []).filter(n => n.type === 'text').map(n => n.value).join('');
  expect(text).toContain('a | b');
});

it('parses display and inline math without touching interpolations', () => {
  const parsed = parseLocal('值 $x^2$，以及 $$y = {a \\over b}$$');
  expect(parsed.diagnostics).toEqual([]);
  const all = flat(parsed.nodes);
  expect(all.find(n => n.type === 'inlineMath')?.value).toBe('x^2');
  expect(all.find(n => n.type === 'math')?.value).toBe('y = {a \\over b}');
  expect(all.some(n => n.type === 'interpolation')).toBe(false);
});

it('reports malformed names, closing attributes and unclosed containers', () => {
  const parsed = parseLocal('<panel title="ok">\n  <card>\n  </panel>\n<Card>');
  const codes = parsed.diagnostics.map(d => d.code);
  expect(codes).toContain('local.tag.mismatch');
  expect(codes).toContain('local.tag.unclosed');
  expect(codes).toContain('local.tag.name');
  const card = parsed.diagnostics.find(d => d.code === 'local.tag.unclosed' && d.message.includes('card'));
  expect(card?.line).toBe(2);
  expect(card?.column).toBe(3);

  const closing = parseLocal('<card>\n</card foo>');
  expect(closing.diagnostics.map(d => d.code)).toContain('local.tag.closing');

  const attribute = parseLocal('<slider onClick="x">');
  expect(attribute.diagnostics.map(d => d.code)).toContain('local.attribute.name');
});

it('assigns deterministic unique identifiers', () => {
  const source = '<panel><badge>a</badge><slider bind="a" label="A"></panel>';
  const first = flat(parseLocal(source).nodes).map(n => n.id);
  const second = flat(parseLocal(source).nodes).map(n => n.id);
  expect(first).toEqual(second);
  expect(new Set(first).size).toBe(first.length);
});
