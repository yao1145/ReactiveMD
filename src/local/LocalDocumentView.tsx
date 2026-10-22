import {
  Component,
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type {
  Diagnostic,
  LocalDocument,
  LocalNode,
  LocalRuntime,
  LocalSnapshot,
  LocalValue,
} from './types';
import type { LocalRenderContext } from './render-types';
import { compileLocal } from './compiler';
import { createLocalRuntime } from './runtime';
import { MAX_LOCAL_STRING_LENGTH, isLocalEmail } from './limits';
import { LatexView } from './math-view';
import { LocalVisual } from './visuals';

/* ------------------------------------------------------------------ props */

/**
 * Host-owned URL allowlist. It runs only after the renderer has validated the
 * protocol, and a thrown error denies the URL.
 */
export type LocalUrlPolicy = (url: string, kind: 'image' | 'link') => boolean;

export interface LocalDocumentViewProps {
  document: LocalDocument;
  runtime: LocalRuntime;
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
  urlPolicy?: LocalUrlPolicy;
}

export interface LocalReactiveDocumentProps {
  source: string;
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
  urlPolicy?: LocalUrlPolicy;
}

/* --------------------------------------------------------------- contexts */

interface LocalViewContext extends LocalRenderContext {
  report: (diagnostics: Diagnostic[]) => void;
  urlPolicy?: LocalUrlPolicy;
}

const LocalViewContext = createContext<LocalViewContext | null>(null);

function useLocal(): LocalViewContext {
  const value = useContext(LocalViewContext);
  if (!value) throw new Error('LocalViewContext 未初始化');
  return value;
}

/* ------------------------------------------------------------- attributes */

const FULL_EXPRESSION = /^\s*\{\{([\s\S]*)\}\}\s*$/;
const EMPTY_SNAPSHOT: LocalSnapshot = { revision: 0, state: {} };

type ReadAttr =
  | { present: false }
  | { present: true; ok: true; value: LocalValue }
  | { present: true; ok: false };

function rawAttr(node: LocalNode, name: string): string | undefined {
  return node.attrs?.[name];
}

function readAttr(runtime: LocalRuntime, node: LocalNode, name: string): ReadAttr {
  const raw = rawAttr(node, name);
  if (raw === undefined) return { present: false };
  const full = FULL_EXPRESSION.exec(raw);
  if (!full) return { present: true, ok: true, value: raw };
  try {
    return { present: true, ok: true, value: runtime.evaluate(full[1]) };
  } catch {
    return { present: true, ok: false };
  }
}

function scalarText(value: LocalValue): string | null {
  if (value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return null;
}

function textAttr(runtime: LocalRuntime, node: LocalNode, name: string, fallback = ''): string {
  const raw = rawAttr(node, name);
  if (raw === undefined) return fallback;
  const full = FULL_EXPRESSION.exec(raw);
  try {
    if (full) return scalarText(runtime.evaluate(full[1])) ?? '无法计算';
    return runtime.text(raw);
  } catch {
    return '无法计算';
  }
}

function readBooleanAttr(
  runtime: LocalRuntime,
  node: LocalNode,
  name: string,
  fallback: boolean,
): { ok: true; value: boolean } | { ok: false } {
  const raw = rawAttr(node, name);
  if (raw === undefined) return { ok: true, value: fallback };
  const full = FULL_EXPRESSION.exec(raw);
  if (!full) return { ok: true, value: raw === 'true' };
  try {
    const value = runtime.evaluate(full[1]);
    return typeof value === 'boolean' ? { ok: true, value } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function boolAttr(runtime: LocalRuntime, node: LocalNode, name: string, fallback = false): boolean {
  const read = readBooleanAttr(runtime, node, name, fallback);
  return read.ok ? read.value : fallback;
}

function runtimeRevision(runtime: LocalRuntime): number {
  try {
    return runtime.snapshot().revision;
  } catch {
    return 0;
  }
}

function numberAttr(runtime: LocalRuntime, node: LocalNode, name: string, fallback: number): number {
  const raw = rawAttr(node, name);
  if (raw === undefined) return fallback;
  const full = FULL_EXPRESSION.exec(raw);
  try {
    const value = full ? runtime.evaluate(full[1]) : Number(raw);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function currentValue(runtime: LocalRuntime, node: LocalNode): LocalValue {
  try {
    return runtime.get(node);
  } catch {
    return null;
  }
}

function displayValue(value: LocalValue): string {
  return scalarText(value) ?? '';
}

/* ------------------------------------------------------------ state hooks */

function useWriter(node: LocalNode) {
  const { runtime, report } = useLocal();
  const [error, setError] = useState<string | null>(null);
  const write = useCallback(
    (value: LocalValue): boolean => {
      try {
        const diagnostics = runtime.set(node, value);
        if (diagnostics.length) {
          setError(diagnostics.map((item) => item.message).join('；'));
          report(diagnostics);
          return false;
        }
        setError(null);
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '无法写入');
        return false;
      }
    },
    [node, report, runtime],
  );
  return { write, error, setError };
}

function useDisabled(node: LocalNode): { disabled: boolean; invalid: boolean } {
  const { runtime } = useLocal();
  const read = readBooleanAttr(runtime, node, 'disabled', false);
  // An unevaluable disabled expression must fail closed: never leave the
  // control editable just because the predicate could not be computed.
  return read.ok ? { disabled: read.value, invalid: false } : { disabled: true, invalid: true };
}

function useResetToken(runtime: LocalRuntime, node: LocalNode, onReset: () => void) {
  let token = 0;
  try {
    token = runtime.resetToken(node);
  } catch {
    token = 0;
  }
  const previous = useRef(token);
  const handler = useRef(onReset);
  handler.current = onReset;
  useEffect(() => {
    if (previous.current !== token) {
      previous.current = token;
      handler.current();
    }
  }, [token]);
}

/* ---------------------------------------------------------------- display */

function LocalError({ message = '无法计算' }: { message?: string }) {
  return (
    <span className="local-error" role="alert">
      {message}
    </span>
  );
}

interface LocalBoundaryProps {
  children: ReactNode;
  revision: number;
}

/**
 * Each component instance is isolated. A failure is retried whenever the
 * runtime revision changes, so fixing a parameter recovers the local content
 * without remounting unrelated subtrees.
 */
class LocalErrorBoundary extends Component<LocalBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidUpdate(previous: Readonly<LocalBoundaryProps>) {
    if (this.state.failed && previous.revision !== this.props.revision) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) return <LocalError />;
    return this.props.children;
  }
}

/* --------------------------------------------------------------- markdown */

interface LocalComponentProps {
  node: LocalNode;
  visible: boolean;
}

const VISUAL_COMPONENTS = new Set(['table', 'chart', 'plot', 'timeline', 'diagram']);

function safeUrl(
  raw: string | undefined,
  kind: 'image' | 'link',
  policy?: LocalUrlPolicy,
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[\u0000- ]+/g, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(normalized);
  if (scheme) {
    const name = scheme[1].toLowerCase();
    const allowed =
      kind === 'image'
        ? name === 'http' || name === 'https'
        : name === 'http' || name === 'https' || name === 'mailto' || name === 'tel';
    // Protocol validation always runs first, even when a host policy exists.
    if (!allowed) return null;
  }
  if (!policy) {
    // Images never start a network request by default, including relative and
    // protocol-relative sources. Links keep the historical safe behavior.
    return kind === 'image' ? null : trimmed;
  }
  try {
    return policy(trimmed, kind) ? trimmed : null;
  } catch {
    return null;
  }
}

function headingTag(depth: number | undefined): 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' {
  const level = Math.min(6, Math.max(1, depth ?? 1));
  return `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
}

interface RenderEnv {
  runtime: LocalRuntime;
  urlPolicy?: LocalUrlPolicy;
}

function renderNodes(
  env: RenderEnv,
  nodes: LocalNode[] | undefined,
  visible: boolean,
  block = true,
): ReactNode {
  if (!nodes || nodes.length === 0) return null;
  return nodes.map((node, index) => renderNode(env, node, index, visible, block));
}

/**
 * Unsupported syntax is preserved as inert source. The parser stores the exact
 * original text in `value`; falling back to the document range keeps older or
 * hand-built trees readable without ever interpreting their contents.
 */
function fallbackSource(env: RenderEnv, node: LocalNode): string {
  if (typeof node.value === 'string') return node.value;
  const { start, end } = node.range;
  if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start) {
    return env.runtime.document.source.slice(start, end);
  }
  return '';
}

function renderFallback(env: RenderEnv, node: LocalNode, key: string, block: boolean): ReactNode {
  return (
    <span
      key={key}
      className={block ? 'local-fallback local-fallback-block' : 'local-fallback local-fallback-inline'}
      title="未支持的语法，已按源码原样显示"
      data-local-fallback=""
    >
      {fallbackSource(env, node)}
    </span>
  );
}

/** Render block-parsed children as inline content for labels and options. */
function renderInlineNodes(env: RenderEnv, nodes: LocalNode[] | undefined, visible: boolean): ReactNode {
  if (!nodes || nodes.length === 0) return null;
  return nodes.map((node, index) => {
    if (node.type === 'paragraph' || node.type === 'root') {
      return (
        <span key={node.id || `inline-${index}`}>
          {renderNodes(env, node.children, visible, false)}
        </span>
      );
    }
    return renderNode(env, node, index, visible, false);
  });
}

function renderNode(
  env: RenderEnv,
  node: LocalNode,
  index: number,
  visible: boolean,
  block = true,
): ReactNode {
  const key = node.id || `${node.type}-${index}`;

  if (node.type === 'component') {
    return (
      <LocalErrorBoundary key={key} revision={runtimeRevision(env.runtime)}>
        {renderComponent(node, visible)}
      </LocalErrorBoundary>
    );
  }

  switch (node.type) {
    case 'root':
      return <div key={key}>{renderNodes(env,node.children, visible)}</div>;

    case 'heading':
      return createElement(
        headingTag(node.depth),
        { key },
        renderNodes(env,node.children, visible, false),
      );

    case 'paragraph':
      return <p key={key}>{renderNodes(env,node.children, visible, false)}</p>;

    case 'text':
      return <span key={key}>{node.value ?? ''}</span>;

    case 'emphasis':
      return <em key={key}>{renderNodes(env,node.children, visible, false)}</em>;

    case 'strong':
      return <strong key={key}>{renderNodes(env,node.children, visible, false)}</strong>;

    case 'delete':
      return <del key={key}>{renderNodes(env,node.children, visible, false)}</del>;

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
      return <blockquote key={key}>{renderNodes(env,node.children, visible)}</blockquote>;

    case 'break':
      return <br key={key} />;

    case 'thematicBreak':
      return <hr key={key} />;

    case 'list':
      return node.ordered ? (
        <ol key={key} start={node.start ?? 1} className="md-list">
          {renderNodes(env,node.children, visible)}
        </ol>
      ) : (
        <ul key={key} className="md-list">
          {renderNodes(env,node.children, visible)}
        </ul>
      );

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
          {renderNodes(env,node.children, visible)}
        </li>
      );
    }

    case 'link': {
      const href = safeUrl(node.url, 'link', env.urlPolicy);
      if (!href) {
        return (
          <span className="md-link-rejected" key={key} title="已拒绝不安全的链接地址">
            {renderNodes(env,node.children, visible, false)}
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
          {renderNodes(env,node.children, visible, false)}
        </a>
      );
    }

    case 'image': {
      const src = safeUrl(node.url, 'image', env.urlPolicy);
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
          referrerPolicy="no-referrer"
        />
      );
    }

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
                  <tr key={row.id || `${key}-row-${rowIndex}`}>
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
      try {
        const text = scalarText(env.runtime.evaluate(node.value ?? ''));
        if (text === null) throw new Error('无法显示数组');
        return (
          <span className="local-interpolation" key={key}>
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
        >
          <LocalErrorBoundary revision={runtimeRevision(env.runtime)}>
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

    case 'fallback':
      return renderFallback(env, node, key, block);

    // The parser turns unsupported footnotes into `fallback` nodes. These
    // branches only see a raw Markdown footnote AST (older trees or a partial
    // parse) and keep it visible instead of silently dropping it.
    case 'footnoteReference':
      return renderFallback(env, node, key, false);

    case 'footnoteDefinition':
      return renderFallback(env, node, key, block);

    case 'comment':
    case 'definition':
      return null;

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
  env: RenderEnv,
  row: LocalNode,
  tag: 'th' | 'td',
  tableAlign: ('left' | 'center' | 'right' | null)[] | undefined,
  visible: boolean,
): ReactNode {
  return (row.children ?? []).map((cell, index) => {
    const textAlign = cell.align?.[0] ?? row.align?.[index] ?? tableAlign?.[index] ?? undefined;
    if (tag === 'th') {
      return (
        <th key={cell.id || `${row.id}-h-${index}`} style={{ textAlign: textAlign ?? undefined }}>
          {renderNodes(env,cell.children, visible, false)}
        </th>
      );
    }
    return (
      <td key={cell.id || `${row.id}-c-${index}`} style={{ textAlign: textAlign ?? undefined }}>
        {renderNodes(env,cell.children, visible, false)}
      </td>
    );
  });
}

function renderComponent(node: LocalNode, visible: boolean): ReactNode {
  const name = node.name ?? '';
  if (VISUAL_COMPONENTS.has(name)) {
    return <VisualView node={node} visible={visible} />;
  }
  const View = COMPONENTS[name];
  if (!View) {
    return <span className="component-error">未知组件“{name || '（缺少名称）'}”</span>;
  }
  return <View node={node} visible={visible} />;
}

function VisualView({ node, visible }: LocalComponentProps) {
  const { runtime, render } = useLocal();
  return (
    <LocalVisual
      node={node}
      runtime={runtime}
      render={render}
      visible={visible}
    />
  );
}

/* ----------------------------------------------------------------- inputs */

function FieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <span className="field-error" role="alert">
      {message}
    </span>
  );
}

function textProblem(
  value: string,
  options: {
    required: boolean;
    minLength?: number;
    maxLength?: number;
    email?: boolean;
  },
): string | null {
  if (options.required && value.length === 0) return '请填写此字段';
  // Check the shared hard limit before the linear email shape check, so a huge
  // draft never reaches format validation.
  if (value.length > MAX_LOCAL_STRING_LENGTH) {
    return `最多允许 ${MAX_LOCAL_STRING_LENGTH} 个字符`;
  }
  if (options.email && value !== '' && !isLocalEmail(value)) return '请输入有效的邮箱地址';
  const length = value.length;
  if (options.minLength !== undefined && options.minLength > 0 && value !== '' && length < options.minLength) {
    return `至少需要 ${options.minLength} 个字符`;
  }
  if (options.maxLength !== undefined && options.maxLength >= 0 && length > options.maxLength) {
    return `最多允许 ${options.maxLength} 个字符`;
  }
  return null;
}

function InputView({ node }: LocalComponentProps) {
  const domId = useId();
  const { runtime } = useLocal();
  const { write, error, setError } = useWriter(node);
  const label = textAttr(runtime, node, 'label', node.name ?? '输入');
  const placeholder = textAttr(runtime, node, 'placeholder', '');
  const typeRaw = rawAttr(node, 'type') ?? 'text';
  const email = typeRaw === 'email';
  const required = boolAttr(runtime, node, 'required', false);
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const minLengthRaw = rawAttr(node, 'min-length');
  const maxLengthRaw = rawAttr(node, 'max-length');
  const minLength = minLengthRaw !== undefined
    ? Math.max(0, Math.floor(numberAttr(runtime, node, 'min-length', 0)))
    : undefined;
  const maxLength = maxLengthRaw !== undefined
    ? Math.max(0, Math.floor(numberAttr(runtime, node, 'max-length', 0)))
    : undefined;
  const display = displayValue(currentValue(runtime, node));

  const [draft, setDraft] = useState(display);
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const composing = useRef(false);
  const lastDisplay = useRef(display);
  const displayRef = useRef(display);
  displayRef.current = display;

  useEffect(() => {
    if (lastDisplay.current !== display) {
      lastDisplay.current = display;
      if (!focused && !composing.current) setDraft(display);
    }
  }, [display, focused]);

  useResetToken(runtime, node, () => {
    composing.current = false;
    setDraft(displayRef.current);
    setTouched(false);
    setDraftError(null);
    setError(null);
  });

  const problemFor = (value: string) =>
    textProblem(value, { required, minLength, maxLength, email });

  return (
    <div className={`md-control local-input${email ? ' local-input-email' : ''}`}>
      <label className="md-label" htmlFor={`${domId}-input`}>
        {label}
      </label>
      <input
        id={`${domId}-input`}
        className="md-text-input"
        type={email ? 'email' : 'text'}
        value={draft}
        placeholder={placeholder || undefined}
        disabled={disabled}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        aria-invalid={draftError || error ? true : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setTouched(true);
          const problem = problemFor(draft);
          setDraftError(problem);
          if (!problem && draft !== display) write(draft);
        }}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const value = event.target.value;
          setDraft(value);
          setError(null);
          if (touched) setDraftError(problemFor(value));
          if (!composing.current && problemFor(value) === null) write(value);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          const value = event.currentTarget.value;
          setDraft(value);
          if (touched) setDraftError(problemFor(value));
          if (problemFor(value) === null) write(value);
        }}
      />
      <FieldError message={disabledInvalid ? '无法计算' : (draftError ?? error)} />
    </div>
  );
}

function TextareaView({ node }: LocalComponentProps) {
  const domId = useId();
  const { runtime } = useLocal();
  const { write, error, setError } = useWriter(node);
  const label = textAttr(runtime, node, 'label', '文本');
  const placeholder = textAttr(runtime, node, 'placeholder', '');
  const rows = Math.min(40, Math.max(1, Math.floor(numberAttr(runtime, node, 'rows', 4))));
  const required = boolAttr(runtime, node, 'required', false);
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const minLengthRaw = rawAttr(node, 'min-length');
  const maxLengthRaw = rawAttr(node, 'max-length');
  const minLength = minLengthRaw !== undefined
    ? Math.max(0, Math.floor(numberAttr(runtime, node, 'min-length', 0)))
    : undefined;
  const maxLength = maxLengthRaw !== undefined
    ? Math.max(0, Math.floor(numberAttr(runtime, node, 'max-length', 0)))
    : undefined;
  const display = displayValue(currentValue(runtime, node));

  const [draft, setDraft] = useState(display);
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const composing = useRef(false);
  const lastDisplay = useRef(display);
  const displayRef = useRef(display);
  displayRef.current = display;

  useEffect(() => {
    if (lastDisplay.current !== display) {
      lastDisplay.current = display;
      if (!focused && !composing.current) setDraft(display);
    }
  }, [display, focused]);

  useResetToken(runtime, node, () => {
    composing.current = false;
    setDraft(displayRef.current);
    setTouched(false);
    setDraftError(null);
    setError(null);
  });

  const problemFor = (value: string) =>
    textProblem(value, { required, minLength, maxLength });

  return (
    <div className="md-control local-textarea">
      <label className="md-label" htmlFor={`${domId}-textarea`}>
        {label}
      </label>
      <textarea
        id={`${domId}-textarea`}
        className="md-text-input"
        rows={rows}
        value={draft}
        placeholder={placeholder || undefined}
        disabled={disabled}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        aria-invalid={draftError || error ? true : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setTouched(true);
          const problem = problemFor(draft);
          setDraftError(problem);
          if (!problem && draft !== display) write(draft);
        }}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
          const value = event.target.value;
          setDraft(value);
          setError(null);
          if (touched) setDraftError(problemFor(value));
          if (!composing.current && problemFor(value) === null) write(value);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          const value = event.currentTarget.value;
          setDraft(value);
          if (touched) setDraftError(problemFor(value));
          if (problemFor(value) === null) write(value);
        }}
      />
      <FieldError message={disabledInvalid ? '无法计算' : (draftError ?? error)} />
    </div>
  );
}

type NumberDraft =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'valid'; value: number };
function parseNumberDraft(text: string): NumberDraft {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === '-' || trimmed === '+' || trimmed === '.' || trimmed === '-.') {
    return { kind: 'empty' };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { kind: 'invalid' };
  return { kind: 'valid', value };
}

function numberProblem(
  value: number,
  min: number | undefined,
  max: number | undefined,
  step: number,
): string | null {
  const tolerance = 1e-9 * Math.max(1, Math.abs(value));
  if (min !== undefined && value < min - tolerance) return `不能小于 ${min}`;
  if (max !== undefined && value > max + tolerance) return `不能大于 ${max}`;
  if (!Number.isFinite(step) || step <= 0) return '步长必须大于 0';
  const base = min ?? 0;
  const quotient = (value - base) / step;
  const nearest = Math.round(quotient);
  if (Math.abs(quotient - nearest) > 1e-9 * Math.max(1, Math.abs(quotient))) {
    return `需要按步长 ${step} 取值`;
  }
  return null;
}

function NumberView({ node }: LocalComponentProps) {
  const domId = useId();
  const { runtime } = useLocal();
  const { write, error, setError } = useWriter(node);
  const label = textAttr(runtime, node, 'label', '数字');
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const minPresent = rawAttr(node, 'min') !== undefined;
  const maxPresent = rawAttr(node, 'max') !== undefined;
  const min = minPresent ? numberAttr(runtime, node, 'min', 0) : undefined;
  const max = maxPresent ? numberAttr(runtime, node, 'max', 0) : undefined;
  const step = numberAttr(runtime, node, 'step', 1);
  const stored = currentValue(runtime, node);
  const display = typeof stored === 'number' && Number.isFinite(stored) ? String(stored) : '';

  const [draft, setDraft] = useState(display);
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const composing = useRef(false);
  const lastDisplay = useRef(display);
  const displayRef = useRef(display);
  displayRef.current = display;

  useEffect(() => {
    if (lastDisplay.current !== display) {
      lastDisplay.current = display;
      if (!focused && !composing.current) setDraft(display);
    }
  }, [display, focused]);

  useResetToken(runtime, node, () => {
    composing.current = false;
    setDraft(displayRef.current);
    setTouched(false);
    setDraftError(null);
    setError(null);
  });

  const commitText = (text: string, reportProblem: boolean): boolean => {
    const parsed = parseNumberDraft(text);
    if (parsed.kind !== 'valid') {
      if (reportProblem) setDraftError('请输入有效数字');
      return false;
    }
    const problem = numberProblem(parsed.value, min, max, step);
    if (problem) {
      if (reportProblem) setDraftError(problem);
      return false;
    }
    setDraftError(null);
    return write(parsed.value);
  };

  return (
    <div className="md-control local-number">
      <label className="md-label" htmlFor={`${domId}-number`}>
        {label}
      </label>
      <input
        id={`${domId}-number`}
        className="md-text-input"
        type="text"
        inputMode="decimal"
        value={draft}
        disabled={disabled}
        aria-invalid={draftError || error ? true : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setTouched(true);
          commitText(draft, true);
        }}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const text = event.target.value;
          setDraft(text);
          setError(null);
          if (!composing.current) commitText(text, touched);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          commitText(event.currentTarget.value, touched);
        }}
      />
      {min !== undefined || max !== undefined || step !== undefined ? (
        <span className="md-hint">
          {min !== undefined ? `最小 ${min}` : ''}
          {min !== undefined && max !== undefined ? ' · ' : ''}
          {max !== undefined ? `最大 ${max}` : ''}
          {step !== undefined ? ` · 步长 ${step}` : ''}
        </span>
      ) : null}
      <FieldError message={disabledInvalid ? '无法计算' : (draftError ?? error)} />
    </div>
  );
}

function SliderView({ node }: LocalComponentProps) {
  const domId = useId();
  const { runtime } = useLocal();
  const { write, error } = useWriter(node);
  const label = textAttr(runtime, node, 'label', '滑块');
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const min = numberAttr(runtime, node, 'min', 0);
  const max = numberAttr(runtime, node, 'max', 100);
  const step = numberAttr(runtime, node, 'step', 1);
  const stored = currentValue(runtime, node);
  const rawValue = typeof stored === 'number' && Number.isFinite(stored) ? stored : min;
  const value = Math.min(max, Math.max(min, rawValue));

  return (
    <div className="md-control md-slider local-slider">
      <label className="md-label" htmlFor={`${domId}-slider`}>
        <span>{label}</span>
        <span className="md-slider-value" aria-hidden="true">
          {value}
        </span>
      </label>
      <input
        id={`${domId}-slider`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event: ChangeEvent<HTMLInputElement>) => write(Number(event.target.value))}
      />
      <FieldError message={disabledInvalid ? '无法计算' : error} />
    </div>
  );
}

function ToggleView({ node }: LocalComponentProps) {
  const domId = useId();
  const { runtime } = useLocal();
  const { write, error } = useWriter(node);
  const label = textAttr(runtime, node, 'label', '开关');
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const checked = currentValue(runtime, node) === true;

  return (
    <div className="md-control md-toggle local-toggle">
      <label className="md-toggle-label" htmlFor={`${domId}-toggle`}>
        <input
          id={`${domId}-toggle`}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event: ChangeEvent<HTMLInputElement>) => write(event.target.checked)}
        />
        <span>{label}</span>
      </label>
      <FieldError message={disabledInvalid ? '无法计算' : error} />
    </div>
  );
}

function CheckboxView({ node }: LocalComponentProps) {
  const domId = useId();
  const { runtime } = useLocal();
  const { write, error } = useWriter(node);
  const label = textAttr(runtime, node, 'label', '勾选');
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const checked = currentValue(runtime, node) === true;

  return (
    <div className="md-control local-checkbox">
      <label className="md-toggle-label" htmlFor={`${domId}-checkbox`}>
        <input
          id={`${domId}-checkbox`}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event: ChangeEvent<HTMLInputElement>) => write(event.target.checked)}
        />
        <span>{label}</span>
      </label>
      <FieldError message={disabledInvalid ? '无法计算' : error} />
    </div>
  );
}

function DateView({ node }: LocalComponentProps) {
  const domId = useId();
  const { runtime } = useLocal();
  const { write, error } = useWriter(node);
  const label = textAttr(runtime, node, 'label', '日期');
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const required = boolAttr(runtime, node, 'required', false);
  const min = textAttr(runtime, node, 'min', '');
  const max = textAttr(runtime, node, 'max', '');
  const stored = currentValue(runtime, node);
  const value = typeof stored === 'string' ? stored : '';
  const [touched, setTouched] = useState(false);
  const problem = touched && required && value === '' ? '请选择日期' : null;

  return (
    <div className="md-control local-date">
      <label className="md-label" htmlFor={`${domId}-date`}>
        {label}
      </label>
      <input
        id={`${domId}-date`}
        className="md-text-input"
        type="date"
        value={value}
        min={min || undefined}
        max={max || undefined}
        required={required}
        disabled={disabled}
        aria-invalid={problem || error ? true : undefined}
        onBlur={() => setTouched(true)}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setTouched(true);
          write(event.target.value);
        }}
      />
      <FieldError message={disabledInvalid ? '无法计算' : (problem ?? error)} />
    </div>
  );
}

/* --------------------------------------------------------------- choices */

interface ChoiceOption {
  value: string;
  node: LocalNode;
}

function readOptions(node: LocalNode): ChoiceOption[] {
  return (node.children ?? [])
    .filter((child) => child.type === 'component' && child.name === 'option')
    .map((child, index) => ({
      value: rawAttr(child, 'value') ?? `option-${index + 1}`,
      node: child,
    }));
}

function inlinePlainText(runtime: LocalRuntime, nodes: LocalNode[] | undefined): string {
  if (!nodes) return '';
  let text = '';
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'inlineCode') {
      text += node.value ?? '';
    } else if (node.type === 'fallback') {
      text += node.value ?? '';
    } else if (node.type === 'interpolation') {
      try {
        text += scalarText(runtime.evaluate(node.value ?? '')) ?? '';
      } catch {
        text += '无法计算';
      }
    } else if (node.type === 'break') {
      text += ' ';
    } else {
      text += inlinePlainText(runtime, node.children);
    }
  }
  return text;
}

function optionLabel(runtime: LocalRuntime, node: LocalNode): string {
  return inlinePlainText(runtime, node.children) || rawAttr(node, 'value') || '';
}

function OptionView() {
  return null;
}

function SelectView({ node }: LocalComponentProps) {
  const domId = useId();
  const { runtime } = useLocal();
  const { write, error } = useWriter(node);
  const label = textAttr(runtime, node, 'label', '选择');
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const options = readOptions(node);
  const stored = currentValue(runtime, node);
  const current = typeof stored === 'string' ? stored : '';
  const active = options.some((option) => option.value === current)
    ? current
    : options[0]?.value ?? '';

  if (options.length === 0) return <LocalError message="缺少选项" />;

  return (
    <div className="md-control md-select local-select">
      <label className="md-label" htmlFor={`${domId}-select`}>
        {label}
      </label>
      <select
        id={`${domId}-select`}
        className="md-select-input"
        value={active}
        disabled={disabled}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => write(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.node.id} value={option.value}>
            {optionLabel(runtime, option.node) || option.value}
          </option>
        ))}
      </select>
      <FieldError message={disabledInvalid ? '无法计算' : error} />
    </div>
  );
}

function ChoicesView({ node, visible }: LocalComponentProps) {
  const domId = useId();
  const local = useLocal();
  const { runtime } = local;
  const { write, error } = useWriter(node);
  const label = textAttr(runtime, node, 'label', '选项');
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const options = readOptions(node);
  const stored = currentValue(runtime, node);
  const current = typeof stored === 'string' ? stored : '';
  const selectedIndex = options.findIndex((option) => option.value === current);
  const activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  if (options.length === 0) return <LocalError message="缺少选项" />;

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    write(option.value);
    refs.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    if (next < 0) return;
    event.preventDefault();
    choose(next);
  };

  return (
    <div className="md-control local-choices">
      <span className="md-label" id={`${domId}-choices-label`}>
        {label}
      </span>
      <div
        className="local-choice-list"
        role="radiogroup"
        aria-labelledby={`${domId}-choices-label`}
        aria-disabled={disabled || undefined}
      >
        {options.map((option, index) => {
          const selected = option.value === current;
          return (
            <button
              key={option.node.id}
              ref={(element) => {
                refs.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={index === activeIndex ? 0 : -1}
              disabled={disabled}
              className={`local-choice${selected ? ' is-selected' : ''}`}
              onClick={() => write(option.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {renderInlineNodes(local, option.node.children, visible)}
            </button>
          );
        })}
      </div>
      <FieldError message={disabledInvalid ? '无法计算' : error} />
    </div>
  );
}

function RadioGroupView({ node, visible }: LocalComponentProps) {
  const domId = useId();
  const local = useLocal();
  const { runtime } = local;
  const { write, error } = useWriter(node);
  const label = textAttr(runtime, node, 'label', '选项');
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const options = readOptions(node);
  const stored = currentValue(runtime, node);
  const current = typeof stored === 'string' ? stored : '';
  const name = domId;

  if (options.length === 0) return <LocalError message="缺少选项" />;

  return (
    <fieldset className="md-control local-radio-group" disabled={disabled}>
      <legend className="md-label">{label}</legend>
      {options.map((option) => (
        <label className="local-radio-option" key={option.node.id}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={current === option.value}
            onChange={() => write(option.value)}
          />
          <span>{renderInlineNodes(local, option.node.children, visible)}</span>
        </label>
      ))}
      <FieldError message={disabledInvalid ? '无法计算' : error} />
    </fieldset>
  );
}

/* -------------------------------------------------------------- checklist */

interface ChecklistItem {
  id: string;
  node: LocalNode;
}

function readChecklistItems(node: LocalNode): ChecklistItem[] {
  const list = (node.children ?? []).find((child) => child.type === 'list');
  return (list?.children ?? [])
    .filter((child) => child.type === 'listItem')
    .map((child, index) => ({ id: `item-${index + 1}`, node: child }));
}

function ChecklistView({ node, visible }: LocalComponentProps) {
  const domId = useId();
  const local = useLocal();
  const { runtime } = local;
  const { write, error } = useWriter(node);
  const label = textAttr(runtime, node, 'label', '清单');
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const items = readChecklistItems(node);
  const stored = currentValue(runtime, node);
  const selected = Array.isArray(stored)
    ? stored.filter((value): value is string => typeof value === 'string')
    : [];

  if (items.length === 0) return <LocalError message="清单需要任务列表" />;

  const toggle = (id: string, checked: boolean) => {
    const chosen = new Set(selected);
    if (checked) chosen.add(id);
    else chosen.delete(id);
    write(items.filter((item) => chosen.has(item.id)).map((item) => item.id));
  };

  return (
    <fieldset className="local-checklist" disabled={disabled}>
      <legend className="md-label">{label}</legend>
      {items.map((item) => (
        <div className="local-checklist-item" key={item.id}>
          <input
            id={`${domId}-${item.id}`}
            type="checkbox"
            checked={selected.includes(item.id)}
            onChange={(event) => toggle(item.id, event.target.checked)}
          />
          <label className="local-checklist-text" htmlFor={`${domId}-${item.id}`}>
            {renderInlineNodes(local, item.node.children, visible)}
          </label>
        </div>
      ))}
      <FieldError message={disabledInvalid ? '无法计算' : error} />
    </fieldset>
  );
}

/* ------------------------------------------------------- counter & timer */

function formatSeconds(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  if (minutes === 0) return `${rest} 秒`;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function CounterView({ node }: LocalComponentProps) {
  const { runtime } = useLocal();
  const { write, error } = useWriter(node);
  const label = textAttr(runtime, node, 'label', '计数');
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const min = numberAttr(runtime, node, 'min', 0);
  const maxPresent = rawAttr(node, 'max') !== undefined;
  const max = maxPresent ? numberAttr(runtime, node, 'max', 0) : undefined;
  const step = numberAttr(runtime, node, 'step', 1);
  const stored = currentValue(runtime, node);
  const value = typeof stored === 'number' && Number.isFinite(stored) ? stored : min;
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
  const tolerance = 1e-9 * Math.max(1, Math.abs(value));
  const canDecrease = value - safeStep >= min - tolerance;
  const canIncrease = max === undefined || value + safeStep <= max + tolerance;

  const change = (direction: 1 | -1) => {
    const next = Number((value + direction * safeStep).toFixed(12));
    write(next);
  };

  const reset = () => {
    try {
      runtime.reset(node);
    } catch {
      /* A disposed runtime has no state to restore. */
    }
  };

  return (
    <div className="local-counter" role="group" aria-label={label}>
      <span className="md-label">{label}</span>
      <div className="local-counter-row">
        <button
          type="button"
          className="md-button md-button-secondary local-counter-button"
          aria-label={`${label} 减少`}
          disabled={disabled || !canDecrease}
          onClick={() => change(-1)}
        >
          −
        </button>
        <span className="local-counter-value" aria-live="polite">
          {value}
        </span>
        <button
          type="button"
          className="md-button md-button-secondary local-counter-button"
          aria-label={`${label} 增加`}
          disabled={disabled || !canIncrease}
          onClick={() => change(1)}
        >
          +
        </button>
        <button
          type="button"
          className="md-button md-button-quiet local-counter-reset"
          disabled={disabled}
          onClick={reset}
        >
          恢复初值
        </button>
      </div>
      <FieldError message={disabledInvalid ? '无法计算' : error} />
    </div>
  );
}

function TimerView({ node, visible }: LocalComponentProps) {
  const { runtime } = useLocal();
  const label = textAttr(runtime, node, 'label', '计时器');
  const durationRaw = numberAttr(runtime, node, 'duration', 60);
  const duration = Math.floor(durationRaw);
  const stored = currentValue(runtime, node);
  const remaining = typeof stored === 'number' && Number.isFinite(stored)
    ? Math.max(0, Math.ceil(stored))
    : duration;

  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const deadline = useRef(0);
  const valueRef = useRef(remaining);
  valueRef.current = remaining;
  const [error, setError] = useState<string | null>(null);

  const commit = useCallback(
    (seconds: number) => {
      try {
        const diagnostics = runtime.set(node, seconds);
        if (diagnostics.length) {
          setError(diagnostics.map((item) => item.message).join('；'));
        }
      } catch {
        /* A disposed runtime cannot accept more ticks. */
      }
    },
    [node, runtime],
  );

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const next = Math.max(0, Math.ceil((deadline.current - performance.now()) / 1000));
      if (next !== valueRef.current) {
        valueRef.current = next;
        commit(next);
      }
      if (next <= 0) {
        setRunning(false);
        setCompleted(true);
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [running, commit]);

  useEffect(() => {
    if (visible || !running) return;
    const next = Math.max(0, Math.ceil((deadline.current - performance.now()) / 1000));
    valueRef.current = next;
    commit(next);
    setRunning(false);
  }, [visible, running, commit]);

  useResetToken(runtime, node, () => {
    setRunning(false);
    setCompleted(false);
    setError(null);
  });

  if (!Number.isFinite(durationRaw) || duration <= 0) {
    return <LocalError message="计时时长必须是大于 0 的秒数" />;
  }

  const start = () => {
    if (running) return;
    const base = remaining > 0 ? remaining : duration;
    if (remaining <= 0) {
      valueRef.current = duration;
      commit(duration);
    }
    deadline.current = performance.now() + base * 1000;
    setCompleted(false);
    setError(null);
    setRunning(true);
  };

  const pause = () => {
    if (!running) return;
    const next = Math.max(0, Math.ceil((deadline.current - performance.now()) / 1000));
    valueRef.current = next;
    commit(next);
    setRunning(false);
  };

  const reset = () => {
    setRunning(false);
    setCompleted(false);
    setError(null);
    valueRef.current = duration;
    try {
      runtime.reset(node);
    } catch {
      /* A disposed runtime has no state to restore. */
    }
  };

  return (
    <div className="local-timer" role="group" aria-label={label}>
      <div className="local-timer-head">
        <span className="md-label">{label}</span>
        <span className="local-timer-value" role="timer" aria-label={`剩余 ${remaining} 秒`}>
          {formatSeconds(remaining)}
        </span>
      </div>
      <div className="local-timer-controls">
        <button
          type="button"
          className="md-button md-button-primary"
          onClick={start}
          disabled={running}
        >
          开始
        </button>
        <button
          type="button"
          className="md-button md-button-secondary"
          onClick={pause}
          disabled={!running}
        >
          暂停
        </button>
        <button type="button" className="md-button md-button-quiet" onClick={reset}>
          重置
        </button>
      </div>
      <span className="local-timer-status" role="status" aria-live="polite">
        {completed ? '计时完成' : running ? '计时中' : '已暂停'}
      </span>
      <FieldError message={error} />
    </div>
  );
}

function ProgressView({ node }: LocalComponentProps) {
  const { runtime } = useLocal();
  const label = textAttr(runtime, node, 'label', '进度');
  const max = numberAttr(runtime, node, 'max', 100);
  const read = readAttr(runtime, node, 'value');

  if (!Number.isFinite(max) || max <= 0) {
    return <LocalError message="进度上限必须是正数" />;
  }
  if (!read.present || !read.ok) return <LocalError />;
  const raw = read.value;
  const numeric = typeof raw === 'number'
    ? raw
    : typeof raw === 'string' && raw.trim() !== ''
      ? Number(raw)
      : Number.NaN;
  if (!Number.isFinite(numeric)) return <LocalError />;
  if (numeric < 0 || numeric > max) {
    return <LocalError message={`进度值需要在 0 到 ${max} 之间`} />;
  }
  const percent = (numeric / max) * 100;

  return (
    <div className="local-progress">
      <div className="local-progress-head">
        <span className="md-label">{label}</span>
        <span className="local-progress-value">{Math.round(percent)}%</span>
      </div>
      <div
        className="local-progress-track"
        role="progressbar"
        aria-label={label || '进度'}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={numeric}
      >
        <div className="local-progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- layout */

function PanelView({ node, visible }: LocalComponentProps) {
  const { runtime, render } = useLocal();
  const title = textAttr(runtime, node, 'title', '');
  const resettable = boolAttr(runtime, node, 'reset', true);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    try {
      runtime.reset(node);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法恢复默认');
    }
  };

  return (
    <section className="local-panel" aria-label={title || '参数面板'}>
      {title || resettable ? (
        <div className="local-panel-head">
          {title ? <h3 className="local-panel-title">{title}</h3> : <span />}
          {resettable ? (
            <button
              type="button"
              className="md-button md-button-quiet local-panel-reset"
              onClick={reset}
              aria-label={title ? `${title} 恢复默认` : '恢复默认'}
            >
              恢复默认
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="local-panel-body">{render(node.children ?? [], visible)}</div>
      <FieldError message={error} />
    </section>
  );
}

function CardView({ node, visible }: LocalComponentProps) {
  const { runtime, render } = useLocal();
  const title = textAttr(runtime, node, 'title', '');
  return (
    <section className="md-card local-card">
      {title ? <h3 className="md-card-title">{title}</h3> : null}
      <div className="md-card-body">{render(node.children ?? [], visible)}</div>
    </section>
  );
}

function GridView({ node, visible }: LocalComponentProps) {
  const { runtime, render } = useLocal();
  const columns = Math.min(4, Math.max(1, Math.floor(numberAttr(runtime, node, 'columns', 2))));
  const style = { '--local-grid-columns': String(columns) } as CSSProperties;
  return (
    <div className="local-grid" style={style}>
      {render(node.children ?? [], visible)}
    </div>
  );
}

function TabView({ node, visible }: LocalComponentProps) {
  const { render } = useLocal();
  return <div className="local-tabpanel-body">{render(node.children ?? [], visible)}</div>;
}

function EdgeView() {
  return null;
}

function TabsView({ node, visible }: LocalComponentProps) {
  const domId = useId();
  const { runtime, render } = useLocal();
  const { write, error } = useWriter(node);
  const label = textAttr(runtime, node, 'label', '');
  const tabs = (node.children ?? []).filter(
    (child) => child.type === 'component' && child.name === 'tab',
  );
  const values = tabs.map((tab, index) => rawAttr(tab, 'value') ?? `tab-${index + 1}`);
  const labels = tabs.map((tab, index) => textAttr(runtime, tab, 'label', values[index]));
  const initial = rawAttr(node, 'initial') ?? values[0] ?? '';
  const bound = rawAttr(node, 'bind') !== undefined;
  const stored = currentValue(runtime, node);
  const boundValue = typeof stored === 'string' ? stored : '';
  const [selected, setSelected] = useState(() => (values.includes(initial) ? initial : values[0] ?? ''));
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  useResetToken(runtime, node, () => {
    setSelected(values.includes(initial) ? initial : values[0] ?? '');
  });

  if (tabs.length === 0) return <LocalError message="标签页至少需要一个 tab" />;

  const current = bound
    ? values.includes(boundValue) ? boundValue : values[0]
    : values.includes(selected) ? selected : values[0];
  const activeIndex = Math.max(0, values.indexOf(current));

  const choose = (index: number) => {
    const value = values[index];
    if (value === undefined) return;
    if (bound) write(value);
    else setSelected(value);
    refs.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next = -1;
    if (event.key === 'ArrowRight') next = (activeIndex + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (activeIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    choose(next);
  };

  return (
    <section className="local-tabs" aria-label={label || '选项卡'}>
      {label ? <div className="local-tabs-label">{label}</div> : null}
      <div className="local-tablist" role="tablist" aria-label={label || '选项卡'} onKeyDown={onKeyDown}>
        {tabs.map((tab, index) => {
          const value = values[index];
          const active = value === current;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                refs.current[index] = element;
              }}
              id={`${domId}-tab-${index}`}
              type="button"
              role="tab"
              className={`local-tab${active ? ' is-selected' : ''}`}
              aria-selected={active}
              aria-controls={`${domId}-panel-${index}`}
              tabIndex={active ? 0 : -1}
              onClick={() => {
                if (bound) write(value);
                else setSelected(value);
              }}
            >
              {labels[index]}
            </button>
          );
        })}
      </div>
      {tabs.map((tab, index) => {
        const value = values[index];
        const active = value === current;
        return (
          <div
            key={tab.id}
            id={`${domId}-panel-${index}`}
            className="local-tabpanel"
            role="tabpanel"
            aria-labelledby={`${domId}-tab-${index}`}
            tabIndex={0}
            hidden={!active}
          >
            {render(tab.children ?? [], visible && active)}
          </div>
        );
      })}
      <FieldError message={error} />
    </section>
  );
}

function AccordionView({ node, visible }: LocalComponentProps) {
  const { runtime, render } = useLocal();
  const label = textAttr(runtime, node, 'label', '');
  return (
    <div className="local-accordion" role="group" aria-label={label || '折叠面板'}>
      {label ? <div className="local-accordion-label">{label}</div> : null}
      {render(node.children ?? [], visible)}
    </div>
  );
}

function DisclosureView({ node, visible }: LocalComponentProps) {
  const domId = useId();
  const { runtime, render } = useLocal();
  const label = textAttr(runtime, node, 'label', '折叠内容');
  const initialOpen = boolAttr(runtime, node, 'open', false);
  const [open, setOpen] = useState(initialOpen);

  useResetToken(runtime, node, () => {
    setOpen(initialOpen);
  });

  const triggerId = `${domId}-disclosure-trigger`;
  const panelId = `${domId}-disclosure-panel`;

  return (
    <div className="local-disclosure">
      <h3 className="local-disclosure-heading">
        <button
          id={triggerId}
          type="button"
          className="local-disclosure-trigger"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          <span className={`local-chevron${open ? ' is-open' : ''}`} aria-hidden="true">
            ▸
          </span>
          <span>{label}</span>
        </button>
      </h3>
      <div
        id={panelId}
        className="local-disclosure-panel"
        role="region"
        aria-labelledby={triggerId}
        hidden={!open}
      >
        {render(node.children ?? [], visible && open)}
      </div>
    </div>
  );
}

function IfView({ node, visible }: LocalComponentProps) {
  const { runtime, render } = useLocal();
  const result = readBooleanAttr(runtime, node, 'when', false);
  const when = result.ok ? result.value : false;
  const conditionError = !result.ok;
  const container = useRef<HTMLDivElement>(null);
  const wasVisible = useRef(when);
  const hadFocus = useRef(false);

  useEffect(() => {
    if (wasVisible.current && !when) {
      if (hadFocus.current) {
        const target = container.current?.closest('.local-document') as HTMLElement | null;
        if (target) {
          target.tabIndex = -1;
          target.focus({ preventScroll: true });
        }
      }
      hadFocus.current = false;
    }
    wasVisible.current = when;
  }, [when]);

  return (
    <>
      {conditionError ? <LocalError /> : null}
      <div
        ref={container}
        className="local-if md-if"
        role="group"
        aria-label="条件内容"
        tabIndex={-1}
        hidden={!when}
        aria-hidden={!when}
        onFocus={() => {
          hadFocus.current = true;
        }}
        onBlur={(event) => {
          if (!container.current?.contains(event.relatedTarget as Node | null)) {
            hadFocus.current = false;
          }
        }}
      >
        {render(node.children ?? [], visible && when)}
      </div>
    </>
  );
}

/* --------------------------------------------------------------- feedback */

function AlertView({ node, visible }: LocalComponentProps) {
  const { runtime, render } = useLocal();
  const title = textAttr(runtime, node, 'title', '');
  const rawTone = rawAttr(node, 'tone') ?? 'info';
  const tone = rawTone === 'success' || rawTone === 'warning' ? rawTone : 'info';
  const role = tone === 'warning' ? 'alert' : 'status';
  return (
    <div className={`local-alert local-alert-${tone}`} role={role}>
      {title ? <div className="local-alert-title">{title}</div> : null}
      <div className="local-alert-body">{render(node.children ?? [], visible)}</div>
    </div>
  );
}

function BadgeView({ node, visible }: LocalComponentProps) {
  const local = useLocal();
  const { runtime } = local;
  const rawTone = rawAttr(node, 'tone') ?? 'neutral';
  const tone = rawTone === 'success' || rawTone === 'warning' ? rawTone : 'neutral';
  return (
    <span className={`md-badge md-badge-${tone} local-badge`}>
      {renderInlineNodes(local, node.children, visible)}
    </span>
  );
}

function TooltipView({ node, visible }: LocalComponentProps) {
  const domId = useId();
  const local = useLocal();
  const { runtime } = local;
  const text = textAttr(runtime, node, 'text', '提示');
  const [open, setOpen] = useState(false);
  const bubbleId = `${domId}-tooltip`;
  return (
    <span
      className="local-tooltip"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        className="local-tooltip-trigger"
        tabIndex={0}
        aria-describedby={bubbleId}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event: KeyboardEvent<HTMLSpanElement>) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        {renderInlineNodes(local, node.children, visible)}
      </span>
      <span
        id={bubbleId}
        role="tooltip"
        className={`local-tooltip-bubble${open ? ' is-visible' : ''}`}
      >
        {text}
      </span>
    </span>
  );
}

const COMPONENTS: Record<string, (props: LocalComponentProps) => ReactNode> = {
  panel: PanelView,
  card: CardView,
  grid: GridView,
  tabs: TabsView,
  tab: TabView,
  accordion: AccordionView,
  disclosure: DisclosureView,
  if: IfView,
  alert: AlertView,
  badge: BadgeView,
  tooltip: TooltipView,
  input: InputView,
  textarea: TextareaView,
  number: NumberView,
  slider: SliderView,
  toggle: ToggleView,
  checkbox: CheckboxView,
  date: DateView,
  select: SelectView,
  choices: ChoicesView,
  'radio-group': RadioGroupView,
  option: OptionView,
  node: TabView,
  edge: EdgeView,
  counter: CounterView,
  timer: TimerView,
  checklist: ChecklistView,
  progress: ProgressView,
};

/* ---------------------------------------------------------------- document */

export function LocalDocumentView({
  document,
  runtime,
  onDiagnostics,
  urlPolicy,
}: LocalDocumentViewProps) {
  const reportRef = useRef(onDiagnostics);
  reportRef.current = onDiagnostics;
  const report = useCallback((diagnostics: Diagnostic[]) => {
    reportRef.current?.(diagnostics);
  }, []);

  const subscribe = useCallback(
    (listener: () => void) => {
      try {
        return runtime.subscribe(listener);
      } catch {
        return () => {};
      }
    },
    [runtime],
  );
  const getSnapshot = useCallback(() => {
    try {
      return runtime.snapshot();
    } catch {
      return EMPTY_SNAPSHOT;
    }
  }, [runtime]);

  // A single subscription drives the whole document. Every control reads the
  // current snapshot through runtime.get during the resulting render.
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const env: RenderEnv = { runtime, urlPolicy };
  const render = (nodes?: LocalNode[], visible = true): ReactNode => (
    <LocalViewContext.Provider value={{ runtime, render, visible, report, urlPolicy }}>
      {renderNodes(env, nodes ?? [], visible)}
    </LocalViewContext.Provider>
  );

  return (
    <article className="md-document local-document" aria-label="交互文档">
      {render(document.nodes, true)}
    </article>
  );
}

export function LocalReactiveDocument({
  source,
  onDiagnostics,
  urlPolicy,
}: LocalReactiveDocumentProps) {
  const result = useMemo(() => compileLocal(source), [source]);
  const runtime = useMemo(() => {
    if (!result.ok) return null;
    try {
      return createLocalRuntime(result.document);
    } catch {
      return null;
    }
  }, [result]);

  const reportRef = useRef(onDiagnostics);
  reportRef.current = onDiagnostics;
  const currentRuntime = useRef(runtime);
  currentRuntime.current = runtime;
  const mounted = useRef(0);

  useEffect(() => {
    mounted.current += 1;
    return () => {
      mounted.current -= 1;
    };
  }, []);

  useEffect(() => {
    reportRef.current?.(result.diagnostics);
  }, [result]);

  useEffect(() => {
    const owned = runtime;
    return () => {
      // StrictMode runs setup, cleanup, then setup synchronously. Deferring
      // disposal one microtask lets that remount re-claim the same runtime
      // (mounted > 0 and still current). A runtime replaced by a new source is
      // no longer current and is disposed even while the document stays mounted.
      queueMicrotask(() => {
        if (currentRuntime.current === owned && mounted.current > 0) return;
        try {
          owned?.dispose();
        } catch {
          /* Disposal is best-effort during unmount. */
        }
      });
    };
  }, [runtime]);

  if (!result.ok || !runtime) {
    return (
      <div className="md-document local-document local-inactive" role="alert">
        <p className="local-inactive-title">
          {result.ok ? '交互初始化失败，预览已停用。' : '文档包含语法错误，交互预览已停用。'}
        </p>
        {result.diagnostics.length ? (
          <ul className="local-inactive-list">
            {result.diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.code}-${index}`}>
                {diagnostic.message}（第 {diagnostic.line} 行，第 {diagnostic.column} 列）
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <LocalDocumentView
      key={source}
      document={result.document}
      runtime={runtime}
      onDiagnostics={onDiagnostics}
      urlPolicy={urlPolicy}
    />
  );
}

