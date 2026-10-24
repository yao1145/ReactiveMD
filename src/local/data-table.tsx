import type { ReactNode } from 'react';
import { compileExpression, type LocalExpression } from './expression';
import {
  DEFAULT_LOCAL_DATA_TABLE_ROWS,
  MAX_LOCAL_DATA_TABLE_COLUMNS,
  MAX_LOCAL_DATA_TABLE_ROWS,
  MAX_LOCAL_VALUE_CHARACTERS,
} from './limits';
import type { Localize } from './i18n';
import type { LocalNode, LocalRuntime, LocalValue } from './types';

/**
 * `<data-table>` renders generated rows from a list expression. Everything in
 * this module is deterministic and renderer-only: rows come from the runtime,
 * the row scope exposes `item`/`index`, and keys are validated before any row
 * markup is allocated. Compilation performs the same checks independently.
 */

/* --------------------------------------------------------------- failures */

export type DataTableFailure =
  | 'label'
  | 'columns'
  | 'max-rows'
  | 'rows'
  | 'rows-budget'
  | 'key'
  | 'text-budget';

/** Internal signal so a budget breach aborts the build with no partial model. */
class DataTableFailureError extends Error {
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
  /** Encoded primitive identity; React never sees a positional key. */
  key: string;
  cells: DataTableCell[];
}

export interface DataTableColumnSpec {
  label: string;
  /** Full expression source (the part between `{{` and `}}`). */
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
  readonly runtime: Pick<LocalRuntime, 'evaluate'>;
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

/**
 * Encode a primitive key with its type so numeric `1` and string `"1"` remain
 * distinct. `-0` and `0` share one identity. `null` marks an invalid key.
 */
export function encodeDataTableKey(value: LocalValue): string | null {
  if (typeof value === 'string') return value === '' ? null : `s:${value}`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return `n:${value === 0 ? 0 : value}`;
  }
  return null;
}

/**
 * Resolve an expression against the runtime without copying its snapshot.
 * Dependency names are own-property getters, so a failing computed value
 * throws at the point the expression actually reads it; short circuits keep
 * their normal behaviour and no cell observes a value rewritten to `null`.
 */
