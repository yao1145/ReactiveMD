import type { LocalDocument, LocalNode, LocalValueKind } from '../types';
import { kernelRule, type KernelRule } from '../../contracts/component-kernel';
import type { AttrMap, Entry, ReportDiagnostic } from './compiler-structure';
import { meaningful, parseNumberText, plainText, hasInterpolation, typeName } from './compiler-values';

/** Only the state consumed by table validation and selection projection. */
interface TableCompileState {
  readonly entries: Entry[];
  readonly attrs: Map<string, AttrMap>;
  readonly tables: Map<string, LocalNode>;
  readonly tableShapes: Map<string, TableShape | null>;
  readonly selections: Map<string, string[]>;
  readonly expressionKinds: Map<string, LocalValueKind | null>;
  readonly report: ReportDiagnostic;
}

export interface TableShape {
  header: string[];
  rows: LocalNode[][];
}

function tableShape(table: LocalNode, state: TableCompileState, component: Entry): TableShape | null {
  const rows = (table.children ?? []).filter((node) => node.type === 'tableRow');
  if (!rows.length) {
    state.report('local.table.header', { key: 'local.table.header.missing', params: { name: component.name } }, table.range.start, table.range.end);
    return null;
  }
  const header = rows[0].children ?? [];
  const names: string[] = [];
  for (const cell of header) {
    if (hasInterpolation(cell)) {
      state.report('local.table.header', { key: 'local.table.header.interpolation' }, cell.range.start, cell.range.end);
      return null;
    }
    const text = plainText(cell).trim();
    if (!text) {
      state.report('local.table.header', { key: 'local.table.header.empty' }, cell.range.start, cell.range.end);
      return null;
    }
    if (names.includes(text)) {
      state.report('local.table.header', { key: 'local.table.header.duplicate', params: { name: text } }, cell.range.start, cell.range.end);
      return null;
    }
    names.push(text);
  }
  if (!names.length) {
    state.report('local.table.header', { key: 'local.table.header.empty' }, table.range.start, table.range.end);
    return null;
  }
  const dataRows: LocalNode[][] = [];
  for (const row of rows.slice(1)) {
    const cells = row.children ?? [];
    if (cells.length !== names.length) {
      state.report('local.table.row', { key: 'local.table.row.mismatch', params: { header: names.length, row: cells.length } }, row.range.start, row.range.end);
      continue;
    }
    dataRows.push(cells);
  }
  return { header: names, rows: dataRows };
}

function cellNumeric(cell: LocalNode, state: TableCompileState): boolean {
  const kids = meaningful(cell.children);
  if (kids.length === 1 && kids[0].type === 'interpolation') {
    const kind = state.expressionKinds.get(kids[0].id);
    if (kind === 'number' || kind === null) return true;
    if (kind !== undefined) return false;
  }
  const text = plainText(cell).trim();
  if (!text) return false;
  const value = parseNumberText(text);
  return value !== null;
}

function requireNumericColumn(
  shape: TableShape,
  column: number,
  state: TableCompileState,
  component: Entry,
  label: string,
): void {
  const name = shape.header[column];
  const timeline = kernelRule(component.kernel, 'timeline-table') !== undefined;
  shape.rows.forEach((row, rowIndex) => {
    const cell = row[column];
    if (!cell) return;
    const kids = meaningful(cell.children);
    if (kids.length === 1 && kids[0].type === 'interpolation') {
      const kind = state.expressionKinds.get(kids[0].id);
      if (kind !== undefined && kind !== null && kind !== 'number') {
        state.report('local.chart.numeric', {
            key: timeline ? 'local.timeline.numeric.expression' : 'local.chart.numeric.expression',
            params: { name, row: rowIndex + 1, kind: typeName(kind) },
          }, cell.range.start, cell.range.end);
      }
      return;
    }
    if (!cellNumeric(cell, state)) {
      state.report('local.chart.numeric', {
          key: timeline ? 'local.timeline.numeric.plain' : 'local.chart.numeric.plain',
          params: { name, row: rowIndex + 1, value: plainText(cell).trim() || 'empty' },
        }, cell.range.start, cell.range.end);
    }
  });
  void label;
}

function columnIndex(header: string[], name: string): number {
  return header.indexOf(name);
}

export function validateTables(state: TableCompileState): void {
  for (const entry of state.entries) {
    if (!kernelRule(entry.kernel, 'single-table')) continue;
    const chart = kernelRule(entry.kernel, 'chart-table');
    const timeline = kernelRule(entry.kernel, 'timeline-table');
    if (!chart && !timeline) {
      tableShapeFor(entry, state);
      continue;
    }
    const shape = tableShapeFor(entry, state);
    if (!shape) continue;
    if (chart) validateChart(entry, shape, state, chart);
    else if (timeline) validateTimeline(entry, shape, state, timeline);
  }
}

