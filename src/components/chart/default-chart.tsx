import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { DefaultChartProps, DefaultChartRow } from './default-chart-types';
import { ChartMotionArc, ChartMotionCircle, ChartMotionPath, ChartMotionRect } from './chart-motion';

/* ------------------------------------------------------------------ */
/* Private chart renderer                                              */
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

const DIM_OPACITY = 'var(--rmd-chart-dim-opacity)';
const FALLBACK_WIDTH = 640;

/** Paint values a theme may override; geometry stays in data coordinates. */
const LINE_WIDTH = 'var(--rmd-chart-line-width)';
const HIGHLIGHT_LINE_WIDTH = 'max(var(--rmd-chart-line-width), var(--rmd-chart-line-highlight-width))';
const POINT_STROKE_WIDTH = 'var(--rmd-chart-point-stroke-width)';
const AREA_OPACITY = 'var(--rmd-chart-area-opacity)';
const SURFACE_STROKE = 'var(--rmd-chart-mark-stroke, var(--surface))';
const AXIS_FILL = 'var(--rmd-chart-axis, var(--chart-axis))';
const GRID_STROKE = 'var(--rmd-chart-grid, var(--chart-grid))';
const AXIS_TITLE_FILL = 'var(--rmd-chart-axis-title, var(--ink-soft))';
const GUIDE_STROKE = 'var(--rmd-chart-guide, var(--line-strong))';

type ActiveSource = 'keyboard' | 'pointer';

type ActiveState =
  | { mode: 'column'; rowId: string; anchorY: number; source: ActiveSource }
  | { mode: 'bar'; rowId: string; series: number; source: ActiveSource }
  | { mode: 'point'; rowId: string; series: number; source: ActiveSource }
  | { mode: 'slice'; rowId: string; source: ActiveSource };

interface TooltipLine {
  key: string;
  color: string;
  label: string;
  value: string;
}

const KIND_LABELS: Record<DefaultChartProps['kind'], [string, string]> = {
  bar: ['bar chart', '柱状图'],
  line: ['line chart', '折线图'],
  area: ['area chart', '面积图'],
  scatter: ['scatter chart', '散点图'],
  donut: ['donut chart', '环形图'],
  pie: ['pie chart', '饼图'],
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function rowIdentity(row: DefaultChartRow): string {
  return row.keyValue ? `k:${row.keyValue}` : `i:${row.index}`;
}

function seriesColor(position: number): string {
  return SERIES_COLORS[position % SERIES_COLORS.length];
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e6 || (magnitude > 0 && magnitude < 0.001)) return value.toExponential(2);
  return String(Number(value.toFixed(4)));
}

function formatAxisNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e6 || (magnitude > 0 && magnitude < 0.001)) return value.toExponential(2);
  return Number(value.toFixed(4)).toString();
}

function formatShare(value: number, total: number): string {
  if (!(total > 0)) return '0%';
  return `${Number(((value / total) * 100).toFixed(1))}%`;
}

