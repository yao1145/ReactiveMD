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
  LatexError,
  LatexView,
  TableSurface,
  compileLatex,
  createDiagramLayoutFallback,
  diagramEdgePath,
  diagramLayoutKey,
  formatLocalDiagnostic,
  layoutDiagram,
  samplePlot,
  type DiagramLayoutInput,
  type DiagramLayoutResult,
  type LatexEvaluationBudget,
  type LocalRenderMode,
  type LocalValue,
} from '../react/component-utils';
import type {
  LocalComponentContext,
  LocalComponentContent,
  LocalComponentTableProjection,
  LocalComponentTableCell,
} from '../react/component-api';
import {
  PrintValue,
  formatNumber,
  localColor,
  numberAttr,
  rawAttr,
  textAttr,
  useComponentView,
  useResetToken,
  useValidationField,
  useWriter,
} from '../react/component-utils';

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

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
const DIAGRAM_NODE_WIDTH = 120;
const DIAGRAM_NODE_HEIGHT = 46;
const DIAGRAM_EDGE_LABEL_FONT_SIZE = 12.5;
const DIAGRAM_EDGE_LABEL_PAD_X = 5;
const DIAGRAM_EDGE_LABEL_PAD_Y = 3;
const DIAGRAM_EDGE_LABEL_MAX_WIDTH = 100;
const DIAGRAM_EDGE_LABEL_MAX_LINES = 2;
const DIAGRAM_EDGE_LABEL_LINE_HEIGHT = 15;

type Localize = (en: string, zh: string) => string;

function formatAxisNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e6 || (magnitude > 0 && magnitude < 0.001)) return value.toExponential(2);
  return Number(value.toFixed(4)).toString();
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
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
/* Table helpers                                                       */
/* ------------------------------------------------------------------ */

function cellText(cell: LocalComponentTableCell | undefined, t: Localize): string {
  if (!cell) return '';
  return cell.error ? t('Cannot compute', '无法计算') : cell.text;
}

function columnIsNumeric(table: LocalComponentTableProjection, column: number): boolean {
  let seen = false;
  for (const row of table.rows) {
    const cell = row.cells[column];
    if (!cell || cell.kind === 'empty') continue;
    if (cell.numeric === null) return false;
    seen = true;
  }
  return seen;
}

function selectionKeyIndex(key: string | undefined, header: string[]): number {
  const name = (key ?? '').trim();
  if (!name) return -1;
  return header.findIndex((entry) => entry.trim() === name);
}

function rowSelectionKey(
  keyIndex: number,
  row: { cells: readonly LocalComponentTableCell[] },
  t: Localize,
): string {
  if (keyIndex < 0) return '';
  return cellText(row.cells[keyIndex], t).trim();
}

/* ------------------------------------------------------------------ */
/* Shared visual pieces                                                */
/* ------------------------------------------------------------------ */

