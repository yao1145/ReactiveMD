import {
  Component,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentType,
  type ReactNode,
} from 'react';
import type { Diagnostic, DocumentNode, StateValue } from '../core/types';
import { getComponentSchema } from '../core/schema';
import {
  evalBoolean,
  evalNumber,
  evalString,
  evaluateSource,
  formatValue,
  labelOf,
  useViewer,
} from './context';
import { ADVANCED_COMPONENTS } from './advanced';
import { VISUAL_COMPONENTS } from './visuals';

export interface ComponentProps {
  node: DocumentNode;
  renderChildren: (nodes: DocumentNode[]) => ReactNode;
}

interface ControlError {
  message: string;
  diagnostic?: Diagnostic;
}

function errorFromResult(diagnostics: Diagnostic[]): ControlError {
  return {
    message: diagnostics.length ? diagnostics.map((item) => item.message).join('；') : '操作未生效',
    diagnostic: diagnostics[0],
  };
}

function FieldError({ error }: { error: ControlError | null }) {
  const { focusDiagnostic } = useViewer();
  if (!error) return null;
  return (
    <span className="field-error" role="alert">
      {error.message}
      {error.diagnostic ? (
        <button
          type="button"
          className="diag-link"
          onClick={() => focusDiagnostic(error.diagnostic!.range)}
        >
          第 {error.diagnostic.line} 行
        </button>
      ) : null}
    </span>
  );
}

function useWriter(node: DocumentNode) {
  const { runtime, report } = useViewer();
  const [error, setError] = useState<ControlError | null>(null);
  const write = useCallback(
    (value: StateValue) => {
      const result = runtime.writeBinding(node.id, value);
      if (result.ok) {
        setError(null);
        const action = node.events?.change;
        if (action) void runtime.dispatchAsync(action, { event: { value } }).then(next => {
          if (!next.ok) report(next.diagnostics);
        }).catch(() => { /* A replaced document cancels its outstanding callbacks. */ });
        return true;
      }
      setError(errorFromResult(result.diagnostics));
      report(result.diagnostics);
      return false;
    },
    [node.id, node.events, report, runtime],
  );
  return { write, error, setError };
}

function useActionButton(node: DocumentNode) {
  const { runtime, report, snapshot } = useViewer();
  const [error, setError] = useState<ControlError | null>(null);
  const [pending, setPending] = useState(false);
  const request = useRef(0);
  const run = useCallback(async () => {
    const name = node.events?.click;
    if (!name) {
      setError({ message: '按钮没有绑定动作' });
      return;
    }
    const token = ++request.current;
    setPending(true);
    try {
      const result = await runtime.dispatchAsync(name);
      if (token !== request.current) return;
      if (result.ok) setError(null);
      else {
        setError(errorFromResult(result.diagnostics));
        report(result.diagnostics);
      }
    } catch (cause) {
      if (token !== request.current) return;
      setError({ message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      if (token === request.current) setPending(false);
    }
  }, [node.events, report, runtime]);
  const cancel = () => {
    request.current++;
    if (node.events?.click) runtime.cancel(node.events.click);
    setPending(false);
    setError(null);
  };
  const canCancel = pending && !!snapshot.resources[node.events?.click ?? ''];
  return { run, error, pending, cancel, canCancel };
}

function missingBinding(node: DocumentNode): ControlError | null {
  if (node.binding) return null;
  return { message: '组件缺少 bind 属性' };
}

function useControlLabel(node: DocumentNode): string {
  const { runtime } = useViewer();
  return labelOf(runtime, node, node.name ?? '输入');
}

function InputView({ node }: ComponentProps) {
  const { runtime, snapshot } = useViewer();
  const label = useControlLabel(node);
  const inheritedError = missingBinding(node);
  const { write, error, setError } = useWriter(node);
  const disabled = evalBoolean(runtime, node, 'disabled', false);
  const commitMode = evalString(runtime, node, 'commit', 'input') === 'blur' ? 'blur' : 'input';
  const placeholder = evalString(runtime, node, 'placeholder', '');
  const bound = node.binding ? snapshot.state[node.binding] : '';
  const display = bound === undefined || bound === null ? '' : String(bound);
  const inputId = useId();

  const [draft, setDraft] = useState(display);
  const [focused, setFocused] = useState(false);
  const composing = useRef(false);
  const lastBound = useRef(bound);

  useEffect(() => {
    if (lastBound.current !== bound) {
      lastBound.current = bound;
      if (!focused) setDraft(display);
    }
  }, [bound, display, focused]);

  if (inheritedError) return <FieldError error={inheritedError} />;

  const commit = (value: string) => {
    if (!write(value)) return false;
    return true;
  };

  return (
    <div className="md-control md-input">
      <label className="md-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="md-text-input"
        type="text"
        name={evalString(runtime, node, 'name', node.binding ?? '')}
        required={evalBoolean(runtime, node, 'required', false)}
        pattern={node.props?.pattern ? evalString(runtime, node, 'pattern') : undefined}
        minLength={node.props?.['min-length'] ? evalNumber(runtime, node, 'min-length', 0) : undefined}
        maxLength={node.props?.['max-length'] ? evalNumber(runtime, node, 'max-length', 0) : undefined}
        value={draft}
        placeholder={placeholder || undefined}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (commitMode === 'blur') commit(draft);
        }}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setDraft(event.target.value);
          setError(null);
          if (commitMode === 'input' && !composing.current) commit(event.target.value);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          if (commitMode === 'input') commit(event.currentTarget.value);
        }}
      />
      <FieldError error={error} />
    </div>
  );
}

