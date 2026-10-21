import {
  useCallback,
  useId,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import type { DocumentNode, Json } from '../core/types';
import type { ComponentProps } from './components';
import { evalNumber, evalString, evaluateSource, labelOf, useViewer } from './context';

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const SERIES_COLORS = [
  '#2563eb',
  '#e11d48',
  '#0d9488',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#65a30d',
  '#db2777',
];

const NUMBER_FORMAT = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 });

function formatNumber(value: number): string {
  return NUMBER_FORMAT.format(value);
}

function formatAxisNumber(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1e12 || (magnitude > 0 && magnitude < 0.001)) return value.toExponential(2);
  return formatNumber(value);
}

function axisLeft(ticks: number[], hasTitle: boolean): number {
  return Math.max(58, ...ticks.map(tick => formatAxisNumber(tick).length * 10 + (hasTitle ? 38 : 16)));
}

function isJsonObject(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOf(value: Json | undefined, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return fallback;
}

function finiteNumber(value: Json | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

function wrapLabel(text: string, maxChars = 10, maxLines = 2): string[] {
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

function evalArray(
  runtime: ReturnType<typeof useViewer>['runtime'],
  node: DocumentNode,
  name: string,
  fallback: Json[] | null,
): { ok: true; value: Json[] } | { ok: false; message: string } {
  const source = node.props?.[name];
  if (!source) {
    return fallback === null
      ? { ok: false, message: `缺少 ${name} 属性` }
      : { ok: true, value: fallback };
  }
  const result = evaluateSource(runtime, source);
  if (!result.ok) return { ok: false, message: `${name} 求值失败：${result.message}` };
  if (!Array.isArray(result.value)) {
    return { ok: false, message: `${name} 必须是 JSON 数组` };
  }
  return { ok: true, value: result.value };
}

interface SelectEvent {
  item: Json;
  index: number;
  series: string;
  value: number;
}

function useSelectDispatch(node: DocumentNode) {
  const { runtime, report } = useViewer();
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    (event: SelectEvent) => {
      const action = node.events?.select;
      if (!action) return;
      setError(null);
      void runtime
        .dispatchAsync(action, { event: event as unknown as Json })
        .then((result) => {
          if (result.ok) return;
          const message =
            result.diagnostics.map((diagnostic) => diagnostic.message).join('；') ||
            '选择动作未生效';
          setError(message);
          report(result.diagnostics);
        })
        .catch((reason: unknown) => {
          setError(reason instanceof Error ? reason.message : String(reason));
        });
    },
    [node.events, report, runtime],
  );

  return { run, error };
}

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
    <figure className={`visual-figure ${className}`} aria-labelledby={titleId}>
      <figcaption id={titleId} className="visual-title">
        {label}
      </figcaption>
      {children}
    </figure>
  );
}

function VisualError({ message }: { message: string }) {
  return (
    <p className="visual-error" role="alert">
      {message}
    </p>
  );
}

function VisualEmpty({ message }: { message: string }) {
  return (
    <p className="visual-empty" role="status">
      {message}
    </p>
  );
}

function Notes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <p className="visual-note" role="status">
      {notes.join('；')}
    </p>
  );
}

interface TableData {
  head: string[];
  rows: string[][];
}

