import type { HTMLAttributes, ReactNode } from 'react';

/** Compatibility exports for the canonical data-table model. */
export {
  buildDataTableModel,
  dataTableFailureMessage,
  encodeDataTableKey,
  evaluateDataTableRows,
} from '../../../components/table/data-table';

export type {
  DataTableBuildOptions,
  DataTableBuildResult,
  DataTableCell,
  DataTableColumnSpec,
  DataTableFailure,
  DataTableModel,
  DataTableRow,
} from '../../../components/table/data-table';

/** The same table/scroll surface for Markdown-backed and native HTML tables. */
export function TableSurface({ children, className = '', scrollClassName = '', tableProps = {} }: {
  children: ReactNode;
  className?: string;
  scrollClassName?: string;
  tableProps?: HTMLAttributes<HTMLTableElement> & { 'data-merged'?: string };
}) {
  return <div className={`local-visual-table-scroll${scrollClassName ? ` ${scrollClassName}` : ''}`}>
    <table {...tableProps} className={`local-visual-table${className ? ` ${className}` : ''}`}>{children}</table>
  </div>;
}