export function VisualFrame({
  className,
  label,
  children,
}: {
  className: string;
  label: ReactNode;
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
  mode,
  t,
}: {
  items: LegendItem[];
  hidden: Set<number>;
  onToggle: (index: number) => void;
  label: string;
  mode: LocalRenderMode;
  t: Localize;
}) {
  const interactive = mode !== 'static';
  return (
    <div
      className={`local-visual-legend${interactive ? '' : ' local-static-legend'}`}
      role="group"
      aria-label={interactive ? label : t('Legend', '图例')}
    >
      {items.map((item, index) => {
        const off = hidden.has(index);
        if (!interactive) {
          return (
            <span
              key={`${item.name}-${index}`}
              className="local-visual-legend-item local-static-legend-item"
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
            </span>
          );
        }
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

/**
 * Source-location and validation wrapper shared by every visual. It only adds
 * markup when a host enables navigation or an advisory rule targets the
 * visual, keeping ordinary export/SSR output unchanged.
 */
function VisualShell({
  context,
  children,
}: {
  context: LocalComponentContext;
  children: ReactNode;
}) {
  const view = useComponentView(context);
  const validation = useValidationField(context);
  const attrs = context.source.attributes();
  const content = validation.invalid ? (
    <div
      role="group"
      aria-label={textAttr(context, 'label', textAttr(context, 'title', view.t('Selection', '选择')))}
      aria-invalid={validation.invalid || undefined}
      aria-describedby={validation.describedBy}
    >
      {children}
    </div>
  ) : children;
  return Object.keys(attrs).length > 0 ? <div {...attrs}>{content}</div> : <>{content}</>;
}

/* ------------------------------------------------------------------ */
/* Interactive table                                                   */
/* ------------------------------------------------------------------ */

interface SortState {
  column: number;
  direction: 'asc' | 'desc';
}

export function TableView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const { content, mode, t } = view;
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(1);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const { write, error } = useWriter(context);
  useResetToken(context, () => {
    setQuery('');
    setSort(null);
    setPage(1);
    setSelectionError(null);
  });

  const label = textAttr(context, 'label', t('Table', '表格'));
  const searchable = context.content.attrs.searchable === undefined
    ? true
    : context.props.searchable === true;
  const sortable = context.content.attrs.sortable === undefined
    ? true
    : context.props.sortable === true;
  const pageSize = Math.max(1, Math.floor(numberAttr(context, 'page-size', 10)));
  const table = context.children.table();

  if (!table || table.header.length === 0) {
    return (
      <VisualShell context={context}>
        <VisualFrame className="local-visual-table-block" label={label}>
          <VisualMessage
            message={t(
              'Table requires a non-empty Markdown table.',
              '表格需要一个非空的 Markdown 表格。',
            )}
            kind="alert"
          />
        </VisualFrame>
      </VisualShell>
    );
  }

  const headerText = table.header.map((cell) => cellText(cell, t).trim());
  const keyIndex = selectionKeyIndex(rawAttr(content, 'key'), headerText);
  const selectable = keyIndex >= 0;
  const selectedKey = (() => {
    if (!selectable) return '';
    try {
      const value = context.runtime.get(content);
      return typeof value === 'string' ? value : '';
    } catch {
      return '';
    }
  })();

  const writeSelection = (value: string) => {
    setSelectionError(null);
    const ok = write(value);
    if (!ok) setSelectionError(error ?? t('Cannot write', '无法写入'));
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
    if (!sort || sort.column !== column) return null;
    return <span className="local-visual-sort-marker" aria-hidden="true">{sort.direction === 'asc' ? '▲' : '▼'}</span>;
  };

  const tableBody = mode === 'static'
    ? (
      <TableSurface className="local-static-table" scrollClassName="local-static-table-scroll">
        <caption className="local-visual-sr-only">{label}</caption>
        <thead>
          <tr>
            {table.header.map((cell, index) => (
              <th
                key={`head-${index}`}
                scope="col"
                className={numericColumns[index] ? 'is-numeric' : undefined}
              >
                {cellText(cell, t)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => {
            const rowKey = selectable ? rowSelectionKey(keyIndex, row, t) : '';
            const selected = selectable && rowKey !== '' && rowKey === selectedKey;
            return (
              <tr key={`row-${row.index}`} className={selected ? 'is-selected local-static-selected' : undefined}>
                {table.header.map((_cell, column) => {
                  const cell = row.cells[column];
                  return (
                    <td
                      key={`cell-${row.index}-${column}`}
                      className={numericColumns[column] ? 'is-numeric' : undefined}
                    >
                      {selected && column === 0 ? (
                        <span className="local-visual-sr-only">{t('Selected row', '已选择行')}</span>
                      ) : null}
                      {cell?.error ? (
                        <span className="local-visual-cell-error" title={cell.error}>
                          {t('Cannot compute', '无法计算')}
                        </span>
                      ) : (
                        cell?.render()
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </TableSurface>
    )
    : (
      <TableSurface>
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
                      className={`local-visual-sort-button${sort && sort.column === index ? ' is-sorted' : ''}`}
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
              <tr key={`row-${row.index}`} className={selected ? 'is-selected' : undefined}>
                {selectable ? (
                  <td className="local-visual-select-cell">
                    {rowKey ? (
                      <button
                        type="button"
                        className={`local-visual-select-button${selected ? ' is-selected' : ''}`}
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
                        cell?.render()
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </TableSurface>
    );

  return (
    <VisualShell context={context}>
      {mode === 'static' ? (
        <VisualFrame className="local-visual-table-block local-static-table-block" label={label}>
          {tableBody}
          {table.rows.length === 0 ? (
            <VisualMessage message={t('No rows to display', '没有可显示的行')} />
          ) : null}
        </VisualFrame>
      ) : (
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
          {tableBody}
          {selectionError ? <VisualMessage message={selectionError} kind="alert" /> : null}
          {ordered.length === 0 ? (
            <VisualMessage message={t('No matching results', '没有匹配结果')} />
          ) : null}
          {totalPages > 1 ? (
            <nav className="local-visual-pagination" aria-label={t('Table pagination', '表格分页')}>
              <button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                {t('Previous', '上一页')}
              </button>
              <span>
                {t(
                  `Page ${currentPage} of ${totalPages} · ${ordered.length} rows`,
                  `第 ${currentPage} / ${totalPages} 页 · 共 ${ordered.length} 行`,
                )}
              </span>
              <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>
                {t('Next', '下一页')}
              </button>
            </nav>
          ) : null}
        </VisualFrame>
      )}
    </VisualShell>
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
  cells: readonly LocalComponentTableCell[];
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

function donutPath(cx: number, cy: number, outer: number, inner: number, start: number, end: number): string {
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

export function ChartView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const { content, mode, t } = view;
  const staticMode = mode === 'static';
  const [hiddenSeries, setHiddenSeries] = useState<Set<number>>(new Set());
  const [hiddenSlices, setHiddenSlices] = useState<Set<number>>(new Set());
  const [active, setActive] = useState<ChartPoint | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const { write, error } = useWriter(context);
  useResetToken(context, () => {
    setHiddenSeries(new Set());
    setHiddenSlices(new Set());
    setActive(null);
    setSelectionError(null);
  });

  const readoutId = useId();
  const title =
    textAttr(context, 'title', '') ||
    textAttr(context, 'label', '') ||
    t('Chart', '图表');
  const kindRaw = String(context.props.kind ?? 'bar').trim().toLowerCase();
  const kind = (CHART_KINDS as string[]).includes(kindRaw) ? (kindRaw as ChartKind) : null;
  const xLabel = textAttr(context, 'x-label', '');
  const yLabel = textAttr(context, 'y-label', '');
  const table = context.children.table();

  if (!table || table.header.length === 0) {
    return (
      <VisualShell context={context}>
        <VisualFrame className="local-visual-chart" label={title}>
          <VisualMessage
            message={t('chart body requires a non-empty Markdown table.', 'chart 正文需要一个非空的 Markdown 表格。')}
            kind="alert"
          />
        </VisualFrame>
      </VisualShell>
    );
  }

  const header = table.headerText.map((text) => text.trim());
  const keyIndex = selectionKeyIndex(rawAttr(content, 'key'), header);
  const selectionEnabled = keyIndex >= 0;
  const selectedRowKey = (() => {
    if (!selectionEnabled) return '';
    try {
      const value = context.runtime.get(content);
      return typeof value === 'string' ? value : '';
    } catch {
      return '';
    }
  })();
  const writeSelection = (value: string) => {
    setSelectionError(null);
    const ok = write(value);
    if (!ok) setSelectionError(error ?? t('Cannot write', '无法写入'));
  };
  const sourceRows = table.rows.map((row) => ({
    index: row.index,
    cells: row.cells,
    texts: header.map((_name, column) => cellText(row.cells[column], t)),
    keyValue: rowSelectionKey(keyIndex, row, t),
  }));

  if (!kind) {
    return (
      <VisualShell context={context}>
        <VisualFrame className="local-visual-chart" label={title}>
          <VisualMessage message={t(`Unknown chart type "${kindRaw}".`, `未知图表类型“${kindRaw}”。`)} kind="alert" />
        </VisualFrame>
      </VisualShell>
    );
  }

  const notes: string[] = [];
  const errors: string[] = [];
  const xName = (rawAttr(content, 'x') ?? '').trim();
  const xIndex = xName ? header.indexOf(xName) : 0;
  if (xIndex < 0 || xIndex >= header.length) {
    errors.push(t(`x column "${xName}" does not exist.`, `x 列“${xName}”不存在。`));
  }
  const yNames = (rawAttr(content, 'y') ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  let yIndexes: number[] = [];
  if (kind === 'donut') {
    if (yNames.length > 1) {
      errors.push(t('donut can only use one numeric column; specify a single column in y.', 'donut 只能使用一个数值列，请在 y 中指定唯一列。'));
    } else if (yNames.length === 1) {
      const index = header.indexOf(yNames[0]);
      if (index < 0) errors.push(t(`y column "${yNames[0]}" does not exist.`, `y 列“${yNames[0]}”不存在。`));
      else yIndexes = [index];
    } else if (header.length === 2) {
      yIndexes = [1];
    } else {
      errors.push(t('A donut chart with more than two columns must use y to specify the single numeric column.', 'donut 多于两列时必须用 y 指定唯一数值列。'));
    }
  } else if (yNames.length > 0) {
    for (const name of yNames) {
      const index = header.indexOf(name);
      if (index < 0) errors.push(t(`y column "${name}" does not exist.`, `y 列“${name}”不存在。`));
      else if (!yIndexes.includes(index)) yIndexes.push(index);
    }
  } else {
    yIndexes = header.map((_name, index) => index).filter((index) => index !== xIndex);
  }

  if (errors.length === 0 && yIndexes.length === 0) {
    errors.push(t('Chart requires at least one numeric series.', '图表至少需要一个数值系列。'));
  }

  if (errors.length > 0) {
    return (
      <VisualShell context={context}>
        <VisualFrame className={`local-visual-chart local-visual-chart-${kind}`} label={title}>
          {errors.map((message, index) => (
            <VisualMessage key={`${message}-${index}`} message={message} kind="alert" />
          ))}
        </VisualFrame>
      </VisualShell>
    );
  }

  const seriesNames = yIndexes.map((index) => header[index] || t(`Series ${index + 1}`, `系列 ${index + 1}`));
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
    notes.push(t(
      `${invalidValues} values are empty or cannot be computed; gaps are kept in the chart.`,
      `${invalidValues} 个数值为空或无法计算，图表中保留空缺。`,
    ));
  }
  for (const column of yIndexes) {
    if (!columnIsNumeric(table, column)) {
      notes.push(t(
        `Column "${header[column]}" is not purely numeric; non-numeric values are treated as gaps.`,
        `列“${header[column]}”不是纯数值列，非数值按空缺处理。`,
      ));
    }
  }
  if (kind === 'donut' && negativeValues > 0) {
    notes.push(t(
      `Donut values must be non-negative; ignored ${negativeValues} negative values.`,
      `环形图数值必须非负，已忽略 ${negativeValues} 个负值。`,
    ));
  }
  if (kind === 'scatter' && !columnIsNumeric(table, xIndex)) {
    notes.push(t(
      `scatter horizontal axis column "${header[xIndex]}" requires numeric values.`,
      `scatter 的横轴列“${header[xIndex]}”需要数值。`,
    ));
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
      (sum, value, index) => (!staticMode && hiddenSlices.has(index) ? sum : sum + value),
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
        <VisualShell context={context}>
          <VisualFrame className="local-visual-chart local-visual-chart-donut" label={title}>
            <VisualMessage message={t('No share to display', '暂无占比')} />
            <Notes notes={notes} />
            <ChartLegend
              items={sliceLegend}
              hidden={hiddenSlices}
              onToggle={toggleSlice}
              label={t('Legend', '图例')}
              mode={mode}
              t={t}
            />
          </VisualFrame>
        </VisualShell>
      );
    }

    const cx = 170;
    const cy = 120;
    const outer = 92;
    const inner = 62;
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
      if (!staticMode && hiddenSlices.has(index)) return;
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
      ? t(`${active.label}: ${formatNumber(active.value)}`, `${active.label}：${formatNumber(active.value)}`)
      : t('Focus a slice or legend to view values', '聚焦扇区或图例查看数值');

    return (
      <VisualShell context={context}>
        <VisualFrame
          className={`local-visual-chart local-visual-chart-donut${staticMode ? ' local-static-chart' : ''}`}
          label={title}
        >
          {staticMode ? null : (
            <div className="local-visual-readout" id={readoutId} aria-live="polite">
              {readout}
            </div>
          )}
          <div className="local-visual-svg-wrap">
            <svg
              className="local-visual-svg"
              viewBox="0 0 340 240"
              role="group"
              aria-label={t(`${title}, donut chart, ${rows.length} items`, `${title}，环形图，共 ${rows.length} 项`)}
              aria-describedby={staticMode ? undefined : readoutId}
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
                const markProps = staticMode
                  ? {}
                  : {
                      'data-chart-mark': '',
                      ...(selectable ? { 'data-chart-selectable': '' } : {}),
                      tabIndex: 0,
                      role: selectable ? ('button' as const) : ('img' as const),
                      ...(selectable ? { 'aria-pressed': selected } : {}),
                      'aria-label': t(`${slice.label}: ${formatNumber(slice.value)}`, `${slice.label}：${formatNumber(slice.value)}`),
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
                      <title>{t(`${slice.label}: ${formatNumber(slice.value)}`, `${slice.label}：${formatNumber(slice.value)}`)}</title>
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
                    <title>{t(`${slice.label}: ${formatNumber(slice.value)}`, `${slice.label}：${formatNumber(slice.value)}`)}</title>
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
            mode={mode}
            t={t}
          />
          {selectionError ? <VisualMessage message={selectionError} kind="alert" /> : null}
          <Notes notes={notes} />
        </VisualFrame>
      </VisualShell>
    );
  }

  const visiblePositions = seriesNames
    .map((_name, position) => position)
    .filter((position) => staticMode || !hiddenSeries.has(position));

  if (visiblePositions.length === 0) {
    return (
      <VisualShell context={context}>
        <VisualFrame className={`local-visual-chart local-visual-chart-${kind}`} label={title}>
          <VisualMessage message={t('All series are hidden in the legend', '所有系列已在图例中关闭')} />
          <ChartLegend items={legendItems} hidden={hiddenSeries} onToggle={toggleSeries} label={t('Legend, toggle series', '图例，可开关系列')} mode={mode} t={t} />
        </VisualFrame>
      </VisualShell>
    );
  }

  const numericColumnX = columnIsNumeric(table, xIndex);
  const useNumericX = kind === 'scatter' ? true : kind === 'line' || kind === 'area' ? numericColumnX : false;
  const plottableRows = useNumericX ? rows.filter((row) => row.xValue !== null) : rows;
  if (useNumericX && plottableRows.length < rows.length) {
    notes.push(t(
      `${rows.length - plottableRows.length} rows have an empty or non-numeric horizontal axis and are not plotted.`,
      `${rows.length - plottableRows.length} 行横轴为空或不是数值，未参与绘制。`,
    ));
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
      <VisualShell context={context}>
        <VisualFrame className={`local-visual-chart local-visual-chart-${kind}`} label={title}>
          <VisualMessage message={t('No data rows to plot', '没有可绘制的数据行')} />
          <Notes notes={notes} />
          <ChartLegend items={legendItems} hidden={hiddenSeries} onToggle={toggleSeries} label={t('Legend, toggle series', '图例，可开关系列')} mode={mode} t={t} />
        </VisualFrame>
      </VisualShell>
    );
  }
  if (allValues.length === 0) {
    return (
      <VisualShell context={context}>
        <VisualFrame className={`local-visual-chart local-visual-chart-${kind}`} label={title}>
          <VisualMessage message={t('No values to read', '没有可读取的数值')} />
          <Notes notes={notes} />
          <ChartLegend items={legendItems} hidden={hiddenSeries} onToggle={toggleSeries} label={t('Legend, toggle series', '图例，可开关系列')} mode={mode} t={t} />
        </VisualFrame>
      </VisualShell>
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
  const yOf = (value: number) => plotTop + ((yDomain.max - value) / (yDomain.max - yDomain.min)) * plotHeight;
  const zeroY = yOf(Math.max(yDomain.min, Math.min(yDomain.max, 0)));

  const xDomain = useNumericX && plottableRows.length > 0
    ? chartDomain(
        plottableRows.map((row) => row.xValue).filter((value): value is number => value !== null),
        false,
      )
    : null;
  const bandWidth = plotWidth / Math.max(1, rows.length);
  const categoryX = (index: number) => plotLeft + bandWidth * (index + 0.5);
  const numericXOf = (value: number) => plotLeft + ((value - xDomain!.min) / (xDomain!.max - xDomain!.min)) * plotWidth;
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

  const activeGuide = staticMode || !active ? null : !xDomain ? null : (
    <line
      className="local-visual-guide"
      x1={Math.max(plotLeft, Math.min(plotRight, active.x))}
      x2={Math.max(plotLeft, Math.min(plotRight, active.x))}
      y1={plotTop}
      y2={plotBottom}
    />
  );

  const markProps = (point: ChartPoint) =>
    staticMode
      ? {}
      : {
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
        };

  const makePoint = (position: number, row: ChartRow, value: number, x: number, y: number): ChartPoint => {
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
        const x = plotLeft + bandWidth * rowIndex + (bandWidth - groupWidth) / 2 + visibleIndex * barWidth;
        const height = Math.max(1, Math.abs(yOf(value) - zeroY));
        const y = value >= 0 ? zeroY - height : zeroY;
        const width = Math.max(1.5, barWidth - 1);
        const radius = Math.min(4, width / 2, height / 2);
        const point = makePoint(position, row, value, x + barWidth / 2, y + height / 2);
        barMarks.push(
          <rect
            key={`bar-${position}-${row.index}`}
            className={`local-visual-bar${point.selected ? ' is-selected' : ''}`}
            x={x}
            y={y}
            width={width}
            height={height}
            rx={radius}
            style={{ fill: SERIES_COLORS[position % SERIES_COLORS.length] }}
            {...markProps(point)}
          >
            <title>{t(`${point.series}, ${point.label}: ${formatNumber(point.value)}`, `${point.series}，${point.label}：${formatNumber(point.value)}`)}</title>
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
          const d = segment.map((entry, index) => `${index === 0 ? 'M' : 'L'} ${entry.x} ${entry.y}`).join(' ');
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
            const area = `M ${first.x} ${baseline} ${segment.map((entry) => `L ${entry.x} ${entry.y}`).join(' ')} L ${last.x} ${baseline} Z`;
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
                <title>{t(`${point.series}, ${point.label}: ${formatNumber(point.value)}`, `${point.series}，${point.label}：${formatNumber(point.value)}`)}</title>
              </circle>
              <circle
                className={`local-visual-point${point.selected ? ' is-selected' : ''}`}
                cx={entry.x}
                cy={entry.y}
                r={4.5}
                style={{ fill: SERIES_COLORS[position % SERIES_COLORS.length], stroke: 'var(--surface)' }}
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
              <title>{t(`${point.series}, ${point.label}: ${formatNumber(point.value)}`, `${point.series}，${point.label}：${formatNumber(point.value)}`)}</title>
            </circle>
            <circle
              className={`local-visual-point${point.selected ? ' is-selected' : ''}`}
              cx={x}
              cy={y}
              r={6}
              style={{ fill: SERIES_COLORS[position % SERIES_COLORS.length], stroke: 'var(--surface)' }}
              strokeWidth={1.5}
              pointerEvents="none"
            />
          </g>,
        );
      });
    });
  }

  const readout = active
    ? t(`${active.series} · ${active.label}: ${formatNumber(active.value)}`, `${active.series} · ${active.label}：${formatNumber(active.value)}`)
    : t('Focus or point at a mark; use arrow keys to change the readout', '聚焦或指向图形，用方向键切换读数');
  const ariaLabel = t(
    `${title}, ${kind} chart, ${rows.length} items, ${visiblePositions.length} series`,
    `${title}，${kind} 图，共 ${rows.length} 项，${visiblePositions.length} 个系列`,
  );

  return (
    <VisualShell context={context}>
      <VisualFrame
        className={`local-visual-chart local-visual-chart-${kind}${staticMode ? ' local-static-chart' : ''}`}
        label={title}
      >
        {staticMode ? null : (
          <div className="local-visual-readout" id={readoutId} aria-live="polite">
            {readout}
          </div>
        )}
        <div className="local-visual-svg-wrap">
          <svg
            className="local-visual-svg"
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            role="group"
            aria-label={ariaLabel}
            aria-describedby={staticMode ? undefined : readoutId}
          >
            {yTicks.map((tick) => (
              <g key={`y-${tick}`}>
                <line className="local-visual-grid-line" x1={plotLeft} x2={plotRight} y1={yOf(tick)} y2={yOf(tick)} />
                <text className="local-visual-axis-label" x={plotLeft - 6} y={yOf(tick)} textAnchor="end" dominantBaseline="middle">
                  {formatAxisNumber(tick)}
                </text>
              </g>
            ))}
            {yDomain.min < 0 && yDomain.max > 0 ? (
              <line className="local-visual-zero-line" x1={plotLeft} x2={plotRight} y1={zeroY} y2={zeroY} />
            ) : null}
            <line className="local-visual-axis-line" x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} />
            {xTicks.map((tick) => {
              const x = xPositionOfTick(tick);
              const labelText = xDomain ? formatAxisNumber(tick) : truncate(rows[tick]?.label ?? '', 8);
              return (
                <g key={`x-${tick}`}>
                  <line className="local-visual-tick" x1={x} x2={x} y1={plotBottom} y2={plotBottom + 5} />
                  <text className="local-visual-axis-label" x={x} y={plotBottom + 19} textAnchor="middle">
                    {labelText}
                    {!xDomain && rows[tick] ? <title>{rows[tick].label}</title> : null}
                  </text>
                </g>
              );
            })}
            {xLabel ? (
              <text className="local-visual-axis-title" x={(plotLeft + plotRight) / 2} y={CHART_HEIGHT - 2} textAnchor="middle">
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
        <ChartLegend items={legendItems} hidden={hiddenSeries} onToggle={toggleSeries} label={t('Legend, toggle series', '图例，可开关系列')} mode={mode} t={t} />
        {selectionError ? <VisualMessage message={selectionError} kind="alert" /> : null}
        <Notes notes={notes} />
      </VisualFrame>
    </VisualShell>
  );
}

/* ------------------------------------------------------------------ */
/* Function plot                                                       */
/* ------------------------------------------------------------------ */

interface PlotMath {
  id: string;
  source: string;
}

interface PlotCurve {
  source: string;
  expression: ReturnType<typeof compileLatex> | null;
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
}

const PLOT_SAMPLE_CACHE_LIMIT = 64;
const documentPlotBudgets = new WeakMap<object, PlotBudgetState>();
const documentPlotSamples = new WeakMap<object, Map<string, PlotSampleResult>>();

function plotBudgetState(runtime: object, revision: number): PlotBudgetState {
  let budget = documentPlotBudgets.get(runtime);
  if (!budget || budget.revision !== revision) {
    budget = {
      revision,
      requestedPoints: new Map(),
      evaluation: { steps: 0, limit: MAX_LOCAL_PLOT_STEPS },
    };
    documentPlotBudgets.set(runtime, budget);
  }
  return budget;
}

function plotSampleCache(runtime: object): Map<string, PlotSampleResult> {
  let samples = documentPlotSamples.get(runtime);
  if (!samples) {
    samples = new Map();
    documentPlotSamples.set(runtime, samples);
  }
  return samples;
}

function cachePlotSample(
  samples: Map<string, PlotSampleResult>,
  cacheKey: string,
  result: PlotSampleResult,
): PlotSampleResult {
  if (samples.size >= PLOT_SAMPLE_CACHE_LIMIT) {
    const oldest = samples.keys().next().value;
    if (oldest !== undefined) samples.delete(oldest);
  }
  samples.set(cacheKey, result);
  return result;
}

function plotEnvironmentKey(
  mathItems: readonly PlotMath[],
  environment: Record<string, LocalValue>,
  revision: number,
): string {
  return mathItems
    .map((child) => {
      const match = /^y\s*=\s*([\s\S]+)$/.exec(child.source.trim());
      if (!match) return `\u0003${revision}`;
      try {
        const expression = compileLatex(match[1].trim());
        return JSON.stringify(expression.dependencies.map((name) => environment[name] ?? null));
      } catch {
        return `\u0003${revision}`;
      }
    })
    .join('\u0001');
}

function sampleDocumentPlot(
  nodeId: string,
  cacheKey: string,
  mathItems: readonly PlotMath[],
  environment: Record<string, LocalValue>,
  min: number,
  max: number,
  samples: number,
  runtimeKey: object,
  revision: number,
  t: Localize,
): PlotSampleResult {
  const sampleCache = plotSampleCache(runtimeKey);
  const cached = sampleCache.get(cacheKey);
  if (cached) return cached;

  const budget = plotBudgetState(runtimeKey, revision);

  const fail = (message: string): PlotSampleResult => {
    const result: PlotSampleResult = { ok: false, message };
    return cachePlotSample(sampleCache, cacheKey, result);
  };

  if (mathItems.length > MAX_LOCAL_PLOT_CURVES) {
    return fail(t(
      `plot supports at most ${MAX_LOCAL_PLOT_CURVES} curves, but has ${mathItems.length}.`,
      `plot 最多支持 ${MAX_LOCAL_PLOT_CURVES} 条曲线，当前为 ${mathItems.length} 条。`,
    ));
  }

  const requested = mathItems.length * samples;
  budget.requestedPoints.set(nodeId, requested);
  let total = 0;
  for (const value of budget.requestedPoints.values()) total += value;
  if (total > MAX_LOCAL_PLOT_POINTS) {
    return fail(t(
      `The document's plot sample count exceeds the limit: ${total} requested, at most ${MAX_LOCAL_PLOT_POINTS} allowed. Reduce curves or samples.`,
      `整篇文档的绘图采样点超过上限：已请求 ${total} 个，最多 ${MAX_LOCAL_PLOT_POINTS} 个。请减少曲线或采样数。`,
    ));
  }

  const notes: string[] = [];
  const budgetFailure: { message: string | null } = { message: null };
  const curves: PlotCurve[] = mathItems.map((mathItem, index) => {
    const source = mathItem.source.trim();
    const match = /^y\s*=\s*([\s\S]+)$/.exec(source);
    if (!match) {
      notes.push(t(
        `Curve ${index + 1}: cannot compute (each formula block must be written as y = expression).`,
        `曲线 ${index + 1}：无法计算（每块公式需写成 y = 表达式）。`,
      ));
      return { source, expression: null, points: [], endpoint: null, error: 'formula' };
    }
    try {
      const expression = compileLatex(match[1].trim());
      const result = samplePlot(expression, environment, min, max, samples, budget.evaluation);
      return { source, expression, points: result.points, endpoint: result.endpoint, error: null };
    } catch (cause) {
      if (cause instanceof LatexError && cause.code === 'latex-budget') {
        budgetFailure.message = cause.message;
        return { source, expression: null, points: [], endpoint: null, error: cause.message };
      }
      notes.push(t(
        `Curve ${index + 1}: cannot compute (${errorMessage(cause)}).`,
        `曲线 ${index + 1}：无法计算（${errorMessage(cause)}）。`,
      ));
      return { source, expression: null, points: [], endpoint: null, error: errorMessage(cause) };
    }
  });
  if (budgetFailure.message !== null) {
    return fail(t(
      `Plot computation exceeded the shared execution budget: ${budgetFailure.message}`,
      `绘图计算超过共享执行预算：${budgetFailure.message}`,
    ));
  }

  const result: PlotSampleResult = { ok: true, curves, notes };
  return cachePlotSample(sampleCache, cacheKey, result);
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
  const shouldBreak = (previous: { x: number; y: number }, next: { x: number; y: number }): boolean => {
    const delta = Math.abs(next.y - previous.y);
    const asymptote = previous.y * next.y < 0 && Math.min(Math.abs(previous.y), Math.abs(next.y)) > Math.max(1, medianAbs * 8);
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

export function PlotView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const { content, mode, locale, t } = view;
  const staticMode = mode === 'static';
  const [activeX, setActiveX] = useState<number | null>(null);
  useResetToken(context, () => setActiveX(null));

  const readoutId = useId();
  const label = textAttr(context, 'label', '') || t('Function plot', '函数图');
  const xLabel = textAttr(context, 'x-label', 'x');
  const yLabel = textAttr(context, 'y-label', 'y');
  const min = context.content.attrs.min === undefined ? -10 : numberAttr(context, 'min', -10);
  const max = context.content.attrs.max === undefined ? 10 : numberAttr(context, 'max', 10);
  const samples = Math.min(2000, Math.max(2, Math.floor(numberAttr(context, 'samples', 200))));
  const mathItems: PlotMath[] = context.children.math().map((item) => ({
    id: item.id,
    source: item.text,
  }));
  let environment: Record<string, LocalValue> = {};
  let revision = 0;
  try {
    const snapshot = context.runtime.snapshot();
    environment = { ...snapshot.state } as Record<string, LocalValue>;
    revision = snapshot.revision;
  } catch {
    environment = {};
  }
  const mathKey = mathItems.map((child) => `${child.id}\u0000${child.source}`).join('\u0001');
  const cacheKey = `${content.id}\u0000${min}\u0000${max}\u0000${samples}\u0000${locale}\u0000${mathKey}`;
  const environmentKey = plotEnvironmentKey(mathItems, environment, revision);
  const sampleKey = `${cacheKey}\u0002${environmentKey}`;
  const runtimeKey = context.runtime.identity;

  const sampled = useMemo<PlotSampleResult>(() => {
    if (mathItems.length === 0 || min === null || max === null || !(max > min)) {
      return { ok: true, curves: [], notes: [] };
    }
    return sampleDocumentPlot(
      content.id,
      sampleKey,
      mathItems,
      environment,
      min,
      max,
      samples,
      runtimeKey,
      revision,
      t,
    );
  }, [cacheKey, environmentKey, content.id, runtimeKey, t]);

  if (mathItems.length === 0) {
    return (
      <VisualShell context={context}>
        <VisualFrame className="local-visual-plot" label={label}>
          <VisualMessage message={t('plot body requires one or more $$ formula blocks.', 'plot 正文需要一个或多个 $$ 公式块。')} kind="alert" />
        </VisualFrame>
      </VisualShell>
    );
  }
  if (min === null || max === null || !(max > min)) {
    return (
      <VisualShell context={context}>
        <VisualFrame className="local-visual-plot" label={label}>
          <VisualMessage message={t('plot min must be less than max.', 'plot 的 min 必须小于 max。')} kind="alert" />
        </VisualFrame>
      </VisualShell>
    );
  }
  if (!sampled.ok) {
    return (
      <VisualShell context={context}>
        <VisualFrame className="local-visual-plot" label={label}>
          <VisualMessage message={sampled.message} kind="alert" />
        </VisualFrame>
      </VisualShell>
    );
  }

  const { curves, notes } = sampled;
  const finitePoints = curves.flatMap((curve) =>
    curve.points.filter((point): point is { x: number; y: number } => point.y !== null && Number.isFinite(point.y)),
  );

  const legend = (
    <div className="local-visual-plot-legend" role="list" aria-label={t('Curve legend', '曲线图例')}>
      {curves.map((curve, index) => (
        <div key={`curve-legend-${index}`} className="local-visual-plot-legend-item" role="listitem">
          <span className="local-visual-swatch" style={{ backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] }} aria-hidden="true" />
          <span className="local-visual-plot-legend-text">
            <span className="local-visual-plot-formula"><LatexView source={curve.source} /></span>
          </span>
        </div>
      ))}
    </div>
  );

  if (finitePoints.length === 0) {
    return (
      <VisualShell context={context}>
        <VisualFrame className="local-visual-plot" label={label}>
          <VisualMessage message={t('No plottable values in the current range', '当前范围内没有可绘制的值')} />
          <Notes notes={notes} />
          {legend}
        </VisualFrame>
      </VisualShell>
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
  const yOf = (y: number) => plotTop + ((yDomain.max - y) / (yDomain.max - yDomain.min)) * plotHeight;

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
  const curveSegments = curves.map((curve) => plotSegments(curve.points, ySpan, medianAbs, medianDelta));

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

  const readX = staticMode || activeX === null ? null : clampX(activeX);
  const readout = readX === null
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
            style={{ fill: SERIES_COLORS[index % SERIES_COLORS.length], stroke: 'var(--surface)' }}
            strokeWidth={1.5}
          />
        );
      });

  return (
    <VisualShell context={context}>
      <VisualFrame className="local-visual-plot" label={label}>
        {staticMode ? null : (
          <div className="local-visual-readout" id={readoutId} aria-live="polite">
            {readout}
          </div>
        )}
        <div className="local-visual-svg-wrap">
          <svg
            className="local-visual-svg"
            viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
            role="group"
            aria-label={t(
              `${label}, range ${formatNumber(min)} to ${formatNumber(max)}, ${samples} samples`,
              `${label}，区间 ${formatNumber(min)} 到 ${formatNumber(max)}，${samples} 个采样点`,
            )}
            aria-describedby={staticMode ? undefined : readoutId}
            tabIndex={staticMode ? undefined : 0}
            onPointerMove={staticMode ? undefined : handlePointerMove}
            onPointerLeave={staticMode ? undefined : () => setActiveX(null)}
            onFocus={staticMode ? undefined : () => setActiveX((current) => current ?? (min + max) / 2)}
            onBlur={staticMode ? undefined : () => setActiveX(null)}
            onKeyDown={staticMode ? undefined : handleKeyDown}
          >
            {yTicks.map((tick) => (
              <g key={`y-${tick}`}>
                <line className="local-visual-grid-line" x1={plotLeft} x2={plotRight} y1={yOf(tick)} y2={yOf(tick)} />
                <text className="local-visual-axis-label" x={plotLeft - 6} y={yOf(tick)} textAnchor="end" dominantBaseline="middle">
                  {formatAxisNumber(tick)}
                </text>
              </g>
            ))}
            {yDomain.min < 0 && yDomain.max > 0 ? (
              <line className="local-visual-zero-line" x1={plotLeft} x2={plotRight} y1={yOf(0)} y2={yOf(0)} />
            ) : null}
            <line className="local-visual-axis-line" x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} />
            {xTicks.map((tick) => (
              <g key={`x-${tick}`}>
                <line className="local-visual-tick" x1={xOf(tick)} x2={xOf(tick)} y1={plotBottom} y2={plotBottom + 5} />
                <text className="local-visual-axis-label" x={xOf(tick)} y={plotBottom + 19} textAnchor="middle">
                  {formatAxisNumber(tick)}
                </text>
              </g>
            ))}
            {xLabel ? (
              <text className="local-visual-axis-title" x={(plotLeft + plotRight) / 2} y={PLOT_HEIGHT - 2} textAnchor="middle">
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
                const d = segment.map((point, index) => `${index === 0 ? 'M' : 'L'} ${xOf(point.x)} ${yOf(point.y)}`).join(' ');
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
              <line className="local-visual-guide" x1={xOf(readX)} x2={xOf(readX)} y1={plotTop} y2={plotBottom} />
            ) : null}
            {activeMarks}
          </svg>
        </div>
        <Notes notes={notes} />
        {legend}
      </VisualFrame>
    </VisualShell>
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
  description: LocalComponentTableCell | null;
  sourceIndex: number;
}

interface TimelineHeaderSet {
  title: string;
  start: string;
  duration: string;
  notes: string;
}

const TIMELINE_HEADERS_EN: TimelineHeaderSet = { title: 'Task', start: 'Start', duration: 'Duration', notes: 'Notes' };
const TIMELINE_HEADERS_ZH: TimelineHeaderSet = { title: '事项', start: '开始', duration: '时长', notes: '说明' };

function timelineHeaderSet(header: string[]): TimelineHeaderSet | null {
  const complete = (set: TimelineHeaderSet) =>
    header.includes(set.title) && header.includes(set.start) && header.includes(set.duration);
  if (complete(TIMELINE_HEADERS_EN)) return TIMELINE_HEADERS_EN;
  if (complete(TIMELINE_HEADERS_ZH)) return TIMELINE_HEADERS_ZH;
  return null;
}

export function TimelineView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const { content, mode, t } = view;
  const interactive = mode !== 'static';
  const [activeKey, setActiveKey] = useState<string | null>(null);
  useResetToken(context, () => setActiveKey(null));

  const title = textAttr(context, 'title', '') || t('Timeline', '时间轴');
  const unit = context.content.attrs.unit === undefined ? t('minutes', '分钟') : textAttr(context, 'unit', '');
  const table = context.children.table();

  if (!table) {
    return (
      <VisualShell context={context}>
        <VisualFrame className="local-visual-timeline" label={title}>
          <VisualMessage message={t('timeline body requires a Markdown table.', 'timeline 正文需要一个 Markdown 表格。')} kind="alert" />
        </VisualFrame>
      </VisualShell>
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
      <VisualShell context={context}>
        <VisualFrame className="local-visual-timeline" label={title}>
          <VisualMessage
            message={t(
              'timeline table requires the "Task", "Start" and "Duration" columns.',
              'timeline 表格需要“事项”“开始”“时长”三列，或“Task”“Start”“Duration”三列。',
            )}
            kind="alert"
          />
        </VisualFrame>
      </VisualShell>
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
    const titleText = cellText(row.cells[titleColumn], t) || t(`Task ${rowIndex + 1}`, `事项 ${rowIndex + 1}`);
    items.push({
      key: `item-${row.index}`,
      title: titleText,
      start,
      duration,
      description: descriptionColumn >= 0 ? row.cells[descriptionColumn] ?? null : null,
      sourceIndex: rowIndex,
    });
  });
  if (invalidRows.length > 0) {
    notes.push(t(
      `Rows ${invalidRows.join(', ')} have an invalid start or duration (must be non-negative numbers) and are hidden.`,
      `第 ${invalidRows.join('、')} 行的开始或时长不是非负数字，未显示。`,
    ));
  }
  if (items.length === 0) {
    return (
      <VisualShell context={context}>
        <VisualFrame className="local-visual-timeline" label={title}>
          <VisualMessage message={t('No valid timeline items.', '没有有效的时间轴事项。')} />
          <Notes notes={notes} />
        </VisualFrame>
      </VisualShell>
    );
  }

  const ordered = [...items].sort((left, right) => left.start - right.start || left.sourceIndex - right.sourceIndex);
  const maxEnd = ordered.reduce((maximum, item) => Math.max(maximum, item.start + item.duration), 0);
  const span = Math.max(1, maxEnd);
  const ticks = niceTicks(0, span, 5);
  if (ticks.length === 0 || ticks[0] !== 0) ticks.unshift(0);
  if (ticks[ticks.length - 1] < span) ticks.push(span);

  const suffix = unit ? ` ${unit}` : '';
  const timeText = (value: number) => `${formatNumber(value)}${suffix}`;
  const active = ordered.find((item) => item.key === activeKey) ?? null;

  return (
    <VisualShell context={context}>
      <VisualFrame
        className={`local-visual-timeline${interactive ? '' : ' local-static-timeline'}`}
        label={title}
      >
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
                  interactive && activeKey === item.key ? ' is-active' : ''
                }${interactive ? '' : ' local-static-timeline-item'}`}
                tabIndex={interactive ? 0 : undefined}
                aria-label={
                  interactive
                    ? t(
                        `${item.title}, started ${timeText(item.start)}, ended ${timeText(end)}, duration ${timeText(item.duration)}${item.description ? ', with notes' : ''}`,
                        `${item.title}，开始 ${timeText(item.start)}，结束 ${timeText(end)}，时长 ${timeText(item.duration)}${item.description ? '，有说明' : ''}`,
                      )
                    : undefined
                }
                onFocus={interactive ? () => setActiveKey(item.key) : undefined}
                onBlur={interactive ? () => setActiveKey((current) => (current === item.key ? null : current)) : undefined}
                onPointerEnter={interactive ? () => setActiveKey(item.key) : undefined}
                onPointerLeave={interactive ? () => setActiveKey((current) => (current === item.key ? null : current)) : undefined}
                onKeyDown={
                  interactive
                    ? (event: ReactKeyboardEvent<HTMLLIElement>) => {
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setActiveKey(null);
                        }
                      }
                    : undefined
                }
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
                {interactive || !item.description ? null : (
                  <div className="local-visual-timeline-detail local-static-timeline-detail">
                    {item.description.render()}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {interactive ? (
          <div className="local-visual-timeline-detail" aria-live="polite">
            {active ? (
              <>
                <strong>{active.title}</strong>
                {active.description ? (
                  active.description.render()
                ) : (
                  <span>{t('No notes.', '没有说明。')}</span>
                )}
              </>
            ) : (
              <span>{t('Focus or point at an item to view its notes.', '聚焦或指向事项查看说明。')}</span>
            )}
          </div>
        ) : null}
        <Notes notes={notes} />
      </VisualFrame>
    </VisualShell>
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
  children: readonly LocalComponentContent[];
}

interface DiagramModelEdge {
  key: string;
  from: string;
  to: string;
  label: string;
}

const DIAGRAM_WIDE_CHAR =
  /[ᄀ-ᅟ⺀-〿぀-㏿㐀-䶿一-鿿가-힯豈-﫿︰-﹏＀-｠￠-￦]/u;

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
  const width = lines.reduce((widest, line) => Math.max(widest, estimateDiagramTextWidth(line)), 0);
  return {
    width: width + DIAGRAM_EDGE_LABEL_PAD_X * 2,
    height: lines.length * DIAGRAM_EDGE_LABEL_LINE_HEIGHT + DIAGRAM_EDGE_LABEL_PAD_Y * 2,
    lines,
  };
}

export function DiagramView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const { content, mode, t } = view;
  const interactive = mode !== 'static';
  const [localSelected, setLocalSelected] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  useResetToken(context, () => {
    setLocalSelected(null);
    setWriteError(null);
  });

  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const markerId = `local-diagram-arrow-${instanceId}`;
  const descriptionId = `local-diagram-description-${instanceId}`;
  const title = textAttr(context, 'label', '') || t('Diagram', '图解');
  const directionRaw = String(context.props.direction ?? 'right').trim().toLowerCase();
  const direction = directionRaw === 'down' ? 'down' : 'right';
  const componentChildren = content.children.filter((child) => child.kind === 'component');

  const notes: string[] = [];
  const nodes: DiagramModelNode[] = [];
  const seenIds = new Set<string>();
  for (const child of componentChildren) {
    if (child.name !== 'node') continue;
    const id = (child.attrs.id ?? '').trim();
    if (!id) {
      notes.push(t('Ignored a node without an id.', '已忽略缺少 id 的节点。'));
      continue;
    }
    if (seenIds.has(id)) {
      notes.push(t(`Duplicate node id ${id}; ignored the later node.`, `节点 id 重复（${id}），已忽略后一个节点。`));
      continue;
    }
    seenIds.add(id);
    const toneRaw = String(child.props.tone ?? 'neutral').trim();
    const tone: DiagramTone = toneRaw === 'success' || toneRaw === 'warning' ? toneRaw : 'neutral';
    const label = typeof child.props.label === 'string'
      ? child.props.label
      : (child.attrs.label ?? id);
    nodes.push({ id, label: label || id, tone, children: child.children });
  }

  const edges: DiagramModelEdge[] = [];
  const edgeKeys = new Set<string>();
  for (const child of componentChildren) {
    if (child.name !== 'edge') continue;
    const from = (child.attrs.from ?? '').trim();
    const to = (child.attrs.to ?? '').trim();
    if (!from || !to || !seenIds.has(from) || !seenIds.has(to)) {
      notes.push(t(`Edge ${from || '?'} → ${to || '?'} references a missing endpoint; ignored.`, `连线 ${from || '?'} → ${to || '?'} 缺少端点，已忽略。`));
      continue;
    }
    const label = typeof child.props.label === 'string' ? child.props.label : '';
    const key = `${from}\u0000${to}\u0000${label}`;
    if (edgeKeys.has(key)) {
      notes.push(t(`Duplicate edge: ${from} → ${to}${label ? ` (${label})` : ''}; ignored.`, `重复连线：${from} → ${to}${label ? `（${label}）` : ''}，已忽略。`));
      continue;
    }
    edgeKeys.add(key);
    edges.push({ key, from, to, label });
  }

  const layoutInput: DiagramLayoutInput = {
    direction,
    nodes: nodes.map((entry) => ({ id: entry.id, width: DIAGRAM_NODE_WIDTH, height: DIAGRAM_NODE_HEIGHT })),
    edges: edges.map((edge) => {
      const metrics = edge.label ? diagramLabelMetrics(edge.label) : null;
      return {
        id: edge.key,
        from: edge.from,
        to: edge.to,
        label: edge.label,
        labelWidth: metrics?.width,
        labelHeight: metrics?.height,
      };
    }),
  };
  const layoutKey = diagramLayoutKey(layoutInput);
  const fallbackLayout = useMemo(() => createDiagramLayoutFallback(layoutInput), [layoutKey]);
  const [resolvedLayout, setResolvedLayout] = useState<{ key: string; layout: DiagramLayoutResult } | null>(null);
  useEffect(() => {
    if (layoutInput.nodes.length === 0) return undefined;
    let active = true;
    layoutDiagram(layoutInput)
      .then((result) => {
        if (active) setResolvedLayout({ key: layoutKey, layout: result });
      })
      .catch(() => {
        /* The fallback already provides a usable layout. */
      });
    return () => {
      active = false;
    };
  }, [layoutKey]);
  const layout = resolvedLayout && resolvedLayout.key === layoutKey ? resolvedLayout.layout : fallbackLayout;

  if (nodes.length === 0) {
    return (
      <VisualShell context={context}>
        <VisualFrame className="local-visual-diagram" label={title}>
          <VisualMessage message="diagram requires at least one node." kind="alert" />
          <Notes notes={notes} />
        </VisualFrame>
      </VisualShell>
    );
  }

  let runtimeSelected: string | null = null;
  try {
    const value = context.runtime.get(content);
    if (typeof value === 'string') runtimeSelected = value;
  } catch {
    runtimeSelected = null;
  }
  const ids = new Set(nodes.map((entry) => entry.id));
  const initialAttr = (content.attrs.initial ?? '').trim();
  const fallbackId = initialAttr && ids.has(initialAttr) ? initialAttr : nodes[0].id;
  const selectedId =
    runtimeSelected && ids.has(runtimeSelected)
      ? runtimeSelected
      : localSelected && ids.has(localSelected)
        ? localSelected
        : fallbackId;
  const selectedNode = nodes.find((entry) => entry.id === selectedId) ?? nodes[0];
  const staticSelectedId =
    runtimeSelected && ids.has(runtimeSelected)
      ? runtimeSelected
      : initialAttr && ids.has(initialAttr)
        ? initialAttr
        : null;

  const select = (id: string) => {
    setLocalSelected(id);
    setWriteError(null);
    const diagnostics = context.runtime.set(content, id);
    if (diagnostics.length > 0) {
      setWriteError(diagnostics.map((diagnostic) => t(formatLocalDiagnostic(diagnostic, 'en'), formatLocalDiagnostic(diagnostic, 'zh'))).join('; '));
    }
  };

  const edgePaths: ReactNode[] = [];
  const edgeLabels: ReactNode[] = [];

  for (const edge of edges) {
    const edgeLayout = layout.edges.get(edge.key);
    if (!edgeLayout || edgeLayout.sections.length === 0) continue;
    const path = diagramEdgePath(edgeLayout.sections);
    edgePaths.push(
      <g key={`edge-${edge.key}`} className="local-visual-edge">
        <path
          d={path}
          fill="none"
          style={{ stroke: 'var(--ink-muted)' }}
          strokeWidth={1.6}
          markerEnd={`url(#${markerId})`}
        />
      </g>,
    );
    if (!edge.label) continue;
    const labelBox = edgeLayout.label;
    if (!labelBox) continue;
    const label = diagramLabelMetrics(edge.label);
    const labelX = labelBox.x + labelBox.width / 2;
    const labelY = labelBox.y + labelBox.height / 2;
    edgeLabels.push(
      <g key={`edge-label-${edge.key}`} className="local-visual-edge-label-group">
        <text className="local-visual-edge-label" x={labelX} y={labelY} textAnchor="middle" dominantBaseline="middle">
          {label.lines.map((line, index) => (
            <tspan
              key={index}
              x={labelX}
              y={labelY + (index - (label.lines.length - 1) / 2) * DIAGRAM_EDGE_LABEL_LINE_HEIGHT}
            >
              {line}
            </tspan>
          ))}
        </text>
      </g>,
    );
  }

  return (
    <VisualShell context={context}>
      <VisualFrame
        className={`local-visual-diagram${interactive ? '' : ' local-static-diagram'}`}
        label={title}
      >
        <div className="local-visual-svg-wrap">
          <svg
            className="local-visual-svg local-visual-diagram-svg"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            width={layout.width}
            height={layout.height}
            role="group"
            aria-label={
              interactive
                ? `${title}, with ${nodes.length} nodes and ${edges.length} edges; press Tab to focus a node and Enter to select`
                : t(
                    `${title}, with ${nodes.length} nodes and ${edges.length} edges`,
                    `${title}，共 ${nodes.length} 个节点、${edges.length} 条连线`,
                  )
            }
            aria-describedby={descriptionId}
          >
            <defs>
              <marker
                id={markerId}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="8"
                markerHeight="8"
                markerUnits="userSpaceOnUse"
                orient="auto-start-reverse"
              >
                <path d="M 1 1 L 9 5 L 1 9 L 3 5 Z" style={{ fill: 'var(--ink-muted)' }} />
              </marker>
            </defs>
            {edgePaths}
            {nodes.map((entry) => {
              const position = layout.nodes.get(entry.id);
              if (!position) return null;
              const selected = interactive
                ? entry.id === selectedId
                : staticSelectedId !== null && entry.id === staticSelectedId;
              const lines = wrapLabel(entry.label, 8, 2);
              return (
                <g
                  key={`node-${entry.id}`}
                  className={`local-visual-node local-visual-node-${entry.tone}${selected ? ' is-selected' : ''}`}
                  data-diagram-node={interactive ? '' : undefined}
                  transform={`translate(${position.x} ${position.y})`}
                  role={interactive ? 'button' : undefined}
                  tabIndex={interactive ? 0 : undefined}
                  aria-pressed={interactive ? selected : undefined}
                  aria-label={interactive ? entry.label : undefined}
                  onClick={interactive ? () => select(entry.id) : undefined}
                  onKeyDown={
                    interactive
                      ? (event: ReactKeyboardEvent<SVGElement>) => {
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
                        }
                      : undefined
                  }
                >
                  <title>{entry.label}</title>
                  <rect
                    className="local-visual-node-shape"
                    x={-position.width / 2}
                    y={-position.height / 2}
                    width={position.width}
                    height={position.height}
                    rx={10}
                  />
                  <text className="local-visual-node-text" textAnchor="middle">
                    {lines.map((line, lineIndex) => (
                      <tspan key={lineIndex} x={0} y={(lineIndex - (lines.length - 1) / 2) * 16 + 4}>
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
        {interactive ? (
          <div className="local-visual-diagram-detail" aria-live="polite">
            {selectedNode ? (
              <>
                <strong>{selectedNode.label}</strong>
                {selectedNode.children.length > 0 ? (
                  view.render(selectedNode.children)
                ) : (
                  <span>{t('This node has no description.', '此节点没有说明。')}</span>
                )}
              </>
            ) : (
              <span>{t('Click a node, or focus it with Tab and press Enter, to view its description.', '点击节点，或用 Tab 聚焦后按 Enter 查看说明。')}</span>
            )}
          </div>
        ) : (
          <div className="local-visual-diagram-detail local-static-diagram-detail">
            <dl className="local-static-diagram-nodes">
              {nodes.map((entry) => (
                <div key={`static-node-${entry.id}`} className="local-static-diagram-node">
                  <dt>{entry.label}</dt>
                  <dd>
                    {entry.children.length > 0 ? (
                      view.render(entry.children)
                    ) : (
                      <span>{t('This node has no description.', '此节点没有说明。')}</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
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
    </VisualShell>
  );
}

/* ------------------------------------------------------------------ */
/* Node / column placeholders (parents own their rendering)            */
/* ------------------------------------------------------------------ */

export function NodeView(context: LocalComponentContext) {
  const view = useComponentView(context);
  return <div className="local-tabpanel-body">{view.render()}</div>;
}
