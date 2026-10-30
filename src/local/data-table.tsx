import type { ReactNode } from 'react';
import type { LocalNode, LocalRuntime } from './types';
import type { Localize } from './i18n';
import { renderLegacyComponent } from './legacy-component-adapter';

/**
 * Legacy `<data-table>` entry points.
 *
 * The model builder and the React view now live in
 * `src/components/data-table.tsx`. This module re-exports the canonical model
 * helpers with their historical signatures and adapts the old fixture props
 * `{ node, visible, runtime: Pick<LocalRuntime,'evaluate'>, t }` into the
 * public component context. There is no second renderer here.
 */

export {
  buildDataTableModel,
  dataTableFailureMessage,
  encodeDataTableKey,
  evaluateDataTableRows,
} from '../components/data-table';
export type {
  DataTableBuildOptions,
  DataTableBuildResult,
  DataTableCell,
  DataTableColumnSpec,
  DataTableFailure,
  DataTableModel,
  DataTableRow,
} from '../components/data-table';

export interface DataTableViewProps {
  node: LocalNode;
  visible: boolean;
  runtime: Pick<LocalRuntime, 'evaluate'>;
  t: Localize;
}

/**
 * Minimal runtime for fixture-only rendering. The view only needs
 * `evaluate`; everything else stays inert so no kernel state is touched.
 */
function fixtureRuntime(runtime: Pick<LocalRuntime, 'evaluate'>): LocalRuntime {
  return {
    get: () => null,
    set: () => [],
    setMany: () => [],
    evaluate: (expression: string) => runtime.evaluate(expression),
    snapshot: () => ({ revision: 0, state: {} }),
    validate: () => [],
    text: (template: string) => template,
    reset: () => {},
    resetToken: () => 0,
  } as unknown as LocalRuntime;
}

/** Compatibility wrapper around the actual public `<data-table>` view. */
export function DataTableView({ node, visible, runtime, t }: DataTableViewProps): ReactNode {
  return renderLegacyComponent('data-table', {
    node,
    runtime: fixtureRuntime(runtime),
    mode: 'interactive',
    visible,
    t,
    locale: t('en', 'zh') === 'zh' ? 'zh' : 'en',
    render: () => null,
  });
}
