import { createElement, useCallback, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { CompiledDocument, DocumentNode, Runtime, SourceRange } from '../core/types';
import {
  ComponentBoundary,
  ComponentNodeView,
} from './components';
import { safeUrl, ViewerContext, type ViewerContextValue } from './context';

const FALLBACK_SNAPSHOT: ReturnType<Runtime['snapshot']> = {
  revision: 0,
  state: {},
  computed: {},
  resources: {},
};

function nodeKey(node: DocumentNode, index: number): string {
  const start = node.range?.start ?? index;
  return `${node.type}-${start}-${index}`;
}

function headingTag(depth: number | undefined): 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' {
  const level = Math.min(6, Math.max(1, depth ?? 1));
  return `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
}

function renderNodes(nodes: DocumentNode[] | undefined): ReactNode {
  if (!nodes || nodes.length === 0) return null;
  return nodes.map((node, index) => renderNode(node, index));
}

function renderInlineChildren(node: DocumentNode): ReactNode {
  return renderNodes(node.children);
}

function renderNode(node: DocumentNode, index: number): ReactNode {
  const key = nodeKey(node, index);

  if (node.type === 'component') {
    return (
      <ComponentBoundary key={key} name={node.name ?? 'component'}>
        <ComponentNodeView node={node} renderChildren={renderNodes} />
      </ComponentBoundary>
    );
  }

  switch (node.type) {
    case 'root':
      return <div key={key}>{renderNodes(node.children)}</div>;

    case 'heading':
      return createElement(headingTag(node.depth), { key }, renderInlineChildren(node));

    case 'paragraph':
      return <p key={key}>{renderInlineChildren(node)}</p>;

    case 'text':
      return <span key={key}>{node.value ?? ''}</span>;

    case 'emphasis':
      return <em key={key}>{renderInlineChildren(node)}</em>;

    case 'strong':
      return <strong key={key}>{renderInlineChildren(node)}</strong>;

    case 'delete':
      return <del key={key}>{renderInlineChildren(node)}</del>;

    case 'inlineCode':
      return (
        <code className="md-inline-code" key={key}>
          {node.value ?? ''}
        </code>
      );

    case 'code': {
      const language = node.lang ? `language-${node.lang}` : undefined;
      return (
        <pre className="md-code" key={key}>
          <code className={language}>{node.value ?? ''}</code>
        </pre>
      );
    }

    case 'blockquote':
      return <blockquote key={key}>{renderNodes(node.children)}</blockquote>;

    case 'break':
      return <br key={key} />;

    case 'thematicBreak':
      return <hr key={key} />;

    case 'list': {
      if (node.ordered) {
        return (
          <ol key={key} start={node.start ?? 1} className="md-list">
            {renderNodes(node.children)}
          </ol>
        );
      }
      return (
        <ul key={key} className="md-list">
          {renderNodes(node.children)}
        </ul>
      );
    }

    case 'listItem': {
      const task = typeof node.checked === 'boolean';
      return (
        <li key={key} className={task ? 'md-list-item md-task-item' : 'md-list-item'}>
          {task ? (
            <input
              type="checkbox"
              className="md-task-checkbox"
              checked={node.checked === true}
              readOnly
              tabIndex={-1}
              aria-label={node.checked ? '已完成' : '未完成'}
            />
          ) : null}
          {renderNodes(node.children)}
        </li>
      );
    }

    case 'link': {
      const href = safeUrl(node.url, 'link');
      if (!href) {
        return (
          <span className="md-link-rejected" key={key} title="已拒绝不安全的链接地址">
            {renderInlineChildren(node)}
          </span>
        );
      }
      const external = /^https?:/i.test(href);
      return (
        <a
          key={key}
          href={href}
          title={node.title ?? undefined}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
        >
          {renderInlineChildren(node)}
        </a>
      );
    }

    case 'image': {
      const src = safeUrl(node.url, 'image');
      if (!src) {
        return (
          <span className="md-image-rejected" key={key}>
            [已拒绝不安全的图片{node.alt ? `：${node.alt}` : ''}]
          </span>
        );
      }
      return (
        <img
          key={key}
          className="md-image"
          src={src}
          alt={node.alt ?? ''}
          title={node.title ?? undefined}
          loading="lazy"
        />
      );
    }

    case 'table': {
      const rows = node.children ?? [];
      const [headRow, ...bodyRows] = rows;
      const align = node.align;
      return (
        <div className="md-table-scroll" key={key}>
          <table className="md-table">
            {headRow ? (
              <thead>
                <tr>{renderTableCells(headRow, 'th', align)}</tr>
              </thead>
            ) : null}
            {bodyRows.length ? (
              <tbody>
                {bodyRows.map((row, rowIndex) => (
                  <tr key={nodeKey(row, rowIndex)}>
                    {renderTableCells(row, 'td', align)}
                  </tr>
                ))}
              </tbody>
            ) : null}
          </table>
        </div>
      );
    }

    case 'tableRow':
      return <tr key={key}>{renderTableCells(node, 'td')}</tr>;

    case 'tableCell': {
      const align = node.align?.[0] ?? undefined;
      return (
        <td key={key} style={{ textAlign: align ?? undefined }}>
          {renderInlineChildren(node)}
        </td>
      );
    }

    case 'html':
      // Raw HTML is shown as text. It is never parsed or executed.
      return (
        <span className="md-raw-html" key={key}>
          {node.value ?? ''}
        </span>
      );

    case 'yaml':
    case 'toml':
    case 'definition':
    case 'footnoteDefinition':
      return null;

    default:
      if (node.children && node.children.length) {
        return <span key={key}>{renderNodes(node.children)}</span>;
      }
      if (typeof node.value === 'string') {
        return <span key={key}>{node.value}</span>;
      }
      return null;
  }
}

function renderTableCells(
  row: DocumentNode,
  tag: 'th' | 'td',
  tableAlign?: ('left' | 'center' | 'right' | null)[],
): ReactNode {
  return (row.children ?? []).map((cell, index) => {
    const textAlign = cell.align?.[0] ?? row.align?.[index] ?? tableAlign?.[index] ?? undefined;
    if (tag === 'th') {
      return (
        <th key={nodeKey(cell, index)} style={{ textAlign: textAlign ?? undefined }}>
          {renderInlineChildren(cell)}
        </th>
      );
    }
    return (
      <td key={nodeKey(cell, index)} style={{ textAlign: textAlign ?? undefined }}>
        {renderInlineChildren(cell)}
      </td>
    );
  });
}

export interface RuntimeDocumentViewProps {
  runtime: Runtime;
  document: CompiledDocument;
  report: ViewerContextValue['report'];
  focusDiagnostic: ViewerContextValue['focusDiagnostic'];
}

export function RuntimeDocumentView({
  runtime,
  document,
  report,
  focusDiagnostic,
}: RuntimeDocumentViewProps) {
  const subscribe = useCallback(
    (listener: () => void) => {
      let unsubscribe: (() => void) | null = null;
      try {
        unsubscribe = runtime.subscribe(['*'], listener);
      } catch {
        return () => {};
      }
      // The runtime may already be disposed by the time React unmounts the
      // previous document; releasing a dead subscription must stay harmless.
      return () => {
        try {
          unsubscribe?.();
        } catch {
          // The old runtime was disposed before this view unmounted.
        }
      };
    },
    [runtime],
  );
  const getSnapshot = useCallback(() => {
    try {
      return runtime.snapshot();
    } catch {
      return FALLBACK_SNAPSHOT;
    }
  }, [runtime]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const contextValue = useMemo<ViewerContextValue>(
    () => ({ runtime, snapshot, report, focusDiagnostic, document }),
    [runtime, snapshot, report, focusDiagnostic, document],
  );

  return (
    <ViewerContext.Provider value={contextValue}>
      <article className="md-document" aria-label="文档预览">
        {(document.nodes ?? []).map((node, index) => renderNode(node, index))}
      </article>
    </ViewerContext.Provider>
  );
}
