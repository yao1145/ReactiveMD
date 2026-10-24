import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import {
  EMPTY_DEPENDENCY_INDEX,
  collectNodeDependencies,
  collectSubtreeResetTokens,
  type NodeDependencies,
} from '../src/local/dependencies';
import { LocalExpressionError, templateDependencies } from '../src/local/expression';
import { createLocalRuntime } from '../src/local/runtime';
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

describe('subtree reset invalidation', () => {
  it('invalidates memo ancestors without resetting their own UI or siblings', () => {
    const document = compile([
      '<card>',
      '<panel title="Inner" reset="true">',
      '<accordion><disclosure label="Details" open="true">Hello</disclosure></accordion>',
      '</panel>',
      '</card>',
      '<counter bind="other" label="Other">',
    ].join('\n'));
    const runtime = createLocalRuntime(document);
    try {
      const card = findComponent(document, 'card');
      const panel = findComponent(document, 'panel');
      const disclosure = findComponent(document, 'disclosure');
      const other = findComponent(document, 'counter');
      const before = collectSubtreeResetTokens(runtime);
      expect(collectSubtreeResetTokens(runtime)).toBe(before);
      runtime.reset(panel);
      const after = collectSubtreeResetTokens(runtime);
      expect(after.get(card.id)).toBeGreaterThan(before.get(card.id)!);
      expect(after.get(disclosure.id)).toBeGreaterThan(before.get(disclosure.id)!);
      expect(after.get(other.id)).toBe(before.get(other.id));
      expect(runtime.resetToken(card)).toBe(0);
      expect(runtime.resetToken(disclosure)).toBe(1);
      expect(runtime.set(other, 1)).toEqual([]);
      expect(collectSubtreeResetTokens(runtime)).toEqual(after);
    } finally {
      runtime.dispose();
    }
  });
});

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

  it('reads only the variables named by plot formulas', () => {
    const document = compile(
      '<slider bind="a" label="振幅" initial="1" min="0" max="5">\n\n' +
        '<slider bind="unused" label="未用" initial="1" min="0" max="5">\n\n' +
        '<plot min="-10" max="10">\n$$ y = a \\sin x $$\n</plot>',
    );
    const plot = findComponent(document, 'plot');
    expect(depsOf(document, plot)).toEqual(['a']);
    expect(depsOf(document, find(document, 'math'))).toEqual(['a']);
  });

  it('reads descendant cell interpolations of tables and charts', () => {
    const document = compile(
      '<slider bind="n" label="数量" initial="2" min="0" max="10">\n\n' +
        '<table label="数据">\n| 名称 | 数值 |\n| --- | --- |\n| A | {{ n * 2 }} |\n</table>',
    );
    expect(depsOf(document, findComponent(document, 'table'))).toEqual(['n']);
  });

  it('adds the selection binding of tables and charts that declare a key', () => {
    const document = compile(
      [
        '<table label="T" key="id" bind="sel">',
        '| id | name |',
        '| --- | --- |',
        '| a | Alpha |',
        '</table>',
        '',
        '<chart key="id" bind="sel">',
        '| id | value |',
        '| --- | --- |',
        '| a | 1 |',
        '</chart>',
      ].join('\n'),
    );
    expect(depsOf(document, findComponent(document, 'table'))).toEqual(['sel']);
    expect(depsOf(document, findComponent(document, 'chart'))).toEqual(['sel']);
  });

  it('reads the compiler-generated selection key of a key-only table', () => {
    const document = compile(
      '<table label="T" key="id">\n| id | name |\n| --- | --- |\n| a | Alpha |\n</table>',
    );
    const table = findComponent(document, 'table');
    expect(document.bindings[`@${table.id}`]).toBeDefined();
    expect(depsOf(document, table)).toEqual([`@${table.id}`]);
  });

  it('reads diagram node/edge attributes, descriptions and its selection binding', () => {
    const document = compile(
      [
        '<input bind="tone" label="语气">',
        '',
        '<input bind="note" label="说明">',
        '',
        '<diagram label="流程" bind="choice">',
        '<node id="a" label="{{ note }}" tone="{{ tone }}">描述 {{ note }}</node>',
        '<node id="b" label="B" tone="{{ tone }}"></node>',
        '<edge from="a" to="b" label="{{ note }}">',
        '</diagram>',
      ].join('\n'),
    );
    // Descendant <node>/<edge> components contribute their own anonymous
    // `@id` placeholders (no binding is registered for them); keep the state
    // keys separate here.
    const dependencies = depsOf(document, findComponent(document, 'diagram'));
    expect(dependencies?.filter((key) => !key.startsWith('@'))).toEqual([
      'choice',
      'note',
      'tone',
    ]);
  });

  it('reports no dependencies for a static timeline', () => {
    const document = compile(
      '<timeline title="计划">\n| Task | Start | Duration |\n| --- | --- | --- |\n| 设计 | 1 | 2 |\n</timeline>',
    );
    expect(depsOf(document, findComponent(document, 'timeline'))).toEqual([]);
  });

  it('keeps a visual undecidable when a descendant cannot be analyzed', () => {
    const document: LocalDocument = {
      syntax: 'local',
      source: '',
      nodes: [
        makeNode('table-1', 'component', {
          name: 'table',
          attrs: { key: 'id', bind: 'sel' },
          children: [
            makeNode('table-2', 'table', {
              children: [
                makeNode('row-1', 'tableRow', {
                  children: [
                    makeNode('cell-1', 'tableCell', {
                      children: [makeNode('interp-1', 'interpolation', { value: '1 +' })],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
      initialState: {},
      bindings: {},
    };
    expect(collectNodeDependencies(document).get('table-1')).toBeNull();
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

describe('compiler-persisted dependency index', () => {
  it('attaches a frozen index to compiled documents', () => {
    const document = compile(
      '<slider bind="n" label="数值" initial="1" min="0" max="5">\n\n值 {{ n * 2 }}',
    );
    expect(document.dependencies).toBeDefined();
    expect(Object.isFrozen(document.dependencies)).toBe(true);

    const slider = findComponent(document, 'slider');
    const interpolation = find(document, 'interpolation');
    expect(document.dependencies?.[slider.id]).toEqual(['n']);
    expect(document.dependencies?.[interpolation.id]).toEqual(['n']);
    expect(Object.isFrozen(document.dependencies?.[slider.id])).toBe(true);
    expect(collectNodeDependencies(document).get(interpolation.id)).toEqual(['n']);
  });

  it('reads persisted entries instead of re-analyzing the nodes', () => {
    const document: LocalDocument = {
      syntax: 'local',
      source: '',
      nodes: [
        makeNode('para-1', 'paragraph', {
          children: [makeNode('interp-1', 'interpolation', { value: 'missing +' })],
        }),
      ],
      initialState: {},
      bindings: {},
      dependencies: { 'para-1': ['kept'], 'interp-1': ['kept'] },
    };
    const index = collectNodeDependencies(document);
    expect(index.get('para-1')).toEqual(['kept']);
    expect(index.get('interp-1')).toEqual(['kept']);
  });

  it('falls back to analysis when no index is persisted', () => {
    const document = compile('文本。');
    const fresh: LocalDocument = { ...document };
    delete (fresh as { dependencies?: unknown }).dependencies;
    const index = collectNodeDependencies(fresh);
    expect(index.size).toBe(all(fresh.nodes).length);
  });
});

describe('compiler-persisted table shapes', () => {
  function bodyTable(visual: LocalNode): LocalNode {
    const table = (visual.children ?? []).find((child) => child.type === 'table');
    if (!table) throw new Error('Missing table body.');
    return table;
  }

  const source = [
    '<table label="Prices">',
    '| Name | Price |',
    '| --- | --- |',
    '| Alpha | 1 |',
    '| Beta | 2 |',
    '</table>',
    '',
    '<chart title="Sales">',
    '| Name | Value |',
    '| --- | --- |',
    '| Gamma | 3 |',
    '</chart>',
    '',
    '<timeline title="Plan">',
    '| Task | Start | Duration |',
    '| --- | --- | --- |',
    '| Design | 0 | 2 |',
    '</timeline>',
  ].join('\n');

  it('persists frozen header names and cell ids for table, chart and timeline', () => {
    const document = compile(source);
    const shapes = document.tableShapes;
    expect(shapes).toBeDefined();
    expect(Object.isFrozen(shapes)).toBe(true);

    const table = findComponent(document, 'table');
    const chart = findComponent(document, 'chart');
    const timeline = findComponent(document, 'timeline');
    expect(Object.keys(shapes!)).toEqual([table.id, chart.id, timeline.id]);

    const samples: [LocalNode, string, number][] = [
      [table, 'Name', 2],
      [chart, 'Name', 1],
      [timeline, 'Task', 1],
    ];
    for (const [visual, firstHeader, rowCount] of samples) {
      const shape = shapes?.[visual.id];
      expect(shape).toBeDefined();
      expect(Object.isFrozen(shape)).toBe(true);
      expect(Object.isFrozen(shape?.header)).toBe(true);
      expect(Object.isFrozen(shape?.rowIds)).toBe(true);
      expect(shape?.header[0]).toBe(firstHeader);
      expect(shape?.rowIds).toHaveLength(rowCount);

      const rows = (bodyTable(visual).children ?? []).filter((row) => row.type === 'tableRow');
      expect(shape?.header).toEqual(
        (rows[0].children ?? []).map((cell) => (cell.children ?? []).map((part) => part.value ?? '').join('')),
      );
      expect(shape?.rowIds).toEqual(
        rows.slice(1).map((row) => (row.children ?? []).map((cell) => cell.id)),
      );
      for (const row of shape?.rowIds ?? []) {
        expect(Object.isFrozen(row)).toBe(true);
      }
    }

    const cellIds = new Set(
      all(document.nodes).filter((node) => node.type === 'tableCell').map((node) => node.id),
    );
    for (const shape of Object.values(shapes!)) {
      for (const row of shape.rowIds) {
        for (const id of row) {
          expect(typeof id).toBe('string');
          expect(cellIds.has(id)).toBe(true);
        }
      }
    }
    expect(() => JSON.stringify(shapes)).not.toThrow();
  });

  it('omits the field when a document has no table-backed visual', () => {
    expect(compile('文本。').tableShapes).toBeUndefined();
  });

  it('keeps hand-built documents usable without the field', () => {
    const document: LocalDocument = {
      syntax: 'local',
      source: '',
      nodes: [
        makeNode('para-1', 'paragraph', {
          children: [makeNode('interp-1', 'interpolation', { value: 'total' })],
        }),
      ],
      initialState: { total: 1 },
      bindings: {},
    };
    expect(document.tableShapes).toBeUndefined();
    expect(collectNodeDependencies(document).get('para-1')).toEqual(['total']);
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
