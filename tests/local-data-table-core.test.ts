import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local';
import type { LocalDocument, LocalNode } from '../src/local/types';

const SUBJECTS = [
  '<multi-select bind="subjects" label="Subjects">',
  '<option value="chemistry">Chemistry</option>',
  '<option value="physics">Physics</option>',
  '</multi-select>',
].join('\n');

function compile(source: string): LocalDocument {
  const result = compileLocal(source);
  if (!result.ok) {
    throw new Error(result.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('\n'));
  }
  return result.document;
}

function codes(source: string): string[] {
  return compileLocal(source).diagnostics.map((diagnostic) => diagnostic.code);
}

function all(nodes: LocalNode[]): LocalNode[] {
  return nodes.flatMap((node) => [node, ...all(node.children ?? [])]);
}

function tables(count: number, columns: number, maxRows = 100): string[] {
  return Array.from({ length: count }, (_, index) => [
    `<data-table label="Table ${index}" rows="{{ subjects }}" key="{{ item }}" max-rows="${maxRows}">`,
    ...Array.from({ length: columns }, (_, column) => `<column label="C${column}" value="{{ item }}">`),
    '</data-table>',
  ].join('\n'));
}

describe('data-table compilation', () => {
  it('accepts the canonical generated table and keeps plain nodes only', () => {
    const document = compile([
      SUBJECTS,
      '<data-table label="Selected topics" rows="{{ subjects }}" key="{{ item }}" max-rows="100">',
      '<column label="Topic" value="{{ item }}">',
      "<column label=\"Fee\" value=\"{{ item == 'chemistry' ? 100 : 80 }}\">",
      '<column label="Position" value="{{ index + 1 }}">',
      '</data-table>',
    ].join('\n'));
    const components = all(document.nodes).filter((node) => node.type === 'component');
    expect(components.filter((node) => node.name === 'data-table')).toHaveLength(1);
    expect(components.filter((node) => node.name === 'column')).toHaveLength(3);
    // This is the new syntax, not the legacy Markdown table/chart pipeline.
    expect(document.validations).toBeUndefined();
    expect(() => structuredClone(document)).not.toThrow();
  });

  it('lets row locals shadow same-named globals', () => {
    const document = compile([
      '<number bind="item" label="Item" initial="1" min="0" max="5">',
      SUBJECTS,
      '<data-table label="Rows" rows="{{ subjects }}" key="{{ item }}">',
      "<column label=\"Topic\" value=\"{{ item == 'chemistry' ? 'yes' : 'no' }}\">",
      '</data-table>',
    ].join('\n'));
    expect(all(document.nodes).filter((node) => node.name === 'data-table')).toHaveLength(1);
  });

  it('supports numeric rows and keeps generated values scoped', () => {
    const document = compile([
      '<computed name="nums" value="{{ [1, 2, 3] }}">',
      '<data-table label="Numbers" rows="{{ nums }}" key="{{ item }}">',
      '<column label="Value" value="{{ item + 1 }}">',
      '<column label="Index" value="{{ index }}">',
      '</data-table>',
    ].join('\n'));
    expect(all(document.nodes).filter((node) => node.name === 'data-table')).toHaveLength(1);
    expect(codes([
      '<computed name="nums" value="{{ [1, 2, 3] }}">',
      '<data-table label="Numbers" rows="{{ nums }}" key="{{ item }}">',
      '<column label="All" value="{{ nums }}">',
      '</data-table>',
    ].join('\n'))).toContain('local.data-table.value');
  });

  it('validates table structure and column labels', () => {
    expect(codes([
      SUBJECTS, '<data-table label="Empty" rows="{{ subjects }}" key="{{ item }}">', '</data-table>',
    ].join('\n'))).toContain('local.structure.children');
    expect(codes([
      SUBJECTS, '<data-table label="Wrong" rows="{{ subjects }}" key="{{ item }}"><panel></panel></data-table>',
    ].join('\n'))).toContain('local.structure.children');
    expect(codes([
      SUBJECTS,
      '<data-table label="Too many" rows="{{ subjects }}" key="{{ item }}">',
      ...Array.from({ length: 21 }, (_, index) => `<column label="C${index}" value="{{ item }}">`),
      '</data-table>',
    ].join('\n'))).toContain('local.budget.data-table.columns');
    expect(codes([
      SUBJECTS,
      '<data-table label="No label" rows="{{ subjects }}" key="{{ item }}">',
      '<column label="" value="{{ item }}">',
      '</data-table>',
    ].join('\n'))).toContain('local.data-table.column');
    expect(codes([
      SUBJECTS,
      '<data-table label="{{ item }}" rows="{{ subjects }}" key="{{ item }}">',
      '<column label="C" value="{{ item }}">',
      '</data-table>',
    ].join('\n'))).toContain('local.attribute.static');
    expect(codes([
      SUBJECTS,
      '<data-table label="Interpolated" rows="{{ subjects }}" key="{{ item }}">',
      '<column label="{{ item }}" value="{{ item }}">',
      '</data-table>',
    ].join('\n'))).toContain('local.attribute.static');
  });

  it('validates rows, value and key expressions', () => {
    const base = (attributes: string, column = '<column label="C" value="{{ item }}">') => [
      SUBJECTS, `<data-table label="T" ${attributes}>`, column, '</data-table>',
    ].join('\n');
    expect(codes(base('key="{{ item }}"'))).toContain('local.attribute.required');
    expect(codes(base('rows="{{ subjects }}"'))).toContain('local.attribute.required');
    expect(codes(base('rows="subjects" key="{{ item }}"'))).toContain('local.data-table.rows');
    expect(codes(base('rows="{{ 3 }}" key="{{ item }}"'))).toContain('local.data-table.rows');
    expect(codes(base('rows="{{ missing }}" key="{{ item }}"'))).toContain('local.binding.unknown');
    expect(codes(base('rows="{{ item }}" key="{{ item }}"'))).toContain('local.binding.unknown');
    expect(codes(base('rows="{{ subjects }}" key="{{ \'fixed\' }}"'))).toContain('local.data-table.key');
    expect(codes(base('rows="{{ subjects }}" key="{{ index }}"'))).toContain('local.data-table.key');
    expect(codes(base("rows=\"{{ subjects }}\" key=\"{{ item + suffix }}\"")))
      .toContain('local.binding.unknown');
    expect(codes([
      '<const name="suffix" value="{{ \'x\' }}">',
      base('rows="{{ subjects }}" key="{{ item + suffix }}"'),
    ].join('\n'))).toContain('local.data-table.key');
    expect(codes(base("rows=\"{{ subjects }}\" key=\"{{ item == 'chemistry' }}\"")))
      .toContain('local.data-table.key');
    expect(codes(base('rows="{{ subjects }}" key="{{ item }}"', '<column label="C" value="{{ subjects }}">')))
      .toContain('local.data-table.value');
    expect(codes(base('rows="{{ subjects }}" key="{{ item }}"', '<column label="C" value="literal">')))
      .toContain('local.data-table.value');
  });

  it('validates max-rows bounds while keeping the default at 100', () => {
    const table = (maxRows: string) => [
      SUBJECTS,
      `<data-table label="T" rows="{{ subjects }}" key="{{ item }}" max-rows="${maxRows}">`,
      '<column label="C" value="{{ item }}">', '</data-table>',
    ].join('\n');
    expect(codes(table('1001'))).toContain('local.attribute.range');
    expect(codes(table('0'))).toContain('local.attribute.type');
    expect(codes(table('1.5'))).toContain('local.attribute.type');
  });

  it('enforces document row and cell budgets including hidden tables', () => {
    const rowCodes = codes([SUBJECTS, '<if when="{{ true }}">', ...tables(21, 1), '</if>'].join('\n'));
    expect(rowCodes).toContain('local.budget.data-table.rows');

    const cellCodes = codes([SUBJECTS, ...tables(11, 10)].join('\n'));
    expect(cellCodes).toContain('local.budget.data-table.cells');
    expect(cellCodes).not.toContain('local.budget.data-table.rows');
  });
});
