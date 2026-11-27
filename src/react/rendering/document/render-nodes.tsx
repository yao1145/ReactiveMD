import {
  extensionEnvironment,
  FULL_EXPRESSION,
  HtmlDetailsView,
  LocalError,
  LocalErrorBoundary,
  readBooleanAttr,
  safeUrl,
  scalarText,
  sourcePosition,
  sourceProps,
  staticExtensionEnvironment,
  type ProjectionEnv,
  type RenderEnv,
  type StaticRenderEnv,
} from './view-render-context';
import type { LocalNode, LocalRuntime, LocalValue } from '../../../local/types';
import { localHtmlAlign, localHtmlLinkRel } from '../../../contracts/html-names';
import { createElement, Fragment, memo, type ReactNode } from 'react';
import { tableNumericColumns } from '../table/table-numeric-columns';
import { HTML_TABLE_NAMES } from '../../../local/html/html-table';
import { VisualFrame } from '../../../components/shared/visual-frame';
import { TableSurface } from '../table/data-table';
import { blockInputsEqual, runtimeRevision } from './view-revision';
import { collectSubtreeResetTokens, type NodeDependencies } from '../../../local/compilation/dependencies';
import { footnoteLabelText, type LocalFootnoteEntry } from '../../../local/parsing/footnotes';
import type { LocalHostComponentContext, LocalHostPropValue } from '../render-types';
import { LocalReactExtensionMissingError } from '../../sdk-core';
import { CodeBlockView } from '../code/code-block';
import { ZoomableImage } from '../image/image-view';
import { LatexView } from '../math-view';
import type { Localize } from '../../localization';
import { ExtendedHtmlFragment } from './ExtendedHtmlFragment';
import { StaticExternalSlot } from './StaticExternalSlot';
import { StaticHostData } from './StaticHostData';
import { splitHtmlDetailsChildren } from '../../../local/html/html-details';

