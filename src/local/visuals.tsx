import {
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  MAX_LOCAL_PLOT_CURVES,
  MAX_LOCAL_PLOT_POINTS,
  MAX_LOCAL_PLOT_STEPS,
} from './limits';
import { compileLatex, LatexError, samplePlot, type LatexEvaluationBudget } from './math';
import { formatLocalDiagnostic } from './diagnostics';
import { LatexView } from './math-view';
import type { LocalNode, LocalRuntime, LocalValue } from './types';
import type { LocalVisualProps } from './render-types';
import {
  defaultLocalize,
  useLocalLocale,
  useLocalize,
  type Localize,
} from './i18n';

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * Series colors resolve against the active theme, so charts and plots follow
 * light/dark tokens without re-rendering. The eight-color cycle and the
 * position-based wrapping are unchanged.
 */
const SERIES_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
];

const CHART_WIDTH = 520;
const CHART_HEIGHT = 320;
const PLOT_WIDTH = 520;
const PLOT_HEIGHT = 320;
const DIAGRAM_MIN_WIDTH = 520;
const DIAGRAM_NODE_WIDTH = 120;
const DIAGRAM_NODE_HEIGHT = 46;
const DIAGRAM_LAYER_GAP = 150;
/* Edge-label metrics mirror the SVG styles below: --text-xs is 12.5px and the
   text uses a surface-colored halo. Long labels wrap to two lines and then
   ellipsize, so the layout can reserve a predictable amount of space. */
const DIAGRAM_EDGE_LABEL_FONT_SIZE = 12.5;
const DIAGRAM_EDGE_LABEL_PAD_X = 5;
const DIAGRAM_EDGE_LABEL_PAD_Y = 3;
const DIAGRAM_EDGE_LABEL_CLEARANCE = 12;
const DIAGRAM_EDGE_LABEL_MARGIN = 10;
const DIAGRAM_EDGE_LABEL_MAX_WIDTH = 100;
const DIAGRAM_EDGE_LABEL_MAX_LINES = 2;
const DIAGRAM_EDGE_LABEL_LINE_HEIGHT = 15;

const NUMERIC_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const FULL_INTERPOLATION = /^\s*\{\{([\s\S]*)\}\}\s*$/;

type CompiledLatex = ReturnType<typeof compileLatex>;

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Object.is(value, -0)) return '0';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e12 || (magnitude > 0 && magnitude < 1e-4)) {
    return value
      .toExponential(3)
      .replace(/(\.\d*?)0+e/, '$1e')
      .replace(/\.e/, 'e');
  }
  return Number(value.toFixed(6)).toString();
}

function formatAxisNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e6 || (magnitude > 0 && magnitude < 0.001)) return value.toExponential(2);
  return Number(value.toFixed(4)).toString();
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function attrText(
  runtime: LocalRuntime,
  attrs: Record<string, string> | undefined,
  name: string,
  fallback = '',
): string {
  const raw = attrs?.[name];
  if (raw === undefined) return fallback;
  try {
    return runtime.text(raw);
  } catch {
    return fallback;
  }
}

function attrNumber(
  runtime: LocalRuntime,
  attrs: Record<string, string> | undefined,
  name: string,
  fallback: number | null,
): number | null {
  const raw = attrs?.[name];
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const dynamic = FULL_INTERPOLATION.exec(trimmed);
  try {
    const value = dynamic ? runtime.evaluate(dynamic[1].trim()) : Number(trimmed);
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function attrBoolean(
  runtime: LocalRuntime,
  attrs: Record<string, string> | undefined,
  name: string,
  fallback: boolean,
): boolean {
  const raw = attrs?.[name];
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  const dynamic = FULL_INTERPOLATION.exec(trimmed);
  if (!dynamic) return fallback;
  try {
    const value = runtime.evaluate(dynamic[1].trim());
    return typeof value === 'boolean' ? value : fallback;
  } catch {
    return fallback;
  }
}

function attrInteger(
  runtime: LocalRuntime,
  attrs: Record<string, string> | undefined,
  name: string,
  fallback: number,
): number {
  const value = attrNumber(runtime, attrs, name, fallback);
  if (value === null || !Number.isFinite(value)) return fallback;
  return Math.trunc(value);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

function wrapLabel(text: string, maxChars = 8, maxLines = 2): string[] {
  if (!text) return [''];
  const lines: string[] = [];
  let rest = text;
  while (rest && lines.length < maxLines - 1) {
    lines.push(rest.slice(0, maxChars));
    rest = rest.slice(maxChars);
  }
  if (rest || lines.length === 0) {
    lines.push(rest.length > maxChars ? `${rest.slice(0, Math.max(1, maxChars - 1))}…` : rest);
  }
  return lines;
}

function compareText(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index].codePointAt(0) ?? 0) - (b[index].codePointAt(0) ?? 0);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [min];
  const rough = (max - min) / Math.max(1, count - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= max + step * 1e-9 && ticks.length < 40; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }
  return ticks;
}

function chartDomain(values: number[], includeZero: boolean): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.15 : 1;
    min -= pad;
    max += pad;
  } else {
    const pad = (max - min) * 0.06;
    min -= pad;
    max += pad;
    if (includeZero) {
      min = Math.min(min, 0);
      max = Math.max(max, 0);
    }
  }
  return { min, max };
}

function axisLeft(ticks: number[], hasTitle: boolean): number {
  return Math.max(46, ...ticks.map((tick) => formatAxisNumber(tick).length * 6 + (hasTitle ? 24 : 10)));
}

function focusNeighbor(
  event: ReactKeyboardEvent<SVGElement>,
  selector: string,
  direction: number,
): void {
  const current = event.currentTarget;
  const svg = current.ownerSVGElement ?? current.closest('svg');
  if (!svg) return;
  const items = Array.from(svg.querySelectorAll<SVGElement>(selector));
  const index = items.indexOf(current);
  if (index < 0 || items.length === 0) return;
  event.preventDefault();
  const next = items[(index + direction + items.length) % items.length];
  next?.focus();
}

function activationKey(event: ReactKeyboardEvent<SVGElement>): boolean {
  return event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar';
}

/* ------------------------------------------------------------------ */
/* Table data model                                                    */
/* ------------------------------------------------------------------ */

type CellKind = 'number' | 'string' | 'boolean' | 'null' | 'array' | 'empty' | 'error';

interface Cell {
  node: LocalNode;
  children: LocalNode[];
  text: string;
  value: LocalValue | undefined;
  kind: CellKind;
  numeric: number | null;
  error: string | null;
}

interface VisualTable {
  tableNode: LocalNode;
  header: Cell[];
  headerText: string[];
  rows: { index: number; cells: Cell[] }[];
}

interface CollectedText {
  text: string;
  error: string | null;
}

function scalarText(
  value: LocalValue,
  t: Localize = defaultLocalize,
): { text: string; kind: CellKind; error: string | null } {
  if (value === null) return { text: '', kind: 'null', error: null };
  if (typeof value === 'string') return { text: value, kind: 'string', error: null };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return {
        text: t('Cannot compute', '无法计算'),
        kind: 'error',
        error: t('Result is not a finite number', '结果不是有限数字'),
      };
    }
    return { text: formatNumber(value), kind: 'number', error: null };
  }
  if (typeof value === 'boolean') {
    return { text: value ? 'true' : 'false', kind: 'boolean', error: null };
  }
  return {
    text: t('Cannot compute', '无法计算'),
    kind: 'array',
    error: t(
      'Arrays must first be converted with a function such as len',
      '数组需要先用 len 等函数转换',
    ),
  };
}

function collectText(
  nodes: LocalNode[] | undefined,
  runtime: LocalRuntime,
  t: Localize = defaultLocalize,
): CollectedText {
  let text = '';
  let error: string | null = null;
  for (const node of nodes ?? []) {
    if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') {
      text += node.value ?? '';
      continue;
    }
    if (node.type === 'interpolation') {
      try {
        const value = runtime.evaluate((node.value ?? '').trim());
        const scalar = scalarText(value, t);
        if (scalar.error) error ??= scalar.error;
        text += scalar.text;
      } catch (cause) {
        error ??= errorMessage(cause);
        text += t('Cannot compute', '无法计算');
      }
      continue;
    }
    if (node.type === 'inlineMath' || node.type === 'math') {
      text += node.value ?? '';
      continue;
    }
    if (node.type === 'image') {
      text += node.alt ?? '';
      continue;
    }
    if (node.children && node.children.length > 0) {
      const nested = collectText(node.children, runtime, t);
      text += nested.text;
      error ??= nested.error;
      continue;
    }
    if (node.value) text += node.value;
  }
  return { text, error };
}

function readCell(node: LocalNode, runtime: LocalRuntime, t: Localize = defaultLocalize): Cell {
  const children = node.children ?? [];
  const significant = children.filter(
    (child) => !(child.type === 'text' && !(child.value ?? '').trim()),
  );
  if (significant.length === 1 && significant[0].type === 'interpolation') {
    try {
      const value = runtime.evaluate((significant[0].value ?? '').trim());
      const scalar = scalarText(value, t);
      return {
        node,
        children,
        text: scalar.text,
        value,
        kind: scalar.kind,
        numeric: scalar.kind === 'number' ? (value as number) : null,
        error: scalar.error,
      };
    } catch (cause) {
      return {
        node,
        children,
        text: t('Cannot compute', '无法计算'),
        value: undefined,
        kind: 'error',
        numeric: null,
        error: errorMessage(cause),
      };
    }
  }

  const collected = collectText(children, runtime, t);
  const plainText = significant.length > 0 && significant.every((child) => child.type === 'text');
  if (plainText && NUMERIC_TEXT.test(collected.text.trim())) {
    const numeric = Number(collected.text.trim());
    if (Number.isFinite(numeric)) {
      return {
        node,
        children,
        text: collected.text,
        value: numeric,
        kind: 'number',
        numeric,
        error: null,
      };
    }
  }
  const isEmpty = !collected.text.trim() && !collected.error;
  return {
    node,
    children,
    text: collected.error ? t('Cannot compute', '无法计算') : collected.text,
    value: collected.text,
    kind: collected.error ? 'error' : isEmpty ? 'empty' : 'string',
    numeric: null,
    error: collected.error,
  };
}

function cellText(cell: Cell | undefined, t: Localize = defaultLocalize): string {
  if (!cell) return '';
  return cell.error ? t('Cannot compute', '无法计算') : cell.text;
}

function buildVisualTable(
  node: LocalNode,
  runtime: LocalRuntime,
  t: Localize = defaultLocalize,
): VisualTable | null {
  const tableNode = node.children?.find((child) => child.type === 'table');
  if (!tableNode) return null;
  const rows = tableNode.children?.filter((child) => child.type === 'tableRow') ?? [];
  if (rows.length === 0) return null;
  const header = (rows[0].children ?? []).map((cell) => readCell(cell, runtime, t));
  return {
    tableNode,
    header,
    headerText: header.map((cell) => cellText(cell, t)),
    rows: rows.slice(1).map((row, index) => ({
      index,
      cells: (row.children ?? []).map((cell) => readCell(cell, runtime, t)),
    })),
  };
}

function columnIsNumeric(table: VisualTable, column: number): boolean {
  let seen = false;
  for (const row of table.rows) {
    const cell = row.cells[column];
    if (!cell || cell.kind === 'empty') continue;
    if (cell.numeric === null) return false;
    seen = true;
  }
  return seen;
}

/* ------------------------------------------------------------------ */
/* Shared selection                                                    */
/* ------------------------------------------------------------------ */

/**
 * Selection is opt-in through the static `key` attribute. It names a source
 * column whose text becomes the stable public value, so sorting, searching,
 * paginating or hiding a series never changes what is selected. Without the
 * attribute tables and charts keep their pre-selection behavior and never
 * read or write a binding.
 */
function selectionKeyIndex(
  attrs: Record<string, string> | undefined,
  header: string[],
): number {
  const name = (attrs?.key ?? '').trim();
  if (!name) return -1;
  return header.findIndex((entry) => entry.trim() === name);
}

function rowSelectionKey(keyIndex: number, row: { cells: Cell[] }, t: Localize): string {
  if (keyIndex < 0) return '';
  return cellText(row.cells[keyIndex], t).trim();
}

