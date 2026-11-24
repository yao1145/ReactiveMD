import { TableSurface } from '../../../components/shared/table-surface';

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
export { TableSurface };