function headingTag(depth: number | undefined): 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' {
  const level = Math.min(6, Math.max(1, depth ?? 1));
  return `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
}

function nodeKey(env: ProjectionEnv, node: LocalNode, index: number): string {
  if ('runtime' in env && env.stableComponentKeys) return `${node.type}:${node.name ?? ''}:${index}`;
  return node.id || `${node.type}-${index}`;
}

const SAFE_HTML_ATTRIBUTE = /^(?:aria|data)-[a-z0-9_.:-]+$/;

const HTML_IDREF_ATTRIBUTES = new Set(['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-details', 'aria-errormessage', 'aria-flowto', 'aria-activedescendant']);

/**
 * Whitelist of source attributes that may reach a rendered P0 element. IDs are
 * always rewritten through this render instance's anchor namespace; source
 * `class`, `style`, URL schemes and event hooks never pass through here.
 */
export function safeHtmlProps(env: ProjectionEnv, node: LocalNode): Record<string, string> {
  const attrs = node.attrs;
  if (!attrs) return {};
  const props: Record<string, string> = {};
  const id = env.anchors.ids.get(node) ?? env.anchors.htmlIds.get(node);
  if (id) props.id = id;
  for (const [rawName, value] of Object.entries(attrs)) {
    const name = rawName.toLowerCase();
    if (name === 'id') continue;
    if (name === 'align' && (node.type === 'div' || node.type === 'paragraph' || node.type === 'heading')) {
      const align = localHtmlAlign(value);
      if (align) props.align = align;
      continue;
    }
    if (name === 'title' || name === 'lang') {
      props[name] = value;
      continue;
    }
    if (name === 'dir') {
      const direction = value.trim().toLowerCase();
      if (direction === 'ltr' || direction === 'rtl' || direction === 'auto') props.dir = direction;
      continue;
    }
    if (SAFE_HTML_ATTRIBUTE.test(name)) {
      props[name] = HTML_IDREF_ATTRIBUTES.has(name)
        ? value.trim().split(/\s+/).filter(Boolean).map(id => env.anchors.referenceId(id)).join(' ')
        : value;
    }
  }
  return props;
}

function renderNativeTable(env: ProjectionEnv, node: LocalNode, visible: boolean, key: string): ReactNode {
  const rows: LocalNode[] = [];
  const collectRows = (nodes: LocalNode[]) => {
    for (const n of nodes) {
      if (n.name === 'tr') rows.push(n);
      else if (n.name !== 'td' && n.name !== 'th' && n.type !== 'htmlTable') collectRows(n.children ?? []);
    }
  };
  collectRows(node.children ?? []);
  const merged = rows.some(row => row.children?.some(cell => ['colspan', 'rowspan'].some(a => cell.attrs?.[a] !== undefined && cell.attrs[a] !== '1')));
  const bodyRows = rows.filter(row => row.children?.some(cell => cell.name === 'td'));
  const text = (n: LocalNode): string => {
    if (n.type === 'interpolation') {
      try { return 'runtime' in env ? scalarText(env.runtime.evaluate(n.value ?? '')) ?? '' : ''; } catch { return ''; }
    }
    return (n.value ?? '') + (n.children ?? []).map(text).join('');
  };
  const numeric = merged ? [] : tableNumericColumns(bodyRows.map(row => row.children ?? []), 'runtime' in env ? env.runtime : undefined, env.t);
  const structural = (n: LocalNode, index = 0): ReactNode => {
    if (n.type === 'htmlTable') return renderNativeTable(env, n, visible, n.id);
    const name = n.name ?? '';
    if (!HTML_TABLE_NAMES.has(name) || name === 'table') return null;
    const props: Record<string, unknown> = { ...safeHtmlProps(env, n), key: nodeKey(env, n, index) };
    const attrs = n.attrs ?? {};
    if (name === 'th' || name === 'td') {
      if (attrs.colspan !== undefined) props.colSpan = Number(attrs.colspan);
      if (attrs.rowspan !== undefined) props.rowSpan = Number(attrs.rowspan);
      if (attrs.scope !== undefined) props.scope = attrs.scope.trim().toLowerCase();
      if (attrs.abbr !== undefined) props.abbr = attrs.abbr;
      if (attrs.headers !== undefined) props.headers = attrs.headers.trim().split(/\s+/).map(id => env.anchors.referenceId(id)).join(' ');
      if (numeric[index]) props.className = 'is-numeric';
      const align = attrs.align && localHtmlAlign(attrs.align);
      if (align) props.style = { textAlign: align };
      return createElement(name, props, renderNodes(env, n.children, visible));
    }
    if (name === 'col' || name === 'colgroup') {
      if (attrs.span !== undefined) props.span = Number(attrs.span);
      if (name === 'col') return createElement('col', props);
    }
    return createElement(name, props, (n.children ?? []).map((child, i) => structural(child, i)));
  };
  const caption = node.children?.find(n => n.name === 'caption');
  const title = caption ? renderNodes(env, (caption.children ?? []).flatMap(n => n.type === 'paragraph' ? n.children ?? [] : [n]), visible, false) : env.t('Table', '表格');
  return <VisualFrame key={key} className="local-visual-table-block local-html-table-block" label={title}>
    <TableSurface tableProps={{ ...safeHtmlProps(env, node), ...(merged ? { 'data-merged': 'true' } : {}) }}>
      <caption {...(caption ? safeHtmlProps(env, caption) : {})} className="local-visual-sr-only">{caption ? text(caption) : env.t('Table', '表格')}</caption>
      {(node.children ?? []).filter(child => child.name !== 'caption').map(child => structural(child))}
    </TableSurface>
  </VisualFrame>;
}

interface LocalBlockProps {
  node: LocalNode;
  index: number;
  visible: boolean;
  env: RenderEnv;
  depValues: readonly LocalValue[] | null;
  resetToken: number;
}

/**
 * A block subtree re-renders only when the bindings it (or a descendant) reads
 * changed. `null` depValues means the dependencies could not be decided, so the
 * block keeps the pre-memoization behavior of re-rendering on every revision.
 */
function blockPropsEqual(previous: LocalBlockProps, next: LocalBlockProps): boolean {
  return blockInputsEqual(previous, next);
}

const LocalBlock = memo(function LocalBlock({ node, index, visible, env }: LocalBlockProps) {
  return renderNode(env, node, index, visible, true);
}, blockPropsEqual);

export function renderNodes(
  env: ProjectionEnv,
  nodes: LocalNode[] | undefined,
  visible: boolean,
  block = true,
): ReactNode {
  if (!nodes || nodes.length === 0) return null;
  // Inline content gets no boundary: it is recreated inside its owning block.
  if (!block || !('runtime' in env)) return nodes.map((node, index) => renderNode(env, node, index, visible, block));
  // Read the snapshot once per call; an unreadable snapshot makes every block
  // in this batch a wildcard, exactly like an undecidable dependency entry.
  let currentState: Readonly<Record<string, LocalValue>> | null = null;
  let resetTokens: ReadonlyMap<string, number> | null = null;
  try {
    currentState = env.runtime.snapshot().state;
    resetTokens = collectSubtreeResetTokens(env.runtime);
  } catch {
    currentState = null;
  }
  const state = currentState;
  return nodes.map((node, index) => {
    const deps: NodeDependencies | undefined = env.dependencies.get(node.id);
    const depValues = deps == null || state === null || resetTokens === null
      ? null : deps.map((key) => state[key]);
    const resetToken = resetTokens?.get(node.id) ?? 0;
    return (
      <LocalBlock
        key={nodeKey(env, node, index)}
        node={node}
        index={index}
        visible={visible}
        env={env}
        depValues={depValues}
        resetToken={resetToken}
      />
    );
  });
}

/**
 * Unsupported syntax is preserved as inert source. The parser stores the exact
 * original text in `value`; falling back to the document range keeps older or
 * hand-built trees readable without ever interpreting their contents.
 */
function fallbackSource(env: ProjectionEnv, node: LocalNode): string {
  if (typeof node.value === 'string') return node.value;
  const { start, end } = node.range;
  if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start) {
    return ('runtime' in env ? env.runtime.document.source : env.source).slice(start, end);
  }
  return '';
}

function renderFallback(env: ProjectionEnv, node: LocalNode, key: string, block: boolean): ReactNode {
  return (
    <span
      key={key}
      className={block ? 'local-fallback local-fallback-block' : 'local-fallback local-fallback-inline'}
      title={env.t('Unsupported syntax shown as source', '未支持的语法，已按源码原样显示')}
      {...sourceProps(env, node)}
      data-local-fallback=""
    >
      {fallbackSource(env, node)}
    </span>
  );
}

/** Render block-parsed children as inline content for labels and options. */
export function renderInlineNodes(env: ProjectionEnv, nodes: LocalNode[] | undefined, visible: boolean): ReactNode {
  if (!nodes || nodes.length === 0) return null;
  return nodes.map((node, index) => {
    if (node.type === 'paragraph' || node.type === 'root') {
      return (
        <span key={nodeKey(env, node, index)}>
          {renderNodes(env, node.children, visible, false)}
        </span>
      );
    }
    return renderNode(env, node, index, visible, false);
  });
}

/**
 * A footnote reference renders as its number in a superscript link. Hrefs use
 * the id generated while collecting footnotes, so URL policy and heading
 * anchor resolution never rewrite an internal target. Without a definition the
 * original source form stays visible instead of becoming a dead link.
 */
function renderFootnoteReference(env: ProjectionEnv, node: LocalNode, key: string): ReactNode {
  const site = env.footnotes.siteFor(node);
  if (!site || !site.entry) {
    const label = site?.label || footnoteLabelText(node) || '?';
    return (
      <span
        key={key}
        className="local-footnote-missing"
        title={env.t('Undefined footnote', '未定义的脚注')}
        data-local-footnote-missing=""
      >
        {`[^${label}]`}
      </span>
    );
  }
  const entry = site.entry;
  return (
    <sup key={key} className="local-footnote-ref">
      <a
        id={site.id}
        href={`#${entry.id}`}
        className="local-footnote-ref-link"
        role="doc-noteref"
        data-local-footnote-number={entry.number}
        aria-label={env.t(`Footnote ${entry.number}`, `脚注 ${entry.number}`)}
      >
        {entry.number}
      </a>
    </sup>
  );
}