function tableShapeFor(entry: Entry, state: TableCompileState): TableShape | null {
  if (state.tableShapes.has(entry.node.id)) return state.tableShapes.get(entry.node.id) ?? null;
  const table = state.tables.get(entry.node.id);
  const shape = table ? tableShape(table, state, entry) : null;
  state.tableShapes.set(entry.node.id, shape);
  return shape;
}

/**
 * Projects the compiler's table shapes onto the document as plain, frozen
 * data. Only header text and cell node ids are kept, so the persisted form is
 * serializable and never references nodes or forms cycles.
 */
export function attachTableShapes(document: LocalDocument, shapes: Map<string, TableShape | null>): void {
  if (shapes.size === 0) return;
  const record: Record<
    string,
    { readonly header: readonly string[]; readonly rowIds: readonly (readonly string[])[] }
  > = Object.create(null);
  let count = 0;
  for (const [id, shape] of shapes) {
    if (!shape) continue;
    record[id] = Object.freeze({
      header: Object.freeze([...shape.header]),
      rowIds: Object.freeze(shape.rows.map((row) => Object.freeze(row.map((cell) => cell.id)))),
    });
    count += 1;
  }
  if (count === 0) return;
  document.tableShapes = Object.freeze(record);
}

/**
 * Turn the `key` column of a table/chart into the stable selection options used
 * by its optional `bind`. Selection is only compiled when `key` is present, so
 * old documents keep the renderer's internal selection state.
 */
export function computeSelections(state: TableCompileState): void {
  for (const entry of state.entries) {
    const rule = kernelRule(entry.kernel, 'table-selection');
    if (!rule) continue;
    const attrs = state.attrs.get(entry.node.id) ?? {};
    const keyInfo = attrs[rule.key];
    if (!keyInfo) continue;
    const keyName = typeof keyInfo.value === 'string' ? keyInfo.value.trim() : '';
    if (!keyName) {
      state.report('local.selection.key', { key: 'local.selection.key.empty', params: { component: entry.name } }, keyInfo.offset, undefined);
      state.selections.set(entry.node.id, ['']);
      continue;
    }
    const shape = tableShapeFor(entry, state);
    if (!shape) {
      state.selections.set(entry.node.id, ['']);
      continue;
    }
    const column = columnIndex(shape.header, keyName);
    if (column < 0) {
      state.report('local.selection.key', { key: 'local.selection.key.missing-column', params: { component: entry.name, name: keyName } }, keyInfo.offset, undefined);
      state.selections.set(entry.node.id, ['']);
      continue;
    }
    const values: string[] = [];
    const seen = new Set<string>();
    shape.rows.forEach((row, rowIndex) => {
      const cell = row[column];
      if (!cell) return;
      if (hasInterpolation(cell)) {
        state.report('local.selection.key', { key: 'local.selection.key.interpolation', params: { component: entry.name, name: keyName, row: rowIndex + 1 } }, cell.range.start, cell.range.end);
        return;
      }
      const text = plainText(cell).trim();
      if (!text) {
        state.report('local.selection.key', { key: 'local.selection.key.empty-cell', params: { component: entry.name, name: keyName, row: rowIndex + 1 } }, cell.range.start, cell.range.end);
        return;
      }
      if (seen.has(text)) {
        state.report('local.selection.key', { key: 'local.selection.key.duplicate', params: { component: entry.name, name: keyName, value: text } }, cell.range.start, cell.range.end);
        return;
      }
      seen.add(text);
      values.push(text);
    });
    state.selections.set(entry.node.id, ['', ...values]);
    const initial = attrs.initial;
    if (initial && typeof initial.value === 'string' && initial.value !== '' && !values.includes(initial.value)) {
      state.report('local.initial.option', { key: 'local.selection.key.initial', params: { value: initial.value, component: entry.name, name: keyName } }, initial.offset, undefined);
    }
  }
}

