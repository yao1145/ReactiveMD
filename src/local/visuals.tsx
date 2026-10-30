import type { ReactNode } from 'react';
import type { LocalNode, LocalRuntime, LocalValue } from './types';
import type { LocalVisualProps } from './render-types';
import type { Localize } from './i18n';
import { defaultLocalize } from './i18n';
import { renderLegacyComponent } from './legacy-component-adapter';

/**
 * Legacy visual entry points.
 *
 * The actual table/chart/plot/timeline/diagram implementations now live in
 * `src/components/visuals.tsx` and are resolved through the default React
 * preset. This module keeps the historical fixture surface (`LocalVisual`,
 * `VisualFrame`) and the generic native-HTML-table helper used by the main
 * renderer; it contains no builtin view implementation or tag dispatch.
 */

export { VisualFrame } from '../components/visuals';

const NUMERIC_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

interface CellNumber {
  empty: boolean;
  numeric: number | null;
}

function scalarText(value: LocalValue): string | null {
  if (value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return null;
}

function collectInlineText(
  nodes: LocalNode[] | undefined,
  runtime: Pick<LocalRuntime, 'evaluate'>,
  state: { error: boolean },
): string {
  let text = '';
  for (const node of nodes ?? []) {
    if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') {
      text += node.value ?? '';
      continue;
    }
    if (node.type === 'interpolation') {
      try {
        const scalar = scalarText(runtime.evaluate((node.value ?? '').trim()));
        if (scalar === null) state.error = true;
        else text += scalar;
      } catch {
        state.error = true;
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
      text += collectInlineText(node.children, runtime, state);
      continue;
    }
    if (node.value) text += node.value;
  }
  return text;
}

/**
 * Classify one table cell for the native HTML-table helper. Only a fully
 * numeric cell counts; interpolation errors and arrays stay non-numeric.
 */
function readNumericCell(
  cell: LocalNode,
  runtime: Pick<LocalRuntime, 'evaluate'>,
): CellNumber {
  const children = cell.children ?? [];
  const significant = children.filter(
    (child) => !(child.type === 'text' && !(child.value ?? '').trim()),
  );
  if (significant.length === 1 && significant[0].type === 'interpolation') {
    try {
      const value = runtime.evaluate((significant[0].value ?? '').trim());
      return {
        empty: false,
        numeric: typeof value === 'number' && Number.isFinite(value) ? value : null,
      };
    } catch {
      return { empty: false, numeric: null };
    }
  }
  const state = { error: false };
  const collected = collectInlineText(children, runtime, state);
  const plain = significant.length > 0 && significant.every((child) => child.type === 'text');
  if (plain && NUMERIC_TEXT.test(collected.trim())) {
    const numeric = Number(collected.trim());
    if (Number.isFinite(numeric)) return { empty: false, numeric };
  }
  if (!state.error && collected.trim() === '') return { empty: true, numeric: null };
  return { empty: false, numeric: null };
}

/**
 * Shared numeric-column detection for native HTML tables. Markdown-backed
 * visuals get the same classification from the public table projection.
 */
export function tableNumericColumns(
  rows: readonly LocalNode[][],
  runtime: Pick<LocalRuntime, 'evaluate'>,
  _t: Localize = defaultLocalize,
): boolean[] {
  const width = rows[0]?.length ?? 0;
  if (!rows.every((row) => row.length === width)) return Array(width).fill(false);
  const cells = rows.map((row) =>
    row.map((cell) => {
      const children = cell.children ?? [];
      const effective =
        children.length === 1 && children[0].type === 'paragraph'
          ? children[0].children ?? []
          : children;
      return readNumericCell({ ...cell, children: effective }, runtime);
    }),
  );
  return Array.from({ length: width }, (_unused, column) => {
    let seen = false;
    for (const row of cells) {
      const cell = row[column];
      if (!cell || cell.empty) continue;
      if (cell.numeric === null) return false;
      seen = true;
    }
    return seen;
  });
}

/**
 * Legacy fixture renderer for one visual component. It adapts the historical
 * `{ node, runtime, render, visible, mode }` props into the public component
 * context and resolves the actual implementation from the default preset.
 */
export function LocalVisual(props: LocalVisualProps): ReactNode {
  return renderLegacyComponent(props.node.name ?? '', {
    node: props.node,
    runtime: props.runtime,
    mode: props.mode ?? 'interactive',
    visible: props.visible,
    render: props.render,
  });
}
