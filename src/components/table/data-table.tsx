import type { ReactNode } from 'react';
import type {
  LocalComponentContext,
  LocalComponentContent,
} from '../../react/component-api';
import {
  useAuthorComponentRoot,
  DEFAULT_LOCAL_DATA_TABLE_ROWS,
  MAX_LOCAL_DATA_TABLE_COLUMNS,
  MAX_LOCAL_DATA_TABLE_ROWS,
  textAttr,
  useComponentView,
  type LocalValue,
} from '../../react/component-utils';
import { DataTableFailureError, type DataTableFailure } from './data-table-model';
import { buildDataTableModel, dataTableFailureMessage, evaluateDataTableRows } from './data-table-model';

export * from './data-table-model';
import type { DataTableBuildResult, DataTableColumnSpec } from './data-table-model';

/* -------------------------------------------------------------- component */

const FULL_EXPRESSION = /^\s*\{\{([\s\S]*)\}\}\s*$/;

function fullExpression(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const match = FULL_EXPRESSION.exec(raw);
  const source = match ? match[1].trim() : '';
  return source === '' ? null : source;
}

function isIgnorableChild(node: LocalComponentContent): boolean {
  return (
    node.kind === 'comment'
    || (node.kind === 'text' && node.text.trim() === '')
    || (node.kind === 'paragraph' && node.children.length === 0 && node.text.trim() === '')
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

function parseDataTable(context: LocalComponentContext): ParseResult {
  const label = textAttr(context, 'label', '').trim();
  if (label === '') return { ok: false, failure: 'label' };

  const rows = fullExpression(context.content.attrs.rows);
  if (!rows) return { ok: false, failure: 'rows' };
  const key = fullExpression(context.content.attrs.key);
  if (!key) return { ok: false, failure: 'key' };

  const rawMax = context.content.attrs['max-rows'];
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

  const children = context.content.children.filter((child) => !isIgnorableChild(child));
  const columns: DataTableColumnSpec[] = [];
  for (const child of children) {
    const columnChildren = child.children.filter((item) => !isIgnorableChild(item));
    if (
      child.kind !== 'component'
      || child.name !== 'column'
      || columnChildren.length > 0
    ) {
      return { ok: false, failure: 'columns' };
    }
    const columnLabel = (child.attrs.label ?? '').trim();
    const value = fullExpression(child.attrs.value);
    if (columnLabel === '' || !value) return { ok: false, failure: 'columns' };
    columns.push({ label: columnLabel, value });
  }
  if (columns.length < 1 || columns.length > MAX_LOCAL_DATA_TABLE_COLUMNS) {
    return { ok: false, failure: 'columns' };
  }

  return { ok: true, table: { label, rows, key, maxRows, columns } };
}

export function DataTableView(context: LocalComponentContext): ReactNode {
  const authorRoot = useAuthorComponentRoot(context);
  const view = useComponentView(context);
  const parsed = parseDataTable(context);
  if (!parsed.ok) {
    return (
      <div {...authorRoot()} className="local-error local-data-table-error" role="alert">
        {dataTableFailureMessage(view.t, parsed.failure)}
      </div>
    );
  }

  const runtime = {
    evaluate: (expression: string): LocalValue =>
      context.runtime.evaluate(expression) as LocalValue,
  };

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
      <div {...authorRoot()} className="local-error local-data-table-error" role="alert">
        {dataTableFailureMessage(view.t, result.failure)}
      </div>
    );
  }

  const { model } = result;
  return (
    <div {...authorRoot()} className="md-table-scroll local-data-table-scroll" data-local-data-table="">
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
                {view.t('No rows', '没有数据')}
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
                        {view.t('Cannot compute', '无法计算')}
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