function DataTable({ caption, table }: { caption: string; table: TableData }) {
  return (
    <details className="visual-details">
      <summary>查看数据表</summary>
      <div className="visual-table-scroll">
        <table className="visual-table">
          <caption>{caption}</caption>
          <thead>
            <tr>
              {table.head.map((cell, index) => (
                <th key={`${cell}-${index}`} scope="col">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Nice tick positions that stay inside [min, max]. */
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

function handleKeyActivation(event: { key: string; preventDefault: () => void }, action: () => void) {
  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault();
    action();
  }
}

/* ------------------------------------------------------------------ */
/* Chart                                                               */
/* ------------------------------------------------------------------ */

type ChartKind = 'bar' | 'line' | 'area' | 'scatter' | 'donut';

const CHART_KINDS: ChartKind[] = ['bar', 'line', 'area', 'scatter', 'donut'];

interface ChartRow {
  label: string;
  item: Json;
  index: number;
  values: (number | null)[];
}

interface ActivePoint {
  key: string;
  label: string;
  series: string;
  value: number;
  item: Json;
  index: number;
  x: number;
  y: number;
}

interface ChartModel {
  rows: ChartRow[];
  series: string[];
  invalidValues: number;
  skipped: number;
  missingLabels: number;
  duplicateSeries: boolean;
}

function buildChartModel(data: Json[], xKey: string, yKeys: string[]): ChartModel {
  const rows: ChartRow[] = [];
  let invalidValues = 0;
  let skipped = 0;
  let missingLabels = 0;

  data.forEach((item, index) => {
    if (!isJsonObject(item)) {
      skipped += 1;
      return;
    }
    const rawLabel = item[xKey];
    let label = '';
    if (typeof rawLabel === 'string') label = rawLabel;
    else if (typeof rawLabel === 'number' && Number.isFinite(rawLabel)) label = String(rawLabel);
    else if (typeof rawLabel === 'boolean') label = String(rawLabel);
    if (!label) {
      label = `第 ${index + 1} 项`;
      missingLabels += 1;
    }

    const values = yKeys.map((key) => {
      const raw = item[key];
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
      invalidValues += 1;
      return null;
    });
    rows.push({ label, item, index, values });
  });

  return {
    rows,
    series: yKeys,
    invalidValues,
    skipped,
    missingLabels,
    duplicateSeries: false,
  };
}

function DonutCenter({ total, label }: { total: number; label: string }) {
  return (
    <g aria-hidden="true" className="visual-donut-center">
      <text x="0" y="-2" textAnchor="middle" className="visual-donut-total">
        {formatNumber(total)}
      </text>
      <text x="0" y="18" textAnchor="middle" className="visual-donut-caption">
        {truncate(label, 14)}
      </text>
    </g>
  );
}

function donutPath(cx: number, cy: number, outer: number, inner: number, start: number, end: number): string {
  const point = (radius: number, angle: number) => {
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)] as const;
  };
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

const CHART_WIDTH = 640;
const CHART_HEIGHT = 360;

function ChartView({ node }: ComponentProps) {
  const { runtime } = useViewer();
  const label = labelOf(runtime, node, '图表');
  const kindSource = evalString(runtime, node, 'kind', 'bar').trim().toLowerCase();
  const kindFallback = !(CHART_KINDS as string[]).includes(kindSource);
  const kind: ChartKind = kindFallback ? 'bar' : (kindSource as ChartKind);
  const xKey = evalString(runtime, node, 'x', 'label').trim() || 'label';
  const yRaw = evalString(runtime, node, 'y', 'value');
  const xLabel = evalString(runtime, node, 'x-label', '');
  const yLabel = evalString(runtime, node, 'y-label', '');
  const { run: dispatchSelect, error: dispatchError } = useSelectDispatch(node);

  const [hiddenSeries, setHiddenSeries] = useState<Set<number>>(new Set());
  const [hiddenSlices, setHiddenSlices] = useState<Set<number>>(new Set());
  const [active, setActive] = useState<ActivePoint | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const readoutId = useId();

  const yParts = yRaw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const yKeys: string[] = [];
  for (const key of yParts) {
    if (!yKeys.includes(key)) yKeys.push(key);
  }
  const duplicateSeries = yKeys.length !== yParts.length;

  const dataResult = evalArray(runtime, node, 'data', null);

  const model = useMemo<ChartModel | null>(() => {
    if (!dataResult.ok) return null;
    if (yKeys.length === 0) return null;
    const built = buildChartModel(dataResult.value, xKey, yKeys);
    built.duplicateSeries = duplicateSeries;
    return built;
  }, [dataResult, duplicateSeries, xKey, yKeys]);

  if (!dataResult.ok) {
    return (
      <VisualFrame className="visual-chart" label={label}>
        <VisualError message={dataResult.message} />
      </VisualFrame>
    );
  }
  if (yKeys.length === 0) {
    return (
      <VisualFrame className="visual-chart" label={label}>
        <VisualError message="chart 缺少 y 系列字段（默认 value，可用逗号分隔多个字段）" />
      </VisualFrame>
    );
  }
  if (!model) {
    return (
      <VisualFrame className="visual-chart" label={label}>
        <VisualEmpty message="暂无数据" />
      </VisualFrame>
    );
  }

  const notes: string[] = [];
  if (kindFallback) notes.push(`未知 kind“${kindSource}”，按 bar 绘制`);
  if (model.skipped > 0) notes.push(`忽略 ${model.skipped} 行非对象数据`);
  if (model.invalidValues > 0) notes.push(`${model.invalidValues} 个非数值或缺失值按空缺处理`);
  if (model.missingLabels > 0) notes.push(`${model.missingLabels} 行缺少 ${xKey}，使用序号作为标签`);
  if (duplicateSeries) notes.push('y 中存在重复系列名，已忽略重复项');

  if (model.rows.length === 0) {
    return (
      <VisualFrame className="visual-chart" label={label}>
        <VisualEmpty message="没有可绘制的数据行" />
        <Notes notes={notes} />
      </VisualFrame>
    );
  }

  const toggleSeries = (index: number) => {
    setHiddenSeries((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };
  const toggleSlice = (index: number) => {
    setHiddenSlices((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const describe = (point: ActivePoint) => {
    setActive(point);
  };

  const selectPoint = (point: ActivePoint) => {
    setSelected(point.key);
    dispatchSelect({
      item: point.item,
      index: point.index,
      series: point.series,
      value: point.value,
    });
  };

  const trigger = (point: ActivePoint) => {
    setActive(point);
    selectPoint(point);
  };

  const readout = active
    ? `${active.series} · ${active.label}：${formatNumber(active.value)}`
    : kind === 'donut'
      ? '聚焦扇区或图例查看数值'
      : '聚焦或指向图形查看精确数值';

  const allValues: number[] = [];
  for (const row of model.rows) {
    for (const value of row.values) {
      if (value !== null) allValues.push(value);
    }
  }

  if (allValues.length === 0) {
    return (
      <VisualFrame className="visual-chart" label={label}>
        <VisualEmpty message="没有可绘制的有限数值" />
        <Notes notes={notes} />
      </VisualFrame>
    );
  }

  const ariaLabel = `${label}，${kind} 图，共 ${model.rows.length} 项，${yKeys.length} 个系列`;

  if (kind === 'donut') {
    const seriesIndex = 0;
    const seriesName = yKeys[0];
    let negative = 0;
    let zeros = 0;
    const positive = model.rows.map((row) => {
      const value = row.values[seriesIndex] ?? 0;
      if (value < 0) {
        negative += 1;
        return 0;
      }
      if (value === 0) zeros += 1;
      return value;
    });
    const visibleTotal = model.rows.reduce((sum, _row, index) => {
      return hiddenSlices.has(index) ? sum : sum + positive[index];
    }, 0);
    if (negative > 0) notes.push(`环形图忽略 ${negative} 个负值`);
    if (zeros > 0) notes.push(`${zeros} 个 0 值不占扇区`);
    if (yKeys.length > 1) notes.push(`环形图只使用第一个系列 ${seriesName}`);

    if (visibleTotal <= 0) {
      return (
        <VisualFrame className="visual-chart visual-chart-donut" label={label}>
          <VisualEmpty
            message={
              hiddenSlices.size > 0 && model.rows.length > 0
                ? '所有扇区已被隐藏，或总数为 0'
                : '环形图总数为 0，没有可绘制的扇区'
            }
          />
          <Notes notes={notes} />
          <DonutLegend
            rows={model.rows}
            positive={positive}
            hidden={hiddenSlices}
            onToggle={toggleSlice}
          />
          <DataTable
            caption={`${label} 数据`}
            table={{
              head: [xKey, seriesName],
              rows: model.rows.map((row) => [
                row.label,
                row.values[seriesIndex] === null ? '—' : formatNumber(row.values[seriesIndex] as number),
              ]),
            }}
          />
        </VisualFrame>
      );
    }

    const cx = CHART_WIDTH / 2;
    const cy = 158;
    const outer = 118;
    const inner = 70;
    let angle = -Math.PI / 2;
    const slices: {
      key: string;
      row: ChartRow;
      value: number;
      start: number;
      end: number;
      color: string;
    }[] = [];

    model.rows.forEach((row, index) => {
      if (hiddenSlices.has(index)) return;
      const value = positive[index];
      if (value <= 0) return;
      const sweep = (value / visibleTotal) * Math.PI * 2;
      const start = angle;
      const end = angle + sweep;
      angle = end;
      slices.push({
        key: `donut:${index}`,
        row,
        value,
        start,
        end,
        color: SERIES_COLORS[index % SERIES_COLORS.length],
      });
    });

    return (
      <VisualFrame className="visual-chart visual-chart-donut" label={label}>
        <div className="visual-readout" id={readoutId} aria-live="polite">
          {readout}
        </div>
        <div className="visual-svg-wrap">
          <svg
            className="visual-svg"
            viewBox={`0 0 ${CHART_WIDTH} 320`}
            role="group"
            aria-label={ariaLabel}
            aria-describedby={readoutId}
          >
            <g transform={`translate(${cx} ${cy})`}>
              <DonutCenter total={visibleTotal} label={seriesName} />
            </g>
            {slices.map((slice) => {
              const point: ActivePoint = {
                key: slice.key,
                label: slice.row.label,
                series: seriesName,
                value: slice.value,
                item: slice.row.item,
                index: slice.row.index,
                x: cx,
                y: cy,
              };
              const isSelected = selected === point.key;
              if (slice.end - slice.start >= Math.PI * 2 - 1e-6) {
                return (
                  <circle
                    key={slice.key}
                    className={`visual-donut-slice${isSelected ? ' is-selected' : ''}`}
                    cx={cx}
                    cy={cy}
                    r={(outer + inner) / 2}
                    fill="none"
                    stroke={slice.color}
                    strokeWidth={outer - inner}
                    tabIndex={0}
                    role="button"
                    aria-label={`${slice.row.label}：${formatNumber(slice.value)}`}
                    aria-pressed={isSelected}
                    onClick={() => trigger(point)}
                    onKeyDown={(event) => handleKeyActivation(event, () => trigger(point))}
                    onFocus={() => describe(point)}
                    onBlur={() => setActive(null)}
                    onPointerEnter={() => describe(point)}
                    onPointerLeave={() => setActive(null)}
                  >
                    <title>{`${slice.row.label}：${formatNumber(slice.value)}`}</title>
                  </circle>
                );
              }
              return (
                <path
                  key={slice.key}
                  className={`visual-donut-slice${isSelected ? ' is-selected' : ''}`}
                  d={donutPath(cx, cy, outer, inner, slice.start, slice.end)}
                  fill={slice.color}
                  tabIndex={0}
                  role="button"
                  aria-label={`${slice.row.label}：${formatNumber(slice.value)}`}
                  aria-pressed={isSelected}
                  onClick={() => trigger(point)}
                  onKeyDown={(event) => handleKeyActivation(event, () => trigger(point))}
                  onFocus={() => describe(point)}
                  onBlur={() => setActive(null)}
                  onPointerEnter={() => describe(point)}
                  onPointerLeave={() => setActive(null)}
                >
                  <title>{`${slice.row.label}：${formatNumber(slice.value)}`}</title>
                </path>
              );
            })}
          </svg>
        </div>
        <DonutLegend
          rows={model.rows}
          positive={positive}
          hidden={hiddenSlices}
          onToggle={toggleSlice}
        />
        {dispatchError ? <VisualError message={dispatchError} /> : null}
        <Notes notes={notes} />
        <DataTable
          caption={`${label} 数据`}
          table={{
            head: [xKey, seriesName],
            rows: model.rows.map((row) => [
              row.label,
              row.values[seriesIndex] === null ? '—' : formatNumber(row.values[seriesIndex] as number),
            ]),
          }}
        />
      </VisualFrame>
    );
  }

  /* Cartesian charts: bar / line / area / scatter */

  const visibleSeries = yKeys
    .map((key, index) => ({ key, index }))
    .filter((entry) => !hiddenSeries.has(entry.index));

  if (visibleSeries.length === 0) {
    return (
      <VisualFrame className="visual-chart" label={label}>
        <VisualEmpty message="所有系列已在图例中关闭" />
        <SeriesLegend
          series={yKeys}
          hidden={hiddenSeries}
          onToggle={toggleSeries}
        />
        <Notes notes={notes} />
      </VisualFrame>
    );
  }

  const includeZero = kind === 'bar' || kind === 'area';
  const yDomain = chartDomain(allValues, includeZero);
  const yTicks = niceTicks(yDomain.min, yDomain.max, 5);
  const plotLeft = axisLeft(yTicks, !!yLabel);
  const plotRight = CHART_WIDTH - 52;
  const plotTop = 18;
  const plotBottom = CHART_HEIGHT - 58;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;
  const yOf = (value: number) => {
    return plotTop + ((yDomain.max - value) / (yDomain.max - yDomain.min)) * plotHeight;
  };
  const zeroY = yOf(0);

  const numericX: (number | null)[] = kind === 'scatter'
    ? model.rows.map((row) => finiteNumber(isJsonObject(row.item) ? row.item[xKey] : undefined))
    : [];
  const useNumericX =
    kind === 'scatter' && numericX.length > 0 && numericX.every((value) => value !== null);
  const numericValues = numericX.filter((value): value is number => value !== null);
  const xDomain = useNumericX ? chartDomain(numericValues, false) : null;
  const bandWidth = plotWidth / Math.max(1, model.rows.length);
  const categoryX = (index: number) => plotLeft + bandWidth * (index + 0.5);
  const xOf = (rowIndex: number) => {
    if (xDomain) return plotLeft + ((numericValues[rowIndex] - xDomain.min) / (xDomain.max - xDomain.min)) * plotWidth;
    return categoryX(rowIndex);
  };

  const xTicks: number[] = [];
  if (xDomain) {
    xTicks.push(...niceTicks(xDomain.min, xDomain.max, 5));
  } else {
    const maxTicks = 6;
    const step = Math.max(1, Math.ceil(model.rows.length / maxTicks));
    for (let index = 0; index < model.rows.length; index += step) xTicks.push(index);
    const lastIndex = model.rows.length - 1;
    if (xTicks[xTicks.length - 1] !== lastIndex) {
      if (xTicks.length > 1 && lastIndex - xTicks[xTicks.length - 1] < step * 0.6) {
        xTicks[xTicks.length - 1] = lastIndex;
      } else {
        xTicks.push(lastIndex);
      }
    }
  }

  const groupWidth = bandWidth * 0.78;
  const barWidth = Math.max(1, groupWidth / Math.max(1, visibleSeries.length));

  const makePoint = (
    row: ChartRow,
    seriesIndex: number,
    value: number,
    x: number,
    y: number,
  ): ActivePoint => ({
    key: `${seriesIndex}:${row.index}`,
    label: row.label,
    series: yKeys[seriesIndex],
    value,
    item: row.item,
    index: row.index,
    x,
    y,
  });

  const renderMark = (
    key: string,
    point: ActivePoint,
    shape: ReactNode,
    ariaText: string,
  ) => {
    const isSelected = selected === point.key;
    return (
      <g
        key={key}
        className={`visual-mark-group${isSelected ? ' is-selected' : ''}`}
        onPointerEnter={() => describe(point)}
        onPointerLeave={() => setActive(null)}
      >
        {shape}
        <title>{ariaText}</title>
      </g>
    );
  };

  const markHandlers = (point: ActivePoint) => ({
    tabIndex: 0,
    role: 'button' as const,
    'aria-label': `${point.series}，${point.label}：${formatNumber(point.value)}`,
    'aria-pressed': selected === point.key,
    onClick: () => trigger(point),
    onKeyDown: (event: { key: string; preventDefault: () => void }) =>
      handleKeyActivation(event, () => trigger(point)),
    onFocus: () => describe(point),
    onBlur: () => setActive(null),
  });

  const linePaths: ReactNode[] = [];
  const areaPaths: ReactNode[] = [];
  const pointMarks: ReactNode[] = [];

  if (kind === 'line' || kind === 'area') {
    for (const entry of visibleSeries) {
      const segments: { row: ChartRow; value: number; x: number; y: number }[][] = [];
      let current: { row: ChartRow; value: number; x: number; y: number }[] = [];
      const flush = () => {
        if (current.length > 0) segments.push(current);
        current = [];
      };

      model.rows.forEach((row, rowIndex) => {
        const value = row.values[entry.index];
        if (value === null) {
          flush();
          return;
        }
        const x = xOf(rowIndex);
        const y = yOf(value);
        current.push({ row, value, x, y });
      });
      flush();

      for (const segment of segments) {
        if (segment.length >= 2) {
          const d = segment
            .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
            .join(' ');
          linePaths.push(
            <path
              key={`line-${entry.index}-${segment[0].row.index}`}
              className="visual-line"
              d={d}
              fill="none"
              stroke={SERIES_COLORS[entry.index % SERIES_COLORS.length]}
              strokeWidth={2.4}
              strokeLinejoin="round"
              strokeLinecap="round"
            />,
          );
          if (kind === 'area') {
            const base = yOf(Math.max(yDomain.min, Math.min(yDomain.max, 0)));
            const first = segment[0];
            const last = segment[segment.length - 1];
            const area = `M ${first.x} ${base} ${segment
              .map((point) => `L ${point.x} ${point.y}`)
              .join(' ')} L ${last.x} ${base} Z`;
            areaPaths.push(
              <path
                key={`area-${entry.index}-${first.row.index}`}
                className="visual-area"
                d={area}
                fill={SERIES_COLORS[entry.index % SERIES_COLORS.length]}
              />,
            );
          }
        }
        for (const point of segment) {
          const activePoint = makePoint(point.row, entry.index, point.value, point.x, point.y);
          pointMarks.push(
            renderMark(
              `point-${entry.index}-${point.row.index}`,
              activePoint,
              <g>
                <circle
                  className="visual-hit"
                  cx={point.x}
                  cy={point.y}
                  r={15}
                  fill="transparent"
                  {...markHandlers(activePoint)}
                />
                <circle
                  className="visual-point"
                  cx={point.x}
                  cy={point.y}
                  r={4.5}
                  fill={SERIES_COLORS[entry.index % SERIES_COLORS.length]}
                  stroke="var(--surface, #ffffff)"
                  strokeWidth={1.5}
                  pointerEvents="none"
                />
              </g>,
              `${activePoint.series}，${activePoint.label}：${formatNumber(activePoint.value)}`,
            ),
          );
        }
      }
    }
  }

  const barMarks: ReactNode[] = [];
  if (kind === 'bar') {
    model.rows.forEach((row, rowIndex) => {
      visibleSeries.forEach((entry, visibleIndex) => {
        const value = row.values[entry.index];
        if (value === null) return;
        const x =
          plotLeft +
          bandWidth * rowIndex +
          (bandWidth - groupWidth) / 2 +
          visibleIndex * barWidth;
        const height = Math.max(1, Math.abs(yOf(value) - zeroY));
        const y = value >= 0 ? zeroY - height : zeroY;
        const point = makePoint(row, entry.index, value, x + barWidth / 2, y + height / 2);
        barMarks.push(
          renderMark(
            `bar-${entry.index}-${row.index}`,
            point,
            <rect
              className="visual-bar"
              x={x}
              y={y}
              width={Math.max(1.5, barWidth - 1)}
              height={height}
              rx={2}
              fill={SERIES_COLORS[entry.index % SERIES_COLORS.length]}
              {...markHandlers(point)}
            />,
            `${point.series}，${point.label}：${formatNumber(point.value)}`,
          ),
        );
      });
    });
  }

  const scatterMarks: ReactNode[] = [];
  if (kind === 'scatter') {
    model.rows.forEach((row, rowIndex) => {
      visibleSeries.forEach((entry) => {
        const value = row.values[entry.index];
        if (value === null) return;
        const x = xOf(rowIndex);
        const y = yOf(value);
        const point = makePoint(row, entry.index, value, x, y);
        scatterMarks.push(
          renderMark(
            `scatter-${entry.index}-${row.index}`,
            point,
            <g>
              <circle
                className="visual-hit"
                cx={x}
                cy={y}
                r={18}
                fill="transparent"
                {...markHandlers(point)}
              />
              <circle
                className="visual-point"
                cx={x}
                cy={y}
                r={6}
                fill={SERIES_COLORS[entry.index % SERIES_COLORS.length]}
                stroke="var(--surface, #ffffff)"
                strokeWidth={1.5}
                pointerEvents="none"
              />
            </g>,
            `${point.series}，${point.label}：${formatNumber(point.value)}`,
          ),
        );
      });
    });
  }

  const activeGuide = active ? (
    <line
      className="visual-guide"
      x1={Math.max(plotLeft, Math.min(plotRight, active.x))}
      x2={Math.max(plotLeft, Math.min(plotRight, active.x))}
      y1={plotTop}
      y2={plotBottom}
    />
  ) : null;

  return (
    <VisualFrame className={`visual-chart visual-chart-${kind}`} label={label}>
      <div className="visual-readout" id={readoutId} aria-live="polite">
        {readout}
      </div>
      <div className="visual-svg-wrap">
        <svg
          className="visual-svg"
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          role="group"
          aria-label={ariaLabel}
          aria-describedby={readoutId}
        >
          {yTicks.map((tick) => (
            <g key={`y-${tick}`}>
              <line
                className="visual-grid-line"
                x1={plotLeft}
                x2={plotRight}
                y1={yOf(tick)}
                y2={yOf(tick)}
              />
              <text
                className="visual-axis-label"
                x={plotLeft - 8}
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
              className="visual-zero-line"
              x1={plotLeft}
              x2={plotRight}
              y1={zeroY}
              y2={zeroY}
            />
          ) : null}
          <line
            className="visual-axis-line"
            x1={plotLeft}
            x2={plotRight}
            y1={plotBottom}
            y2={plotBottom}
          />
          {xDomain ? (
            xTicks.map((tick) => {
              const x = plotLeft + ((tick - xDomain.min) / (xDomain.max - xDomain.min)) * plotWidth;
              return (
                <g key={`x-${tick}`}>
                  <line className="visual-tick" x1={x} x2={x} y1={plotBottom} y2={plotBottom + 5} />
                  <text
                    className="visual-axis-label"
                    x={x}
                    y={plotBottom + 20}
                    textAnchor="middle"
                  >
                    {formatAxisNumber(tick)}
                  </text>
                </g>
              );
            })
          ) : (
            xTicks.map((index) => {
              const row = model.rows[index];
              const x = categoryX(index);
              return (
                <g key={`x-${index}`}>
                  <line className="visual-tick" x1={x} x2={x} y1={plotBottom} y2={plotBottom + 5} />
                  <text
                    className="visual-axis-label"
                    x={x}
                    y={plotBottom + 20}
                    textAnchor="middle"
                  >
                    {truncate(row.label, 10)}
                    <title>{row.label}</title>
                  </text>
                </g>
              );
            })
          )}
          {xLabel ? (
            <text
              className="visual-axis-title"
              x={(plotLeft + plotRight) / 2}
              y={CHART_HEIGHT - 4}
              textAnchor="middle"
            >
              {xLabel}
            </text>
          ) : null}
          {yLabel ? (
            <text
              className="visual-axis-title"
              transform={`translate(14 ${(plotTop + plotBottom) / 2}) rotate(-90)`}
              textAnchor="middle"
            >
              {yLabel}
            </text>
          ) : null}
          {areaPaths}
          {linePaths}
          {activeGuide}
          {barMarks}
          {scatterMarks}
          {pointMarks}
        </svg>
      </div>
      <SeriesLegend series={yKeys} hidden={hiddenSeries} onToggle={toggleSeries} />
      {dispatchError ? <VisualError message={dispatchError} /> : null}
      <Notes notes={notes} />
      <DataTable
        caption={`${label} 数据`}
        table={{
          head: [xKey, ...yKeys],
          rows: model.rows.map((row) => [
            row.label,
            ...row.values.map((value) => (value === null ? '—' : formatNumber(value))),
          ]),
        }}
      />
    </VisualFrame>
  );
}

function SeriesLegend({
  series,
  hidden,
  onToggle,
}: {
  series: string[];
  hidden: Set<number>;
  onToggle: (index: number) => void;
}) {
  return (
    <div className="visual-legend" role="group" aria-label="图例，可开关系列">
      {series.map((name, index) => {
        const off = hidden.has(index);
        return (
          <button
            key={`${name}-${index}`}
            type="button"
            className={`visual-legend-button${off ? ' is-off' : ''}`}
            aria-pressed={!off}
            onClick={() => onToggle(index)}
            title={off ? `显示系列 ${name}` : `隐藏系列 ${name}`}
          >
            <span
              className="visual-swatch"
              style={{ backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] }}
              aria-hidden="true"
            />
            <span className="visual-legend-text">{name}</span>
          </button>
        );
      })}
    </div>
  );
}

function DonutLegend({
  rows,
  positive,
  hidden,
  onToggle,
}: {
  rows: ChartRow[];
  positive: number[];
  hidden: Set<number>;
  onToggle: (index: number) => void;
}) {
  return (
    <div className="visual-legend" role="group" aria-label="图例，可开关扇区">
      {rows.map((row, index) => {
        const value = row.values[0];
        const off = hidden.has(index) || positive[index] <= 0;
        return (
          <button
            key={`slice-${row.index}`}
            type="button"
            className={`visual-legend-button${off ? ' is-off' : ''}`}
            aria-pressed={!hidden.has(index) && positive[index] > 0}
            disabled={positive[index] <= 0}
            onClick={() => onToggle(index)}
            title={row.label}
          >
            <span
              className="visual-swatch"
              style={{ backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] }}
              aria-hidden="true"
            />
            <span className="visual-legend-text">
              {row.label}
              {value !== null ? `（${formatNumber(value)}）` : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Plot                                                                */
/* ------------------------------------------------------------------ */

interface PlotSample {
  x: number;
  y: number | null;
  error: string | null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function PlotView({ node }: ComponentProps) {
  const { runtime } = useViewer();
  const label = labelOf(runtime, node, '函数图');
  const formula = evalString(runtime, node, 'formula', '').trim();
  const min = evalNumber(runtime, node, 'min', 0);
  const max = evalNumber(runtime, node, 'max', 10);
  const rawSamples = evalNumber(runtime, node, 'samples', 60);
  const xLabel = evalString(runtime, node, 'x-label', '');
  const yLabel = evalString(runtime, node, 'y-label', '');
  const readoutId = useId();

  if (!formula) {
    return (
      <VisualFrame className="visual-plot" label={label}>
        <VisualError message="plot 缺少 formula 属性" />
      </VisualFrame>
    );
  }
  if (formula.startsWith('=')) {
    return (
      <VisualFrame className="visual-plot" label={label}>
        <VisualError message="formula 是不带等号的表达式，例如 sin(x) + 1" />
      </VisualFrame>
    );
  }
  if (!(max > min)) {
    return (
      <VisualFrame className="visual-plot" label={label}>
        <VisualError message="plot 的 max 必须大于 min" />
      </VisualFrame>
    );
  }

  const notes: string[] = [];
  if (rawSamples > 500) notes.push('samples 已限制为最多 500 个采样点');
  const samples = Math.min(500, Math.max(2, Math.floor(rawSamples)));

  const points: PlotSample[] = [];
  let firstError: string | null = null;
  for (let index = 0; index < samples; index += 1) {
    const x = min + ((max - min) * index) / (samples - 1);
    try {
      const value = runtime.evaluate(
        { kind: 'expression', expression: formula },
        { x },
      );
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        points.push({ x, y: null, error: '结果不是有限数字' });
        if (!firstError) firstError = `x = ${formatNumber(x)} 时结果不是有限数字`;
      } else {
        points.push({ x, y: value, error: null });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      points.push({ x, y: null, error: message });
      if (!firstError) firstError = `x = ${formatNumber(x)}：${message}`;
    }
  }

  const finite = points.filter((point): point is PlotSample & { y: number } => point.y !== null);
  const errors = points.length - finite.length;
  if (finite.length === 0) {
    return (
      <VisualFrame className="visual-plot" label={label}>
        <VisualError
          message={`所有采样点都无法求出有限值${firstError ? `：${firstError}` : ''}`}
        />
        <Notes notes={notes} />
        <DataTable
          caption={`${label} 采样数据`}
          table={{
            head: ['x', 'f(x)'],
            rows: points.map((point) => [
              formatNumber(point.x),
              point.y === null ? '—' : formatNumber(point.y),
            ]),
          }}
        />
      </VisualFrame>
    );
  }
  if (errors > 0) {
    notes.push(`${errors} 个采样点无法求值，折线在空缺处断开`);
    if (firstError) notes.push(firstError);
  }

  const yValues = finite.map((point) => point.y);
  const domain = chartDomain(yValues, false);
  const yTicks = niceTicks(domain.min, domain.max, 5);
  const xTicks = niceTicks(min, max, 5);
  const plotLeft = axisLeft(yTicks, !!yLabel);
  const plotRight = CHART_WIDTH - 52;
  const plotTop = 18;
  const plotBottom = CHART_HEIGHT - 58;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;
  const xOf = (x: number) => plotLeft + ((x - min) / (max - min)) * plotWidth;
  const yOf = (y: number) =>
    plotTop + ((domain.max - y) / (domain.max - domain.min)) * plotHeight;

  const medianAbs = median(finite.map((point) => Math.abs(point.y)));
  const consecutiveDeltas: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous.y !== null && current.y !== null) {
      consecutiveDeltas.push(Math.abs(current.y - previous.y));
    }
  }
  const medianDelta = median(consecutiveDeltas);
  const spanY = domain.max - domain.min;

  const shouldBreak = (
    previous: PlotSample & { y: number },
    current: PlotSample & { y: number },
  ) => {
    const delta = Math.abs(current.y - previous.y);
    // A sign flip far away from the typical magnitude is a sampled asymptote
    // (1/x, tan); drawing a straight bridge across it would invent data.
    const asymptote =
      previous.y * current.y < 0 &&
      Math.min(Math.abs(previous.y), Math.abs(current.y)) > Math.max(1, medianAbs * 8);
    // A jump that covers most of the vertical domain is a discontinuity, not a
    // steep but continuous sample of the same function.
    const jump = delta > spanY * 0.8 && delta > Math.max(medianDelta, 1e-9) * 10;
    return asymptote || jump;
  };

  const segments: (PlotSample & { y: number })[][] = [];
  let segment: (PlotSample & { y: number })[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (point.y === null) {
      if (segment.length > 0) segments.push(segment);
      segment = [];
      continue;
    }
    const current: PlotSample & { y: number } = { x: point.x, y: point.y, error: point.error };
    const previous = segment[segment.length - 1];
    if (previous && shouldBreak(previous, current)) {
      segments.push(segment);
      segment = [];
    }
    segment.push(current);
  }
  if (segment.length > 0) segments.push(segment);

  const ariaLabel = `${label}，函数 ${formula}，区间 ${formatNumber(min)} 到 ${formatNumber(max)}`;
  const intervalText = `采样区间 [${formatNumber(min)}, ${formatNumber(max)}] · ${samples} 个采样点`;

  return (
    <VisualFrame className="visual-plot" label={label}>
      <p className="visual-formula">
        <code>f(x) = {formula}</code>
      </p>
      <p className="visual-readout" id={readoutId}>
        {intervalText}
      </p>
      <div className="visual-svg-wrap">
        <svg
          className="visual-svg"
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          role="group"
          aria-label={ariaLabel}
          aria-describedby={readoutId}
        >
          {yTicks.map((tick) => (
            <g key={`y-${tick}`}>
              <line
                className="visual-grid-line"
                x1={plotLeft}
                x2={plotRight}
                y1={yOf(tick)}
                y2={yOf(tick)}
              />
              <text
                className="visual-axis-label"
                x={plotLeft - 8}
                y={yOf(tick)}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {formatAxisNumber(tick)}
              </text>
            </g>
          ))}
          {domain.min < 0 && domain.max > 0 ? (
            <line
              className="visual-zero-line"
              x1={plotLeft}
              x2={plotRight}
              y1={yOf(0)}
              y2={yOf(0)}
            />
          ) : null}
          <line
            className="visual-axis-line"
            x1={plotLeft}
            x2={plotRight}
            y1={plotBottom}
            y2={plotBottom}
          />
          {xTicks.map((tick) => (
            <g key={`x-${tick}`}>
              <line
                className="visual-tick"
                x1={xOf(tick)}
                x2={xOf(tick)}
                y1={plotBottom}
                y2={plotBottom + 5}
              />
              <text
                className="visual-axis-label"
                x={xOf(tick)}
                y={plotBottom + 20}
                textAnchor="middle"
              >
                {formatAxisNumber(tick)}
              </text>
            </g>
          ))}
          {xLabel ? (
            <text
              className="visual-axis-title"
              x={(plotLeft + plotRight) / 2}
              y={CHART_HEIGHT - 4}
              textAnchor="middle"
            >
              {xLabel}
            </text>
          ) : null}
          {yLabel ? (
            <text
              className="visual-axis-title"
              transform={`translate(14 ${(plotTop + plotBottom) / 2}) rotate(-90)`}
              textAnchor="middle"
            >
              {yLabel}
            </text>
          ) : null}
          {segments.map((item) => {
            if (item.length < 2) {
              const only = item[0];
              return (
                <circle
                  key={`dot-${only.x}`}
                  className="visual-plot-dot"
                  cx={xOf(only.x)}
                  cy={yOf(only.y)}
                  r={2.5}
                />
              );
            }
            const d = item
              .map((point, index) => `${index === 0 ? 'M' : 'L'} ${xOf(point.x)} ${yOf(point.y)}`)
              .join(' ');
            return (
              <path
                key={`segment-${item[0].x}`}
                className="visual-plot-line"
                d={d}
                fill="none"
                stroke="var(--blue, #365cf5)"
                strokeWidth={2.4}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            );
          })}
        </svg>
      </div>
      <Notes notes={notes} />
      <DataTable
        caption={`${label} 采样数据（${intervalText}）`}
        table={{
          head: ['x', 'f(x)'],
          rows: points.map((point) => [
            formatNumber(point.x),
            point.y === null ? '—' : formatNumber(point.y),
          ]),
        }}
      />
    </VisualFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Diagram                                                             */
/* ------------------------------------------------------------------ */

interface DiagramNode {
  id: string;
  label: string;
  description: string;
  x: number | null;
  y: number | null;
}

interface DiagramEdge {
  from: string;
  to: string;
  label: string;
  index: number;
}

interface DiagramModel {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  errors: string[];
}

const DIAGRAM_WIDTH = 640;
const DIAGRAM_HEIGHT = 420;
const NODE_RADIUS = 27;

function buildDiagramModel(rawNodes: Json[], rawEdges: Json[]): DiagramModel {
  const errors: string[] = [];
  const nodes: DiagramNode[] = [];
  const seen = new Set<string>();

  rawNodes.forEach((raw, index) => {
    if (!isJsonObject(raw)) {
      errors.push(`第 ${index + 1} 个节点不是对象`);
      return;
    }
    const id = textOf(raw.id, '').trim();
    if (!id) {
      errors.push(`第 ${index + 1} 个节点缺少有效 id`);
      return;
    }
    if (seen.has(id)) {
      errors.push(`节点 id 重复：${id}`);
      return;
    }
    seen.add(id);
    nodes.push({
      id,
      label: textOf(raw.label, id),
      description: textOf(raw.description, ''),
      x: finiteNumber(raw.x),
      y: finiteNumber(raw.y),
    });
  });

  const edges: DiagramEdge[] = [];
  rawEdges.forEach((raw, index) => {
    if (!isJsonObject(raw)) {
      errors.push(`第 ${index + 1} 条边不是对象`);
      return;
    }
    const from = textOf(raw.from, '').trim();
    const to = textOf(raw.to, '').trim();
    if (!from || !to) {
      errors.push(`第 ${index + 1} 条边缺少 from 或 to`);
      return;
    }
    if (!seen.has(from) || !seen.has(to)) {
      errors.push(`第 ${index + 1} 条边引用了不存在的节点：${from} → ${to}`);
      return;
    }
    edges.push({ from, to, label: textOf(raw.label, ''), index });
  });

  return { nodes, edges, errors };
}

function diagramPositions(nodes: DiagramNode[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const explicit = nodes.every((node) => node.x !== null && node.y !== null);
  const padding = 70;

  if (explicit && nodes.length > 0) {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const node of nodes) {
      minX = Math.min(minX, node.x as number);
      maxX = Math.max(maxX, node.x as number);
      minY = Math.min(minY, node.y as number);
      maxY = Math.max(maxY, node.y as number);
    }
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    for (const node of nodes) {
      const x = spanX === 0
        ? DIAGRAM_WIDTH / 2
        : padding + (((node.x as number) - minX) / spanX) * (DIAGRAM_WIDTH - padding * 2);
      const y = spanY === 0
        ? DIAGRAM_HEIGHT / 2
        : padding + (((node.y as number) - minY) / spanY) * (DIAGRAM_HEIGHT - padding * 2);
      positions.set(node.id, { x, y });
    }
    return positions;
  }

  const count = nodes.length;
  if (count === 0) return positions;
  if (count === 1) {
    positions.set(nodes[0].id, { x: DIAGRAM_WIDTH / 2, y: DIAGRAM_HEIGHT / 2 });
    return positions;
  }
  const radiusX = DIAGRAM_WIDTH / 2 - padding - NODE_RADIUS;
  const radiusY = DIAGRAM_HEIGHT / 2 - padding - NODE_RADIUS;
  nodes.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
    positions.set(node.id, {
      x: DIAGRAM_WIDTH / 2 + Math.cos(angle) * radiusX,
      y: DIAGRAM_HEIGHT / 2 + Math.sin(angle) * radiusY,
    });
  });
  return positions;
}

function edgeGeometry(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x1: number; y1: number; x2: number; y2: number; mx: number; my: number } | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;
  const ux = dx / length;
  const uy = dy / length;
  return {
    x1: from.x + ux * NODE_RADIUS,
    y1: from.y + uy * NODE_RADIUS,
    x2: to.x - ux * (NODE_RADIUS + 8),
    y2: to.y - uy * (NODE_RADIUS + 8),
    mx: (from.x + to.x) / 2,
    my: (from.y + to.y) / 2,
  };
}

function DiagramView({ node }: ComponentProps) {
  const { runtime, snapshot, report } = useViewer();
  const label = labelOf(runtime, node, '关系图');
  const [internalSelected, setInternalSelected] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const markerId = `visual-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const nodesResult = evalArray(runtime, node, 'nodes', null);
  const edgesResult = evalArray(runtime, node, 'edges', []);

  const model = useMemo<DiagramModel | null>(() => {
    if (!nodesResult.ok) return null;
    if (!edgesResult.ok) return null;
    return buildDiagramModel(nodesResult.value, edgesResult.value);
  }, [nodesResult, edgesResult]);

  if (!nodesResult.ok) {
    return (
      <VisualFrame className="visual-diagram" label={label}>
        <VisualError message={nodesResult.message} />
      </VisualFrame>
    );
  }
  if (!edgesResult.ok) {
    return (
      <VisualFrame className="visual-diagram" label={label}>
        <VisualError message={edgesResult.message} />
      </VisualFrame>
    );
  }
  if (!model) {
    return (
      <VisualFrame className="visual-diagram" label={label}>
        <VisualEmpty message="暂无可绘制的节点" />
      </VisualFrame>
    );
  }
  if (model.nodes.length === 0) {
    return (
      <VisualFrame className="visual-diagram" label={label}>
        <VisualEmpty message="没有可绘制的节点" />
        <Notes notes={model.errors} />
      </VisualFrame>
    );
  }

  const bound = node.binding ? snapshot.state[node.binding] : null;
  const selectedId =
    node.binding && typeof bound === 'string' ? bound : internalSelected;
  const selectedNode = model.nodes.find((entry) => entry.id === selectedId) ?? null;
  const positions = diagramPositions(model.nodes);
  const edges: {
    edge: DiagramEdge;
    geometry: { x1: number; y1: number; x2: number; y2: number; mx: number; my: number };
  }[] = [];
  for (const edge of model.edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    const geometry = edgeGeometry(from, to);
    if (!geometry) continue;
    edges.push({ edge, geometry });
  }

  const selectNode = (entry: DiagramNode) => {
    setInternalSelected(entry.id);
    setWriteError(null);
    if (!node.binding) return;
    const result = runtime.writeBinding(node.id, entry.id);
    if (!result.ok) {
      const message = result.diagnostics.map((diagnostic) => diagnostic.message).join('；');
      setWriteError(message || '无法写入选择结果');
      report(result.diagnostics);
    }
  };

  const focusSibling = (event: { key: string; currentTarget: EventTarget; preventDefault: () => void }) => {
    const direction =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (direction === 0) return;
    const current = event.currentTarget as Element;
    const svg = current.closest('svg');
    if (!svg) return;
    const all = Array.from(svg.querySelectorAll<SVGGElement>('[data-visual-node]'));
    const index = all.indexOf(current as SVGGElement);
    if (index < 0) return;
    event.preventDefault();
    const next = all[(index + direction + all.length) % all.length];
    next?.focus();
  };

  return (
    <VisualFrame className="visual-diagram" label={label}>
      <div className="visual-svg-wrap">
        <svg
          className="visual-svg visual-diagram-svg"
          viewBox={`0 0 ${DIAGRAM_WIDTH} ${DIAGRAM_HEIGHT}`}
          role="group"
          aria-label={`${label}，包含 ${model.nodes.length} 个节点和 ${edges.length} 条边；用 Tab 聚焦节点，回车选择`}
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
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ink-muted, #6b7893)" />
            </marker>
          </defs>
          {edges.map(({ edge, geometry }) => (
            <g key={`edge-${edge.index}`} className="visual-edge">
              <line
                x1={geometry.x1}
                y1={geometry.y1}
                x2={geometry.x2}
                y2={geometry.y2}
                stroke="var(--ink-muted, #6b7893)"
                strokeWidth={1.6}
                markerEnd={`url(#${markerId})`}
              />
              {edge.label ? (
                <text
                  className="visual-edge-label"
                  x={geometry.mx}
                  y={geometry.my}
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {edge.label}
                </text>
              ) : null}
            </g>
          ))}
          {model.nodes.map((entry) => {
            const position = positions.get(entry.id);
            if (!position) return null;
            const isSelected = selectedId === entry.id;
            const lines = wrapLabel(entry.label, 9, 2);
            return (
              <g
                key={entry.id}
                className={`visual-node${isSelected ? ' is-selected' : ''}`}
                data-visual-node
                transform={`translate(${position.x} ${position.y})`}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={`${entry.label}${entry.description ? `：${entry.description}` : ''}`}
                onClick={() => selectNode(entry)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
                    event.preventDefault();
                    selectNode(entry);
                    return;
                  }
                  focusSibling(event);
                }}
              >
                <title>{entry.label}</title>
                <circle
                  className="visual-node-shape"
                  r={NODE_RADIUS}
                  fill="var(--surface, #ffffff)"
                  stroke="var(--line-strong, #c9d4e8)"
                  strokeWidth={2}
                />
                <text className="visual-node-text" textAnchor="middle">
                  {lines.map((line, lineIndex) => (
                    <tspan
                      key={lineIndex}
                      x={0}
                      y={(lineIndex - (lines.length - 1) / 2) * 14 + 4}
                    >
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="visual-selection" aria-live="polite">
        {selectedNode ? (
          <>
            <strong>{selectedNode.label}</strong>
            <span>{selectedNode.description || '该节点没有说明。'}</span>
          </>
        ) : (
          <span>点击或用 Tab 聚焦节点后按回车查看说明。</span>
        )}
      </div>
      {writeError ? <VisualError message={writeError} /> : null}
      <Notes notes={model.errors} />
      <details className="visual-details">
        <summary>查看节点与连线</summary>
        <ul className="visual-diagram-list">
          {model.nodes.map((entry) => (
            <li key={`list-${entry.id}`}>
              <strong>{entry.label}</strong>
              {entry.description ? `：${entry.description}` : ''}
            </li>
          ))}
          {model.edges.map((edge) => {
            const from = model.nodes.find((entry) => entry.id === edge.from);
            const to = model.nodes.find((entry) => entry.id === edge.to);
            return (
              <li key={`edge-list-${edge.index}`}>
                {from?.label ?? edge.from} → {to?.label ?? edge.to}
                {edge.label ? `（${edge.label}）` : ''}
              </li>
            );
          })}
        </ul>
      </details>
    </VisualFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

interface TimelineItem {
  id: string;
  title: string;
  start: number;
  duration: number;
  description: string;
  index: number;
}

interface TimelineModel {
  items: TimelineItem[];
  skipped: number;
  duplicateIds: number;
}

function buildTimelineModel(raw: Json[]): TimelineModel {
  const items: TimelineItem[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let duplicateIds = 0;

  raw.forEach((entry, index) => {
    if (!isJsonObject(entry)) {
      skipped += 1;
      return;
    }
    const start = finiteNumber(entry.start);
    const duration = finiteNumber(entry.duration);
    if (start === null || start < 0 || duration === null || duration < 0) {
      skipped += 1;
      return;
    }
    const rawId = textOf(entry.id, '');
    const id = rawId || `item-${index}`;
    if (seen.has(id)) duplicateIds += 1;
    seen.add(id);
    items.push({
      id,
      title: textOf(entry.title, `项目 ${index + 1}`),
      start,
      duration,
      description: textOf(entry.description, ''),
      index,
    });
  });

  return { items, skipped, duplicateIds };
}

function formatMinutes(value: number): string {
  if (Math.abs(value) >= 60) {
    const hours = value / 60;
    const text = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
    return `${text} 小时`;
  }
  return `${formatNumber(value)} 分钟`;
}

function TimelineView({ node }: ComponentProps) {
  const { runtime } = useViewer();
  const label = labelOf(runtime, node, '时间线');
  const result = evalArray(runtime, node, 'items', null);
  const model = useMemo<TimelineModel | null>(() => {
    if (!result.ok) return null;
    return buildTimelineModel(result.value);
  }, [result]);

  if (!result.ok) {
    return (
      <VisualFrame className="visual-timeline" label={label}>
        <VisualError message={result.message} />
      </VisualFrame>
    );
  }
  if (!model) {
    return (
      <VisualFrame className="visual-timeline" label={label}>
        <VisualEmpty message="暂无时间线数据" />
      </VisualFrame>
    );
  }
  if (model.items.length === 0) {
    const notes: string[] = [];
    if (model.skipped > 0) notes.push(`忽略 ${model.skipped} 个 start/duration 无效的项目`);
    return (
      <VisualFrame className="visual-timeline" label={label}>
        <VisualEmpty message="没有有效的项目（start 与 duration 必须是非负有限数字）" />
        <Notes notes={notes} />
      </VisualFrame>
    );
  }

  const notes: string[] = [];
  if (model.skipped > 0) notes.push(`忽略 ${model.skipped} 个 start/duration 无效的项目`);
  if (model.duplicateIds > 0) notes.push(`${model.duplicateIds} 个重复 id 的项目仍按顺序显示`);

  const maxEnd = model.items.reduce(
    (maximum, item) => Math.max(maximum, item.start + item.duration),
    0,
  );
  const span = Math.max(1, maxEnd);
  const ticks = niceTicks(0, span, 5);
  if (ticks.length === 0 || ticks[ticks.length - 1] < span) ticks.push(span);

  return (
    <VisualFrame className="visual-timeline" label={label}>
      <div className="visual-timeline-axis" aria-hidden="true">
        {ticks.map((tick, index) => {
          const percent = (tick / span) * 100;
          const style =
            index === ticks.length - 1
              ? { left: `${percent}%`, transform: 'translateX(-100%)' }
              : index === 0
                ? { left: '0%' }
                : { left: `${percent}%`, transform: 'translateX(-50%)' };
          return (
            <span key={`tick-${tick}`} className="visual-timeline-tick" style={style}>
              {formatMinutes(tick)}
            </span>
          );
        })}
      </div>
      <ol className="visual-timeline-list">
        {model.items.map((item, index) => {
          const end = item.start + item.duration;
          const left = (item.start / span) * 100;
          const width = (item.duration / span) * 100;
          const color = SERIES_COLORS[index % SERIES_COLORS.length];
          return (
            <li key={`${item.id}-${index}`} className="visual-timeline-item">
              <div className="visual-timeline-head">
                <span className="visual-timeline-title">
                  <span
                    className="visual-swatch"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  />
                  {item.title}
                </span>
                <span className="visual-timeline-times">
                  开始 {formatMinutes(item.start)} · 结束 {formatMinutes(end)} · 持续{' '}
                  {formatMinutes(item.duration)}
                </span>
              </div>
              <div
                className="visual-timeline-track"
                role="img"
                aria-label={`${item.title}，${formatMinutes(item.start)}开始，${formatMinutes(end)}结束，持续${formatMinutes(item.duration)}`}
              >
                <span
                  className={`visual-timeline-bar${item.duration === 0 ? ' is-zero' : ''}`}
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    backgroundColor: color,
                  }}
                />
              </div>
              {item.description ? (
                <details className="visual-details visual-timeline-details">
                  <summary>查看详情</summary>
                  <p>{item.description}</p>
                </details>
              ) : null}
            </li>
          );
        })}
      </ol>
      <Notes notes={notes} />
    </VisualFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export const VISUAL_COMPONENTS: Record<string, ComponentType<ComponentProps>> = {
  chart: ChartView,
  plot: PlotView,
  diagram: DiagramView,
  timeline: TimelineView,
};

