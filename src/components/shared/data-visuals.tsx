import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { LocalComponentContext, LocalComponentTableCell } from '../../react/component-api';
import { formatNumber, numberAttr, rawAttr, textAttr, useComponentView, useResetToken, useWriter } from '../../react/component-utils';
import { TableSurface } from './table-surface';
import { VisualFrame } from './visual-frame';
import { SERIES_COLORS, formatAxisNumber, niceTicks, cellText, columnIsNumeric, selectionKeyIndex, rowSelectionKey, VisualMessage, Notes, VisualShell } from './visual-helpers';

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
        <VisualFrame className="local-visual-table-block" label={label} component="table">
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
                      data-rmd-appearance="custom"
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
                        data-rmd-appearance="custom"
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
        <VisualFrame className="local-visual-table-block local-static-table-block" label={label} component="table">
          {tableBody}
          {table.rows.length === 0 ? (
            <VisualMessage message={t('No rows to display', '没有可显示的行')} />
          ) : null}
        </VisualFrame>
      ) : (
        <VisualFrame className="local-visual-table-block" label={label} component="table">
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
              <button type="button" className="md-button md-button-secondary" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                {t('Previous', '上一页')}
              </button>
              <span>
                {t(
                  `Page ${currentPage} of ${totalPages} · ${ordered.length} rows`,
                  `第 ${currentPage} / ${totalPages} 页 · 共 ${ordered.length} 行`,
                )}
              </span>
              <button type="button" className="md-button md-button-secondary" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>
                {t('Next', '下一页')}
              </button>
            </nav>
          ) : null}
        </VisualFrame>
      )}
    </VisualShell>
  );
}

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
  const { mode, t } = view;
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
        component="timeline"
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
