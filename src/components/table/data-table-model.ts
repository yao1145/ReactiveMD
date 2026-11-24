import type { LocalValue } from '../../contracts/runtime-types';
import {
  DEFAULT_LOCAL_DATA_TABLE_ROWS,
  MAX_LOCAL_DATA_TABLE_COLUMNS,
  MAX_LOCAL_DATA_TABLE_ROWS,
  MAX_LOCAL_VALUE_CHARACTERS,
} from '../../contracts/limits';
import { compileExpression, type LocalExpression } from '../../local/evaluation/expression/compile';

type Localize = (english: string, chinese: string) => string;

/* --------------------------------------------------------------- failures */

export type DataTableFailure =
  | 'label'
  | 'columns'
  | 'max-rows'
  | 'rows'
  | 'rows-budget'
  | 'key'
  | 'text-budget';

export class DataTableFailureError extends Error {
  readonly failure: DataTableFailure;

  constructor(failure: DataTableFailure) {
    super(failure);
    this.name = 'DataTableFailureError';
    this.failure = failure;
  }
}

export interface DataTableCell {
  ok: boolean;
  text: string;
}

export interface DataTableRow {
  key: string;
  cells: DataTableCell[];
}

export interface DataTableColumnSpec {
  label: string;
  value: string;
}

export interface DataTableModel {
  columns: string[];
  rows: DataTableRow[];
  empty: boolean;
}

export type DataTableBuildResult =
  | { ok: true; model: DataTableModel }
  | { ok: false; failure: DataTableFailure };

export interface DataTableBuildOptions {
  readonly rows: readonly LocalValue[];
  readonly columns: readonly DataTableColumnSpec[];
  readonly keyExpression: string;
  readonly runtime: { evaluate(expression: string): LocalValue };
  readonly maxRows?: number;
  readonly budget?: number;
}

/* ----------------------------------------------------------------- helpers */

function scalarText(value: LocalValue): string | null {
  if (value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return null;
}

export function encodeDataTableKey(value: LocalValue): string | null {
  if (typeof value === 'string') return value === '' ? null : `s:${value}`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return `n:${value === 0 ? 0 : value}`;
  }
  return null;
}

function scopedEnvironment(
  runtime: { evaluate(expression: string): LocalValue },
  dependencies: readonly string[],
  locals: Record<string, LocalValue>,
): Record<string, LocalValue> {
  const environment: Record<string, LocalValue> = { ...locals };
  for (const name of dependencies) {
    if (Object.hasOwn(locals, name)) continue;
    Object.defineProperty(environment, name, {
      enumerable: true,
      configurable: true,
      get() {
        return runtime.evaluate(name);
      },
    });
  }
  return environment;
}

function rowArrayProblem(rows: readonly LocalValue[]): DataTableFailure | null {
  if (rows.length === 0) return null;
  const first = typeof rows[0];
  if (first !== 'string' && first !== 'number') return 'rows';
  for (const item of rows) {
    if (typeof item !== first) return 'rows';
    if (typeof item === 'number' && !Number.isFinite(item)) return 'rows';
  }
  return null;
}

export function evaluateDataTableRows(
  runtime: { evaluate(expression: string): LocalValue },
  expression: string,
): LocalValue[] {
  let compiled: LocalExpression;
  try {
    compiled = compileExpression(expression);
  } catch {
    throw new DataTableFailureError('rows');
  }
  let value: LocalValue;
  try {
    value = compiled.evaluate(scopedEnvironment(runtime, compiled.dependencies, {}));
  } catch {
    throw new DataTableFailureError('rows');
  }
  if (!Array.isArray(value)) throw new DataTableFailureError('rows');
  const problem = rowArrayProblem(value);
  if (problem) throw new DataTableFailureError(problem);
  return value;
}

/* ------------------------------------------------------------------ build */