/** Resolve one host property; full interpolations keep their expression type. */
function resolveHostProp(
  runtime: LocalRuntime,
  raw: string,
): LocalHostPropValue {
  const full = FULL_EXPRESSION.exec(raw);
  if (full) {
    try {
      const value = runtime.evaluate(full[1]);
      if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
      }
      return null;
    } catch {
      return null;
    }
  }
  try {
    return runtime.text(raw);
  } catch {
    return null;
  }
}

/**
 * The legacy renderer shares prop and data resolution across live and static
 * views. The placeholder is the diagnostic surface for callback failures.
 */
function renderHostComponent(
  env: ProjectionEnv,
  node: LocalNode,
  key: string,
  visible: boolean,
): ReactNode {
  const name = node.name ?? '';
  const unavailable = (reason: 'renderer' | 'data' | 'error' | 'loading', sdk = false): ReactNode => (
    <span
      key={key}
      className={`local-host-component local-host-unavailable${sdk ? ' local-sdk-unavailable' : ''}`}
      data-local-host-component={name}
      data-local-host-reason={reason}
      data-rmd-host-data={reason === 'loading' ? 'loading' : undefined}
      role={reason === 'loading' ? 'status' : 'note'}
    >
      {reason === 'loading' ? env.t('Loading host content…', '正在加载宿主内容…')
        : env.t(`Host component <${name}> is unavailable here.`, `宿主组件 <${name}> 在此不可用。`)}
    </span>
  );

  // SDK components own their props and bindings, so the legacy requirement for
  // `kind`/`ref` host data never applies to them. Visibility travels into the
  // context and children render under that visibility.
  if ('runtime' in env && env.extensionRenderer) {
    try {
      return createElement(Fragment, { key }, env.extensionRenderer(
        node,
        extensionEnvironment(env, node, visible, renderNodes, renderInlineNodes),
      ));
    } catch (error) {
      return unavailable(error instanceof LocalReactExtensionMissingError ? 'renderer' : 'error', true);
    }
  }

  const staticView = 'staticRuntime' in env;
  const runtime = staticView ? env.staticRuntime : env.runtime;
  const kind = node.attrs?.kind?.trim() ?? '';
  const ref = node.attrs?.ref?.trim() ?? '';
  const dataKey = kind !== '' && ref !== '' ? `${kind}:${ref}` : null;
  if (dataKey === null) {
    // A binding-only host component does not need host data. Without a
    // binding, a node that declares neither kind nor ref keeps the historical
    // visible data placeholder.
    let bound = false;
    try {
      bound = Object.values(runtime.document.bindings).some((binding) => binding.nodeIds.includes(node.id));
    } catch {
      bound = false;
    }
    // Container and inline host components are structural: they may render
    // children without host data. A bare leaf keeps the historical placeholder.
    if (!bound && node.hostForm !== 'container' && node.hostForm !== 'inline') return unavailable('data');
  }
  const renderer = env.hostRenderer;
  if (!renderer) return unavailable('renderer');

  const render = (data: unknown): ReactNode => {
    try {
      const content = renderer(node, data, legacyHostContext(env, node, visible));
      if (staticView) {
        return <LocalErrorBoundary key={key} revision={env.trace?.sourceRevision ?? 0}
          resetKey={data} fallback={unavailable('error')}>{content}</LocalErrorBoundary>;
      }
      return createElement(Fragment, { key }, content);
    } catch {
      return unavailable('error');
    }
  };
  if (dataKey === null) return render(undefined);
  // `undefined` alone means missing: null, false and 0 are valid host data.
  const data = env.hostData?.[dataKey];
  if (data === undefined) {
    if (staticView && env.resolveHostData) {
      return <StaticHostData key={key} kind={kind} reference={ref} resolve={env.resolveHostData}
        render={render} placeholder={unavailable} />;
    }
    return unavailable('data');
  }
  return render(data);
}

