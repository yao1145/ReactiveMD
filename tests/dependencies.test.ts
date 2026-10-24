import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import {
  EMPTY_DEPENDENCY_INDEX,
  collectNodeDependencies,
  type NodeDependencies,
} from '../src/local/dependencies';
import { LocalExpressionError, templateDependencies } from '../src/local/expression';
import type { LocalDocument, LocalNode } from '../src/local/types';

function compile(source: string): LocalDocument {
  const result = compileLocal(source);
  if (!result.ok) {
    throw new Error(result.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('\n'));
  }
  return result.document;
}

function all(nodes: LocalNode[]): LocalNode[] {
  return nodes.flatMap((node) => [node, ...all(node.children ?? [])]);
}

function find(document: LocalDocument, type: string, index = 0): LocalNode {
  const matches = all(document.nodes).filter((node) => node.type === type);
  if (!matches[index]) throw new Error(`Missing node #${index} of type ${type}`);
  return matches[index];
}

function findComponent(document: LocalDocument, name: string, index = 0): LocalNode {
  const matches = all(document.nodes).filter((node) => node.type === 'component' && node.name === name);
  if (!matches[index]) throw new Error(`Missing component <${name}> #${index}`);
  return matches[index];
}

function depsOf(document: LocalDocument, node: LocalNode): NodeDependencies {
  const index = collectNodeDependencies(document);
  if (!index.has(node.id)) throw new Error(`Missing dependency entry for node ${node.id}`);
  return index.get(node.id) ?? null;
}

function makeNode(id: string, type: string, extra: Partial<LocalNode> = {}): LocalNode {
  return { id, type, range: { start: 0, end: 0 }, ...extra };
}

