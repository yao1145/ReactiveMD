import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  buildDataTableModel,
  DataTableView,
  encodeDataTableKey,
  evaluateDataTableRows,
} from '../src/local/data-table';
import { defaultLocalize } from '../src/local/i18n';
import type { LocalNode, LocalRuntime, LocalValue } from '../src/local/types';

/* ------------------------------------------------------------- fixtures */

function fakeRuntime(values: Record<string, LocalValue>): Pick<LocalRuntime, 'evaluate'> {
  return {
    evaluate(name: string): LocalValue {
      if (!Object.hasOwn(values, name)) throw new Error(`Unknown value "${name}"`);
      return values[name];
    },
  };
}

function columnNode(index: number, label: string, value: string): LocalNode {
  return {
    type: 'component',
    id: `column-${index}`,
    name: 'column',
    range: { start: 10 + index * 10, end: 15 + index * 10 },
    attrs: { label, value },
  };
}

function dataTableNode(options: {
  attrs?: Record<string, string | undefined>;
  children?: LocalNode[];
} = {}): LocalNode {
  const attrs: Record<string, string> = {
    label: 'Selected topics',
    rows: '{{ subjects }}',
    key: '{{ item }}',
  };
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value !== undefined) attrs[name] = value;
  }
  return {
    type: 'component',
    id: 'table-1',
    name: 'data-table',
    range: { start: 0, end: 9 },
    attrs,
    children: options.children ?? [columnNode(0, 'Topic', '{{ item }}')],
  };
}

function renderTable(node: LocalNode, values: Record<string, LocalValue> = {}): string {
  return renderToStaticMarkup(
    <DataTableView node={node} visible runtime={fakeRuntime(values)} t={defaultLocalize} />,
  );
}

/* --------------------------------------------------------------- renderer */

describe('data-table rendering', () => {
  it('renders native table semantics, an accessible label and horizontal scrolling', () => {
    const html = renderTable(dataTableNode(), {
      subjects: ['chemistry', 'physics'],
    });

    expect(html).toContain('class="md-table-scroll local-data-table-scroll"');
    expect(html).toContain('<table class="md-table local-data-table" aria-label="Selected topics">');
    expect(html).toContain('<thead>');
    expect(html).toContain('<th scope="col">Topic</th>');
    expect(html).toContain('<tbody>');
    expect(html).toContain('chemistry');
    expect(html).toContain('physics');
  });

  it('shows one error block and no stale rows when rows cannot be resolved', () => {
    const html = renderTable(dataTableNode({ attrs: { rows: '{{ 5 }}' } }));
    expect(html).toContain('local-data-table-error');
    expect(html).toContain('Rows must evaluate to a list.');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('chemistry');
  });

  it('rejects a row list larger than max-rows before rendering any row', () => {
    const html = renderTable(dataTableNode({ attrs: { 'max-rows': '2' } }), {
      subjects: ['one', 'two', 'three'],
    });
    expect(html).toContain('Too many rows for this table.');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('one');
  });

  it('keeps independent cells when one cell expression fails', () => {
    const html = renderTable(
      dataTableNode({
        children: [
          columnNode(0, 'Topic', '{{ item }}'),
          columnNode(1, 'Ratio', '{{ 10 / index }}'),
        ],
      }),
      { subjects: ['alpha', 'beta', 'gamma'] },
    );

    expect(html.match(/local-data-table-cell-error/g)).toHaveLength(1);
    expect(html).toContain('Cannot compute');
    expect(html).toContain('alpha');
    expect(html).toContain('beta');
    expect(html).toContain('gamma');
    expect(html).toContain('>10<');
    expect(html).toContain('>5<');
  });

  it('keeps the headers and shows an explicit empty state', () => {
    const html = renderTable(dataTableNode(), { subjects: [] });
    expect(html).toContain('<th scope="col">Topic</th>');
    expect(html).toContain('local-data-table-empty');
    expect(html).toContain('No rows');
  });

  it('rejects duplicate row keys instead of reusing or dropping rows', () => {
    const html = renderTable(dataTableNode(), { subjects: ['same', 'same'] });
    expect(html).toContain('Every row needs a unique, non-empty key.');
    expect(html).not.toContain('<table');
  });

  it('rejects a non-column child definition', () => {
    const html = renderTable(
      dataTableNode({
        children: [
          columnNode(0, 'Topic', '{{ item }}'),
          { type: 'text', id: 'stray', range: { start: 30, end: 35 }, value: 'stray' },
        ],
      }),
      { subjects: ['a'] },
    );
    expect(html).toContain('column definitions');
    expect(html).not.toContain('<table');
  });

  it('rejects a missing label and an invalid max-rows value', () => {
    const missing = renderTable(dataTableNode({ attrs: { label: ' ' } }), { subjects: ['a'] });
    expect(missing).toContain('Data table requires a label.');

    const invalid = renderTable(dataTableNode({ attrs: { 'max-rows': '0' } }), {
      subjects: ['a'],
    });
    expect(invalid).toContain('max-rows must be a positive integer');
    expect(invalid).not.toContain('<table');
  });
});

/* ------------------------------------------------------------------ model */