function legacyHostContext(env: ProjectionEnv, node: LocalNode, visible: boolean): LocalHostComponentContext {
  const staticView = 'staticRuntime' in env;
  const runtime = staticView ? env.staticRuntime : env.runtime;
  const readValue = (): LocalValue => {
    try {
      return runtime.get(node);
    } catch {
      return null;
    }
  };
  const props: Record<string, LocalHostPropValue> = {};
  for (const [propName, raw] of Object.entries(node.attrs ?? {})) {
    if (propName === 'bind' || propName === 'initial' || propName === 'disabled') continue;
    props[propName] = staticView || (node.literalAttributes && raw.includes('{{')) ? raw : resolveHostProp(runtime, raw);
  }
  let resetToken = 0;
  try {
    resetToken = runtime.resetToken(node);
  } catch {
    resetToken = 0;
  }
  const disabledRead = readBooleanAttr(runtime, node, 'disabled', false);

  return {
    runtime,
    // With no explicit nodes, a container renders its parsed children.
    render: (nodes, nextVisible = true) => renderNodes(env, nodes ?? node.children ?? [], nextVisible),
    visible,
    mode: env.mode,
    value: readValue(),
    setValue: (next: LocalValue): boolean => {
      if (staticView) return false;
      try {
        const diagnostics = runtime.set(node, next);
        if (diagnostics.length) {
          env.report?.(diagnostics);
          return false;
        }
        return true;
      } catch {
        return false;
      }
    },
    disabled: disabledRead.ok ? disabledRead.value : true,
    resetToken,
    props: Object.freeze(props),
    report: (diagnostics) => env.report?.(diagnostics),
  };
}

/** Collapse memo wrappers along deep single-child Markdown chains. The native
 * DOM stays nested, while React no longer needs one extra component per level. */
function renderDeepContainerChain(env:ProjectionEnv,node:LocalNode,visible:boolean,rootKey:string):ReactNode|undefined {
  const plain=(node:LocalNode)=>node.type==='blockquote'||node.type==='list'
    ||(node.type==='listItem'&&typeof node.checked!=='boolean');
  if(!plain(node)||node.children?.length!==1||!plain(node.children[0]))return;
  const chain:LocalNode[]=[];
  let current=node;
  for(;;){
    chain.push(current);
    if(current.children?.length!==1||!plain(current.children[0]))break;
    current=current.children[0];
  }
  if(chain.length<32)return;
  let children=renderNodes(env,current.children,visible);
  for(let i=chain.length-1;i>=0;i--){
    const item=chain[i],props=safeHtmlProps(env,item),key=i === 0 ? rootKey : nodeKey(env, item, 0);
    if(item.type==='blockquote')children=<blockquote key={key} {...props}>{children}</blockquote>;
    else if(item.type==='listItem')children=<li key={key} {...props} className="md-list-item">{children}</li>;
    else if(item.ordered)children=<ol key={key} {...props} start={item.start??1} className="md-list">{children}</ol>;
    else children=<ul key={key} {...props} className="md-list">{children}</ul>;
  }
  return children;
}