type NumberDraft = { kind: 'empty' } | { kind: 'invalid' } | { kind: 'valid'; value: number };

function parseNumberDraft(text: string): NumberDraft {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === '-' || trimmed === '+' || trimmed === '.' || trimmed === '-.') {
    return { kind: 'empty' };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { kind: 'invalid' };
  return { kind: 'valid', value };
}

function NumberView({ node }: ComponentProps) {
  const { runtime, snapshot } = useViewer();
  const label = useControlLabel(node);
  const inheritedError = missingBinding(node);
  const { write, error, setError } = useWriter(node);
  const disabled = evalBoolean(runtime, node, 'disabled', false);
  const bound = node.binding ? snapshot.state[node.binding] : '';
  const display = typeof bound === 'number' ? String(bound) : '';
  const inputId = useId();

  const [draft, setDraft] = useState(display);
  const [focused, setFocused] = useState(false);
  const [blurError, setBlurError] = useState<ControlError | null>(null);
  const composing = useRef(false);
  const lastBound = useRef(bound);

  const min = node.props?.min ? evalNumber(runtime, node, 'min', 0) : undefined;
  const max = node.props?.max ? evalNumber(runtime, node, 'max', 0) : undefined;
  const step = node.props?.step ? evalNumber(runtime, node, 'step', 1) : undefined;

  useEffect(() => {
    if (lastBound.current !== bound) {
      lastBound.current = bound;
      if (!focused) {
        setDraft(display);
        setBlurError(null);
        setError(null);
      }
    }
  }, [bound, display, focused, setError]);

  if (inheritedError) return <FieldError error={inheritedError} />;

  const commitDraft = (text: string) => {
    const parsed = parseNumberDraft(text);
    if (parsed.kind !== 'valid') return false;
    return write(parsed.value);
  };

  return (
    <div className="md-control md-number">
      <label className="md-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="md-text-input"
        type="text"
        inputMode="decimal"
        name={evalString(runtime, node, 'name', node.binding ?? '')}
        required={evalBoolean(runtime, node, 'required', false)}
        value={draft}
        disabled={disabled}
        aria-invalid={error || blurError ? true : undefined}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          setFocused(false);
          const parsed = parseNumberDraft(draft);
          if (parsed.kind !== 'valid') {
            setBlurError({ message: '请输入有效数字；状态会保持最后一次合法值' });
            event.currentTarget.setCustomValidity('请输入有效数字');
            return;
          }
          setBlurError(null);
          event.currentTarget.setCustomValidity(write(parsed.value) ? '' : '请输入约束范围内的数字');
        }}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const text = event.target.value;
          setDraft(text);
          setBlurError(null);
          setError(null);
          if (!composing.current) event.currentTarget.setCustomValidity(commitDraft(text) ? '' : '请输入约束范围内的数字');
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          commitDraft(event.currentTarget.value);
        }}
      />
      {min !== undefined || max !== undefined ? (
        <span className="md-hint">
          {min !== undefined ? `最小 ${min}` : ''}
          {min !== undefined && max !== undefined ? ' · ' : ''}
          {max !== undefined ? `最大 ${max}` : ''}
          {step !== undefined ? ` · 步长 ${step}` : ''}
        </span>
      ) : null}
      <FieldError error={blurError ?? error} />
    </div>
  );
}