describe('collectNodeDependencies', () => {
  it('reports an empty set for static text', () => {
    const document = compile('普通文本，没有任何绑定。');
    const paragraph = find(document, 'paragraph');
    expect(depsOf(document, paragraph)).toEqual([]);
    for (const entry of collectNodeDependencies(document).values()) {
      expect(entry).toEqual([]);
    }
  });

  it('unions the dependencies of interpolation children', () => {
    const document = compile(
      '<slider bind="people" label="人数" initial="2" min="1" max="20">\n\n当前共 {{ people }} 人。',
    );
    const paragraph = find(document, 'paragraph');
    expect(depsOf(document, paragraph)).toEqual(['people']);
    expect(depsOf(document, find(document, 'interpolation'))).toEqual(['people']);
  });

  it('includes attribute template variables and the control key of the same node', () => {
    const document = compile(
      '<input bind="query" label="搜索">\n<slider bind="n" label="{{ query }}" min="0" max="10">',
    );
    const slider = findComponent(document, 'slider');
    const dependencies = depsOf(document, slider);
    expect(dependencies).not.toBeNull();
    expect(dependencies).toContain('query');
    expect(dependencies).toContain('n');
  });

  it('keeps the write key of named and anonymous controls', () => {
    const named = compile('<slider bind="n" label="数值" initial="2" min="0" max="10">');
    expect(depsOf(named, findComponent(named, 'slider'))).toEqual(['n']);

    const anonymous = compile('<counter label="计数" initial="3">');
    const counter = findComponent(anonymous, 'counter');
    expect(depsOf(anonymous, counter)).toEqual([`@${counter.id}`]);
  });

  it('includes every binding slot of a multi-slot component', () => {
    const document = compile('<range-slider label="区间" bind-start="lo" bind-end="hi" min="0" max="10">');
    const range = findComponent(document, 'range-slider');
    expect(document.bindingSlots?.[range.id]).toEqual({ start: 'lo', end: 'hi' });
    expect(depsOf(document, range)).toEqual([`@${range.id}`, 'lo', 'hi']);
  });

  it('reads math formulas while excluding x and the bound variable', () => {
    const document = compile(
      '<slider bind="a" label="振幅" initial="1" min="0" max="5">\n\n$$ y = a \\sin x $$',
    );
    expect(depsOf(document, find(document, 'math'))).toEqual(['a']);
  });

  it('treats visual components as undecidable but still indexes their children', () => {
    const document = compile(
      '<slider bind="a" label="振幅" initial="1" min="0" max="5">\n\n<plot min="-10" max="10">\n$$ y = a \\sin x $$\n</plot>',
    );
    const plot = findComponent(document, 'plot');
    expect(depsOf(document, plot)).toBeNull();
    expect(depsOf(document, find(document, 'math'))).toEqual(['a']);
  });

  it('unions own keys and nested subtree dependencies in first-occurrence order', () => {
    const document = compile(
      [
        '<panel title="面板">',
        '<slider bind="a" label="A" initial="1" min="0" max="10">',
        '正文 {{ b }}。',
        '</panel>',
        '<slider bind="b" label="B" initial="2" min="0" max="10">',
      ].join('\n'),
    );
    const panel = findComponent(document, 'panel');
    expect(depsOf(document, panel)).toEqual([`@${panel.id}`, 'a', 'b']);
  });

  it('propagates null to every ancestor of an undecidable descendant', () => {
    const document: LocalDocument = {
      syntax: 'local',
      source: '',
      nodes: [
        makeNode('panel-1', 'component', {
          name: 'panel',
          attrs: {},
          children: [
            makeNode('para-1', 'paragraph', {
              children: [
                makeNode('text-1', 'text', { value: '深层文本 ' }),
                makeNode('interp-1', 'interpolation', { value: '1 + ' }),
              ],
            }),
          ],
        }),
        makeNode('para-2', 'paragraph', {
          children: [makeNode('interp-2', 'interpolation', { value: 'total' })],
        }),
      ],
      initialState: {},
      bindings: {},
    };
    const index = collectNodeDependencies(document);
    expect(index.get('interp-1')).toBeNull();
    expect(index.get('para-1')).toBeNull();
    expect(index.get('panel-1')).toBeNull();
    expect(index.get('interp-2')).toEqual(['total']);
    expect(index.get('para-2')).toEqual(['total']);
  });

  it('treats malformed attribute templates as undecidable', () => {
    const document: LocalDocument = {
      syntax: 'local',
      source: '',
      nodes: [makeNode('slider-1', 'component', { name: 'slider', attrs: { bind: 'n', label: '{{ a' } })],
      initialState: {},
      bindings: {},
    };
    expect(collectNodeDependencies(document).get('slider-1')).toBeNull();
  });

  it('memoizes the index per document identity', () => {
    const first = compile('文本。');
    const second = compile('文本。');
    expect(collectNodeDependencies(first)).toBe(collectNodeDependencies(first));
    expect(collectNodeDependencies(second)).not.toBe(collectNodeDependencies(first));
    expect(EMPTY_DEPENDENCY_INDEX.size).toBe(0);
  });
});

describe('templateDependencies', () => {
  it('unions template expressions in first-occurrence order', () => {
    expect(templateDependencies('{{ a }} 与 {{ b + a }}，共 {{ len(rows) }} 行')).toEqual(['a', 'b', 'rows']);
    expect(templateDependencies('没有插值的文本')).toEqual([]);
  });

  it('throws on malformed templates and expressions', () => {
    expect(() => templateDependencies('{{ a ')).toThrow(LocalExpressionError);
    expect(() => templateDependencies('{{  }}')).toThrow(LocalExpressionError);
    expect(() => templateDependencies('{{ 1 + }}')).toThrow(LocalExpressionError);

    const missing = (() => {
      try {
        templateDependencies('x {{ a ');
      } catch (error) {
        return error;
      }
      throw new Error('Expected a LocalExpressionError.');
    })();
    expect((missing as LocalExpressionError).code).toBe('expression-interpolation');
  });
});