function renderNode(
  env: ProjectionEnv,
  node: LocalNode,
  index: number,
  visible: boolean,
  block = true,
): ReactNode {
  const key = nodeKey(env, node, index);
  const chain=renderDeepContainerChain(env,node,visible,key);
  if(chain!==undefined)return chain;

  if (node.type === 'component') {
    if (!('runtime' in env)) {
      if (node.name === 'if') {
        const shown = node.attrs?.when === 'true';
        return <div key={key} className="local-if md-if" role="group" hidden={!shown} aria-hidden={!shown}
          aria-label={env.t('Conditional content', '条件内容')}>{shown ? renderNodes(env, node.children, visible) : null}</div>;
      }
      return renderStaticComponent(env, node, key, visible);
    }
    return (
      <LocalErrorBoundary key={key} revision={runtimeRevision(env.runtime)}>
        {renderComponent(env, node, visible)}
      </LocalErrorBoundary>
    );
  }

  switch (node.type) {
    case 'root':
      return <div key={key}>{renderNodes(env,node.children, visible)}</div>;

    case 'heading':
      return createElement(
        headingTag(node.depth),
        {
          key,
          // An explicit source id wins; otherwise the generated heading slug.
          id: env.anchors.ids.get(node),
          ...safeHtmlProps(env, node),
          ...sourceProps(env, node),
        },
        renderNodes(env,node.children, visible, false),
      );

    case 'paragraph':
      return <p key={key} {...safeHtmlProps(env, node)} {...sourceProps(env, node)}>{renderNodes(env,node.children, visible, false)}</p>;

    case 'text':
      return <span key={key}>{node.value ?? ''}</span>;

    // A raw-body container body is author source text. It reaches the DOM as
    // one escaped text child: never innerHTML, never Markdown, never an HTML
    // renderer. SSR and static export read the same compiled value.
    case 'rawBody':
      return <span className="local-raw-body" key={key}>{node.value ?? ''}</span>;

    case 'emphasis':
      return <em key={key} {...safeHtmlProps(env, node)}>{renderNodes(env,node.children, visible, false)}</em>;

    case 'strong':
      return <strong key={key} {...safeHtmlProps(env, node)}>{renderNodes(env,node.children, visible, false)}</strong>;

    case 'delete':
      return <del key={key} {...safeHtmlProps(env, node)}>{renderNodes(env,node.children, visible, false)}</del>;

    // Basic HTML formatting is rebuilt as plain React tags. No raw HTML and no
    // attributes from the source reach the DOM.
    case 'underline':
      return <u key={key} {...safeHtmlProps(env, node)}>{renderNodes(env,node.children, visible, false)}</u>;

    case 'mark':
      return <mark key={key} {...safeHtmlProps(env, node)}>{renderNodes(env,node.children, visible, false)}</mark>;

    case 'sup':
      return <sup key={key} {...safeHtmlProps(env, node)}>{renderNodes(env,node.children, visible, false)}</sup>;

    case 'sub':
      return <sub key={key} {...safeHtmlProps(env, node)}>{renderNodes(env,node.children, visible, false)}</sub>;

    case 'span':
      return <span key={key} {...safeHtmlProps(env, node)}>{renderNodes(env,node.children, visible, false)}</span>;

    case 'div':
      return <div key={key} {...safeHtmlProps(env, node)}>{renderNodes(env,node.children, visible)}</div>;

    case 'summary':
      return <span key={key} {...safeHtmlProps(env, node)}>{renderNodes(env,node.children, visible, false)}</span>;

    case 'details': {
      if (!('runtime' in env)) {
        const { summary, body } = splitHtmlDetailsChildren(node.children ?? []);
        return <div key={key} className="local-accordion" role="group" aria-label={env.t('Accordion', '折叠面板')}>
          <section className="local-disclosure local-static-disclosure local-html-details" {...safeHtmlProps(env, node)}>
            <h3 className="local-disclosure-heading">{summary
              ? <span {...safeHtmlProps(env, summary)}>{renderInlineNodes(env, summary.children, visible)}</span>
              : env.t('Details', '折叠内容')}</h3>
            <div className="local-disclosure-panel">{renderNodes(env, body, visible)}</div>
          </section>
        </div>;
      }
      return <HtmlDetailsView key={key} node={node} visible={visible} renderInlineNodes={renderInlineNodes} safeHtmlProps={safeHtmlProps} />;
    }

    case 'inlineCode':
      return (
        <code className="md-inline-code" key={key} {...safeHtmlProps(env, node)}>
          {node.value ?? ''}
        </code>
      );

    case 'code':
      return <CodeBlockView key={key} value={node.value ?? ''} language={node.lang ?? undefined} mode={env.mode} htmlProps={safeHtmlProps(env, node)} />;

    case 'blockquote':
      return <blockquote key={key} {...safeHtmlProps(env, node)} {...sourceProps(env, node)}>{renderNodes(env,node.children, visible)}</blockquote>;

    case 'break':
      return <br key={key} {...safeHtmlProps(env, node)} />;

    case 'thematicBreak':
      return <hr key={key} {...safeHtmlProps(env, node)} />;

    case 'list':
      return node.ordered ? (
        <ol key={key} start={node.start ?? 1} className="md-list" {...safeHtmlProps(env, node)}>
          {renderNodes(env,node.children, visible)}
        </ol>
      ) : (
        <ul key={key} className="md-list" {...safeHtmlProps(env, node)}>
          {renderNodes(env,node.children, visible)}
        </ul>
      );

    case 'listItem': {
      const task = typeof node.checked === 'boolean';
      return (
        <li key={key} className={task ? 'md-list-item md-task-item' : 'md-list-item'} {...safeHtmlProps(env, node)} {...sourceProps(env, node)}>
          {task ? (
            env.mode === 'static' ? (
              <span
                className="md-task-marker"
                role="img"
                aria-label={
                  node.checked
                    ? env.t('Completed', '已完成')
                    : env.t('Not completed', '未完成')
                }
              >
                {node.checked ? '✓' : '☐'}
              </span>
            ) : (
              <input
                type="checkbox"
                className="md-task-checkbox"
                checked={node.checked === true}
                readOnly
                tabIndex={-1}
                aria-label={
                  node.checked
                    ? env.t('Completed', '已完成')
                    : env.t('Not completed', '未完成')
                }
              />
            )
          ) : null}
          {renderNodes(env,node.children, visible)}
        </li>
      );
    }

    case 'link': {
      const allowedHref = safeUrl(node.url, 'link', env.urlPolicy);
      if (!allowedHref) {
        return (
          <span
            {...safeHtmlProps(env, node)}
            className="md-link-rejected"
            key={key}
            title={env.t('Unsafe link URL rejected', '已拒绝不安全的链接地址')}
          >
            {renderNodes(env,node.children, visible, false)}
          </span>
        );
      }
      const href = env.anchors.resolve(allowedHref);
      const external = /^https?:/i.test(href);
      const target = node.attrs?.target ?? (external ? '_blank' : undefined);
      const rel = localHtmlLinkRel(node.attrs?.rel ?? (external ? 'noopener noreferrer' : undefined), target);
      return (
        <a
          key={key}
          {...safeHtmlProps(env, node)}
          href={href}
          title={node.title ?? undefined}
          target={target}
          rel={rel}
        >
          {renderNodes(env,node.children, visible, false)}
        </a>
      );
    }

    case 'image': {
      const accepted = safeUrl(node.url, 'image', env.urlPolicy);
      let src = accepted;
      // The host resolver is a post-validation mapping only. A thrown error,
      // a non-string or an empty result rejects the image instead of falling
      // back to an unchecked URL.
      if (accepted && env.imageResolver) {
        try {
          const mapped = env.imageResolver(accepted);
          src = typeof mapped === 'string' && mapped.trim() !== '' ? mapped : null;
        } catch {
          src = null;
        }
      }
      if (!src) {
        const rejected = env.t('Unsafe image rejected', '已拒绝不安全的图片');
        const alt = node.alt ? env.t(`: ${node.alt}`, `：${node.alt}`) : '';
        return (
          <span className="md-image-rejected" key={key} {...safeHtmlProps(env, node)}>
            [{rejected}{alt}]
          </span>
        );
      }
      return (
        <ZoomableImage
          key={key}
          src={src}
          alt={node.alt ?? ''}
          title={node.title ?? undefined}
          mode={env.mode}
          rootRef={env.rootRef}
          imageProps={node.attrs === undefined ? undefined : { ...safeHtmlProps(env, node), width: node.width, height: node.height }}
        />
      );
    }

    case 'htmlTable':
      return renderNativeTable(env, node, visible, key);

    case 'table': {
      const rows = node.children ?? [];
      const [headRow, ...bodyRows] = rows;
      return (
        <div className="md-table-scroll" key={key}>
          <table className="md-table">
            {headRow ? (
              <thead>
                <tr>{renderTableCells(env,headRow, 'th', node.align, visible)}</tr>
              </thead>
            ) : null}
            {bodyRows.length ? (
              <tbody>
                {bodyRows.map((row, rowIndex) => (
                  <tr key={nodeKey(env, row, rowIndex)}>
                    {renderTableCells(env,row, 'td', node.align, visible)}
                  </tr>
                ))}
              </tbody>
            ) : null}
          </table>
        </div>
      );
    }

    case 'tableRow':
      return <tr key={key}>{renderTableCells(env,node, 'td', undefined, visible)}</tr>;

    case 'tableCell': {
      const align = node.align?.[0] ?? undefined;
      return (
        <td key={key} style={{ textAlign: align ?? undefined }}>
          {renderNodes(env,node.children, visible, false)}
        </td>
      );
    }

    case 'interpolation': {
      if (!('runtime' in env)) return null;
      try {
        const text = scalarText(env.runtime.evaluate(node.value ?? ''));
        if (text === null) throw new Error('Cannot display an array');
        return (
          <span className="local-interpolation" key={key} {...sourceProps(env, node)}>
            {text}
          </span>
        );
      } catch {
        return <LocalError key={key} />;
      }
    }

    case 'math':
    case 'inlineMath': {
      const display = node.type === 'math';
      return (
        <span
          key={key}
          className={display ? 'local-math-display' : 'local-math-inline'}
          {...sourceProps(env, node)}
        >
          <LocalErrorBoundary revision={'runtime' in env ? runtimeRevision(env.runtime) : 0}>
            <LatexView source={node.value ?? ''} display={display} />
          </LocalErrorBoundary>
        </span>
      );
    }

    case 'html':
      return (
        <span className="md-raw-html" key={key}>
          {node.value ?? ''}
        </span>
      );

    case 'extendedHtml':
      if (env.capabilityPolicy?.enableExtendedHtml) {
        return <ExtendedHtmlFragment
          key={key}
          inline={!block}
          source={fallbackSource(env, node)}
          sourceAttributes={sourceProps(env, node)}
          policy={env.capabilityPolicy}
          allowedFrameOrigins={env.allowedFrameOrigins}
          onDiagnostics={items => env.report?.(items.map(item => {
            const start = node.range.start + item.range.start;
            return { ...item, ...sourcePosition(env, start), range: { start, end: node.range.start + item.range.end } };
          }))}
        />;
      }
      return renderFallback(env, node, key, block);

    case 'fallback':
      return renderFallback(env, node, key, block);

    // Footnotes are collected at the document level: references show a
    // numbered superscript, and definitions render once in the endnotes
    // section instead of at their source position.
    case 'footnoteReference':
      return renderFootnoteReference(env, node, key);

    case 'footnoteDefinition':
      return null;

    case 'comment':
    case 'definition':
      return null;

    case 'hostComponent':
      return 'staticRuntime' in env && env.sdkHostNames.has(node.name ?? '')
        ? renderStaticComponent(env, node, key, visible)
        : renderHostComponent(env, node, key, visible);

    case 'externalSlot': {
      const name = node.name ?? '';
      return <LocalErrorBoundary key={key} revision={env.trace?.sourceRevision ?? 0}>
        <StaticExternalSlot slot={{ name, locale: env.locale, range: node.range }} trace={env.trace} report={env.report}
          position={env.report ? () => sourcePosition(env, node.range.start) : undefined}
          render={'renderExternalSlot' in env ? env.renderExternalSlot : undefined}
          resolver={'resolveExternalSlot' in env ? env.resolveExternalSlot : undefined} />
      </LocalErrorBoundary>;
    }

    default:
      if (node.children && node.children.length) {
        return <span key={key}>{renderNodes(env,node.children, visible, block)}</span>;
      }
      if (typeof node.value === 'string') {
        return <span key={key}>{node.value}</span>;
      }
      return null;
  }
}