function truncate(text: string, max: number): string {
  const characters = Array.from(text);
  return characters.length > max ? `${characters.slice(0, Math.max(1, max - 1)).join('')}…` : text;
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

function axisLeft(ticks: number[], hasTitle: boolean): number {
  return Math.max(42, ...ticks.map((tick) => formatAxisNumber(tick).length * 6 + (hasTitle ? 24 : 10)));
}

function activationKey(event: ReactKeyboardEvent<SVGElement>): boolean {
  return event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar';
}

function focusNeighbor(event: ReactKeyboardEvent<SVGElement>, direction: number): void {
  const current = event.currentTarget;
  const svg = current.ownerSVGElement ?? current.closest('svg');
  if (!svg) return;
  const items = Array.from(svg.querySelectorAll<SVGElement>('[data-chart-mark]'));
  const index = items.indexOf(current);
  if (index < 0 || items.length === 0) return;
  event.preventDefault();
  const next = items[(index + direction + items.length) % items.length];
  next?.focus();
}

function valueOf(row: DefaultChartRow, position: number): number | null {
  const value = row.values[position];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

export function DefaultChart(props: DefaultChartProps) {
  const {
    kind,
    title,
    xLabel,
    yLabel,
    rows,
    seriesNames,
    numericX,
    selectionEnabled,
    selectedRowKey,
    onSelect,
    resetToken,
    t,
  } = props;

  const isSliceKind = kind === 'donut' || kind === 'pie';
  const [hiddenSeries, setHiddenSeries] = useState<Set<number>>(new Set());
  const [hiddenSlices, setHiddenSlices] = useState<Set<number>>(new Set());
  const [highlight, setHighlight] = useState<number | null>(null);
  const [active, setActive] = useState<ActiveState | null>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const [tipSize, setTipSize] = useState({ width: 230, height: 140 });
  const rootRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const readoutId = useId();
  const height = width < 520 ? 292 : 330;
  const rowSignature = rows.map(rowIdentity).join('\u0001');
  const seriesSignature = seriesNames.join('\u0001');

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const update = (next: number) => {
      if (Number.isFinite(next) && next > 0) setWidth(Math.round(next));
    };
    update(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) update(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setHiddenSeries(new Set());
    setHiddenSlices(new Set());
  }, [resetToken, rowSignature, seriesSignature]);

  useEffect(() => {
    setHighlight(null);
    setActive(null);
  }, [resetToken, kind, rowSignature, seriesSignature]);

  useEffect(() => {
    if (!active) return;
    const element = tooltipRef.current;
    if (!element) return;
    const update = () => {
      const next = { width: element.offsetWidth, height: element.offsetHeight };
      setTipSize((current) => (
        current.width === next.width && current.height === next.height ? current : next
      ));
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [active, width, height, rows]);

  useEffect(() => {
    const dismiss = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setActive(null);
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, []);

  const hiddenSet = isSliceKind ? hiddenSlices : hiddenSeries;
  const visibleShareTotal = isSliceKind
    ? rows.reduce((sum, row, index) => hiddenSlices.has(index) ? sum : sum + Math.max(0, valueOf(row, 0) ?? 0), 0)
    : 0;
  const legendItems = isSliceKind
    ? rows.map((row, index) => ({
        index,
        label: row.label,
        color: seriesColor(index),
        disabled: (valueOf(row, 0) ?? 0) <= 0,
      }))
    : seriesNames.map((name, index) => ({ index, label: name, color: seriesColor(index), disabled: false }));
  const activeSeries = active?.mode === 'slice'
    ? rows.findIndex(row => rowIdentity(row) === active.rowId)
    : active?.mode === 'bar' || active?.mode === 'point' ? active.series : null;
  const emphasis = highlight ?? activeSeries;
  const focused = emphasis !== null
    && emphasis >= 0
    && emphasis < legendItems.length
    && !hiddenSet.has(emphasis)
    && (!isSliceKind || (valueOf(rows[emphasis], 0) ?? 0) > 0)
    ? emphasis
    : null;
  const dimmed = (index: number) => (focused === null || focused === index ? 1 : DIM_OPACITY);
  const rowSelected = (row: DefaultChartRow) =>
    selectionEnabled && row.keyValue !== '' && row.keyValue === selectedRowKey;

  const toggleLegendItem = (index: number) => {
    setActive(null);
    setHighlight(null);
    if (isSliceKind) {
      setHiddenSlices((current) => {
        const next = new Set(current);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
      return;
    }
    setHiddenSeries((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const markProps = (row: DefaultChartRow, ariaLabel: string, focus: () => void) => {
    const selectable = selectionEnabled && row.keyValue !== '';
    const selected = selectable && row.keyValue === selectedRowKey;
    const handleKeyDown = (event: ReactKeyboardEvent<SVGElement>) => {
      if (activationKey(event)) {
        if (selectable) {
          event.preventDefault();
          onSelect(row.keyValue);
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setActive(null);
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        focusNeighbor(event, 1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        focusNeighbor(event, -1);
      }
    };
    return {
      'data-chart-mark': '',
      ...(selectable ? { 'data-chart-selectable': '' } : {}),
      tabIndex: 0,
      role: selectable ? ('button' as const) : ('img' as const),
      ...(selectable ? { 'aria-pressed': selected } : {}),
      'aria-label': ariaLabel,
      onFocus: focus,
      onBlur: () => setActive(null),
      onClick: selectable ? () => onSelect(row.keyValue) : undefined,
      onKeyDown: handleKeyDown,
    };
  };

  const selectActive = (current: ActiveState | null, next: ActiveState): ActiveState => {
    if (!current) return next;
    if (
      current.mode !== next.mode
      || current.rowId !== next.rowId
      || current.source !== next.source
    ) {
      return next;
    }
    if (current.mode === 'bar' || current.mode === 'point') {
      return current.series === (next as { series: number }).series ? current : next;
    }
    return current;
  };

  const renderLegend = (label: string) => (
    <div
      className="rmd-chart-legend"
      role="group"
      aria-label={label}
      data-rmd-part="legend"
      style={{ display: 'flex', flexWrap: 'wrap', minWidth: 0 }}
    >
      {legendItems.map((item) => {
        const off = hiddenSet.has(item.index);
        const isHighlighted = focused === item.index;
        const share = isSliceKind
          ? off ? '—' : formatShare(Math.max(0, valueOf(rows[item.index], 0) ?? 0), visibleShareTotal)
          : null;
        return (
          <button
            key={`legend-${item.index}-${item.label}`}
            type="button"
            className={`rmd-chart-legend-item${off ? ' is-off' : ''}${isHighlighted ? ' is-highlighted' : ''}`}
            data-rmd-appearance="custom"
            data-series={item.index}
            aria-pressed={!off}
            aria-label={share === null ? undefined : `${item.label} ${share}`}
            disabled={item.disabled}
            title={item.label}
            style={{
              minWidth: 0,
              maxWidth: '100%',
              opacity: item.disabled ? 0.42 : undefined,
            }}
            onClick={() => toggleLegendItem(item.index)}
            onPointerEnter={() => {
              if (!off) setHighlight(item.index);
            }}
            onPointerLeave={() => setHighlight((current) => (current === item.index ? null : current))}
            onFocus={() => {
              if (!off) setHighlight(item.index);
            }}
            onBlur={() => setHighlight((current) => (current === item.index ? null : current))}
          >
            <span className="rmd-chart-swatch" style={{ backgroundColor: item.color }} aria-hidden="true" />
            <span
              className="rmd-chart-legend-label"
              style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {item.label}
            </span>
            {share !== null ? <span className="rmd-chart-legend-share">{share}</span> : null}
          </button>
        );
      })}
    </div>
  );

  const renderShell = (stage: ReactNode, emptyMessage: string | null, readoutText: string) => (
    <div
      ref={rootRef}
      className={`rmd-chart rmd-chart-${kind}`}
      data-rmd-chart-kind={kind}
      data-rmd-component="chart"
      style={{ minWidth: 0, maxWidth: '100%' }}
    >
      {renderLegend(isSliceKind
        ? t('Legend, toggle items', '图例，可开关项')
        : t('Legend, toggle series', '图例，可开关系列'))}
      {emptyMessage ? (
        <p className="rmd-chart-empty" role="status">{emptyMessage}</p>
      ) : (
        <div className="rmd-chart-stage" data-rmd-part="plot" style={{ position: 'relative', width: '100%', minWidth: 0 }}>
          {stage}
        </div>
      )}
      <div
        id={readoutId}
        className="rmd-chart-readout"
        aria-live={active?.source === 'keyboard' ? 'polite' : 'off'}
        aria-atomic="true"
        data-rmd-part="readout"
      >
        {readoutText}
      </div>
    </div>
  );

  const tooltipPosition = (anchorX: number, anchorY: number) => {
    const offset = 14;
    const preferredLeft = anchorX + offset + tipSize.width <= width - 8
      ? anchorX + offset
      : anchorX - tipSize.width - offset;
    return {
      left: clamp(preferredLeft, 8, Math.max(8, width - tipSize.width - 8)),
      top: clamp(anchorY - tipSize.height / 2, 8, Math.max(8, height - tipSize.height - 8)),
    };
  };

  const renderTooltip = (
    titleText: string,
    lines: TooltipLine[],
    foot: ReactNode,
    anchorX: number,
    anchorY: number,
  ) => {
    const position = tooltipPosition(anchorX, anchorY);
    return (
      <div
        ref={tooltipRef}
        className="rmd-chart-tooltip"
        role="tooltip"
        style={{
          left: position.left,
          top: position.top,
          position: 'absolute',
          maxWidth: 'calc(100% - 16px)',
          pointerEvents: 'none',
        }}
      >
        <div className="rmd-chart-tooltip-title" style={{ overflowWrap: 'anywhere' }}>{titleText}</div>
        {lines.map((line) => (
          <div className="rmd-chart-tooltip-row" key={line.key}>
            <span className="rmd-chart-tooltip-label" style={{ overflowWrap: 'anywhere' }}>
              <span className="rmd-chart-tooltip-dot" style={{ backgroundColor: line.color }} aria-hidden="true" />
              {line.label}
            </span>
            <span className="rmd-chart-tooltip-value">{line.value}</span>
          </div>
        ))}
        {foot ? <div className="rmd-chart-tooltip-foot" style={{ overflowWrap: 'anywhere' }}>{foot}</div> : null}
      </div>
    );
  };

  /* ---------------------------------------------------------------- */
  /* Donut / pie                                                      */
  /* ---------------------------------------------------------------- */

  if (isSliceKind) {
    const sliceValues = rows.map((row) => {
      const value = valueOf(row, 0);
      return value !== null && value >= 0 ? value : null;
    });
    const positiveCount = sliceValues.filter((value): value is number => value !== null && value > 0).length;
    const visibleSliceIndexes = rows
      .map((_row, index) => index)
      .filter((index) => !hiddenSlices.has(index) && (sliceValues[index] ?? 0) > 0);
    const visibleTotal = visibleShareTotal;
    const emptyMessage = (() => {
      if (rows.length === 0) return t('No data rows to plot', '没有可绘制的数据行');
      if (positiveCount === 0) return t('No share to display', '暂无占比');
      if (visibleTotal <= 0) return t('All items are hidden. Use the legend to show them again.', '所有项已隐藏，可在图例中重新显示。');
      return null;
    })();
    if (emptyMessage) {
      return renderShell(null, emptyMessage, emptyMessage);
    }

    let angle = -Math.PI / 2;
    const slices = visibleSliceIndexes.map((index) => {
      const value = sliceValues[index] as number;
      const start = angle;
      angle += (value / visibleTotal) * Math.PI * 2;
      return { index, value, start, end: angle };
    });
    const outer = Math.max(22, Math.min(132, Math.min(width, height) / 2 - 22));
    const inner = kind === 'donut' ? Math.max(0, outer * 0.66) : 0;
    const cx = width / 2;
    const cy = height / 2;

    const activeIndex = active?.mode === 'slice'
      ? rows.findIndex((row) => rowIdentity(row) === active.rowId)
      : -1;
    const activeSlice = activeIndex >= 0 ? slices.find((slice) => slice.index === activeIndex) : undefined;
    let tooltip: ReactNode = null;
    let activeReadout = '';
    let guide: ReactNode = null;

    if (activeSlice) {
      const row = rows[activeSlice.index];
      const share = formatShare(activeSlice.value, visibleTotal);
      const mid = (activeSlice.start + activeSlice.end) / 2;
      const radius = (outer + inner) / 2;
      const anchorX = cx + Math.cos(mid) * radius;
      const anchorY = cy + Math.sin(mid) * radius;
      tooltip = renderTooltip(
        row.label,
        [{
          key: `slice-${activeSlice.index}`,
          color: seriesColor(activeSlice.index),
          label: seriesNames[0] || t('Value', '数值'),
          value: formatValue(activeSlice.value),
        }],
        <>{share} {t('of visible total', '占可见合计')} {formatValue(visibleTotal)}</>,
        anchorX,
        anchorY,
      );
      activeReadout = `${row.label}: ${formatValue(activeSlice.value)}, ${share}`;
      guide = (
        <circle
          cx={anchorX}
          cy={anchorY}
          r={4}
          fill={seriesColor(activeSlice.index)}
          stroke={SURFACE_STROKE}
          strokeWidth={2}
          pointerEvents="none"
        />
      );
    }

    const idleReadout = t(
      'Hover or focus a slice to read its share; use arrow keys to move between slices.',
      '悬浮或聚焦扇区查看占比；方向键切换扇区。',
    );
    const ariaLabel = t(
      `${title}, ${KIND_LABELS[kind][0]}, ${rows.length} items`,
      `${title}，${KIND_LABELS[kind][1]}，共 ${rows.length} 项`,
    );

    const stage = (
      <>
        <svg
          className="rmd-chart-svg"
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label={ariaLabel}
          aria-describedby={readoutId}
          style={{ display: 'block', width: '100%', touchAction: 'pan-y' }}
        >
          {kind === 'donut' ? (
            <g aria-hidden="true">
              <text
                x={cx}
                y={cy - 2}
                textAnchor="middle"
                fill="var(--ink)"
                style={{ fontSize: 18, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}
              >
                {formatValue(visibleTotal)}
              </text>
              <text
                x={cx}
                y={cy + 17}
                textAnchor="middle"
                fill="var(--ink-muted)"
                style={{ fontSize: 11 }}
              >
                {truncate(seriesNames[0] ?? '', 16)}
              </text>
            </g>
          ) : null}
          {slices.map((slice) => {
            const row = rows[slice.index];
            const color = seriesColor(slice.index);
            const selected = rowSelected(row);
            const share = formatShare(slice.value, visibleTotal);
            const mark = markProps(
              row,
              t(
                `${row.label}: ${formatValue(slice.value)}, ${share}`,
                `${row.label}：${formatValue(slice.value)}，${share}`,
              ),
              () => setActive((current) => selectActive(current, {
                mode: 'slice',
                rowId: rowIdentity(row),
                source: 'keyboard',
              })),
            );
            const activate = () => setActive((current) => selectActive(current, {
              mode: 'slice',
              rowId: rowIdentity(row),
              source: 'pointer',
            }));
            const deactivate = () => setActive((current) => (
              current?.mode === 'slice' && current.rowId === rowIdentity(row) && current.source === 'pointer'
                ? null
                : current
            ));
            const className = `local-visual-donut-slice${selected ? ' is-selected' : ''}`;
            return (
              <ChartMotionArc
                key={`slice-${slice.index}`}
                cx={cx}
                cy={cy}
                outerRadius={outer}
                innerRadius={inner}
                startAngle={slice.start}
                endAngle={slice.end}
                fill={color}
                stroke={SURFACE_STROKE}
                strokeWidth={POINT_STROKE_WIDTH}
                className={className}
                data-rmd-part="slice"
                data-series={slice.index}
                style={{
                  opacity: dimmed(slice.index),
                  transform: focused === slice.index ? 'scale(1.035)' : 'scale(1)',
                  transformOrigin: `${cx}px ${cy}px`,
                  transformBox: 'view-box',
                }}
                {...mark}
                onPointerEnter={activate}
                onPointerMove={activate}
                onPointerLeave={deactivate}
              />
            );
          })}
          {guide}
        </svg>
        {tooltip}
      </>
    );

    return renderShell(stage, null, activeReadout || idleReadout);
  }

  /* ---------------------------------------------------------------- */
  /* Cartesian charts                                                 */
  /* ---------------------------------------------------------------- */

  const visibleSeries = seriesNames
    .map((_name, position) => position)
    .filter((position) => !hiddenSeries.has(position));
  if (visibleSeries.length === 0) {
    const message = seriesNames.length === 0
      ? t('No values to read', '没有可读取的数值')
      : t('All series are hidden. Use the legend to show them again.', '所有系列已隐藏，可在图例中重新显示。');
    return renderShell(null, message, message);
  }
  if (rows.length === 0) {
    const message = t('No data rows to plot', '没有可绘制的数据行');
    return renderShell(null, message, message);
  }

  const useNumericX = kind === 'scatter' ? true : kind !== 'bar' && numericX;
  const plottableRows = useNumericX
    ? rows.filter((row) => row.xValue !== null && Number.isFinite(row.xValue))
    : rows;
  if (plottableRows.length === 0) {
    const message = t('No data rows to plot', '没有可绘制的数据行');
    return renderShell(null, message, message);
  }

  // Numeric coordinates retain source order, including intentional reversals.
  const plotRows = plottableRows;
  const rowPositions = new Map(rows.map((row, index) => [row, index]));

  const allValues: number[] = [];
  for (const row of plottableRows) {
    for (const position of visibleSeries) {
      const value = valueOf(row, position);
      if (value !== null) allValues.push(value);
    }
  }
  if (allValues.length === 0) {
    const message = t('No values to read', '没有可读取的数值');
    return renderShell(null, message, message);
  }

  const includeZero = kind === 'bar' || kind === 'area';
  const yDomain = chartDomain(allValues, includeZero);
  const yTicks = niceTicks(yDomain.min, yDomain.max, width < 520 ? 4 : 5);
  const plotLeft = Math.min(Math.max(32, axisLeft(yTicks, Boolean(yLabel))), Math.max(30, width * 0.42));
  const plotRight = Math.max(plotLeft + 8, width - 12);
  const plotTop = 16;
  const plotBottom = height - (xLabel ? 48 : 34);
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;
  const yOf = (value: number) => plotTop + ((yDomain.max - value) / (yDomain.max - yDomain.min)) * plotHeight;
  const zeroY = yOf(Math.max(yDomain.min, Math.min(yDomain.max, 0)));

  const xValues = plottableRows
    .map((row) => row.xValue)
    .filter((value): value is number => value !== null);
  const xDomain = useNumericX && xValues.length > 0 ? chartDomain(xValues, false) : null;
  const bandWidth = plotWidth / Math.max(1, rows.length);
  const categoryX = (row: DefaultChartRow) => {
    const position = rowPositions.get(row) ?? 0;
    return plotLeft + bandWidth * (position + 0.5);
  };
  const xOfRow = (row: DefaultChartRow): number | null => {
    if (xDomain) {
      return row.xValue === null ? null : plotLeft + ((row.xValue - xDomain.min) / (xDomain.max - xDomain.min)) * plotWidth;
    }
    return categoryX(row);
  };

  const yGrid = yTicks.map((tick) => (
    <g key={`y-${tick}`}>
      <line
        className="rmd-chart-grid"
        x1={plotLeft}
        x2={plotRight}
        y1={yOf(tick)}
        y2={yOf(tick)}
        style={{ stroke: GRID_STROKE, strokeWidth: 1 }}
      />
      <text
        className="rmd-chart-axis-label"
        x={plotLeft - 7}
        y={yOf(tick)}
        textAnchor="end"
        dominantBaseline="middle"
        style={{ fill: AXIS_FILL }}
      >
        {formatAxisNumber(tick)}
      </text>
    </g>
  ));

  const xTicks: { key: string; x: number; label: string; full: string }[] = [];
  if (xDomain) {
    for (const tick of niceTicks(xDomain.min, xDomain.max, width < 520 ? 4 : 5)) {
      xTicks.push({
        key: `x-${tick}`,
        x: plotLeft + ((tick - xDomain.min) / (xDomain.max - xDomain.min)) * plotWidth,
        label: formatAxisNumber(tick),
        full: formatAxisNumber(tick),
      });
    }
  } else {
    const step = Math.max(1, Math.ceil(rows.length / (width < 520 ? 4 : 6)));
    const indexes: number[] = [];
    for (let index = 0; index < rows.length; index += step) indexes.push(index);
    const last = rows.length - 1;
    if (last >= 0 && indexes[indexes.length - 1] !== last) {
      if (indexes.length > 1 && last - indexes[indexes.length - 1] < step * 0.6) {
        indexes[indexes.length - 1] = last;
      } else {
        indexes.push(last);
      }
    }
    for (const index of indexes) {
      const row = rows[index];
      xTicks.push({
        key: `x-${index}`,
        x: categoryX(row),
        label: truncate(row.label, width < 520 ? 4 : 8),
        full: row.label,
      });
    }
  }

  const barGeometry = (row: DefaultChartRow, position: number, visibleIndex: number) => {
    const groupWidth = bandWidth * 0.76;
    const barWidth = Math.max(1, groupWidth / Math.max(1, visibleSeries.length));
    const x = plotLeft
      + bandWidth * (rowPositions.get(row) ?? 0)
      + (bandWidth - groupWidth) / 2
      + visibleIndex * barWidth;
    const value = valueOf(row, position) as number;
    const barHeight = Math.max(1, Math.abs(yOf(value) - zeroY));
    const y = value >= 0 ? zeroY - barHeight : zeroY;
    return { x, y, width: Math.max(1.5, barWidth - 1), height: barHeight, centerX: x + barWidth / 2 };
  };

  const activeRow = active ? rows.find((row) => rowIdentity(row) === active.rowId) : undefined;
  let activeInfo: {
    title: string;
    lines: TooltipLine[];
    foot: ReactNode;
    anchorX: number;
    anchorY: number;
    guideX: number;
    guideY: number | null;
    readout: string;
  } | null = null;

  if (active && activeRow) {
    if ((kind === 'bar') && active.mode === 'bar' && visibleSeries.includes(active.series)) {
      const value = valueOf(activeRow, active.series);
      const x = xOfRow(activeRow);
      if (value !== null && x !== null) {
        const visibleIndex = visibleSeries.indexOf(active.series);
        const bar = barGeometry(activeRow, active.series, visibleIndex);
        activeInfo = {
          title: activeRow.label,
          lines: [{
            key: `bar-${active.series}`,
            color: seriesColor(active.series),
            label: seriesNames[active.series],
            value: formatValue(value),
          }],
          foot: null,
          anchorX: bar.centerX,
          anchorY: bar.y + bar.height / 2,
          guideX: bar.centerX,
          guideY: null,
          readout: `${seriesNames[active.series]}, ${activeRow.label}: ${formatValue(value)}`,
        };
      }
    } else if ((kind === 'line' || kind === 'area') && active.mode === 'column') {
      const x = xOfRow(activeRow);
      if (x !== null) {
        const lines = visibleSeries.flatMap((position) => {
          const value = valueOf(activeRow, position);
          return value === null ? [] : [{
            key: `series-${position}`,
            color: seriesColor(position),
            label: seriesNames[position],
            value: formatValue(value),
          }];
        });
        if (lines.length > 0) {
          activeInfo = {
            title: activeRow.label,
            lines,
            foot: null,
            anchorX: x,
            anchorY: clamp(active.anchorY, plotTop, plotBottom),
            guideX: x,
            guideY: null,
            readout: `${activeRow.label}: ${lines.map((line) => `${line.label} ${line.value}`).join(t('; ', '；'))}`,
          };
        }
      }
    } else if (kind === 'scatter' && active.mode === 'point' && visibleSeries.includes(active.series)) {
      const value = valueOf(activeRow, active.series);
      const x = xOfRow(activeRow);
      if (value !== null && x !== null) {
        const xName = xLabel || t('x', 'x');
        const yName = yLabel || t('y', 'y');
        const y = yOf(value);
        activeInfo = {
          title: activeRow.label,
          lines: [{
            key: `point-${active.series}`,
            color: seriesColor(active.series),
            label: seriesNames[active.series],
            value: formatValue(value),
          }],
          foot: (
            <>
              {xName}: {formatValue(activeRow.xValue as number)}
              {' · '}
              {yName}: {formatValue(value)}
            </>
          ),
          anchorX: x,
          anchorY: y,
          guideX: x,
          guideY: y,
          readout: `${seriesNames[active.series]}, ${activeRow.label}: ${xName} ${formatValue(activeRow.xValue as number)}, ${yName} ${formatValue(value)}`,
        };
      }
    }
  }

  const stagePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (kind !== 'line' && kind !== 'area' && kind !== 'scatter') return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const px = (event.clientX - rect.left) * width / rect.width;
    const py = (event.clientY - rect.top) * height / rect.height;
    if (px < plotLeft || px > plotRight || py < plotTop || py > plotBottom) {
      setActive((current) => (current?.source === 'pointer' ? null : current));
      return;
    }
    if (kind === 'scatter') {
      let best: { row: DefaultChartRow; series: number; x: number; y: number; distance: number } | null = null;
      for (const row of plotRows) {
        const x = xOfRow(row);
        if (x === null) continue;
        for (const position of visibleSeries) {
          const value = valueOf(row, position);
          if (value === null) continue;
          const y = yOf(value);
          const distance = Math.hypot(x - px, y - py);
          if (!best || distance < best.distance) best = { row, series: position, x, y, distance };
        }
      }
      if (!best) {
        setActive((current) => (current?.source === 'pointer' ? null : current));
        return;
      }
      const target = best;
      setActive((current) => selectActive(current, {
        mode: 'point',
        rowId: rowIdentity(target.row),
        series: target.series,
        source: 'pointer',
      }));
      return;
    }
    let nearestRow: DefaultChartRow | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const row of plotRows) {
      const x = xOfRow(row);
      if (x === null) continue;
      const distance = Math.abs(x - px);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestRow = row;
      }
    }
    if (!nearestRow) {
      setActive((current) => (current?.source === 'pointer' ? null : current));
      return;
    }
    const targetRow = nearestRow;
    setActive((current) => selectActive(current, {
      mode: 'column',
      rowId: rowIdentity(targetRow),
      anchorY: clamp(py, plotTop, plotBottom),
      source: 'pointer',
    }));
  };

  const stagePointerLeave = () => setActive((current) => (current?.source === 'pointer' ? null : current));

  const areaMarks: ReactNode[] = [];
  const lineMarks: ReactNode[] = [];
  const pointMarks: ReactNode[] = [];
  const barMarks: ReactNode[] = [];

  if (kind === 'bar') {
    rows.forEach((row) => {
      visibleSeries.forEach((position, visibleIndex) => {
        const value = valueOf(row, position);
        if (value === null) return;
        const bar = barGeometry(row, position, visibleIndex);
        const selected = rowSelected(row);
        const mark = markProps(
          row,
          t(
            `${seriesNames[position]}, ${row.label}: ${formatValue(value)}`,
            `${seriesNames[position]}，${row.label}：${formatValue(value)}`,
          ),
          () => setActive((current) => selectActive(current, {
            mode: 'bar',
            rowId: rowIdentity(row),
            series: position,
            source: 'keyboard',
          })),
        );
        const activate = () => setActive((current) => selectActive(current, {
          mode: 'bar',
          rowId: rowIdentity(row),
          series: position,
          source: 'pointer',
        }));
        const deactivate = () => setActive((current) => (
          current?.mode === 'bar'
            && current.rowId === rowIdentity(row)
            && current.series === position
            && current.source === 'pointer'
            ? null
            : current
        ));
        barMarks.push(
          <ChartMotionRect
            key={`bar-${position}-${row.index}`}
            className={`local-visual-bar${selected ? ' is-selected' : ''}`}
            data-rmd-part="bar"
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={bar.height}
            rx={Math.min(4, bar.width / 2, bar.height / 2)}
            data-series={position}
            style={{ fill: seriesColor(position), opacity: dimmed(position), rx: `min(var(--rmd-chart-bar-radius), ${Math.min(bar.width, bar.height) / 2}px)` }}
            {...mark}
            onPointerEnter={activate}
            onPointerMove={activate}
            onPointerLeave={deactivate}
          />,
        );
      });
    });
  }

  if (kind === 'line' || kind === 'area') {
    for (const position of visibleSeries) {
      const segments: { row: DefaultChartRow; value: number; x: number; y: number }[][] = [];
      let current: { row: DefaultChartRow; value: number; x: number; y: number }[] = [];
      const flush = () => {
        if (current.length > 0) segments.push(current);
        current = [];
      };
      for (const row of plotRows) {
        const value = valueOf(row, position);
        const x = xOfRow(row);
        if (value === null || x === null) {
          flush();
          continue;
        }
        current.push({ row, value, x, y: yOf(value) });
      }
      flush();

      for (const segment of segments) {
        if (segment.length >= 2) {
          const d = segment
            .map((entry, index) => `${index === 0 ? 'M' : 'L'} ${entry.x} ${entry.y}`)
            .join(' ');
          lineMarks.push(
            <ChartMotionPath
              key={`line-${position}-${segment[0].row.index}`}
              className="local-visual-line"
              data-rmd-part="line"
              d={d}
              fill="none"
              data-series={position}
              style={{ stroke: seriesColor(position), opacity: dimmed(position) }}
              strokeWidth={focused === position ? HIGHLIGHT_LINE_WIDTH : LINE_WIDTH}
              strokeLinejoin="round"
              strokeLinecap="round"
            />,
          );
          if (kind === 'area') {
            const first = segment[0];
            const last = segment[segment.length - 1];
            const area = `M ${first.x} ${zeroY} ${segment.map((entry) => `L ${entry.x} ${entry.y}`).join(' ')} L ${last.x} ${zeroY} Z`;
            areaMarks.push(
              <ChartMotionPath
                key={`area-${position}-${first.row.index}`}
                className="local-visual-area"
                data-rmd-part="area"
                d={area}
                data-series={position}
                style={{ fill: seriesColor(position), fillOpacity: AREA_OPACITY, opacity: dimmed(position) }}
              />,
            );
          }
        }
        for (const entry of segment) {
          const selected = rowSelected(entry.row);
          const mark = markProps(
            entry.row,
            t(
              `${seriesNames[position]}, ${entry.row.label}: ${formatValue(entry.value)}`,
              `${seriesNames[position]}，${entry.row.label}：${formatValue(entry.value)}`,
            ),
            () => setActive((current) => selectActive(current, {
              mode: 'column',
              rowId: rowIdentity(entry.row),
              anchorY: entry.y,
              source: 'keyboard',
            })),
          );
          pointMarks.push(
            <g key={`point-${position}-${entry.row.index}`}>
              <circle
                className={`local-visual-hit${selected ? ' is-selected' : ''}`}
                data-rmd-part="hit"
                cx={entry.x}
                cy={entry.y}
                r={12}
                fill="transparent"
                data-series={position}
                {...mark}
              />
              <ChartMotionCircle
                className={`local-visual-point${selected ? ' is-selected' : ''}`}
                data-rmd-part="point"
                cx={entry.x}
                cy={entry.y}
                r={3.4}
                data-series={position}
                style={{
                  fill: seriesColor(position),
                  stroke: SURFACE_STROKE,
                  strokeWidth: POINT_STROKE_WIDTH,
                  opacity: dimmed(position),
                }}
                pointerEvents="none"
              />
            </g>,
          );
        }
      }
    }
  }

  if (kind === 'scatter') {
    // A numeric x column becomes the row label, so the stable row key would
    // disappear from the spoken name. Keep the key plus both coordinates.
    const xName = xLabel || t('x', 'x');
    for (const row of plotRows) {
      const x = xOfRow(row);
      if (x === null) continue;
      const xText = row.xValue === null ? row.label : formatValue(row.xValue);
      const keyPart = row.keyValue !== '' && row.keyValue !== row.label && row.keyValue !== xText
        ? `, ${row.keyValue}`
        : '';
      for (const position of visibleSeries) {
        const value = valueOf(row, position);
        if (value === null) continue;
        const selected = rowSelected(row);
        const mark = markProps(
          row,
          t(
            `${seriesNames[position]}, ${row.label}${keyPart} (${xName} ${xText}): ${formatValue(value)}`,
            `${seriesNames[position]}，${row.label}${keyPart}（${xName} ${xText}）：${formatValue(value)}`,
          ),
          () => setActive((current) => selectActive(current, {
            mode: 'point',
            rowId: rowIdentity(row),
            series: position,
            source: 'keyboard',
          })),
        );
        pointMarks.push(
          <g key={`scatter-${position}-${row.index}`}>
            <circle
              className={`local-visual-hit${selected ? ' is-selected' : ''}`}
              data-rmd-part="hit"
              cx={x}
              cy={yOf(value)}
              r={15}
              fill="transparent"
              data-series={position}
              {...mark}
            />
            <ChartMotionCircle
              className={`local-visual-point${selected ? ' is-selected' : ''}`}
              data-rmd-part="point"
              cx={x}
              cy={yOf(value)}
              r={
                activeInfo
                && active?.mode === 'point'
                && active.rowId === rowIdentity(row)
                && active.series === position
                  ? 7
                  : 5.5
              }
              data-series={position}
              style={{
                fill: seriesColor(position),
                stroke: SURFACE_STROKE,
                strokeWidth: POINT_STROKE_WIDTH,
                opacity: dimmed(position),
              }}
              pointerEvents="none"
            />
          </g>,
        );
      }
    }
  }

  const tooltip = activeInfo
    ? renderTooltip(
        activeInfo.title,
        activeInfo.lines,
        activeInfo.foot,
        activeInfo.anchorX,
        activeInfo.anchorY,
      )
    : null;

  const guide: ReactNode = activeInfo ? (
    <g aria-hidden="true" pointerEvents="none">
      <line
        className="rmd-chart-guide local-visual-guide"
        x1={activeInfo.guideX}
        x2={activeInfo.guideX}
        y1={plotTop}
        y2={plotBottom}
      />
      {activeInfo.guideY !== null ? (
        <line
          className="rmd-chart-guide local-visual-guide"
          x1={plotLeft}
          x2={plotRight}
          y1={activeInfo.guideY}
          y2={activeInfo.guideY}
        />
      ) : null}
      {(kind === 'line' || kind === 'area') && active && active.mode === 'column' && activeRow
        ? visibleSeries.map((position) => {
            const value = valueOf(activeRow, position);
            if (value === null) return null;
            const x = xOfRow(activeRow);
            if (x === null) return null;
            return (
              <circle
                key={`guide-${position}`}
                cx={x}
                cy={yOf(value)}
                r={4.5}
                fill={seriesColor(position)}
                stroke={SURFACE_STROKE}
                strokeWidth={2}
              />
            );
          })
        : null}
    </g>
  ) : null;

  const idleReadout = kind === 'bar'
    ? t('Hover or focus a single bar to read it; arrow keys move between bars.', '悬浮或聚焦单根柱读取该数据；方向键切换柱。')
    : kind === 'scatter'
      ? t('Point at the nearest dot or use arrow keys to read values.', '指向最近的数据点或用方向键读数。')
      : t('Move anywhere in the plot to read every series at the nearest x; use arrow keys to move between marks.', '在绘图区移动读取最近横坐标处各系列数值；方向键切换标记。');
  const ariaLabel = t(
    `${title}, ${KIND_LABELS[kind][0]}, ${rows.length} items, ${visibleSeries.length} series`,
    `${title}，${KIND_LABELS[kind][1]}，共 ${rows.length} 项，${visibleSeries.length} 个系列`,
  );

  const stage = (
    <>
      <svg
        className="rmd-chart-svg"
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={ariaLabel}
        aria-describedby={readoutId}
        style={{ display: 'block', width: '100%', touchAction: 'pan-y' }}
        onPointerMove={
          kind === 'line' || kind === 'area' || kind === 'scatter' ? stagePointerMove : undefined
        }
        onPointerLeave={
          kind === 'line' || kind === 'area' || kind === 'scatter' ? stagePointerLeave : undefined
        }
      >
        <g aria-hidden="true">
          {yGrid}
          {yDomain.min < 0 && yDomain.max > 0 ? (
            <line
              className="rmd-chart-grid"
              x1={plotLeft}
              x2={plotRight}
              y1={zeroY}
              y2={zeroY}
              style={{ stroke: GUIDE_STROKE, strokeWidth: 1 }}
            />
          ) : null}
          <line
            x1={plotLeft}
            x2={plotRight}
            y1={plotBottom}
            y2={plotBottom}
            style={{ stroke: GUIDE_STROKE, strokeWidth: 1 }}
          />
          {xTicks.map((tick) => (
            <g key={tick.key}>
              <line
                x1={tick.x}
                x2={tick.x}
                y1={plotBottom}
                y2={plotBottom + 5}
                style={{ stroke: GUIDE_STROKE, strokeWidth: 1 }}
              />
              <text
                className="rmd-chart-axis-label"
                x={tick.x}
                y={plotBottom + 19}
                textAnchor="middle"
                style={{ fill: AXIS_FILL }}
              >
                {tick.label}
                {tick.full !== tick.label ? <title>{tick.full}</title> : null}
              </text>
            </g>
          ))}
          {xLabel ? (
            <text
              className="rmd-chart-axis-title"
              x={(plotLeft + plotRight) / 2}
              y={height - 3}
              textAnchor="middle"
              style={{ fill: AXIS_TITLE_FILL }}
            >
              {truncate(xLabel, Math.max(8, Math.floor((plotRight - plotLeft) / 12)))}
              <title>{xLabel}</title>
            </text>
          ) : null}
          {yLabel ? (
            <text
              className="rmd-chart-axis-title"
              transform={`translate(12 ${(plotTop + plotBottom) / 2}) rotate(-90)`}
              textAnchor="middle"
              style={{ fill: AXIS_TITLE_FILL }}
            >
              {truncate(yLabel, Math.max(8, Math.floor(plotHeight / 12)))}
              <title>{yLabel}</title>
            </text>
          ) : null}
        </g>
        {areaMarks}
        {lineMarks}
        {guide}
        {barMarks}
        {pointMarks}
      </svg>
      {tooltip}
    </>
  );

  return renderShell(stage, null, activeInfo?.readout || idleReadout);
}
