import type { HTMLAttributes, ReactNode } from 'react';

/** Shared table and scroll surface for rendered and native HTML tables. */
export function TableSurface({
  children,
  className = '',
  scrollClassName = '',
  tableProps = {},
}: {
  children: ReactNode;
  className?: string;
  scrollClassName?: string;
  tableProps?: HTMLAttributes<HTMLTableElement> & { 'data-merged'?: string };
}) {
  return (
    <div className={`local-visual-table-scroll${scrollClassName ? ` ${scrollClassName}` : ''}`}>
      <table {...tableProps} className={`local-visual-table${className ? ` ${className}` : ''}`}>
        {children}
      </table>
    </div>
  );
}