function SliderView({ node }: ComponentProps) {
  const { runtime, snapshot } = useViewer();
  const label = useControlLabel(node);
  const inheritedError = missingBinding(node);
  const { write, error } = useWriter(node);
  const disabled = evalBoolean(runtime, node, 'disabled', false);
  const min = evalNumber(runtime, node, 'min', 0);
  const max = evalNumber(runtime, node, 'max', 100);
  const step = evalNumber(runtime, node, 'step', 1);
  const bound = node.binding ? snapshot.state[node.binding] : '';
  const numeric = typeof bound === 'number' && Number.isFinite(bound) ? bound : min;
  const inputId = useId();

  if (inheritedError) return <FieldError error={inheritedError} />;

  return (
    <div className="md-control md-slider">
      <label className="md-label" htmlFor={inputId}>
        {label}
        <span className="md-slider-value" aria-hidden="true">{numeric}</span>
      </label>
      <input
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={numeric}
        disabled={disabled}
        onChange={(event: ChangeEvent<HTMLInputElement>) => write(Number(event.target.value))}
      />
      <FieldError error={error} />
    </div>
  );
}

function ToggleView({ node }: ComponentProps) {
  const { runtime, snapshot } = useViewer();
  const label = useControlLabel(node);
  const inheritedError = missingBinding(node);
  const { write, error } = useWriter(node);
  const disabled = evalBoolean(runtime, node, 'disabled', false);
  const bound = node.binding ? snapshot.state[node.binding] : false;
  const checked = bound === true;
  const inputId = useId();

  if (inheritedError) return <FieldError error={inheritedError} />;

  return (
    <div className="md-control md-toggle">
      <label className="md-toggle-label" htmlFor={inputId}>
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event: ChangeEvent<HTMLInputElement>) => write(event.target.checked)}
        />
        <span>{label}</span>
      </label>
      <FieldError error={error} />
    </div>
  );
}

interface SelectOption {
  value: string;
  label: string;
  key: string;
}

function OptionView() {
  return null;
}

function SelectView({ node, renderChildren }: ComponentProps) {
  const { runtime, snapshot } = useViewer();
  const label = useControlLabel(node);
  const inheritedError = missingBinding(node);
  const { write, error } = useWriter(node);
  const disabled = evalBoolean(runtime, node, 'disabled', false);
  const bound = node.binding ? snapshot.state[node.binding] : '';
  const current = typeof bound === 'string' ? bound : '';
  const inputId = useId();

  const options: SelectOption[] = (node.children ?? [])
    .filter((child) => child.type === 'component' && child.name === 'option')
    .map((child, index) => {
      const valueResult = evaluateSource(runtime, child.props?.value);
      const value = valueResult.ok && typeof valueResult.value === 'string' ? valueResult.value : '';
      return {
        value,
        label: child.label ?? '',
        key: child.id || `${node.id}-option-${index}`,
      };
    });

  const hasCurrent = options.some((option) => option.value === current);

  if (inheritedError) return <FieldError error={inheritedError} />;

  // Other children are only whitespace per the component schema; rendering them
  // here would produce invalid select markup.
  void renderChildren;

  return (
    <div className="md-control md-select">
      <label className="md-label" htmlFor={inputId}>
        {label}
      </label>
      <select
        id={inputId}
        className="md-select-input"
        value={hasCurrent ? current : ''}
        disabled={disabled}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => write(event.target.value)}
      >
        {hasCurrent ? null : (
          <option value="" disabled>
            请选择
          </option>
        )}
        {options.map((option) => (
          <option key={option.key} value={option.value}>
            {option.label || option.value}
          </option>
        ))}
      </select>
      <FieldError error={error} />
    </div>
  );
}

function ValueView({ node }: ComponentProps) {
  const { runtime } = useViewer();
  const valueResult = evaluateSource(runtime, node.props?.value);
  if (!valueResult.ok) {
    return <span className="component-error">value 求值失败：{valueResult.message}</span>;
  }
  const format = evalString(runtime, node, 'format', 'text');
  const currency = evalString(runtime, node, 'currency', 'CNY');
  let text: string;
  try {
    text = formatValue(valueResult.value, format, currency);
  } catch (error) {
    return (
      <span className="component-error">
        {error instanceof Error ? error.message : String(error)}
      </span>
    );
  }
  return <span className={`md-value md-value-${format}`}>{text}</span>;
}

function BadgeView({ node }: ComponentProps) {
  const { runtime } = useViewer();
  const tone = evalString(runtime, node, 'tone', 'neutral');
  const safeTone = tone === 'success' || tone === 'warning' ? tone : 'neutral';
  const label = labelOf(runtime, node, node.label ?? '');
  return <span className={`md-badge md-badge-${safeTone}`}>{label}</span>;
}

function GAP_CLASS(name: string, value: string): string {
  return value === 'sm' || value === 'lg' ? `${name} gap-${value}` : `${name} gap-md`;
}

function CardView({ node, renderChildren }: ComponentProps) {
  const { runtime } = useViewer();
  const title = labelOf(runtime, node, node.label ?? '');
  return (
    <section className="md-card">
      {title ? <h3 className="md-card-title">{title}</h3> : null}
      <div className="md-card-body">{renderChildren(node.children ?? [])}</div>
    </section>
  );
}