function validateChart(
  entry: Entry,
  shape: TableShape,
  state: TableCompileState,
  rule: Extract<KernelRule, { kind: 'chart-table' }>,
): void {
  const attrs = state.attrs.get(entry.node.id) ?? {};
  const kind = typeof attrs[rule.chartKind]?.value === 'string' ? String(attrs[rule.chartKind].value) : 'bar';
  const header = shape.header;
  for (const name of header) {
    if (name.includes(',')) {
      state.report('local.chart.column', { key: 'local.chart.column.comma', params: { name } }, entry.node.range.start, entry.node.range.end);
    }
  }
  const xName = typeof attrs[rule.x]?.value === 'string' ? String(attrs[rule.x].value).trim() : '';
  const yRaw = typeof attrs[rule.y]?.value === 'string' ? String(attrs[rule.y].value).trim() : '';
  if (xName && columnIndex(header, xName) < 0) {
    state.report('local.chart.column', { key: 'local.chart.column.x-missing', params: { name: xName } }, attrs[rule.x]?.offset ?? entry.node.range.start, undefined);
  }
  let yNames: string[] = [];
  if (yRaw) {
    yNames = yRaw.split(',').map((name) => name.trim()).filter(Boolean);
    if (!yNames.length) {
      state.report('local.chart.column', { key: 'local.chart.column.y-required' }, attrs[rule.y]?.offset ?? entry.node.range.start, undefined);
    }
    for (const name of yNames) {
      if (columnIndex(header, name) < 0) {
        state.report('local.chart.column', { key: 'local.chart.column.y-missing', params: { name } }, attrs[rule.y]?.offset ?? entry.node.range.start, undefined);
      }
    }
  }

  let numeric: number[] = [];
  if (kind === 'bar' || kind === 'line' || kind === 'area') {
    const xColumn = xName ? Math.max(0, columnIndex(header, xName)) : 0;
    numeric = yNames.length
      ? yNames.map((name) => columnIndex(header, name)).filter((index) => index >= 0)
      : header.map((_, index) => index).filter((index) => index !== xColumn);
    if (!numeric.length) {
      state.report('local.chart.column', { key: 'local.chart.column.needs-numeric' }, entry.node.range.start, entry.node.range.end);
    }
  } else if (kind === 'scatter') {
    const xColumn = xName ? columnIndex(header, xName) : 0;
    if (xColumn < 0) {
      state.report('local.chart.column', { key: 'local.chart.column.scatter-x-missing', params: { name: xName } }, entry.node.range.start, undefined);
    } else {
      requireNumericColumn(shape, xColumn, state, entry, 'x');
    }
    numeric = yNames.length
      ? yNames.map((name) => columnIndex(header, name)).filter((index) => index >= 0)
      : header.map((_, index) => index).filter((index) => index !== xColumn);
    if (!numeric.length) {
      state.report('local.chart.column', { key: 'local.chart.column.scatter-needs-numeric' }, entry.node.range.start, entry.node.range.end);
    }
  } else if (kind === 'donut' || kind === 'pie') {
    if (header.length < 2) {
      state.report('local.chart.column', { key: 'local.chart.column.donut-columns' }, entry.node.range.start, entry.node.range.end);
      return;
    }
    if (yNames.length === 1) {
      const index = columnIndex(header, yNames[0]);
      if (index >= 0) numeric = [index];
    } else if (yNames.length > 1) {
      state.report('local.chart.column', { key: 'local.chart.column.donut-y' }, attrs[rule.y]?.offset ?? entry.node.range.start, undefined);
    } else if (header.length > 2) {
      state.report('local.chart.column', { key: 'local.chart.column.donut-need-y' }, entry.node.range.start, entry.node.range.end);
    } else {
      numeric = [1];
    }
  }

  numeric = [...new Set(numeric)];
  for (const column of numeric) requireNumericColumn(shape, column, state, entry, 'y');
  if (kind === 'donut' || kind === 'pie') {
    for (const column of numeric) {
      shape.rows.forEach((row, rowIndex) => {
        const cell = row[column];
        if (!cell) return;
        const kids = meaningful(cell.children);
        if (kids.length) return;
        const value = parseNumberText(plainText(cell).trim());
        if (value !== null && value < 0) {
          state.report('local.chart.negative', { key: 'local.chart.negative', params: { row: rowIndex + 1, value } }, cell.range.start, cell.range.end);
        }
      });
    }
  }
}

function validateTimeline(
  entry: Entry,
  shape: TableShape,
  state: TableCompileState,
  rule: Extract<KernelRule, { kind: 'timeline-table' }>,
): void {
  const headerSets = rule.headerSets.map((set) => ({
    title: set[0] ?? '',
    start: set[1] ?? '',
    duration: set[2] ?? '',
    notes: set[3] ?? '',
  }));
  const headers = headerSets.find((set) =>
    shape.header.includes(set.title) && shape.header.includes(set.start) && shape.header.includes(set.duration),
  );
  if (!headers) {
    state.report('local.timeline.header', { key: 'local.timeline.header.missing' }, entry.node.range.start, entry.node.range.end);
    return;
  }
  const allowed = new Set(Object.values(headers));
  for (const name of shape.header) {
    if (!allowed.has(name)) {
      state.report('local.timeline.header', { key: 'local.timeline.header.column', params: { name } }, entry.node.range.start, entry.node.range.end);
    }
  }
  for (const name of [headers.start, headers.duration]) {
    const column = columnIndex(shape.header, name);
    if (column >= 0) requireNumericColumn(shape, column, state, entry, name);
  }
  const startColumn = columnIndex(shape.header, headers.start);
  const durationColumn = columnIndex(shape.header, headers.duration);
  shape.rows.forEach((row, rowIndex) => {
    for (const column of [startColumn, durationColumn]) {
      if (column < 0) continue;
      const cell = row[column];
      if (!cell) continue;
      if (meaningful(cell.children).length) continue;
      const value = parseNumberText(plainText(cell).trim());
      if (value !== null && value < 0) {
        state.report('local.timeline.value', { key: 'local.timeline.value.negative', params: { name: shape.header[column], row: rowIndex + 1 } }, cell.range.start, cell.range.end);
      }
    }
  });
}