function renderTableCells(
  env: ProjectionEnv,
  row: LocalNode,
  tag: 'th' | 'td',
  tableAlign: ('left' | 'center' | 'right' | null)[] | undefined,
  visible: boolean,
): ReactNode {
  return (row.children ?? []).map((cell, index) => {
    const textAlign = cell.align?.[0] ?? row.align?.[index] ?? tableAlign?.[index] ?? undefined;
    if (tag === 'th') {
      return (
        <th key={nodeKey(env, cell, index)} style={{ textAlign: textAlign ?? undefined }}>
          {renderNodes(env,cell.children, visible, false)}
        </th>
      );
    }
    return (
      <td key={nodeKey(env, cell, index)} style={{ textAlign: textAlign ?? undefined }}>
        {renderNodes(env,cell.children, visible, false)}
      </td>
    );
  });
}

/**
 * Runtime-free component projection. The compiler only admits manifests that
 * declare static rendering, and the host supplies the pack implementation via
 * `reactConfig`; without one the node keeps a stable placeholder.
 */
function renderStaticComponent(
  env: StaticRenderEnv,
  node: LocalNode,
  key: string,
  visible: boolean,
): ReactNode {
  const name = node.name ?? '';
  if (name === 'computed' || name === 'const' || name === 'external') return null;
  const unavailable = (reason: 'renderer' | 'error'): ReactNode => (
    <span
      key={key}
      className="local-host-component local-host-unavailable local-sdk-unavailable"
      data-local-host-component={name}
      data-local-host-reason={reason}
      role="note"
    >
      {env.t(`Component <${name}> is unavailable here.`, `组件 <${name}> 在此不可用。`)}
    </span>
  );
  const renderer = env.componentRenderer;
  if (!renderer) return unavailable('renderer');
  try {
    return (
      <LocalErrorBoundary key={key} revision={0}>
        {renderer(node, staticExtensionEnvironment(env, node, visible, renderNodes, renderInlineNodes))}
      </LocalErrorBoundary>
    );
  } catch (error) {
    return unavailable(error instanceof LocalReactExtensionMissingError ? 'renderer' : 'error');
  }
}