describe('data-table model', () => {
  it('encodes primitive keys with their type and normalizes negative zero', () => {
    expect(encodeDataTableKey(1)).toBe('n:1');
    expect(encodeDataTableKey('1')).toBe('s:1');
    expect(encodeDataTableKey(-0)).toBe('n:0');
    expect(encodeDataTableKey(0)).toBe('n:0');
    expect(encodeDataTableKey('')).toBeNull();
    expect(encodeDataTableKey(Number.NaN)).toBeNull();
    expect(encodeDataTableKey(Number.POSITIVE_INFINITY)).toBeNull();
    expect(encodeDataTableKey(true)).toBeNull();
    expect(encodeDataTableKey(null)).toBeNull();
  });

  it('resolves rows through dependency getters', () => {
    const runtime = fakeRuntime({ subjects: ['a', 'b'] });
    expect(evaluateDataTableRows(runtime, 'subjects')).toEqual(['a', 'b']);
    expect(() => evaluateDataTableRows(runtime, '5')).toThrow();
    expect(() => evaluateDataTableRows(runtime, 'missing')).toThrow();
  });

  it('requires the key to depend on item only', () => {
    const runtime = fakeRuntime({});
    const base = {
      rows: ['a'] as LocalValue[],
      columns: [{ label: 'A', value: 'item' }],
      runtime,
    };
    expect(buildDataTableModel({ ...base, keyExpression: 'item' })).toMatchObject({ ok: true });
    expect(buildDataTableModel({ ...base, keyExpression: 'index' })).toEqual({
      ok: false,
      failure: 'key',
    });
    expect(
      buildDataTableModel({ ...base, keyExpression: 'item + suffix' }),
    ).toEqual({ ok: false, failure: 'key' });
  });

  it('rejects duplicate, empty and non-finite keys', () => {
    const runtime = fakeRuntime({});
    const build = (rows: LocalValue[]) =>
      buildDataTableModel({
        rows,
        columns: [{ label: 'A', value: 'item' }],
        keyExpression: 'item',
        runtime,
      });
    expect(build(['same', 'same'])).toEqual({ ok: false, failure: 'key' });
    expect(build([''])).toEqual({ ok: false, failure: 'key' });
    expect(build([Number.NaN])).toEqual({ ok: false, failure: 'rows' });
  });

  it('enforces row, column and max-rows budgets before building cells', () => {
    const runtime = fakeRuntime({});
    const columns = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ label: `C${index}`, value: 'item' }));
    const base = { columns: columns(1), runtime, keyExpression: 'item' };

    expect(buildDataTableModel({ ...base, rows: ['a', 'b', 'c'], maxRows: 2 })).toEqual({
      ok: false,
      failure: 'rows-budget',
    });
    expect(buildDataTableModel({ ...base, rows: ['a'], maxRows: 0 })).toEqual({
      ok: false,
      failure: 'max-rows',
    });
    expect(buildDataTableModel({ ...base, rows: ['a'], maxRows: 1_001 })).toEqual({
      ok: false,
      failure: 'max-rows',
    });
    expect(
      buildDataTableModel({ rows: ['a'], columns: [], runtime, keyExpression: 'item' }),
    ).toEqual({ ok: false, failure: 'columns' });
    expect(
      buildDataTableModel({
        rows: ['a'],
        columns: columns(21),
        runtime,
        keyExpression: 'item',
      }),
    ).toEqual({ ok: false, failure: 'columns' });
  });

  it('enforces the cumulative text budget across the whole table', () => {
    const runtime = fakeRuntime({
      s1: 'a'.repeat(60_000),
      s2: 'b'.repeat(60_000),
    });
    expect(
      buildDataTableModel({
        rows: ['x'],
        columns: [
          { label: 'A', value: 's1' },
          { label: 'B', value: 's2' },
        ],
        keyExpression: 'item',
        runtime,
      }),
    ).toEqual({ ok: false, failure: 'text-budget' });

    expect(
      buildDataTableModel({
        rows: ['x'],
        columns: [{ label: 'ABC', value: 'item' }],
        keyExpression: 'item',
        runtime,
        budget: 3,
      }),
    ).toEqual({ ok: false, failure: 'text-budget' });

    expect(
      buildDataTableModel({
        rows: ['x'],
        columns: [{ label: 'AB', value: 'item' }],
        keyExpression: 'item',
        runtime,
        budget: 6,
      }),
    ).toMatchObject({ ok: true });
  });

  it('isolates cell failures and produces an explicit empty model', () => {
    const runtime = fakeRuntime({});
    const result = buildDataTableModel({
      rows: ['a', 'b'],
      columns: [
        { label: 'Ratio', value: '10 / index' },
        { label: 'Topic', value: 'item' },
      ],
      keyExpression: 'item',
      runtime,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.empty).toBe(false);
    expect(result.model.rows[0].cells[0]).toEqual({ ok: false, text: '' });
    expect(result.model.rows[0].cells[1]).toEqual({ ok: true, text: 'a' });
    expect(result.model.rows[1].cells[0]).toEqual({ ok: true, text: '10' });
    expect(result.model.rows[1].cells[1]).toEqual({ ok: true, text: 'b' });

    const empty = buildDataTableModel({
      rows: [],
      columns: [{ label: 'Topic', value: 'item' }],
      keyExpression: 'item',
      runtime,
    });
    expect(empty).toEqual({
      ok: true,
      model: { columns: ['Topic'], rows: [], empty: true },
    });
  });
});
