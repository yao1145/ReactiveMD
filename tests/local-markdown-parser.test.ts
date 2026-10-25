import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { parseLocal } from '../src/local/parser';
import type { LocalNode } from '../src/local/types';

const flat = (nodes: LocalNode[]): LocalNode[] => nodes.flatMap(node => [node, ...flat(node.children ?? [])]);
const ofType = (nodes: LocalNode[], type: string): LocalNode[] => flat(nodes).filter(node => node.type === type);

function compiled(source: string) {
  const result = compileLocal(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result;
}

describe('footnote definitions in Markdown containers', () => {
  it('resolves references across containers in both directions', () => {
    const source = [
      '<card>',
      '卡片内引用[^outer]，另一定义[^inner]。',
      '',
      '[^inner]: 卡片内定义。',
      '</card>',
      '',
      '正文引用[^inner]。',
      '',
      '[^outer]: 外层定义。',
    ].join('\n');
    const { document, diagnostics } = compiled(source);
    expect(diagnostics).toEqual([]);
    const references = ofType(document.nodes, 'footnoteReference');
    expect(references.map(node => node.identifier)).toEqual(['outer', 'inner', 'inner']);
    const definitions = ofType(document.nodes, 'footnoteDefinition');
    expect(definitions.map(node => node.identifier).sort()).toEqual(['inner', 'outer']);
    // The container definition lives inside the card subtree.
    const card = flat(document.nodes).find(node => node.name === 'card')!;
    expect(flat(card.children ?? []).some(node => node.type === 'footnoteDefinition')).toBe(true);
    expect(Object.keys(document.bindings)).toEqual([]);
  });

  it('keeps malformed controls inside a container definition inert', () => {
    const source = '<card>\n  正文[^note]\n\n  [^note]: {{ broken <slider onClick="bad">\n</card>\n\n后文';
    const { document, diagnostics } = compiled(source);
    expect(diagnostics).toEqual([]);
    expect(Object.keys(document.bindings)).toEqual([]);
    expect(ofType(document.nodes, 'footnoteReference')).toHaveLength(1);
    expect(ofType(document.nodes, 'footnoteDefinition')).toHaveLength(1);
  });

  it('keeps every duplicate definition node and lets the first one win', () => {
    const source = '[^a]: 第一个\n\n[^a]: 第二个\n\n正文[^a]';
    const parsed = parseLocal(source);
    expect(parsed.diagnostics).toEqual([]);
    const definitions = ofType(parsed.nodes, 'footnoteDefinition');
    expect(definitions).toHaveLength(2);
    expect(definitions.every(node => node.identifier === 'a')).toBe(true);
    expect(source.slice(definitions[0].range.start, definitions[0].range.end)).toBe('[^a]: 第一个');
    expect(ofType(parsed.nodes, 'footnoteReference')).toHaveLength(1);
  });

  it('accepts rich definition bodies: links, code, nested lists and basic HTML', () => {
    const source = [
      '前文[^rich]。',
      '',
      '[^rich]: **加粗**与[链接](https://example.com)及<i>斜体</i>。',
      '',
      '    ```md',
      '    <b>代码里的标签</b>',
      '    ```',
      '',
      '    - 外层',
      '      - 内层',
    ].join('\n');
    const parsed = parseLocal(source);
    expect(parsed.diagnostics).toEqual([]);
    const definition = ofType(parsed.nodes, 'footnoteDefinition')[0];
    const children = flat(definition.children ?? []);
    expect(children.some(node => node.type === 'strong')).toBe(true);
    expect(children.some(node => node.type === 'link')).toBe(true);
    expect(children.some(node => node.type === 'emphasis')).toBe(true);
    expect(children.some(node => node.type === 'code')).toBe(true);
    expect(children.some(node => node.type === 'list')).toBe(true);
    // Code inside the definition stays code, not a component.
    expect(ofType(parsed.nodes, 'component')).toEqual([]);
  });

  it('supports a definition that references another footnote without cycling', () => {
    const source = '[^a]: 引用[^b] 与自引[^a]\n\n[^b]: 乙\n\n正文[^a]';
    const parsed = parseLocal(source);
    expect(parsed.diagnostics).toEqual([]);
    const references = ofType(parsed.nodes, 'footnoteReference');
    expect(references.map(node => node.identifier).sort()).toEqual(['a', 'a', 'b']);
    expect(ofType(parsed.nodes, 'footnoteDefinition')).toHaveLength(2);
  });

  it('never emits the old unsupported-footnote warning', () => {
    const parsed = parseLocal('正文[^x]\n\n[^x]: 定义');
    expect(parsed.diagnostics.map(diagnostic => diagnostic.code)).not.toContain('local.footnote.unsupported');
  });
});

describe('basic HTML in Markdown contexts', () => {
  it('formats inline HTML inside lists and tables', () => {
    const source = [
      '- 列表 <mark>高亮</mark>',
      '',
      '| 名称 | 值 |',
      '| --- | --- |',
      '| 粗体 | <b>值</b> |',
    ].join('\n');
    const parsed = parseLocal(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(ofType(parsed.nodes, 'mark')).toHaveLength(1);
    expect(ofType(parsed.nodes, 'strong')).toHaveLength(1);
  });

  it('keeps HTML inside footnote definitions safe and formatted', () => {
    const source = '正文[^x]\n\n[^x]: <b>粗</b>与<br>换行';
    const parsed = parseLocal(source);
    expect(parsed.diagnostics).toEqual([]);
    const definition = ofType(parsed.nodes, 'footnoteDefinition')[0];
    const children = flat(definition.children ?? []);
    expect(children.some(node => node.type === 'strong')).toBe(true);
    expect(children.some(node => node.type === 'break')).toBe(true);
  });

  it('does not execute script-like fallbacks and never opens attributes', () => {
    const parsed = parseLocal('<script>alert(1)</script> 与 <u style="x">下划线</u>');
    const codes = parsed.diagnostics.map(diagnostic => diagnostic.code);
    expect(codes).toContain('local.component.unknown');
    expect(codes).toContain('local.html');
    expect(parsed.diagnostics.every(diagnostic => diagnostic.severity === 'warning')).toBe(true);
    expect(ofType(parsed.nodes, 'underline')).toEqual([]);
    expect(ofType(parsed.nodes, 'fallback').length).toBeGreaterThan(0);
  });
});

describe('markdown compatibility boundaries stay intact', () => {
  it('does not let currency swallow a later formula', () => {
    const source = '价格 $5、$10，函数 $x^2$，常数 $5$。';
    const parsed = parseLocal(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(ofType(parsed.nodes, 'inlineMath').map(node => node.value)).toEqual(['x^2', '5']);
  });

  it('keeps escaped and code-shielded markup literal', () => {
    const parsed = parseLocal('\\<b>不粗\\</b> 与 `<i>代码</i>` 与 \\$5');
    expect(parsed.diagnostics).toEqual([]);
    expect(ofType(parsed.nodes, 'strong')).toEqual([]);
    expect(ofType(parsed.nodes, 'emphasis')).toEqual([]);
    expect(ofType(parsed.nodes, 'inlineMath')).toEqual([]);
  });

  it('still diagnoses misspelled known components and unknown line-leading tags', () => {
    const cases = compileLocal('<Card/>');
    expect(cases.ok).toBe(false);
    expect(cases.diagnostics.map(diagnostic => diagnostic.code)).toContain('local.tag.name');

    const unclosed = compileLocal('<mystery>\n<counter bind="x" label="X">');
    expect(unclosed.ok).toBe(false);
    expect(unclosed.diagnostics.map(diagnostic => diagnostic.code)).toContain('local.tag.unclosed');
  });

  it('keeps soft breaks unchanged and only accepts literal <br> for hard HTML breaks', () => {
    const parsed = parseLocal('软换行\n下一行与<br>硬换行');
    const breaks = ofType(parsed.nodes, 'break');
    expect(breaks).toHaveLength(1);
    expect(breaks[0].range).toEqual({ start: '软换行\n下一行与'.length, end: '软换行\n下一行与<br>'.length });
  });
});