function renderComponent(
  env: RenderEnv,
  node: LocalNode,
  visible: boolean,
): ReactNode {
  const name = node.name ?? '';
  // Computed/const/external declarations are document metadata, not rendered
  // controls. They are also the only component names the renderer knows by
  // name; every rendered builtin resolves through the same manifest index.
  if (name === 'computed' || name === 'const' || name === 'external') return null;
  const renderer = env.componentRenderer ?? env.extensionRenderer;
  if (renderer) {
    try {
      return createElement(Fragment, {
        key: env.stableComponentKeys ? undefined : node.id,
      }, renderer(node, extensionEnvironment(env, node, visible, renderNodes, renderInlineNodes)));
    } catch (error) {
      if (!(error instanceof LocalReactExtensionMissingError)) throw error;
    }
  }
  return (
    <span className="component-error">
      {env.t('Unknown component "', '未知组件“')}
      {name || env.t('(missing name)', '（缺少名称）')}
      {env.t('"', '”')}
    </span>
  );
}

/* --------------------------------------------------------------- endnotes */
function footnoteBody(env: ProjectionEnv, entry: LocalFootnoteEntry): ReactNode {
  const children = entry.definition.children;
  if (children && children.length > 0) return renderNodes(env, children, true);
  // Older or hand-built definitions may only carry their text in `value`.
  if (typeof entry.definition.value === 'string' && entry.definition.value !== '') {
    return <p>{entry.definition.value}</p>;
  }
  return null;
}