function StackView({ node, renderChildren }: ComponentProps) {
  const { runtime } = useViewer();
  const gap = evalString(runtime, node, 'gap', 'md');
  return (
    <div className={GAP_CLASS('md-stack', gap)}>{renderChildren(node.children ?? [])}</div>
  );
}

function RowView({ node, renderChildren }: ComponentProps) {
  const { runtime } = useViewer();
  const gap = evalString(runtime, node, 'gap', 'md');
  return <div className={GAP_CLASS('md-row', gap)}>{renderChildren(node.children ?? [])}</div>;
}

function ButtonView({ node }: ComponentProps) {
  const { runtime } = useViewer();
  const { run, error, pending, cancel, canCancel } = useActionButton(node);
  const label = labelOf(runtime, node, node.label ?? '按钮');
  const variant = evalString(runtime, node, 'variant', 'primary');
  const safeVariant = variant === 'secondary' || variant === 'quiet' ? variant : 'primary';
  const disabled = evalBoolean(runtime, node, 'disabled', false);
  return (
    <>
      <button
        type="button"
        className={`md-button md-button-${safeVariant}`}
        onClick={run}
        disabled={disabled || pending}
        aria-busy={pending || undefined}
      >
        {pending ? `${label}…` : label}
      </button>
      {canCancel ? <button type="button" className="md-button md-button-secondary" onClick={cancel}>取消请求</button> : null}
      <FieldError error={error} />
    </>
  );
}

function IfView({ node, renderChildren }: ComponentProps) {
  const { runtime } = useViewer();
  const when = evalBoolean(runtime, node, 'when', false);
  const containerRef = useRef<HTMLDivElement>(null);
  const wasVisible = useRef(when);

  useLayoutEffect(() => {
    if (wasVisible.current && !when) {
      const active = document.activeElement;
      const container = containerRef.current;
      const target = container?.closest('.md-document') as HTMLElement | null;
      // The hidden subtree is unmounted. Move focus to the document container
      // so keyboard users do not fall back to <body>.
      if (target && (!active || active === document.body || container?.contains(active))) {
        target.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
    }
    wasVisible.current = when;
  }, [when]);

  return (
    <div
      ref={containerRef}
      className="md-if"
      tabIndex={-1}
      role="group"
      hidden={!when}
      aria-hidden={!when}
      aria-label="条件内容"
    >
      {when ? renderChildren(node.children ?? []) : null}
    </div>
  );
}

const COMPONENTS: Record<string, ComponentType<ComponentProps>> = {
  ...ADVANCED_COMPONENTS,
  ...VISUAL_COMPONENTS,
  input: InputView,
  number: NumberView,
  slider: SliderView,
  toggle: ToggleView,
  select: SelectView,
  option: OptionView,
  value: ValueView,
  badge: BadgeView,
  card: CardView,
  stack: StackView,
  row: RowView,
  button: ButtonView,
  if: IfView,
};

const HOST_COMPONENTS = new Map<string, ComponentType<ComponentProps>>();
const SCHEMA_RENDERERS = new WeakMap<object, ComponentType<ComponentProps>>();
export function registerComponentRenderer(name: string, renderer: ComponentType<ComponentProps>): () => void {
  if (COMPONENTS[name] || HOST_COMPONENTS.has(name)) throw new Error(`组件 ${name} 已有渲染器`);
  HOST_COMPONENTS.set(name, renderer);
  const schema = getComponentSchema(name);
  if (schema) SCHEMA_RENDERERS.set(schema, renderer);
  return () => { if (HOST_COMPONENTS.get(name) === renderer) HOST_COMPONENTS.delete(name); };
}

export function ComponentNodeView({ node, renderChildren }: ComponentProps) {
  const { document } = useViewer();
  const schema = node.name ? document?.componentSchemas[node.name] : undefined;
  const Renderer = node.name ? (schema ? SCHEMA_RENDERERS.get(schema) : undefined) ?? HOST_COMPONENTS.get(node.name) ?? COMPONENTS[node.name] : undefined;
  if (!Renderer) {
    return (
      <span className="component-error">
        未知组件 {node.name ? `“${node.name}”` : '（缺少名称）'}
      </span>
    );
  }
  return <Renderer node={node} renderChildren={renderChildren} />;
}

interface BoundaryProps {
  name: string;
  children: ReactNode;
}

interface BoundaryState {
  message: string | null;
}

/**
 * Each component instance is isolated so a single broken render cannot take
 * down the rest of the document.
 */
export class ComponentBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  render() {
    if (this.state.message) {
      return (
        <span className="component-error" role="alert">
          组件“{this.props.name}”渲染失败：{this.state.message}
        </span>
      );
    }
    return this.props.children;
  }
}
