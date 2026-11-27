import { Children, cloneElement, isValidElement, type ComponentProps, type ReactNode } from 'react';
import { VisualFrame } from './visual-frame';
import type { LocalComponentContext, LocalComponentTableCell, LocalComponentTableProjection } from '../../react/component-api';
import { textAttr, useAuthorComponentRoot, useComponentView, useValidationField } from '../../react/component-utils';

export const SERIES_COLORS = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)',
  'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)',
];

export type Localize = (en: string, zh: string) => string;

export function formatAxisNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e6 || (magnitude > 0 && magnitude < 0.001)) return value.toExponential(2);
  return Number(value.toFixed(4)).toString();
}

export function niceTicks(min: number, max: number, count = 5): number[] {
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

export function cellText(cell: LocalComponentTableCell | undefined, t: Localize): string {
  if (!cell) return '';
  return cell.error ? t('Cannot compute', '无法计算') : cell.text;
}

export function columnIsNumeric(table: LocalComponentTableProjection, column: number): boolean {
  let seen = false;
  for (const row of table.rows) {
    const cell = row.cells[column];
    if (!cell || cell.kind === 'empty') continue;
    if (cell.numeric === null) return false;
    seen = true;
  }
  return seen;
}

export function selectionKeyIndex(key: string | undefined, header: string[]): number {
  const name = (key ?? '').trim();
  if (!name) return -1;
  return header.findIndex((entry) => entry.trim() === name);
}

export function rowSelectionKey(
  keyIndex: number,
  row: { cells: readonly LocalComponentTableCell[] },
  t: Localize,
): string {
  if (keyIndex < 0) return '';
  return cellText(row.cells[keyIndex], t).trim();
}

export function VisualMessage({ message, kind = 'status' }: { message: string; kind?: 'status' | 'alert' }) {
  return (
    <p className={`local-visual-message local-visual-${kind}`} role={kind}>
      {message}
    </p>
  );
}

export function Notes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="local-visual-notes" role="status">
      {notes.map((note, index) => (
        <li key={`${note}-${index}`}>{note}</li>
      ))}
    </ul>
  );
}

/** Source-location and validation wrapper shared by visual components. */
export function VisualShell({
  context,
  children,
}: {
  context: LocalComponentContext;
  children: ReactNode;
}) {
  const view = useComponentView(context);
  const validation = useValidationField(context);
  const attrs = context.source.attributes();
  const authorRoot = useAuthorComponentRoot(context);
  const frames = context.authorStyle ? Children.map(children, child =>
    isValidElement<ComponentProps<typeof VisualFrame>>(child) && child.type === VisualFrame
      ? cloneElement(child, { authorRoot: authorRoot() })
      : child) : children;
  const content = validation.invalid ? (
    <div
      role="group"
      aria-label={textAttr(context, 'label', textAttr(context, 'title', view.t('Selection', '选择')))}
      aria-invalid={validation.invalid || undefined}
      aria-describedby={validation.describedBy}
    >
      {frames}
    </div>
  ) : frames;
  return Object.keys(attrs).length > 0 ? <div {...attrs}>{content}</div> : <>{content}</>;
}