/**
 * One document-wide endnote list. Each item keeps every backlink for its
 * references so readers can return to any occurrence, not just the first.
 */
export function EndnotesView({
  entries,
  env,
  t,
  titleId,
}: {
  entries: readonly LocalFootnoteEntry[];
  env: ProjectionEnv;
  t: Localize;
  titleId: string;
}) {
  return (
    <section
      className="local-footnotes"
      role="doc-endnotes"
      aria-labelledby={titleId}
      data-local-footnotes=""
    >
      <h2 id={titleId} className="local-footnotes-title">
        {t('Footnotes', '脚注')}
      </h2>
      <ol className="local-footnotes-list">
        {entries.map((entry) => {
          const multiple = entry.references.length > 1;
          return (
            <li
              key={entry.id}
              id={entry.id}
              className="local-footnote"
              data-local-footnote-number={entry.number}
            >
              <div className="local-footnote-body">{footnoteBody(env, entry)}</div>
              <span className="local-footnote-backlinks">
                {entry.references.map((reference, index) => (
                  <a
                    key={reference.id}
                    href={`#${reference.id}`}
                    className="local-footnote-backlink"
                    role="doc-backlink"
                    aria-label={
                      multiple
                        ? t(
                            `Back to reference ${entry.number} (${index + 1} of ${entry.references.length})`,
                            `返回脚注 ${entry.number} 的第 ${index + 1} 处引用`,
                          )
                        : t(`Back to reference ${entry.number}`, `返回脚注 ${entry.number}`)
                    }
                  >
                    {'↩'}
                  </a>
                ))}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