function scopedEnvironment(
  runtime: Pick<LocalRuntime, 'evaluate'>,
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

/** Evaluate `rows` in the ordinary global scope and validate its shape. */
export function evaluateDataTableRows(
  runtime: Pick<LocalRuntime, 'evaluate'>,
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

/**
 * Build row keys and cell text before rendering. Row count, column count and
 * the cumulative text budget are enforced up front; any breach returns a
 * whole-table failure instead of a partial model.
 */
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
  // `key` may read only `item`: `index` and document globals would make the
  // identity dependent on position or unrelated state.
  const keyDependencies = keyed.dependencies;
  if (keyDependencies.length !== 1 || keyDependencies[0] !== 'item') {
    return { ok: false, failure: 'key' };
  }

  const compiledColumns = columns.map((column) => {
    try {
      return { spec: column, expression: compileExpression(column.value) };
    } catch {
      // A malformed hand-built column degrades to per-cell errors; the rest of
      // the table still renders.
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
      // Stable identities are retained alongside the cells and need a budget too.
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

/* -------------------------------------------------------------- component */

const FULL_EXPRESSION = /^\s*\{\{([\s\S]*)\}\}\s*$/;

function fullExpression(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const match = FULL_EXPRESSION.exec(raw);
  const source = match ? match[1].trim() : '';
  return source === '' ? null : source;
}

/** Blank lines and comments between structural children carry no meaning. */
function isIgnorableChild(node: LocalNode): boolean {
  return (
    node.type === 'comment'
    || (node.type === 'text' && (node.value ?? '').trim() === '')
    || (node.type === 'paragraph' && !node.children?.length && (node.value ?? '').trim() === '')
  );
}

interface ParsedDataTable {
  label: string;
  rows: string;
  key: string;
  maxRows: number;
  columns: DataTableColumnSpec[];
}

type ParseResult =
  | { ok: true; table: ParsedDataTable }
  | { ok: false; failure: DataTableFailure };

function parseDataTable(node: LocalNode): ParseResult {
  const label = (node.attrs?.label ?? '').trim();
  if (label === '') return { ok: false, failure: 'label' };

  const rows = fullExpression(node.attrs?.rows);
  if (!rows) return { ok: false, failure: 'rows' };
  const key = fullExpression(node.attrs?.key);
  if (!key) return { ok: false, failure: 'key' };

  const rawMax = node.attrs?.['max-rows'];
  let maxRows = DEFAULT_LOCAL_DATA_TABLE_ROWS;
  if (rawMax !== undefined) {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(rawMax.trim())) {
      return { ok: false, failure: 'max-rows' };
    }
    maxRows = Number(rawMax.trim());
    if (
      !Number.isSafeInteger(maxRows)
      || maxRows <= 0
      || maxRows > MAX_LOCAL_DATA_TABLE_ROWS
    ) {
      return { ok: false, failure: 'max-rows' };
    }
  }

  const children = (node.children ?? []).filter((child) => !isIgnorableChild(child));
  const columns: DataTableColumnSpec[] = [];
  for (const child of children) {
    const columnChildren = (child.children ?? []).filter((item) => !isIgnorableChild(item));
    if (
      child.type !== 'component'
      || child.name !== 'column'
      || columnChildren.length > 0
    ) {
      return { ok: false, failure: 'columns' };
    }
    const columnLabel = (child.attrs?.label ?? '').trim();
    const value = fullExpression(child.attrs?.value);
    if (columnLabel === '' || !value) return { ok: false, failure: 'columns' };
    columns.push({ label: columnLabel, value });
  }
  if (columns.length < 1 || columns.length > MAX_LOCAL_DATA_TABLE_COLUMNS) {
    return { ok: false, failure: 'columns' };
  }

  return { ok: true, table: { label, rows, key, maxRows, columns } };
}

export interface DataTableViewProps {
  node: LocalNode;
  visible: boolean;
  runtime: Pick<LocalRuntime, 'evaluate'>;
  t: Localize;
}

export function DataTableView({ node, runtime, t }: DataTableViewProps): ReactNode {
  const parsed = parseDataTable(node);
  if (!parsed.ok) {
    return (
      <div className="local-error local-data-table-error" role="alert">
        {dataTableFailureMessage(t, parsed.failure)}
      </div>
    );
  }

  let result: DataTableBuildResult;
  try {
    const rows = evaluateDataTableRows(runtime, parsed.table.rows);
    result = buildDataTableModel({
      rows,
      columns: parsed.table.columns,
      keyExpression: parsed.table.key,
      maxRows: parsed.table.maxRows,
      runtime,
    });
  } catch (error) {
    const failure = error instanceof DataTableFailureError ? error.failure : 'rows';
    result = { ok: false, failure };
  }

  if (!result.ok) {
    return (
      <div className="local-error local-data-table-error" role="alert">
        {dataTableFailureMessage(t, result.failure)}
      </div>
    );
  }

  const { model } = result;
  return (
    <div className="md-table-scroll local-data-table-scroll" data-local-data-table="">
      <table className="md-table local-data-table" aria-label={parsed.table.label}>
        <thead>
          <tr>
            {model.columns.map((label, index) => (
              <th key={`column-${index}`} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.empty ? (
            <tr>
              <td className="local-data-table-empty" colSpan={model.columns.length}>
                {t('No rows', '没有数据')}
              </td>
            </tr>
          ) : (
            model.rows.map((row) => (
              <tr key={row.key}>
                {row.cells.map((cell, index) => (
                  <td key={`cell-${index}`}>
                    {cell.ok ? (
                      cell.text
                    ) : (
                      <span className="local-error local-data-table-cell-error">
                        {t('Cannot compute', '无法计算')}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