export function buildDataTableModel(options: DataTableBuildOptions): DataTableBuildResult {
  const { rows, columns, keyExpression, runtime } = options;
  const maxRows = options.maxRows ?? DEFAULT_LOCAL_DATA_TABLE_ROWS;
  const budget = options.budget ?? MAX_LOCAL_VALUE_CHARACTERS;

  if (
    !Number.isSafeInteger(maxRows)
    || maxRows <= 0
    || maxRows > MAX_LOCAL_DATA_TABLE_ROWS
  ) {
    return { ok: false, failure: 'max-rows' };
  }
  if (columns.length < 1 || columns.length > MAX_LOCAL_DATA_TABLE_COLUMNS) {
    return { ok: false, failure: 'columns' };
  }
  const rowsProblem = rowArrayProblem(rows);
  if (rowsProblem) return { ok: false, failure: rowsProblem };
  if (rows.length > maxRows) return { ok: false, failure: 'rows-budget' };

  let keyed: LocalExpression;
  try {
    keyed = compileExpression(keyExpression);
  } catch {
    return { ok: false, failure: 'key' };
  }
  const keyDependencies = keyed.dependencies;
  if (keyDependencies.length !== 1 || keyDependencies[0] !== 'item') {
    return { ok: false, failure: 'key' };
  }

  const compiledColumns = columns.map((column) => {
    try {
      return { spec: column, expression: compileExpression(column.value) };
    } catch {
      return { spec: column, expression: null };
    }
  });

  let textLength = 0;
  for (const column of columns) textLength += column.label.length;
  if (rows.length === 0) textLength += Math.max('No rows'.length, '没有数据'.length);
  if (textLength > budget) return { ok: false, failure: 'text-budget' };

  const charge = (length: number): void => {
    textLength += length;
    if (textLength > budget) throw new DataTableFailureError('text-budget');
  };
  const errorTextLength = Math.max('Cannot compute'.length, '无法计算'.length);

  const seen = new Set<string>();
  const modelRows: DataTableRow[] = [];

  try {
    for (let index = 0; index < rows.length; index += 1) {
      const item = rows[index];
      const locals: Record<string, LocalValue> = { item, index };

      let key: string | null = null;
      try {
        key = encodeDataTableKey(keyed.evaluate(locals));
      } catch {
        return { ok: false, failure: 'key' };
      }
      if (key === null) return { ok: false, failure: 'key' };
      if (seen.has(key)) return { ok: false, failure: 'key' };
      charge(key.length);
      seen.add(key);

      const cells: DataTableCell[] = [];
      for (const column of compiledColumns) {
        if (!column.expression) {
          charge(errorTextLength);
          cells.push({ ok: false, text: '' });
          continue;
        }
        let text: string | null = null;
        try {
          text = scalarText(
            column.expression.evaluate(
              scopedEnvironment(runtime, column.expression.dependencies, locals),
            ),
          );
        } catch {
          text = null;
        }
        if (text === null) {
          charge(errorTextLength);
          cells.push({ ok: false, text: '' });
          continue;
        }
        charge(text.length);
        cells.push({ ok: true, text });
      }

      modelRows.push({ key, cells });
    }
  } catch (error) {
    if (error instanceof DataTableFailureError) {
      return { ok: false, failure: error.failure };
    }
    return { ok: false, failure: 'rows' };
  }

  return {
    ok: true,
    model: {
      columns: columns.map((column) => column.label),
      rows: modelRows,
      empty: rows.length === 0,
    },
  };
}

/* --------------------------------------------------------------- messages */

export function dataTableFailureMessage(t: Localize, failure: DataTableFailure): string {
  switch (failure) {
    case 'label':
      return t('Data table requires a label.', '数据表需要标签。');
    case 'columns':
      return t(
        `Data table requires between 1 and ${MAX_LOCAL_DATA_TABLE_COLUMNS} column definitions.`,
        `数据表需要 1 到 ${MAX_LOCAL_DATA_TABLE_COLUMNS} 个列定义。`,
      );
    case 'max-rows':
      return t(
        `max-rows must be a positive integer no greater than ${MAX_LOCAL_DATA_TABLE_ROWS}.`,
        `max-rows 必须是 1 到 ${MAX_LOCAL_DATA_TABLE_ROWS} 之间的整数。`,
      );
    case 'rows':
      return t('Rows must evaluate to a list.', '行数据必须计算为列表。');
    case 'rows-budget':
      return t('Too many rows for this table.', '此数据表的行数超过上限。');
    case 'key':
      return t('Every row needs a unique, non-empty key.', '每一行都需要唯一且非空的键。');
    case 'text-budget':
      return t('The table content exceeds the text budget.', '数据表内容超过文本上限。');
  }
}