function readSelection(runtime: LocalRuntime, node: LocalNode, enabled: boolean): string {
  if (!enabled) return '';
  try {
    const value = runtime.get(node);
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ */
/* Shared visual pieces                                                */
/* ------------------------------------------------------------------ */

function VisualFrame({
  className,
  label,
  children,
}: {
  className: string;
  label: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <figure className={`local-visual ${className}`} aria-labelledby={titleId}>
      <figcaption id={titleId} className="local-visual-title">
        {label}
      </figcaption>
      {children}
    </figure>
  );
}

function VisualMessage({ message, kind = 'status' }: { message: string; kind?: 'status' | 'alert' }) {
  return (
    <p className={`local-visual-message local-visual-${kind}`} role={kind}>
      {message}
    </p>
  );
}

function Notes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="local-visual-notes" role="status">
      {notes.map((note, index) => (
        <li key={`${note}-${index}`}>{note}</li>
      ))}
    </ul>
  );
}

interface LegendItem {
  name: string;
  color: string;
  detail?: string;
  disabled?: boolean;
}

function ChartLegend({
  items,
  hidden,
  onToggle,
  label,
}: {
  items: LegendItem[];
  hidden: Set<number>;
  onToggle: (index: number) => void;
  label: string;
}) {
  const t = useLocalize();
  return (
    <div className="local-visual-legend" role="group" aria-label={label}>
      {items.map((item, index) => {
        const off = hidden.has(index);
        return (
          <button
            key={`${item.name}-${index}`}
            type="button"
            className={`local-visual-legend-item${off ? ' is-off' : ''}`}
            aria-pressed={!off}
            disabled={item.disabled}
            onClick={() => onToggle(index)}
            title={off ? t(`Show ${item.name}`, `显示 ${item.name}`) : t(`Hide ${item.name}`, `隐藏 ${item.name}`)}
          >
            <span
              className="local-visual-swatch"
              style={{ backgroundColor: item.color }}
              aria-hidden="true"
            />
            <span className="local-visual-legend-text">
              {item.name}
              {item.detail ? t(` (${item.detail})`, `（${item.detail}）`) : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Interactive table                                                   */
/* ------------------------------------------------------------------ */

interface SortState {
  column: number;
  direction: 'asc' | 'desc';
}

function TableView({ node, runtime, render }: LocalVisualProps) {
  const t = useLocalize();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(1);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const reset = runtime.resetToken(node);
  useEffect(() => {
    setQuery('');
    setSort(null);
    setPage(1);
    setSelectionError(null);
  }, [reset]);

  const label = attrText(runtime, node.attrs, 'label', t('Table', '表格'));
  const searchable = attrBoolean(runtime, node.attrs, 'searchable', true);
  const sortable = attrBoolean(runtime, node.attrs, 'sortable', true);
  const rawPageSize = attrInteger(runtime, node.attrs, 'page-size', 10);
  const pageSize = Math.max(1, rawPageSize);
  const table = buildVisualTable(node, runtime, t);

  if (!table || table.header.length === 0) {
    return (
      <VisualFrame className="local-visual-table-block" label={label}>
        <VisualMessage
          message={t(
            'Table requires a non-empty Markdown table.',
            '表格需要一个非空的 Markdown 表格。',
          )}
          kind="alert"
        />
      </VisualFrame>
    );
  }

  const keyIndex = selectionKeyIndex(node.attrs, table.headerText);
  const selectable = keyIndex >= 0;
  const selectedKey = readSelection(runtime, node, selectable);
  const writeSelection = (value: string) => {
    setSelectionError(null);
    try {
      const diagnostics = runtime.set(node, value);
      if (diagnostics.length > 0) {
        setSelectionError(diagnostics.map((diagnostic) => t(formatLocalDiagnostic(diagnostic, 'en'), formatLocalDiagnostic(diagnostic, 'zh'))).join('; '));
      }
    } catch (cause) {
      setSelectionError(errorMessage(cause));
    }
  };

  const numericColumns = table.header.map((_cell, index) => columnIsNumeric(table, index));
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = table.rows.filter((row) => {
    if (!normalizedQuery) return true;
    return row.cells.some((cell) => cellText(cell, t).toLowerCase().includes(normalizedQuery));
  });
  const ordered = [...filtered];
  if (sort) {
    const numeric = numericColumns[sort.column];
    ordered.sort((left, right) => {
      const a = left.cells[sort.column];
      const b = right.cells[sort.column];
      let result: number;
      if (numeric) {
        const av = a?.numeric ?? Number.NEGATIVE_INFINITY;
        const bv = b?.numeric ?? Number.NEGATIVE_INFINITY;
        result = av === bv ? 0 : av < bv ? -1 : 1;
      } else {
        result = compareText(cellText(a, t), cellText(b, t));
      }
      if (result === 0) return left.index - right.index;
      return sort.direction === 'asc' ? result : -result;
    });
  }

  const totalPages = Math.max(1, Math.ceil(ordered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = ordered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const cycleSort = (column: number) => {
    setPage(1);
    setSort((current): SortState | null => {
      if (!current || current.column !== column) return { column, direction: 'asc' };
      if (current.direction === 'asc') return { column, direction: 'desc' };
      return null;
    });
  };

  const sortMarker = (column: number) => {
    if (!sort || sort.column !== column) return '';
    return sort.direction === 'asc' ? t(' (ascending)', '（升序）') : t(' (descending)', '（降序）');
  };

  return (
    <VisualFrame className="local-visual-table-block" label={label}>
      {searchable ? (
        <label className="local-visual-search">
          <span>{t('Search', '搜索')}</span>
          <input
            type="search"
            value={query}
            placeholder={t('Search all columns', '搜索所有列')}
            aria-label={t(`Search ${label}`, `搜索${label}`)}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </label>
      ) : null}
      <div className="local-visual-table-scroll">
        <table className="local-visual-table">
          <caption className="local-visual-sr-only">{label}</caption>
          <thead>
            <tr>
              {selectable ? (
                <th scope="col" className="local-visual-select-column">
                  <span className="local-visual-sr-only">{t('Select', '选择')}</span>
                </th>
              ) : null}
              {table.header.map((cell, index) => {
                const ariaSort =
                  sort && sort.column === index
                    ? sort.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none';
                return (
                  <th
                    key={`head-${index}`}
                    scope="col"
                    aria-sort={ariaSort}
                    className={numericColumns[index] ? 'is-numeric' : undefined}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        className={`local-visual-sort-button${
                          sort && sort.column === index ? ' is-sorted' : ''
                        }`}
                        onClick={() => cycleSort(index)}
                        title={t(
                          'Click to cycle ascending, descending and original order',
                          '点击切换升序、降序和原始顺序',
                        )}
                      >
                        {cellText(cell, t)}
                        {sortMarker(index)}
                      </button>
                    ) : (
                      cellText(cell, t)
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => {
              const rowKey = selectable ? rowSelectionKey(keyIndex, row, t) : '';
              const selected = selectable && rowKey !== '' && rowKey === selectedKey;
              return (
                <tr
                  key={`row-${row.index}`}
                  className={selected ? 'is-selected' : undefined}
                >
                  {selectable ? (
                    <td className="local-visual-select-cell">
                      {rowKey ? (
                        <button
                          type="button"
                          className={`local-visual-select-button${
                            selected ? ' is-selected' : ''
                          }`}
                          aria-pressed={selected}
                          aria-label={t(`Select row ${rowKey}`, `选择行 ${rowKey}`)}
                          title={t(`Select row ${rowKey}`, `选择行 ${rowKey}`)}
                          onClick={() => writeSelection(rowKey)}
                        >
                          <span aria-hidden="true">{selected ? '●' : '○'}</span>
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                  {table.header.map((_cell, column) => {
                    const cell = row.cells[column];
                    return (
                      <td
                        key={`cell-${row.index}-${column}`}
                        className={numericColumns[column] ? 'is-numeric' : undefined}
                      >
                        {cell?.error ? (
                          <span className="local-visual-cell-error" title={cell.error}>
                            {t('Cannot compute', '无法计算')}
                          </span>
                        ) : (
                          render(cell?.children ?? [])
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selectionError ? <VisualMessage message={selectionError} kind="alert" /> : null}
      {ordered.length === 0 ? (
        <VisualMessage message={t('No matching results', '没有匹配结果')} />
      ) : null}
      {totalPages > 1 ? (
        <nav
          className="local-visual-pagination"
          aria-label={t('Table pagination', '表格分页')}
        >
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            {t('Previous', '上一页')}
          </button>
          <span>
            {t(
              `Page ${currentPage} of ${totalPages} · ${ordered.length} rows`,
              `第 ${currentPage} / ${totalPages} 页 · 共 ${ordered.length} 行`,
            )}
          </span>
          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
          >
            {t('Next', '下一页')}
          </button>
        </nav>
      ) : null}
    </VisualFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Chart                                                               */
/* ------------------------------------------------------------------ */

type ChartKind = 'bar' | 'line' | 'area' | 'scatter' | 'donut';

const CHART_KINDS: ChartKind[] = ['bar', 'line', 'area', 'scatter', 'donut'];

interface ChartRow {
  index: number;
  label: string;
  xValue: number | null;
  values: (number | null)[];
  cells: Cell[];
  keyValue: string;
}

interface ChartPoint {
  key: string;
  series: string;
  label: string;
  value: number;
  x: number;
  y: number;
  rowKey: string;
  selectable: boolean;
  selected: boolean;
}

function donutPath(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  start: number,
  end: number,
): string {
  const point = (radius: number, angle: number): [number, number] => [
    cx + radius * Math.cos(angle),
    cy + radius * Math.sin(angle),
  ];
  const [x0, y0] = point(outer, start);
  const [x1, y1] = point(outer, end);
  const [x2, y2] = point(inner, end);
  const [x3, y3] = point(inner, start);
  const large = end - start > Math.PI ? 1 : 0;
  return [
    `M ${x0} ${y0}`,
    `A ${outer} ${outer} 0 ${large} 1 ${x1} ${y1}`,
    `L ${x2} ${y2}`,
    `A ${inner} ${inner} 0 ${large} 0 ${x3} ${y3}`,
    'Z',
  ].join(' ');
}

function ChartView({ node, runtime }: LocalVisualProps) {
  const t = useLocalize();
  const [hiddenSeries, setHiddenSeries] = useState<Set<number>>(new Set());
  const [hiddenSlices, setHiddenSlices] = useState<Set<number>>(new Set());
  const [active, setActive] = useState<ChartPoint | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const reset = runtime.resetToken(node);
  useEffect(() => {
    setHiddenSeries(new Set());
    setHiddenSlices(new Set());
    setActive(null);
    setSelectionError(null);
  }, [reset]);

  const readoutId = useId();
  const title =
    attrText(runtime, node.attrs, 'title', '') ||
    attrText(runtime, node.attrs, 'label', '') ||
    t('Chart', '图表');
  const kindRaw = (node.attrs?.kind ?? 'bar').trim().toLowerCase();
  const kind = (CHART_KINDS as string[]).includes(kindRaw) ? (kindRaw as ChartKind) : null;
  const xLabel = attrText(runtime, node.attrs, 'x-label', '');
  const yLabel = attrText(runtime, node.attrs, 'y-label', '');
  const table = buildVisualTable(node, runtime, t);

  if (!table || table.header.length === 0) {
    return (
      <VisualFrame className="local-visual-chart" label={title}>
        <VisualMessage
          message={t(
            'chart body requires a non-empty Markdown table.',
            'chart 正文需要一个非空的 Markdown 表格。',
          )}
          kind="alert"
        />
      </VisualFrame>
    );
  }

  const header = table.headerText.map((text) => text.trim());
  const keyIndex = selectionKeyIndex(node.attrs, header);
  const selectionEnabled = keyIndex >= 0;
  const selectedRowKey = readSelection(runtime, node, selectionEnabled);
  const writeSelection = (value: string) => {
    setSelectionError(null);
    try {
      const diagnostics = runtime.set(node, value);
      if (diagnostics.length > 0) {
        setSelectionError(diagnostics.map((diagnostic) => t(formatLocalDiagnostic(diagnostic, 'en'), formatLocalDiagnostic(diagnostic, 'zh'))).join('; '));
      }
    } catch (cause) {
      setSelectionError(errorMessage(cause));
    }
  };
  const sourceRows = table.rows.map((row) => ({
    index: row.index,
    cells: row.cells,
    texts: header.map((_name, column) => cellText(row.cells[column], t)),
    keyValue: rowSelectionKey(keyIndex, row, t),
  }));

  if (!kind) {
    return (
      <VisualFrame className="local-visual-chart" label={title}>
        <VisualMessage
          message={t(`Unknown chart type "${kindRaw}".`, `未知图表类型“${kindRaw}”。`)}
          kind="alert"
        />
      </VisualFrame>
    );
  }

  const notes: string[] = [];
  const errors: string[] = [];
  const xName = (node.attrs?.x ?? '').trim();
  const xIndex = xName ? header.indexOf(xName) : 0;
  if (xIndex < 0 || xIndex >= header.length) {
    errors.push(t(`x column "${xName}" does not exist.`, `x 列“${xName}”不存在。`));
  }
  const yNames = (node.attrs?.y ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  let yIndexes: number[] = [];
  if (kind === 'donut') {
    if (yNames.length > 1) {
      errors.push(
        t(
          'donut can only use one numeric column; specify a single column in y.',
          'donut 只能使用一个数值列，请在 y 中指定唯一列。',
        ),
      );
    } else if (yNames.length === 1) {
      const index = header.indexOf(yNames[0]);
      if (index < 0) {
        errors.push(t(`y column "${yNames[0]}" does not exist.`, `y 列“${yNames[0]}”不存在。`));
      } else yIndexes = [index];
    } else if (header.length === 2) {
      yIndexes = [1];
    } else {
      errors.push(
        t(
          'A donut chart with more than two columns must use y to specify the single numeric column.',
          'donut 多于两列时必须用 y 指定唯一数值列。',
        ),
      );
    }
  } else {
    if (yNames.length > 0) {
      for (const name of yNames) {
        const index = header.indexOf(name);
        if (index < 0) {
          errors.push(t(`y column "${name}" does not exist.`, `y 列“${name}”不存在。`));
        } else if (!yIndexes.includes(index)) yIndexes.push(index);
      }
    } else {
      yIndexes = header.map((_name, index) => index).filter((index) => index !== xIndex);
    }
  }

  if (errors.length === 0 && yIndexes.length === 0) {
    errors.push(t('Chart requires at least one numeric series.', '图表至少需要一个数值系列。'));
  }

  if (errors.length > 0) {
    return (
      <VisualFrame className={`local-visual-chart local-visual-chart-${kind}`} label={title}>
        {errors.map((message, index) => (
          <VisualMessage key={`${message}-${index}`} message={message} kind="alert" />
        ))}
      </VisualFrame>
    );
  }

  const seriesNames = yIndexes.map(
    (index) => header[index] || t(`Series ${index + 1}`, `系列 ${index + 1}`),
  );
  let invalidValues = 0;
  let negativeValues = 0;
  const rows: ChartRow[] = sourceRows.map((source) => {
    const xCell = source.cells[xIndex];
    const label = source.texts[xIndex] || t(`Item ${source.index + 1}`, `第 ${source.index + 1} 项`);
    const xValue = xCell && xCell.numeric !== null ? xCell.numeric : null;
    const values = yIndexes.map((column) => {
      const cell = source.cells[column];
      if (!cell || cell.kind === 'empty') {
        invalidValues += 1;
        return null;
      }
      if (cell.numeric === null) {
        invalidValues += 1;
        return null;
      }
      if (kind === 'donut' && cell.numeric < 0) negativeValues += 1;
      return cell.numeric;
    });
    return { index: source.index, label, xValue, values, cells: source.cells, keyValue: source.keyValue };
  });

  if (invalidValues > 0) {
    notes.push(
      t(
        `${invalidValues} values are empty or cannot be computed; gaps are kept in the chart.`,
        `${invalidValues} 个数值为空或无法计算，图表中保留空缺。`,
      ),
    );
  }
  for (const column of yIndexes) {
    if (!columnIsNumeric(table, column)) {
      notes.push(
        t(
          `Column "${header[column]}" is not purely numeric; non-numeric values are treated as gaps.`,
          `列“${header[column]}”不是纯数值列，非数值按空缺处理。`,
        ),
      );
    }
  }
  if (kind === 'donut' && negativeValues > 0) {
    notes.push(
      t(
        `Donut values must be non-negative; ignored ${negativeValues} negative values.`,
        `环形图数值必须非负，已忽略 ${negativeValues} 个负值。`,
      ),
    );
  }
  if (kind === 'scatter' && !columnIsNumeric(table, xIndex)) {
    notes.push(
      t(
        `scatter horizontal axis column "${header[xIndex]}" requires numeric values.`,
        `scatter 的横轴列“${header[xIndex]}”需要数值。`,
      ),
    );
  }

  const toggleSeries = (position: number) => {
    setActive(null);
    setHiddenSeries((current) => {
      const next = new Set(current);
      if (next.has(position)) next.delete(position);
      else next.add(position);
      return next;
    });
  };
  const toggleSlice = (index: number) => {
    setActive(null);
    setHiddenSlices((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const legendItems: LegendItem[] = seriesNames.map((name, position) => ({
    name,
    color: SERIES_COLORS[position % SERIES_COLORS.length],
  }));

  if (kind === 'donut') {
    const values = rows.map((row) => row.values[0]);
    const positive = values.map((value) => (value !== null && value >= 0 ? value : 0));
    const visibleTotal = positive.reduce(
      (sum, value, index) => (hiddenSlices.has(index) ? sum : sum + value),
      0,
    );
    const sliceLegend: LegendItem[] = rows.map((row, index) => ({
      name: row.label,
      color: SERIES_COLORS[index % SERIES_COLORS.length],
      detail: values[index] === null ? '—' : formatNumber(values[index] as number),
      disabled: positive[index] <= 0,
    }));

    if (visibleTotal <= 0) {
      return (
        <VisualFrame className="local-visual-chart local-visual-chart-donut" label={title}>
          <VisualMessage message={t('No share to display', '暂无占比')} />
          <Notes notes={notes} />
          <ChartLegend
            items={sliceLegend}
            hidden={hiddenSlices}
            onToggle={toggleSlice}
            label={t('Legend', '图例')}
          />
        </VisualFrame>
      );
    }

    const cx = CHART_WIDTH / 2;
    const cy = 140;
    const outer = 98;
    const inner = 58;
    let angle = -Math.PI / 2;
    const slices: {
      key: string;
      label: string;
      value: number;
      start: number;
      end: number;
      color: string;
      x: number;
      y: number;
      rowKey: string;
    }[] = [];
    rows.forEach((row, index) => {
      if (hiddenSlices.has(index)) return;
      const value = positive[index];
      if (value <= 0) return;
      const sweep = (value / visibleTotal) * Math.PI * 2;
      const start = angle;
      const end = angle + sweep;
      angle = end;
      slices.push({
        key: `donut:${index}`,
        label: row.label,
        value,
        start,
        end,
        color: SERIES_COLORS[index % SERIES_COLORS.length],
        x: cx,
        y: cy,
        rowKey: row.keyValue,
      });
    });

    const readout = active
      ? t(
          `${active.label}: ${formatNumber(active.value)}`,
          `${active.label}：${formatNumber(active.value)}`,
        )
      : t('Focus a slice or legend to view values', '聚焦扇区或图例查看数值');

    return (
      <VisualFrame className="local-visual-chart local-visual-chart-donut" label={title}>
        <div className="local-visual-readout" id={readoutId} aria-live="polite">
          {readout}
        </div>
        <div className="local-visual-svg-wrap">
          <svg
            className="local-visual-svg"
            viewBox={`0 0 ${CHART_WIDTH} 290`}
            role="group"
            aria-label={t(
              `${title}, donut chart, ${rows.length} items`,
              `${title}，环形图，共 ${rows.length} 项`,
            )}
            aria-describedby={readoutId}
          >
            <g className="local-visual-donut-center" aria-hidden="true">
              <text x={cx} y={cy - 2} textAnchor="middle" className="local-visual-donut-total">
                {formatNumber(visibleTotal)}
              </text>
              <text x={cx} y={cy + 18} textAnchor="middle" className="local-visual-donut-caption">
                {truncate(seriesNames[0], 14)}
              </text>
            </g>
            {slices.map((slice) => {
              const selectable = selectionEnabled && slice.rowKey !== '';
              const selected = selectable && slice.rowKey === selectedRowKey;
              const point: ChartPoint = {
                key: slice.key,
                series: seriesNames[0],
                label: slice.label,
                value: slice.value,
                x: slice.x,
                y: slice.y,
                rowKey: slice.rowKey,
                selectable,
                selected,
              };
              const markProps = {
                'data-chart-mark': '',
                ...(selectable ? { 'data-chart-selectable': '' } : {}),
                tabIndex: 0,
                role: selectable ? ('button' as const) : ('img' as const),
                ...(selectable ? { 'aria-pressed': selected } : {}),
                'aria-label': t(
                  `${slice.label}: ${formatNumber(slice.value)}`,
                  `${slice.label}：${formatNumber(slice.value)}`,
                ),
                onFocus: () => setActive(point),
                onBlur: () => setActive(null),
                onPointerEnter: () => setActive(point),
                onPointerLeave: () => setActive(null),
                onClick: selectable ? () => writeSelection(slice.rowKey) : undefined,
                onKeyDown: (event: ReactKeyboardEvent<SVGElement>) => {
                  if (selectable && activationKey(event)) {
                    event.preventDefault();
                    writeSelection(slice.rowKey);
                    return;
                  }
                  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                    focusNeighbor(event, '[data-chart-mark]', 1);
                  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                    focusNeighbor(event, '[data-chart-mark]', -1);
                  }
                },
              };
              const sliceClass = `local-visual-donut-slice${selected ? ' is-selected' : ''}`;
              if (slice.end - slice.start >= Math.PI * 2 - 1e-6) {
                return (
                  <circle
                    key={slice.key}
                    className={sliceClass}
                    cx={cx}
                    cy={cy}
                    r={(outer + inner) / 2}
                    fill="none"
                    style={{ stroke: slice.color }}
                    strokeWidth={outer - inner}
                    {...markProps}
                  >
                    <title>
                      {t(
                        `${slice.label}: ${formatNumber(slice.value)}`,
                        `${slice.label}：${formatNumber(slice.value)}`,
                      )}
                    </title>
                  </circle>
                );
              }
              return (
                <path
                  key={slice.key}
                  className={sliceClass}
                  d={donutPath(cx, cy, outer, inner, slice.start, slice.end)}
                  style={{ fill: slice.color }}
                  {...markProps}
                >
                  <title>
                    {t(
                      `${slice.label}: ${formatNumber(slice.value)}`,
                      `${slice.label}：${formatNumber(slice.value)}`,
                    )}
                  </title>
                </path>
              );
            })}
          </svg>
        </div>
        <ChartLegend
          items={sliceLegend}
          hidden={hiddenSlices}
          onToggle={toggleSlice}
          label={t('Legend, toggle slices', '图例，可开关扇区')}
        />
        {selectionError ? <VisualMessage message={selectionError} kind="alert" /> : null}
        <Notes notes={notes} />
      </VisualFrame>
    );
  }

  /* Cartesian charts: bar / line / area / scatter */

  const visiblePositions = seriesNames
    .map((_name, position) => position)
    .filter((position) => !hiddenSeries.has(position));

  if (visiblePositions.length === 0) {
    return (
      <VisualFrame className={`local-visual-chart local-visual-chart-${kind}`} label={title}>
        <VisualMessage message={t('All series are hidden in the legend', '所有系列已在图例中关闭')} />
        <ChartLegend
          items={legendItems}
          hidden={hiddenSeries}
          onToggle={toggleSeries}
          label={t('Legend, toggle series', '图例，可开关系列')}
        />
      </VisualFrame>
    );
  }

  const numericColumnX = columnIsNumeric(table, xIndex);
  const useNumericX =
    kind === 'scatter' ? true : kind === 'line' || kind === 'area' ? numericColumnX : false;
  const plottableRows = useNumericX
    ? rows.filter((row) => row.xValue !== null)
    : rows;
  if (useNumericX && plottableRows.length < rows.length) {
    notes.push(
      t(
        `${rows.length - plottableRows.length} rows have an empty or non-numeric horizontal axis and are not plotted.`,
        `${rows.length - plottableRows.length} 行横轴为空或不是数值，未参与绘制。`,
      ),
    );
  }

  const allValues: number[] = [];
  for (const row of plottableRows) {
    for (const position of visiblePositions) {
      const value = row.values[position];
      if (value !== null) allValues.push(value);
    }
  }

  if (plottableRows.length === 0) {
    return (
      <VisualFrame className={`local-visual-chart local-visual-chart-${kind}`} label={title}>
        <VisualMessage message={t('No data rows to plot', '没有可绘制的数据行')} />
        <Notes notes={notes} />
        <ChartLegend
          items={legendItems}
          hidden={hiddenSeries}
          onToggle={toggleSeries}
          label={t('Legend, toggle series', '图例，可开关系列')}
        />
      </VisualFrame>
    );
  }
  if (allValues.length === 0) {
    return (
      <VisualFrame className={`local-visual-chart local-visual-chart-${kind}`} label={title}>
        <VisualMessage message={t('No values to read', '没有可读取的数值')} />
        <Notes notes={notes} />
        <ChartLegend
          items={legendItems}
          hidden={hiddenSeries}
          onToggle={toggleSeries}
          label={t('Legend, toggle series', '图例，可开关系列')}
        />
      </VisualFrame>
    );
  }

  const includeZero = kind === 'bar' || kind === 'area';
  const yDomain = chartDomain(allValues, includeZero);
  const yTicks = niceTicks(yDomain.min, yDomain.max, 5);
  const plotLeft = axisLeft(yTicks, Boolean(yLabel));
  const plotRight = CHART_WIDTH - 14;
  const plotTop = 16;
  const plotBottom = CHART_HEIGHT - 46;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;
  const yOf = (value: number) =>
    plotTop + ((yDomain.max - value) / (yDomain.max - yDomain.min)) * plotHeight;
  const zeroY = yOf(Math.max(yDomain.min, Math.min(yDomain.max, 0)));

  const xDomain =
    useNumericX && plottableRows.length > 0
      ? chartDomain(
          plottableRows
            .map((row) => row.xValue)
            .filter((value): value is number => value !== null),
          false,
        )
      : null;
  const bandWidth = plotWidth / Math.max(1, rows.length);
  const categoryX = (index: number) => plotLeft + bandWidth * (index + 0.5);
  const numericXOf = (value: number) =>
    plotLeft + ((value - xDomain!.min) / (xDomain!.max - xDomain!.min)) * plotWidth;
  const xOfRow = (row: ChartRow, rowIndex: number): number | null => {
    if (xDomain) return row.xValue === null ? null : numericXOf(row.xValue);
    return categoryX(rowIndex);
  };

  const xTicks: number[] = [];
  if (xDomain) {
    xTicks.push(...niceTicks(xDomain.min, xDomain.max, 5));
  } else {
    const step = Math.max(1, Math.ceil(rows.length / 6));
    for (let index = 0; index < rows.length; index += step) xTicks.push(index);
    const last = rows.length - 1;
    if (last >= 0 && xTicks[xTicks.length - 1] !== last) {
      if (xTicks.length > 1 && last - xTicks[xTicks.length - 1] < step * 0.6) {
        xTicks[xTicks.length - 1] = last;
      } else {
        xTicks.push(last);
      }
    }
  }

  const xPositionOfTick = (tick: number) =>
    xDomain
      ? plotLeft + ((tick - xDomain.min) / (xDomain.max - xDomain.min)) * plotWidth
      : categoryX(tick);

  const activeGuide = active && !xDomain ? null : active ? (
    <line
      className="local-visual-guide"
      x1={Math.max(plotLeft, Math.min(plotRight, active.x))}
      x2={Math.max(plotLeft, Math.min(plotRight, active.x))}
      y1={plotTop}
      y2={plotBottom}
    />
  ) : null;

  const markProps = (point: ChartPoint) => ({
    'data-chart-mark': '',
    ...(point.selectable ? { 'data-chart-selectable': '' } : {}),
    tabIndex: 0,
    role: point.selectable ? ('button' as const) : ('img' as const),
    ...(point.selectable ? { 'aria-pressed': point.selected } : {}),
    'aria-label': t(
      `${point.series}, ${point.label}${point.selectable && point.rowKey !== point.label ? `, ${point.rowKey}` : ''}: ${formatNumber(point.value)}`,
      `${point.series}，${point.label}${point.selectable && point.rowKey !== point.label ? `，${point.rowKey}` : ''}：${formatNumber(point.value)}`,
    ),
    onFocus: () => setActive(point),
    onBlur: () => setActive(null),
    onPointerEnter: () => setActive(point),
    onPointerLeave: () => setActive(null),
    onClick: point.selectable ? () => writeSelection(point.rowKey) : undefined,
    onKeyDown: (event: ReactKeyboardEvent<SVGElement>) => {
      if (point.selectable && activationKey(event)) {
        event.preventDefault();
        writeSelection(point.rowKey);
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        focusNeighbor(event, '[data-chart-mark]', 1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        focusNeighbor(event, '[data-chart-mark]', -1);
      }
    },
  });

  const makePoint = (
    position: number,
    row: ChartRow,
    value: number,
    x: number,
    y: number,
  ): ChartPoint => {
    const selectable = selectionEnabled && row.keyValue !== '';
    return {
      key: `${position}:${row.index}`,
      series: seriesNames[position],
      label: row.label,
      value,
      x,
      y,
      rowKey: row.keyValue,
      selectable,
      selected: selectable && row.keyValue === selectedRowKey,
    };
  };

  const barMarks: ReactNode[] = [];
  if (kind === 'bar') {
    const groupWidth = bandWidth * 0.76;
    const barWidth = Math.max(1, groupWidth / Math.max(1, visiblePositions.length));
    rows.forEach((row, rowIndex) => {
      visiblePositions.forEach((position, visibleIndex) => {
        const value = row.values[position];
        if (value === null) return;
        const x =
          plotLeft +
          bandWidth * rowIndex +
          (bandWidth - groupWidth) / 2 +
          visibleIndex * barWidth;
        const height = Math.max(1, Math.abs(yOf(value) - zeroY));
        const y = value >= 0 ? zeroY - height : zeroY;
        const point = makePoint(position, row, value, x + barWidth / 2, y + height / 2);
        barMarks.push(
          <rect
            key={`bar-${position}-${row.index}`}
            className={`local-visual-bar${point.selected ? ' is-selected' : ''}`}
            x={x}
            y={y}
            width={Math.max(1.5, barWidth - 1)}
            height={height}
            rx={2}
            style={{ fill: SERIES_COLORS[position % SERIES_COLORS.length] }}
            {...markProps(point)}
          >
            <title>
              {t(
                `${point.series}, ${point.label}: ${formatNumber(point.value)}`,
                `${point.series}，${point.label}：${formatNumber(point.value)}`,
              )}
            </title>
          </rect>,
        );
      });
    });
  }

  const lineMarks: ReactNode[] = [];
  const areaMarks: ReactNode[] = [];
  const pointMarks: ReactNode[] = [];

  if (kind === 'line' || kind === 'area') {
    for (const position of visiblePositions) {
      const segments: { row: ChartRow; value: number; x: number; y: number }[][] = [];
      let current: { row: ChartRow; value: number; x: number; y: number }[] = [];
      const flush = () => {
        if (current.length > 0) segments.push(current);
        current = [];
      };
      rows.forEach((row, rowIndex) => {
        const value = row.values[position];
        const x = xOfRow(row, rowIndex);
        if (value === null || x === null) {
          flush();
          return;
        }
        current.push({ row, value, x, y: yOf(value) });
      });
      flush();

      for (const segment of segments) {
        if (segment.length >= 2) {
          const d = segment
            .map((entry, index) => `${index === 0 ? 'M' : 'L'} ${entry.x} ${entry.y}`)
            .join(' ');
          lineMarks.push(
            <path
              key={`line-${position}-${segment[0].row.index}`}
              className="local-visual-line"
              d={d}
              fill="none"
              style={{ stroke: SERIES_COLORS[position % SERIES_COLORS.length] }}
              strokeWidth={2.4}
              strokeLinejoin="round"
              strokeLinecap="round"
            />,
          );
          if (kind === 'area') {
            const baseline = zeroY;
            const first = segment[0];
            const last = segment[segment.length - 1];
            const area = `M ${first.x} ${baseline} ${segment
              .map((entry) => `L ${entry.x} ${entry.y}`)
              .join(' ')} L ${last.x} ${baseline} Z`;
            areaMarks.push(
              <path
                key={`area-${position}-${first.row.index}`}
                className="local-visual-area"
                d={area}
                style={{ fill: SERIES_COLORS[position % SERIES_COLORS.length] }}
              />,
            );
          }
        }
        for (const entry of segment) {
          const point = makePoint(position, entry.row, entry.value, entry.x, entry.y);
          pointMarks.push(
            <g key={`point-${position}-${entry.row.index}`} className="local-visual-point-group">
              <circle
                className={`local-visual-hit${point.selected ? ' is-selected' : ''}`}
                cx={entry.x}
                cy={entry.y}
                r={12}
                fill="transparent"
                {...markProps(point)}
              >
                <title>
              {t(
                `${point.series}, ${point.label}: ${formatNumber(point.value)}`,
                `${point.series}，${point.label}：${formatNumber(point.value)}`,
              )}
            </title>
              </circle>
              <circle
                className={`local-visual-point${point.selected ? ' is-selected' : ''}`}
                cx={entry.x}
                cy={entry.y}
                r={4.5}
                style={{
                  fill: SERIES_COLORS[position % SERIES_COLORS.length],
                  stroke: 'var(--surface)',
                }}
                strokeWidth={1.5}
                pointerEvents="none"
              />
            </g>,
          );
        }
      }
    }
  }

  if (kind === 'scatter') {
    rows.forEach((row, rowIndex) => {
      const x = xOfRow(row, rowIndex);
      if (x === null) return;
      visiblePositions.forEach((position) => {
        const value = row.values[position];
        if (value === null) return;
        const y = yOf(value);
        const point = makePoint(position, row, value, x, y);
        pointMarks.push(
          <g key={`scatter-${position}-${row.index}`} className="local-visual-point-group">
            <circle
              className={`local-visual-hit${point.selected ? ' is-selected' : ''}`}
              cx={x}
              cy={y}
              r={15}
              fill="transparent"
              {...markProps(point)}
            >
              <title>
              {t(
                `${point.series}, ${point.label}: ${formatNumber(point.value)}`,
                `${point.series}，${point.label}：${formatNumber(point.value)}`,
              )}
            </title>
            </circle>
            <circle
              className={`local-visual-point${point.selected ? ' is-selected' : ''}`}
              cx={x}
              cy={y}
              r={6}
              style={{
                fill: SERIES_COLORS[position % SERIES_COLORS.length],
                stroke: 'var(--surface)',
              }}
              strokeWidth={1.5}
              pointerEvents="none"
            />
          </g>,
        );
      });
    });
  }

  const readout = active
    ? t(
        `${active.series} · ${active.label}: ${formatNumber(active.value)}`,
        `${active.series} · ${active.label}：${formatNumber(active.value)}`,
      )
    : t(
        'Focus or point at a mark; use arrow keys to change the readout',
        '聚焦或指向图形，用方向键切换读数',
      );
  const ariaLabel = t(
    `${title}, ${kind} chart, ${rows.length} items, ${visiblePositions.length} series`,
    `${title}，${kind} 图，共 ${rows.length} 项，${visiblePositions.length} 个系列`,
  );

  return (
    <VisualFrame className={`local-visual-chart local-visual-chart-${kind}`} label={title}>
      <div className="local-visual-readout" id={readoutId} aria-live="polite">
        {readout}
      </div>
      <div className="local-visual-svg-wrap">
        <svg
          className="local-visual-svg"
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          role="group"
          aria-label={ariaLabel}
          aria-describedby={readoutId}
        >
          {yTicks.map((tick) => (
            <g key={`y-${tick}`}>
              <line
                className="local-visual-grid-line"
                x1={plotLeft}
                x2={plotRight}
                y1={yOf(tick)}
                y2={yOf(tick)}
              />
              <text
                className="local-visual-axis-label"
                x={plotLeft - 6}
                y={yOf(tick)}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {formatAxisNumber(tick)}
              </text>
            </g>
          ))}
          {yDomain.min < 0 && yDomain.max > 0 ? (
            <line
              className="local-visual-zero-line"
              x1={plotLeft}
              x2={plotRight}
              y1={zeroY}
              y2={zeroY}
            />
          ) : null}
          <line
            className="local-visual-axis-line"
            x1={plotLeft}
            x2={plotRight}
            y1={plotBottom}
            y2={plotBottom}
          />
          {xTicks.map((tick) => {
            const x = xPositionOfTick(tick);
            const labelText = xDomain
              ? formatAxisNumber(tick)
              : truncate(rows[tick]?.label ?? '', 8);
            return (
              <g key={`x-${tick}`}>
                <line
                  className="local-visual-tick"
                  x1={x}
                  x2={x}
                  y1={plotBottom}
                  y2={plotBottom + 5}
                />
                <text
                  className="local-visual-axis-label"
                  x={x}
                  y={plotBottom + 19}
                  textAnchor="middle"
                >
                  {labelText}
                  {!xDomain && rows[tick] ? <title>{rows[tick].label}</title> : null}
                </text>
              </g>
            );
          })}
          {xLabel ? (
            <text
              className="local-visual-axis-title"
              x={(plotLeft + plotRight) / 2}
              y={CHART_HEIGHT - 2}
              textAnchor="middle"
            >
              {xLabel}
            </text>
          ) : null}
          {yLabel ? (
            <text
              className="local-visual-axis-title"
              transform={`translate(12 ${(plotTop + plotBottom) / 2}) rotate(-90)`}
              textAnchor="middle"
            >
              {yLabel}
            </text>
          ) : null}
          {areaMarks}
          {lineMarks}
          {activeGuide}
          {barMarks}
          {pointMarks}
        </svg>
      </div>
      <ChartLegend
        items={legendItems}
        hidden={hiddenSeries}
        onToggle={toggleSeries}
        label={t('Legend, toggle series', '图例，可开关系列')}
      />
      {selectionError ? <VisualMessage message={selectionError} kind="alert" /> : null}
      <Notes notes={notes} />
    </VisualFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Function plot                                                       */
/* ------------------------------------------------------------------ */

interface PlotCurve {
  source: string;
  expression: CompiledLatex | null;
  points: { x: number; y: number | null }[];
  endpoint: number | null;
  error: string | null;
}

type PlotSampleResult =
  | { ok: true; curves: PlotCurve[]; notes: string[] }
  | { ok: false; message: string };

interface PlotBudgetState {
  revision: number;
  requestedPoints: Map<string, number>;
  evaluation: LatexEvaluationBudget;
  samples: Map<string, PlotSampleResult>;
}

/**
 * Document-wide plot accounting. Keys are the runtime instance, so separate
 * documents never share limits. The snapshot revision starts a fresh budget:
 * state changes may alter plot expressions and must not inherit an exhausted
 * budget from the previous render.
 */
const documentPlotBudgets = new WeakMap<LocalRuntime, PlotBudgetState>();

function plotBudgetState(runtime: LocalRuntime, revision: number): PlotBudgetState {
  let budget = documentPlotBudgets.get(runtime);
  if (!budget || budget.revision !== revision) {
    budget = {
      revision,
      requestedPoints: new Map(),
      evaluation: { steps: 0, limit: MAX_LOCAL_PLOT_STEPS },
      samples: new Map(),
    };
    documentPlotBudgets.set(runtime, budget);
  }
  return budget;
}

/**
 * Samples every curve of one plot once per revision. Caching by node id keeps
 * pointer and keyboard readout updates from resampling, and makes StrictMode's
 * repeated render unable to charge the shared budget twice.
 */
function sampleDocumentPlot(
  nodeId: string,
  cacheKey: string,
  mathNodes: LocalNode[],
  environment: Record<string, LocalValue>,
  min: number,
  max: number,
  samples: number,
  runtime: LocalRuntime,
  revision: number,
  t: Localize = defaultLocalize,
): PlotSampleResult {
  const budget = plotBudgetState(runtime, revision);
  const cached = budget.samples.get(cacheKey);
  if (cached) return cached;

  const fail = (message: string): PlotSampleResult => {
    const result: PlotSampleResult = { ok: false, message };
    budget.samples.set(cacheKey, result);
    return result;
  };

  if (mathNodes.length > MAX_LOCAL_PLOT_CURVES) {
    return fail(
      t(
        `plot supports at most ${MAX_LOCAL_PLOT_CURVES} curves, but has ${mathNodes.length}.`,
        `plot 最多支持 ${MAX_LOCAL_PLOT_CURVES} 条曲线，当前为 ${mathNodes.length} 条。`,
      ),
    );
  }

  const requested = mathNodes.length * samples;
  budget.requestedPoints.set(nodeId, requested);
  let total = 0;
  for (const value of budget.requestedPoints.values()) total += value;
  if (total > MAX_LOCAL_PLOT_POINTS) {
    return fail(
      t(
        `The document's plot sample count exceeds the limit: ${total} requested, at most ${MAX_LOCAL_PLOT_POINTS} allowed. Reduce curves or samples.`,
        `整篇文档的绘图采样点超过上限：已请求 ${total} 个，最多 ${MAX_LOCAL_PLOT_POINTS} 个。请减少曲线或采样数。`,
      ),
    );
  }

  const notes: string[] = [];
  const budgetFailure: { message: string | null } = { message: null };
  const curves: PlotCurve[] = mathNodes.map((mathNode, index) => {
    const source = (mathNode.value ?? '').trim();
    const match = /^y\s*=\s*([\s\S]+)$/.exec(source);
    if (!match) {
      notes.push(
        t(
          `Curve ${index + 1}: cannot compute (each formula block must be written as y = expression).`,
          `曲线 ${index + 1}：无法计算（每块公式需写成 y = 表达式）。`,
        ),
      );
      return { source, expression: null, points: [], endpoint: null, error: 'formula' };
    }
    try {
      const expression = compileLatex(match[1].trim());
      const result = samplePlot(expression, environment, min, max, samples, budget.evaluation);
      return { source, expression, points: result.points, endpoint: result.endpoint, error: null };
    } catch (cause) {
      if (cause instanceof LatexError && cause.code === 'latex-budget') {
        // An exhausted document budget makes the whole plot unreliable; do not
        // draw a partial set of curves.
        budgetFailure.message = cause.message;
        return { source, expression: null, points: [], endpoint: null, error: cause.message };
      }
      notes.push(
        t(
          `Curve ${index + 1}: cannot compute (${errorMessage(cause)}).`,
          `曲线 ${index + 1}：无法计算（${errorMessage(cause)}）。`,
        ),
      );
      return { source, expression: null, points: [], endpoint: null, error: errorMessage(cause) };
    }
  });
  if (budgetFailure.message !== null) {
    return fail(
      t(
        `Plot computation exceeded the shared execution budget: ${budgetFailure.message}`,
        `绘图计算超过共享执行预算：${budgetFailure.message}`,
      ),
    );
  }

  const result: PlotSampleResult = { ok: true, curves, notes };
  budget.samples.set(cacheKey, result);
  return result;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function plotSegments(
  points: { x: number; y: number | null }[],
  ySpan: number,
  medianAbs: number,
  medianDelta: number,
): { x: number; y: number }[][] {
  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  const shouldBreak = (
    previous: { x: number; y: number },
    next: { x: number; y: number },
  ): boolean => {
    const delta = Math.abs(next.y - previous.y);
    const asymptote =
      previous.y * next.y < 0 &&
      Math.min(Math.abs(previous.y), Math.abs(next.y)) > Math.max(1, medianAbs * 8);
    const jump = delta > ySpan * 0.8 && delta > Math.max(medianDelta, 1e-9) * 10;
    return asymptote || jump;
  };
  for (const point of points) {
    if (point.y === null) {
      if (current.length > 0) segments.push(current);
      current = [];
      continue;
    }
    const next = { x: point.x, y: point.y };
    const previous = current[current.length - 1];
    if (previous && shouldBreak(previous, next)) {
      segments.push(current);
      current = [];
    }
    current.push(next);
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

function PlotView({ node, runtime }: LocalVisualProps) {
  const t = useLocalize();
  const locale = useLocalLocale();
  const [activeX, setActiveX] = useState<number | null>(null);
  const reset = runtime.resetToken(node);
  useEffect(() => {
    setActiveX(null);
  }, [reset]);

  const readoutId = useId();
  const label = attrText(runtime, node.attrs, 'label', '') || t('Function plot', '函数图');
  const xLabel = attrText(runtime, node.attrs, 'x-label', 'x');
  const yLabel = attrText(runtime, node.attrs, 'y-label', 'y');
  const min = attrNumber(runtime, node.attrs, 'min', -10);
  const max = attrNumber(runtime, node.attrs, 'max', 10);
  const samples = Math.min(2000, Math.max(2, attrInteger(runtime, node.attrs, 'samples', 200)));
  const mathNodes = (node.children ?? []).filter(
    (child) => child.type === 'math' || child.type === 'inlineMath',
  );
  const environment = (() => {
    try {
      return { ...runtime.snapshot().state } as Record<string, LocalValue>;
    } catch {
      return {} as Record<string, LocalValue>;
    }
  })();
  let revision = 0;
  try {
    revision = runtime.snapshot().revision;
  } catch {
    revision = 0;
  }
  const mathKey = mathNodes
    .map((child) => `${child.id}\u0000${child.value ?? ''}`)
    .join('\u0001');
  const cacheKey = `${node.id}\u0000${min}\u0000${max}\u0000${samples}\u0000${locale}\u0000${mathKey}`;

  // Sampling is cached per document revision, so moving the pointer across the
  // plot or changing the keyboard readout never resamples every curve.
  const sampled = useMemo<PlotSampleResult>(
    () => {
      if (mathNodes.length === 0 || min === null || max === null || !(max > min)) {
        return { ok: true, curves: [], notes: [] };
      }
      return sampleDocumentPlot(
        node.id,
        cacheKey,
        mathNodes,
        environment,
        min,
        max,
        samples,
        runtime,
        revision,
        t,
      );
    },
    [cacheKey, node.id, revision, runtime, t],
  );

  if (mathNodes.length === 0) {
    return (
      <VisualFrame className="local-visual-plot" label={label}>
        <VisualMessage
          message={t(
            'plot body requires one or more $$ formula blocks.',
            'plot 正文需要一个或多个 $$ 公式块。',
          )}
          kind="alert"
        />
      </VisualFrame>
    );
  }
  if (min === null || max === null || !(max > min)) {
    return (
      <VisualFrame className="local-visual-plot" label={label}>
        <VisualMessage
          message={t('plot min must be less than max.', 'plot 的 min 必须小于 max。')}
          kind="alert"
        />
      </VisualFrame>
    );
  }
  if (!sampled.ok) {
    return (
      <VisualFrame className="local-visual-plot" label={label}>
        <VisualMessage message={sampled.message} kind="alert" />
      </VisualFrame>
    );
  }

  const { curves, notes } = sampled;

  const finitePoints = curves.flatMap((curve) =>
    curve.points.filter(
      (point): point is { x: number; y: number } => point.y !== null && Number.isFinite(point.y),
    ),
  );

  const legend = (
    <div
      className="local-visual-plot-legend"
      role="list"
      aria-label={t('Curve legend', '曲线图例')}
    >
      {curves.map((curve, index) => (
        <div key={`curve-legend-${index}`} className="local-visual-plot-legend-item" role="listitem">
          <span
            className="local-visual-swatch"
            style={{ backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] }}
            aria-hidden="true"
          />
          <span className="local-visual-plot-legend-text">
            <span className="local-visual-plot-formula"><LatexView source={curve.source} /></span>
          </span>
        </div>
      ))}
    </div>
  );

  if (finitePoints.length === 0) {
    return (
      <VisualFrame className="local-visual-plot" label={label}>
        <VisualMessage
          message={t(
            'No plottable values in the current range',
            '当前范围内没有可绘制的值',
          )}
        />
        <Notes notes={notes} />
        {legend}
      </VisualFrame>
    );
  }

  const yValues = finitePoints.map((point) => point.y);
  const yDomain = chartDomain(yValues, false);
  const yTicks = niceTicks(yDomain.min, yDomain.max, 5);
  const xTicks = niceTicks(min, max, 5);
  const plotLeft = axisLeft(yTicks, Boolean(yLabel));
  const plotRight = PLOT_WIDTH - 14;
  const plotTop = 16;
  const plotBottom = PLOT_HEIGHT - 46;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;
  const xOf = (x: number) => plotLeft + ((x - min) / (max - min)) * plotWidth;
  const yOf = (y: number) =>
    plotTop + ((yDomain.max - y) / (yDomain.max - yDomain.min)) * plotHeight;

  const medianAbs = median(finitePoints.map((point) => Math.abs(point.y)));
  const consecutiveDeltas: number[] = [];
  for (const curve of curves) {
    for (let index = 1; index < curve.points.length; index += 1) {
      const previous = curve.points[index - 1];
      const current = curve.points[index];
      if (previous.y !== null && current.y !== null) {
        consecutiveDeltas.push(Math.abs(current.y - previous.y));
      }
    }
  }
  const medianDelta = median(consecutiveDeltas);
  const ySpan = yDomain.max - yDomain.min;

  const curveSegments = curves.map((curve) =>
    plotSegments(curve.points, ySpan, medianAbs, medianDelta),
  );

  // Readout evaluation shares one bounded budget per render as well, so a
  // readout update cannot multiply work by the number of curves.
  const readoutBudget: LatexEvaluationBudget = { steps: 0, limit: MAX_LOCAL_PLOT_STEPS };
  const valueAt = (curve: PlotCurve, x: number): number | null => {
    if (!curve.expression) return null;
    try {
      const value = curve.expression.evaluate(x, environment, readoutBudget);
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  };

  const clampX = (value: number) => Math.max(min, Math.min(max, value));
  const step = (max - min) / 100;

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    setActiveX(min + ratio * (max - min));
  };

  const handleKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    const multiplier = event.shiftKey ? 10 : 1;
    let next: number | null = activeX;
    if (event.key === 'ArrowRight') next = (activeX ?? (min + max) / 2) + step * multiplier;
    else if (event.key === 'ArrowLeft') next = (activeX ?? (min + max) / 2) - step * multiplier;
    else if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = max;
    else return;
    event.preventDefault();
    setActiveX(clampX(next));
  };

  const readX = activeX === null ? null : clampX(activeX);
  const readout =
    readX === null
      ? t(
          `Range [${formatNumber(min)}, ${formatNumber(max)}] · ${samples} samples; use arrow keys or pointer to read values`,
          `区间 [${formatNumber(min)}, ${formatNumber(max)}] · ${samples} 个采样点；用方向键或指针读取数值`,
        )
      : `${t(`x = ${formatNumber(readX)}; `, `x = ${formatNumber(readX)}；`)}${curves
          .map((curve, index) => {
            const value = valueAt(curve, readX);
            const status = curve.error
              ? t('cannot compute', '无法计算')
              : value === null
                ? t('undefined', '无定义')
                : formatNumber(value);
            return t(`Curve ${index + 1}: `, `曲线 ${index + 1}：`) + status;
          })
          .join(t('; ', '；'))}`;

  const activeMarks = readX === null
    ? null
    : curves.map((curve, index) => {
        const value = valueAt(curve, readX);
        if (value === null || !curve.expression) return null;
        return (
          <circle
            key={`active-${index}`}
            className="local-visual-active-point"
            cx={xOf(readX)}
            cy={yOf(value)}
            r={4.5}
            style={{
              fill: SERIES_COLORS[index % SERIES_COLORS.length],
              stroke: 'var(--surface)',
            }}
            strokeWidth={1.5}
          />
        );
      });

  return (
    <VisualFrame className="local-visual-plot" label={label}>
      <div className="local-visual-readout" id={readoutId} aria-live="polite">
        {readout}
      </div>
      <div className="local-visual-svg-wrap">
        <svg
          className="local-visual-svg"
          viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
          role="group"
          aria-label={t(
            `${label}, range ${formatNumber(min)} to ${formatNumber(max)}, ${samples} samples`,
            `${label}，区间 ${formatNumber(min)} 到 ${formatNumber(max)}，${samples} 个采样点`,
          )}
          aria-describedby={readoutId}
          tabIndex={0}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setActiveX(null)}
          onFocus={() => setActiveX((current) => current ?? (min + max) / 2)}
          onBlur={() => setActiveX(null)}
          onKeyDown={handleKeyDown}
        >
          {yTicks.map((tick) => (
            <g key={`y-${tick}`}>
              <line
                className="local-visual-grid-line"
                x1={plotLeft}
                x2={plotRight}
                y1={yOf(tick)}
                y2={yOf(tick)}
              />
              <text
                className="local-visual-axis-label"
                x={plotLeft - 6}
                y={yOf(tick)}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {formatAxisNumber(tick)}
              </text>
            </g>
          ))}
          {yDomain.min < 0 && yDomain.max > 0 ? (
            <line
              className="local-visual-zero-line"
              x1={plotLeft}
              x2={plotRight}
              y1={yOf(0)}
              y2={yOf(0)}
            />
          ) : null}
          <line
            className="local-visual-axis-line"
            x1={plotLeft}
            x2={plotRight}
            y1={plotBottom}
            y2={plotBottom}
          />
          {xTicks.map((tick) => (
            <g key={`x-${tick}`}>
              <line
                className="local-visual-tick"
                x1={xOf(tick)}
                x2={xOf(tick)}
                y1={plotBottom}
                y2={plotBottom + 5}
              />
              <text
                className="local-visual-axis-label"
                x={xOf(tick)}
                y={plotBottom + 19}
                textAnchor="middle"
              >
                {formatAxisNumber(tick)}
              </text>
            </g>
          ))}
          {xLabel ? (
            <text
              className="local-visual-axis-title"
              x={(plotLeft + plotRight) / 2}
              y={PLOT_HEIGHT - 2}
              textAnchor="middle"
            >
              {xLabel}
            </text>
          ) : null}
          {yLabel ? (
            <text
              className="local-visual-axis-title"
              transform={`translate(12 ${(plotTop + plotBottom) / 2}) rotate(-90)`}
              textAnchor="middle"
            >
              {yLabel}
            </text>
          ) : null}
          {curveSegments.map((segments, curveIndex) =>
            segments.map((segment, segmentIndex) => {
              if (segment.length < 2) return null;
              const d = segment
                .map((point, index) => `${index === 0 ? 'M' : 'L'} ${xOf(point.x)} ${yOf(point.y)}`)
                .join(' ');
              return (
                <path
                  key={`curve-${curveIndex}-${segmentIndex}`}
                  className="local-visual-plot-line"
                  d={d}
                  fill="none"
                  style={{ stroke: SERIES_COLORS[curveIndex % SERIES_COLORS.length] }}
                  strokeWidth={2.4}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              );
            }),
          )}
          {readX !== null ? (
            <line
              className="local-visual-guide"
              x1={xOf(readX)}
              x2={xOf(readX)}
              y1={plotTop}
              y2={plotBottom}
            />
          ) : null}
          {activeMarks}
        </svg>
      </div>
      <Notes notes={notes} />
      {legend}
    </VisualFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

interface TimelineItem {
  key: string;
  title: string;
  start: number;
  duration: number;
  description: LocalNode[];
  sourceIndex: number;
}

interface TimelineHeaderSet {
  title: string;
  start: string;
  duration: string;
  notes: string;
}

const TIMELINE_HEADERS_EN: TimelineHeaderSet = {
  title: 'Task',
  start: 'Start',
  duration: 'Duration',
  notes: 'Notes',
};

const TIMELINE_HEADERS_ZH: TimelineHeaderSet = {
  title: '事项',
  start: '开始',
  duration: '时长',
  notes: '说明',
};

/**
 * The compiler accepts either the English or the Chinese header set. Detect
 * one complete set per table so column indexes always come from the same
 * language and a partially translated header is reported as invalid.
 */
function timelineHeaderSet(header: string[]): TimelineHeaderSet | null {
  const complete = (set: TimelineHeaderSet) =>
    header.includes(set.title) && header.includes(set.start) && header.includes(set.duration);
  if (complete(TIMELINE_HEADERS_EN)) return TIMELINE_HEADERS_EN;
  if (complete(TIMELINE_HEADERS_ZH)) return TIMELINE_HEADERS_ZH;
  return null;
}

function TimelineView({ node, runtime, render }: LocalVisualProps) {
  const t = useLocalize();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const reset = runtime.resetToken(node);
  useEffect(() => {
    setActiveKey(null);
  }, [reset]);

  const title = attrText(runtime, node.attrs, 'title', '') || t('Timeline', '时间轴');
  const unit = attrText(runtime, node.attrs, 'unit', t('minutes', '分钟'));
  const table = buildVisualTable(node, runtime, t);

  if (!table) {
    return (
      <VisualFrame className="local-visual-timeline" label={title}>
        <VisualMessage
          message={t('timeline body requires a Markdown table.', 'timeline 正文需要一个 Markdown 表格。')}
          kind="alert"
        />
      </VisualFrame>
    );
  }

  const header = table.headerText.map((text) => text.trim());
  const headers = timelineHeaderSet(header);
  const titleColumn = headers ? header.indexOf(headers.title) : -1;
  const startColumn = headers ? header.indexOf(headers.start) : -1;
  const durationColumn = headers ? header.indexOf(headers.duration) : -1;
  const descriptionColumn = headers ? header.indexOf(headers.notes) : -1;
  if (!headers || titleColumn < 0 || startColumn < 0 || durationColumn < 0) {
    return (
      <VisualFrame className="local-visual-timeline" label={title}>
        <VisualMessage
          message={t(
            'timeline table requires the "Task", "Start" and "Duration" columns.',
            'timeline 表格需要“事项”“开始”“时长”三列，或“Task”“Start”“Duration”三列。',
          )}
          kind="alert"
        />
      </VisualFrame>
    );
  }

  const notes: string[] = [];
  const invalidRows: number[] = [];
  const items: TimelineItem[] = [];
  table.rows.forEach((row, rowIndex) => {
    const startCell = row.cells[startColumn];
    const durationCell = row.cells[durationColumn];
    const start = startCell?.numeric ?? null;
    const duration = durationCell?.numeric ?? null;
    if (start === null || duration === null || start < 0 || duration < 0) {
      invalidRows.push(rowIndex + 1);
      return;
    }
    const titleText =
      cellText(row.cells[titleColumn], t) || t(`Task ${rowIndex + 1}`, `事项 ${rowIndex + 1}`);
    items.push({
      key: `item-${row.index}`,
      title: titleText,
      start,
      duration,
      description: descriptionColumn >= 0 ? row.cells[descriptionColumn]?.children ?? [] : [],
      sourceIndex: rowIndex,
    });
  });
  if (invalidRows.length > 0) {
    notes.push(
      t(
        `Rows ${invalidRows.join(', ')} have an invalid start or duration (must be non-negative numbers) and are hidden.`,
        `第 ${invalidRows.join('、')} 行的开始或时长不是非负数字，未显示。`,
      ),
    );
  }
  if (items.length === 0) {
    return (
      <VisualFrame className="local-visual-timeline" label={title}>
        <VisualMessage message={t('No valid timeline items.', '没有有效的时间轴事项。')} />
        <Notes notes={notes} />
      </VisualFrame>
    );
  }

  const ordered = [...items].sort(
    (left, right) => left.start - right.start || left.sourceIndex - right.sourceIndex,
  );
  const maxEnd = ordered.reduce(
    (maximum, item) => Math.max(maximum, item.start + item.duration),
    0,
  );
  const span = Math.max(1, maxEnd);
  const ticks = niceTicks(0, span, 5);
  if (ticks.length === 0 || ticks[0] !== 0) ticks.unshift(0);
  if (ticks[ticks.length - 1] < span) ticks.push(span);

  const suffix = unit ? ` ${unit}` : '';
  const timeText = (value: number) => `${formatNumber(value)}${suffix}`;
  const active = ordered.find((item) => item.key === activeKey) ?? null;

  return (
    <VisualFrame className="local-visual-timeline" label={title}>
      <div className="local-visual-timeline-axis" aria-hidden="true">
        {ticks.map((tick, index) => {
          const percent = (tick / span) * 100;
          const style =
            index === ticks.length - 1
              ? { left: `${percent}%`, transform: 'translateX(-100%)' }
              : index === 0
                ? { left: '0%' }
                : { left: `${percent}%`, transform: 'translateX(-50%)' };
          return (
            <span key={`tick-${tick}`} className="local-visual-timeline-tick" style={style}>
              {formatAxisNumber(tick)}
            </span>
          );
        })}
      </div>
      <ol className="local-visual-timeline-list">
        {ordered.map((item) => {
          const end = item.start + item.duration;
          const left = (item.start / span) * 100;
          const width = (item.duration / span) * 100;
          const index = ordered.indexOf(item);
          return (
            <li
              key={item.key}
              className={`local-visual-timeline-item${
                activeKey === item.key ? ' is-active' : ''
              }`}
              tabIndex={0}
              aria-label={t(
                `${item.title}, started ${timeText(item.start)}, ended ${timeText(
                  end,
                )}, duration ${timeText(item.duration)}${item.description.length > 0 ? ', with notes' : ''}`,
                `${item.title}，开始 ${timeText(item.start)}，结束 ${timeText(
                  end,
                )}，时长 ${timeText(item.duration)}${item.description.length > 0 ? '，有说明' : ''}`,
              )}
              onFocus={() => setActiveKey(item.key)}
              onBlur={() => setActiveKey((current) => (current === item.key ? null : current))}
              onPointerEnter={() => setActiveKey(item.key)}
              onPointerLeave={() =>
                setActiveKey((current) => (current === item.key ? null : current))
              }
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setActiveKey(null);
                }
              }}
            >
              <div className="local-visual-timeline-head">
                <span className="local-visual-timeline-title">
                  <span
                    className="local-visual-swatch"
                    style={{ backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] }}
                    aria-hidden="true"
                  />
                  {item.title}
                </span>
                <span className="local-visual-timeline-times">
                  {t('Started', '开始')} {timeText(item.start)} · {t('Ended', '结束')}{' '}
                  {timeText(end)} · {t('Duration', '时长')} {timeText(item.duration)}
                </span>
              </div>
              <div className="local-visual-timeline-track" aria-hidden="true">
                <span
                  className={`local-visual-timeline-bar${item.duration === 0 ? ' is-zero' : ''}`}
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length],
                  }}
                />
              </div>
            </li>
          );
        })}
      </ol>
      <div className="local-visual-timeline-detail" aria-live="polite">
        {active ? (
          <>
            <strong>{active.title}</strong>
            {active.description.length > 0 ? (
              render(active.description)
            ) : (
              <span>{t('No notes.', '没有说明。')}</span>
            )}
          </>
        ) : (
          <span>
            {t('Focus or point at an item to view its notes.', '聚焦或指向事项查看说明。')}
          </span>
        )}
      </div>
      <Notes notes={notes} />
    </VisualFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Diagram                                                             */
/* ------------------------------------------------------------------ */

type DiagramTone = 'neutral' | 'success' | 'warning';

interface DiagramModelNode {
  id: string;
  label: string;
  tone: DiagramTone;
  children: LocalNode[];
}

interface DiagramModelEdge {
  key: string;
  from: string;
  to: string;
  label: string;
}

interface DiagramLayout {
  width: number;
  height: number;
  positions: Map<string, { x: number; y: number }>;
}

/** CJK, kana, hangul and full-width punctuation occupy roughly one em. */
const DIAGRAM_WIDE_CHAR =
  /[\u1100-\u115f\u2e80-\u303f\u3040-\u33ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u;

function estimateDiagramTextWidth(text: string): number {
  let em = 0;
  for (const char of text) {
    if (DIAGRAM_WIDE_CHAR.test(char)) em += 1;
    else if (/\s/u.test(char)) em += 0.3;
    else em += 0.58;
  }
  return em * DIAGRAM_EDGE_LABEL_FONT_SIZE;
}

function fitDiagramLabelLine(text: string, maxWidth: number): string {
  if (estimateDiagramTextWidth(text) <= maxWidth) return text;
  let line = '';
  for (const char of text) {
    if (estimateDiagramTextWidth(`${line}${char}…`) > maxWidth) break;
    line += char;
  }
  return `${line.trimEnd()}…`;
}

function wrapDiagramLabel(label: string): string[] {
  const lines: string[] = [];
  let line = '';
  for (const char of label) {
    if (line && estimateDiagramTextWidth(line + char) > DIAGRAM_EDGE_LABEL_MAX_WIDTH) {
      lines.push(line);
      line = char;
    } else {
      line += char;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= DIAGRAM_EDGE_LABEL_MAX_LINES) return lines;
  const kept = lines.slice(0, DIAGRAM_EDGE_LABEL_MAX_LINES);
  kept[DIAGRAM_EDGE_LABEL_MAX_LINES - 1] = fitDiagramLabelLine(
    lines.slice(DIAGRAM_EDGE_LABEL_MAX_LINES - 1).join(''),
    DIAGRAM_EDGE_LABEL_MAX_WIDTH,
  );
  return kept;
}

interface DiagramLabelMetrics {
  width: number;
  height: number;
  lines: string[];
}

function diagramLabelMetrics(label: string): DiagramLabelMetrics {
  const lines = wrapDiagramLabel(label);
  const width = lines.reduce(
    (widest, line) => Math.max(widest, estimateDiagramTextWidth(line)),
    0,
  );
  return {
    width: width + DIAGRAM_EDGE_LABEL_PAD_X * 2,
    height: lines.length * DIAGRAM_EDGE_LABEL_LINE_HEIGHT + DIAGRAM_EDGE_LABEL_PAD_Y * 2,
    lines,
  };
}

/**
 * Parallel edges fan out around the pair's center. The same offsets must be
 * used for layout measurement and rendering so label bounds stay accurate.
 */
function diagramEdgeOffsets(edges: DiagramModelEdge[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const edge of edges) {
    const pair = `${edge.from}\u0000${edge.to}`;
    totals.set(pair, (totals.get(pair) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const offsets = new Map<string, number>();
  for (const edge of edges) {
    const pair = `${edge.from}\u0000${edge.to}`;
    const total = totals.get(pair) ?? 1;
    const index = seen.get(pair) ?? 0;
    seen.set(pair, index + 1);
    offsets.set(edge.key, (index - (total - 1) / 2) * 12);
  }
  return offsets;
}

/**
 * Grows the viewBox and shifts every node when a label would leave it. Forward
 * labels already fit between cards thanks to the adaptive layer spacing; this
 * pass protects back-edge and self-loop labels near the diagram borders.
 */
function padDiagramForLabels(
  layout: DiagramLayout,
  edges: DiagramModelEdge[],
  direction: 'right' | 'down',
): DiagramLayout {
  const { width, height, positions } = layout;
  const offsets = diagramEdgeOffsets(edges);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const edge of edges) {
    if (!edge.label) continue;
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    const geometry = edgeGeometry(
      direction,
      from,
      to,
      offsets.get(edge.key) ?? 0,
      edge.from === edge.to,
    );
    const metrics = diagramLabelMetrics(edge.label);
    minX = Math.min(minX, geometry.labelX - metrics.width / 2);
    minY = Math.min(minY, geometry.labelY - metrics.height / 2);
    maxX = Math.max(maxX, geometry.labelX + metrics.width / 2);
    maxY = Math.max(maxY, geometry.labelY + metrics.height / 2);
  }
  if (!Number.isFinite(minX)) return layout;

  const left = Math.max(0, DIAGRAM_EDGE_LABEL_MARGIN - minX);
  const top = Math.max(0, DIAGRAM_EDGE_LABEL_MARGIN - minY);
  const right = Math.max(0, maxX + DIAGRAM_EDGE_LABEL_MARGIN - width);
  const bottom = Math.max(0, maxY + DIAGRAM_EDGE_LABEL_MARGIN - height);
  if (left === 0 && top === 0 && right === 0 && bottom === 0) return layout;

  for (const position of positions.values()) {
    position.x += left;
    position.y += top;
  }
  return {
    width: width + left + right,
    height: height + top + bottom,
    positions,
  };
}

function diagramLayout(
  nodes: DiagramModelNode[],
  edges: DiagramModelEdge[],
  direction: 'right' | 'down',
): DiagramLayout {
  const ids = nodes.map((entry) => entry.id);
  const sourceOrder = new Map(ids.map((id, index) => [id, index]));
  const known = new Set(ids);
  const adjacency = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of edges) {
    if (edge.from === edge.to || !known.has(edge.from) || !known.has(edge.to)) continue;
    adjacency.get(edge.from)!.push(edge.to);
  }

  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  const strongConnect = (id: string) => {
    indices.set(id, counter);
    low.set(id, counter);
    counter += 1;
    stack.push(id);
    onStack.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (!indices.has(next)) {
        strongConnect(next);
        low.set(id, Math.min(low.get(id)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(id, Math.min(low.get(id)!, indices.get(next)!));
      }
    }
    if (low.get(id) === indices.get(id)) {
      const component: string[] = [];
      let current: string;
      do {
        current = stack.pop()!;
        onStack.delete(current);
        component.push(current);
      } while (current !== id);
      components.push(component.reverse());
    }
  };
  for (const id of ids) if (!indices.has(id)) strongConnect(id);

  const componentOf = new Map<string, number>();
  components.forEach((component, index) => {
    for (const id of component) componentOf.set(id, index);
  });

  const condensed = components.map(() => new Set<number>());
  const indegree = components.map(() => 0);
  for (const edge of edges) {
    if (!known.has(edge.from) || !known.has(edge.to)) continue;
    const from = componentOf.get(edge.from)!;
    const to = componentOf.get(edge.to)!;
    if (from === to || condensed[from].has(to)) continue;
    condensed[from].add(to);
    indegree[to] += 1;
  }

  const componentOrder = components.map((component, index) => ({
    index,
    order: Math.min(...component.map((id) => sourceOrder.get(id) ?? 0)),
  }));
  const queue = componentOrder
    .filter((entry) => indegree[entry.index] === 0)
    .map((entry) => entry.index)
    .sort((left, right) => {
      const a = componentOrder[left].order;
      const b = componentOrder[right].order;
      return a - b;
    });
  const layer = components.map(() => 0);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of condensed[current]) {
      layer[next] = Math.max(layer[next], layer[current] + 1);
      indegree[next] -= 1;
      if (indegree[next] === 0) queue.push(next);
    }
  }

  const layerCount = Math.max(1, ...layer) + 1;
  const groups: string[][] = Array.from({ length: layerCount }, () => []);
  for (const id of ids) groups[layer[componentOf.get(id)!]].push(id);
  const populated = groups.filter((group) => group.length > 0);
  const maxCount = Math.max(1, ...populated.map((group) => group.length));
  const marginX = 44;
  const marginY = 30;

  const positions = new Map<string, { x: number; y: number }>();
  let width: number;
  let height: number;
  if (direction === 'down') {
    width = DIAGRAM_MIN_WIDTH;
    height = Math.max(
      240,
      marginY * 2 + DIAGRAM_NODE_HEIGHT + (populated.length - 1) * 120,
    );
    populated.forEach((group, layerIndex) => {
      const y = marginY + DIAGRAM_NODE_HEIGHT / 2 + layerIndex * 120;
      group.forEach((id, index) => {
        const x =
          group.length === 1
            ? width / 2
            : marginX +
              DIAGRAM_NODE_WIDTH / 2 +
              index * ((width - marginX * 2 - DIAGRAM_NODE_WIDTH) / (group.length - 1));
        positions.set(id, { x, y });
      });
    });
  } else {
    // Forward edge labels sit in the channel between two layers. Reserve the
    // widest estimated label plus breathing room on both sides; fall back to
    // the original 150px rhythm when there are no labels.
    const widestLabel = edges.reduce(
      (widest, edge) =>
        edge.label ? Math.max(widest, diagramLabelMetrics(edge.label).width) : widest,
      0,
    );
    const layerSpacing = Math.max(
      DIAGRAM_LAYER_GAP,
      DIAGRAM_NODE_WIDTH +
        (widestLabel > 0 ? widestLabel + DIAGRAM_EDGE_LABEL_CLEARANCE * 2 : 0),
    );
    width = Math.max(
      DIAGRAM_MIN_WIDTH,
      marginX * 2 + DIAGRAM_NODE_WIDTH + (populated.length - 1) * layerSpacing,
    );
    height = Math.max(
      240,
      marginY * 2 + DIAGRAM_NODE_HEIGHT + (maxCount - 1) * 74,
    );
    populated.forEach((group, layerIndex) => {
      const x =
        populated.length === 1
          ? width / 2
          : marginX +
            DIAGRAM_NODE_WIDTH / 2 +
            layerIndex * ((width - marginX * 2 - DIAGRAM_NODE_WIDTH) / (populated.length - 1));
      group.forEach((id, index) => {
        const y =
          group.length === 1
            ? height / 2
            : marginY +
              DIAGRAM_NODE_HEIGHT / 2 +
              index * ((height - marginY * 2 - DIAGRAM_NODE_HEIGHT) / (group.length - 1));
        positions.set(id, { x, y });
      });
    });
  }

  return padDiagramForLabels({ width, height, positions }, edges, direction);
}

interface EdgeGeometry {
  d: string;
  labelX: number;
  labelY: number;
}

function edgeGeometry(
  direction: 'right' | 'down',
  from: { x: number; y: number },
  to: { x: number; y: number },
  offset: number,
  self: boolean,
): EdgeGeometry {
  const width = DIAGRAM_NODE_WIDTH;
  const height = DIAGRAM_NODE_HEIGHT;
  if (self) {
    if (direction === 'right') {
      const d = `M ${from.x + 20} ${from.y - height / 2} C ${from.x + 64} ${
        from.y - height / 2 - 64
      }, ${from.x - 64} ${from.y - height / 2 - 64}, ${from.x - 20} ${from.y - height / 2}`;
      return { d, labelX: from.x, labelY: from.y - height / 2 - 46 };
    }
    const d = `M ${from.x + width / 2} ${from.y - 10} C ${from.x + width / 2 + 64} ${
      from.y - 54
    }, ${from.x + width / 2 + 64} ${from.y + 54}, ${from.x + width / 2} ${from.y + 10}`;
    return { d, labelX: from.x + width / 2 + 44, labelY: from.y };
  }

  if (direction === 'right') {
    const forward = to.x > from.x;
    if (forward) {
      const x1 = from.x + width / 2;
      const y1 = from.y + offset;
      const x2 = to.x - width / 2;
      const y2 = to.y + offset;
      return {
        d: `M ${x1} ${y1} L ${x2} ${y2}`,
        labelX: (x1 + x2) / 2,
        labelY: (y1 + y2) / 2 - 12,
      };
    }
    const x1 = from.x + offset;
    const x2 = to.x + offset;
    const y1 = from.y + height / 2;
    const y2 = to.y - height / 2;
    const bend = Math.max(70, Math.abs(x2 - x1) * 0.45);
    return {
      d: `M ${x1} ${y1} C ${x1 + bend} ${y1 + 86}, ${x2 - bend} ${y2 + 86}, ${x2} ${y2}`,
      labelX: (x1 + x2) / 2,
      labelY: Math.max(y1, y2) + 48,
    };
  }

  const forward = to.y > from.y;
  if (forward) {
    const x1 = from.x + offset;
    const x2 = to.x + offset;
    const y1 = from.y + height / 2;
    const y2 = to.y - height / 2;
    return {
      d: `M ${x1} ${y1} L ${x2} ${y2}`,
      labelX: (x1 + x2) / 2 + 10,
      labelY: (y1 + y2) / 2,
    };
  }
  const x1 = from.x + width / 2;
  const x2 = to.x - width / 2;
  const y1 = from.y + offset;
  const y2 = to.y + offset;
  const bend = Math.max(70, Math.abs(y2 - y1) * 0.45);
  return {
    d: `M ${x1} ${y1} C ${x1 + 86} ${y1 + bend}, ${x2 + 86} ${y2 - bend}, ${x2} ${y2}`,
    labelX: Math.max(x1, x2) + 48,
    labelY: (y1 + y2) / 2,
  };
}

function DiagramView({ node, runtime, render }: LocalVisualProps) {
  const t = useLocalize();
  const [localSelected, setLocalSelected] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const reset = runtime.resetToken(node);
  useEffect(() => {
    setLocalSelected(null);
    setWriteError(null);
  }, [reset]);

  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const markerId = `local-diagram-arrow-${instanceId}`;
  const descriptionId = `local-diagram-description-${instanceId}`;
  const title = attrText(runtime, node.attrs, 'label', '') || t('Diagram', '图解');
  const directionRaw = (node.attrs?.direction ?? 'right').trim().toLowerCase();
  const direction = directionRaw === 'down' ? 'down' : 'right';
  const children = node.children?.filter((child) => child.type === 'component') ?? [];

  const notes: string[] = [];
  const nodes: DiagramModelNode[] = [];
  const seenIds = new Set<string>();
  for (const child of children) {
    if (child.name !== 'node') continue;
    const id = (child.attrs?.id ?? '').trim();
    if (!id) {
      notes.push(t('Ignored a node without an id.', '已忽略缺少 id 的节点。'));
      continue;
    }
    if (seenIds.has(id)) {
      notes.push(t(`Duplicate node id ${id}; ignored the later node.`, `节点 id 重复（${id}），已忽略后一个节点。`));
      continue;
    }
    seenIds.add(id);
    const toneRaw = attrText(runtime, child.attrs, 'tone', 'neutral').trim();
    const tone: DiagramTone =
      toneRaw === 'success' || toneRaw === 'warning' ? toneRaw : 'neutral';
    nodes.push({
      id,
      label: attrText(runtime, child.attrs, 'label', id) || id,
      tone,
      children: child.children ?? [],
    });
  }

  const edges: DiagramModelEdge[] = [];
  const edgeKeys = new Set<string>();
  for (const child of children) {
    if (child.name !== 'edge') continue;
    const from = (child.attrs?.from ?? '').trim();
    const to = (child.attrs?.to ?? '').trim();
    if (!from || !to || !seenIds.has(from) || !seenIds.has(to)) {
      notes.push(t(`Edge ${from || '?'} → ${to || '?'} references a missing endpoint; ignored.`, `连线 ${from || '?'} → ${to || '?'} 缺少端点，已忽略。`));
      continue;
    }
    const label = attrText(runtime, child.attrs, 'label', '');
    const key = `${from}\u0000${to}\u0000${label}`;
    if (edgeKeys.has(key)) {
      notes.push(t(`Duplicate edge: ${from} → ${to}${label ? ` (${label})` : ''}; ignored.`, `重复连线：${from} → ${to}${label ? `（${label}）` : ''}，已忽略。`));
      continue;
    }
    edgeKeys.add(key);
    edges.push({ key, from, to, label });
  }

  if (nodes.length === 0) {
    return (
      <VisualFrame className="local-visual-diagram" label={title}>
        <VisualMessage message="diagram requires at least one node." kind="alert" />
        <Notes notes={notes} />
      </VisualFrame>
    );
  }

  let runtimeSelected: string | null = null;
  try {
    const value = runtime.get(node);
    if (typeof value === 'string') runtimeSelected = value;
  } catch {
    runtimeSelected = null;
  }
  const ids = new Set(nodes.map((entry) => entry.id));
  const initialAttr = (node.attrs?.initial ?? '').trim();
  const fallbackId = initialAttr && ids.has(initialAttr) ? initialAttr : nodes[0].id;
  const selectedId =
    runtimeSelected && ids.has(runtimeSelected)
      ? runtimeSelected
      : localSelected && ids.has(localSelected)
        ? localSelected
        : fallbackId;
  const selectedNode = nodes.find((entry) => entry.id === selectedId) ?? nodes[0];

  const select = (id: string) => {
    setLocalSelected(id);
    setWriteError(null);
    try {
      const diagnostics = runtime.set(node, id);
      if (diagnostics.length > 0) {
        setWriteError(diagnostics.map((diagnostic) => t(formatLocalDiagnostic(diagnostic, 'en'), formatLocalDiagnostic(diagnostic, 'zh'))).join('; '));
      }
    } catch (cause) {
      setWriteError(errorMessage(cause));
    }
  };

  const layout = diagramLayout(nodes, edges, direction);
  const offsets = diagramEdgeOffsets(edges);
  const edgePaths: ReactNode[] = [];
  const edgeLabels: ReactNode[] = [];

  for (const edge of edges) {
    const from = layout.positions.get(edge.from);
    const to = layout.positions.get(edge.to);
    if (!from || !to) continue;
    const geometry = edgeGeometry(
      direction,
      from,
      to,
      offsets.get(edge.key) ?? 0,
      edge.from === edge.to,
    );
    edgePaths.push(
      <g key={`edge-${edge.key}`} className="local-visual-edge">
        <path
          d={geometry.d}
          fill="none"
          style={{ stroke: 'var(--ink-muted)' }}
          strokeWidth={1.6}
          markerEnd={`url(#${markerId})`}
        />
      </g>,
    );
    if (!edge.label) continue;
    const label = diagramLabelMetrics(edge.label);
    edgeLabels.push(
      <g key={`edge-label-${edge.key}`} className="local-visual-edge-label-group">
        <text
          className="local-visual-edge-label"
          x={geometry.labelX}
          y={geometry.labelY}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {label.lines.map((line, index) => (
            <tspan
              key={index}
              x={geometry.labelX}
              y={geometry.labelY + (index - (label.lines.length - 1) / 2) * DIAGRAM_EDGE_LABEL_LINE_HEIGHT}
            >
              {line}
            </tspan>
          ))}
        </text>
      </g>,
    );
  }

  return (
    <VisualFrame className="local-visual-diagram" label={title}>
      <div className="local-visual-svg-wrap">
        <svg
          className="local-visual-svg local-visual-diagram-svg"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="group"
          aria-label={`${title}, with ${nodes.length} nodes and ${edges.length} edges; press Tab to focus a node and Enter to select`}
          aria-describedby={descriptionId}
        >
          <defs>
            <marker
              id={markerId}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: 'var(--ink-muted)' }} />
            </marker>
          </defs>
          {edgePaths}
          {nodes.map((entry) => {
            const position = layout.positions.get(entry.id);
            if (!position) return null;
            const selected = entry.id === selectedId;
            const lines = wrapLabel(entry.label, 8, 2);
            return (
              <g
                key={`node-${entry.id}`}
                className={`local-visual-node local-visual-node-${entry.tone}${
                  selected ? ' is-selected' : ''
                }`}
                data-diagram-node=""
                transform={`translate(${position.x} ${position.y})`}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={entry.label}
                onClick={() => select(entry.id)}
                onKeyDown={(event) => {
                  if (activationKey(event)) {
                    event.preventDefault();
                    select(entry.id);
                    return;
                  }
                  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                    focusNeighbor(event, '[data-diagram-node]', 1);
                  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                    focusNeighbor(event, '[data-diagram-node]', -1);
                  }
                }}
              >
                <title>{entry.label}</title>
                <rect
                  className="local-visual-node-shape"
                  x={-DIAGRAM_NODE_WIDTH / 2}
                  y={-DIAGRAM_NODE_HEIGHT / 2}
                  width={DIAGRAM_NODE_WIDTH}
                  height={DIAGRAM_NODE_HEIGHT}
                  rx={10}
                />
                <text className="local-visual-node-text" textAnchor="middle">
                  {lines.map((line, lineIndex) => (
                    <tspan
                      key={lineIndex}
                      x={0}
                      y={(lineIndex - (lines.length - 1) / 2) * 16 + 4}
                    >
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}
          {edgeLabels}
        </svg>
      </div>
      <div className="local-visual-diagram-detail" aria-live="polite">
        {selectedNode ? (
          <>
            <strong>{selectedNode.label}</strong>
            {selectedNode.children.length > 0 ? (
              render(selectedNode.children)
            ) : (
              <span>{t('This node has no description.', '此节点没有说明。')}</span>
            )}
          </>
        ) : (
          <span>{t('Click a node, or focus it with Tab and press Enter, to view its description.', '点击节点，或用 Tab 聚焦后按 Enter 查看说明。')}</span>
        )}
      </div>
      <ul id={descriptionId} className="local-visual-sr-only" aria-label={t('Nodes and edges', '节点与连线')}>
        {nodes.map((entry) => (
          <li key={`description-node-${entry.id}`}>{entry.label}</li>
        ))}
        {edges.map((edge) => {
          const from = nodes.find((entry) => entry.id === edge.from);
          const to = nodes.find((entry) => entry.id === edge.to);
          return (
            <li key={`description-edge-${edge.key}`}>
              {from?.label ?? edge.from} → {to?.label ?? edge.to}
              {edge.label ? ` (${edge.label})` : ''}
            </li>
          );
        })}
      </ul>
      {writeError ? <VisualMessage message={writeError} kind="alert" /> : null}
      <Notes notes={notes} />
    </VisualFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

export function LocalVisual(props: LocalVisualProps): ReactNode {
  switch (props.node.name) {
    case 'table':
      return <TableView {...props} />;
    case 'chart':
      return <ChartView {...props} />;
    case 'plot':
      return <PlotView {...props} />;
    case 'timeline':
      return <TimelineView {...props} />;
    case 'diagram':
      return <DiagramView {...props} />;
    default:
      return null;
  }
}
