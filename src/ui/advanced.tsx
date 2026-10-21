import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { Diagnostic, DocumentNode, Json, Runtime, RuntimeSnapshot, SourceRange } from '../core/types';
import type { ComponentProps } from './components';
import {
  ScopedViewer,
  evalBoolean,
  evalNumber,
  evalString,
  evaluateSource,
  formatValue,
  labelOf,
  propOf,
  safeUrl,
  useViewer,
} from './context';

interface CtlError {
  message: string;
  diagnostic?: Diagnostic;
}

function errorFromDiagnostics(diagnostics: Diagnostic[]): CtlError {
  return {
    message: diagnostics.length
      ? diagnostics.map((item) => item.message).join('；')
      : '操作未生效',
    diagnostic: diagnostics[0],
  };
}

function syntheticDiagnostic(range: SourceRange, message: string): Diagnostic {
  return { code: 'advanced.action', message, severity: 'error', range, line: 1, column: 1 };
}

function ErrorText({ error }: { error: CtlError | null }) {
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

function missingBinding(node: DocumentNode): CtlError | null {
  return node.binding ? null : { message: '组件缺少 bind 属性' };
}

function fieldNameOf(runtime: Runtime, node: DocumentNode): string | undefined {
  const source = propOf(node, 'name');
  if (source) {
    const result = evaluateSource(runtime, source);
    if (result.ok && typeof result.value === 'string' && result.value.trim()) {
      return result.value;
    }
  }
  return node.binding ?? undefined;
}

function useBindingWriter(node: DocumentNode) {
  const { runtime, report } = useViewer();
  const [error, setError] = useState<CtlError | null>(null);
  const write = useCallback(
    (value: Json) => {
      const result = runtime.writeBinding(node.id, value);
      if (result.ok) {
        setError(null);
        return true;
      }
      const failure = errorFromDiagnostics(result.diagnostics);
      setError(failure);
      report(result.diagnostics);
      return false;
    },
    [node.id, report, runtime],
  );
  return { write, error, setError };
}

function useAsyncAction(node: DocumentNode) {
  const { runtime, report } = useViewer();
  const [error, setError] = useState<CtlError | null>(null);
  const [pending, setPending] = useState(false);
  const run = useCallback(
    async (name: string | undefined, locals?: Record<string, Json>): Promise<boolean> => {
      if (!name) {
        setError({ message: '组件没有绑定动作' });
        return false;
      }
      setPending(true);
      setError(null);
      try {
        const result = await runtime.dispatchAsync(name, locals);
        if (result.ok) return true;
        const failure = errorFromDiagnostics(result.diagnostics);
        setError(failure);
        report(result.diagnostics);
        return false;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        const diagnostic = syntheticDiagnostic(node.range, message);
        setError({ message, diagnostic });
        report([diagnostic]);
        return false;
      } finally {
        setPending(false);
      }
    },
    [node.range, report, runtime],
  );
  return { run, error, pending, setError };
}

function isJsonObject(value: Json | undefined): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function displayText(value: Json | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

function normalizeGap(value: string): 'sm' | 'md' | 'lg' {
  return value === 'sm' || value === 'lg' ? value : 'md';
}

/* ---------------------------------------------------------------- layout */

function GridView({ node, renderChildren }: ComponentProps) {
  const { runtime } = useViewer();
  const columns = Math.max(1, Math.min(12, Math.floor(evalNumber(runtime, node, 'columns', 2))));
  const gap = normalizeGap(evalString(runtime, node, 'gap', 'md'));
  const minWidth = Math.max(0, evalNumber(runtime, node, 'min-width', 220));
  const style = {
    '--advanced-grid-columns': String(columns),
    '--advanced-grid-min': `${minWidth}px`,
  } as CSSProperties;
  return (
    <div className={`advanced-grid gap-${gap}`} style={style}>
      {renderChildren(node.children ?? [])}
    </div>
  );
}

interface TabDef {
  value: string;
  label: string;
  key: string;
  node: DocumentNode;
}

function readTabs(runtime: Runtime, node: DocumentNode): { ok: true; tabs: TabDef[] } | { ok: false; message: string } {
  const children = node.children ?? [];
  const foreign = children.find(
    (child) => child.type === 'component' && child.name !== 'tab',
  );
  if (foreign) {
    return { ok: false, message: 'tabs 的子节点只能是 tab' };
  }
  const tabs: TabDef[] = [];
  const seen = new Set<string>();
  for (const child of children) {
    if (child.type !== 'component' || child.name !== 'tab') continue;
    const valueResult = evaluateSource(runtime, propOf(child, 'value'));
    if (!valueResult.ok || typeof valueResult.value !== 'string' || !valueResult.value) {
      return { ok: false, message: `tab“${child.label ?? ''}”缺少字符串 value` };
    }
    if (seen.has(valueResult.value)) {
      return { ok: false, message: `tab 的 value 重复：“${valueResult.value}”` };
    }
    seen.add(valueResult.value);
    const label = labelOf(runtime, child, child.label ?? '');
    if (!label) return { ok: false, message: 'tab 缺少 label' };
    tabs.push({
      value: valueResult.value,
      label,
      key: child.id,
      node: child,
    });
  }
  if (tabs.length === 0) return { ok: false, message: 'tabs 至少需要一个 tab 子节点' };
  return { ok: true, tabs };
}

function TabsView({ node, renderChildren }: ComponentProps) {
  const { runtime, snapshot } = useViewer();
  const missing = missingBinding(node);
  const { write, error } = useBindingWriter(node);
  const label = labelOf(runtime, node, node.label ?? '');
  const labelId = useId();
  const parsed = readTabs(runtime, node);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const bound = node.binding ? snapshot.state[node.binding] : '';
  const boundValue = typeof bound === 'string' ? bound : '';
  const currentIndex = parsed.ok ? parsed.tabs.findIndex((tab) => tab.value === boundValue) : -1;
  const activeIndex = parsed.ok ? (currentIndex >= 0 ? currentIndex : 0) : -1;

  const activate = (index: number) => {
    if (!parsed.ok) return;
    const tab = parsed.tabs[index];
    if (!tab) return;
    write(tab.value);
    buttonRefs.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!parsed.ok) return;
    const count = parsed.tabs.length;
    let next = -1;
    if (event.key === 'ArrowRight') next = (activeIndex + 1) % count;
    else if (event.key === 'ArrowLeft') next = (activeIndex - 1 + count) % count;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    else return;
    event.preventDefault();
    activate(next);
  };

  if (missing) return <ErrorText error={missing} />;
  if (!parsed.ok) return <span className="component-error">{parsed.message}</span>;

  return (
    <section className="advanced-tabs" aria-labelledby={label ? labelId : undefined}>
      {label ? (
        <div className="advanced-tabs-label" id={labelId}>
          {label}
        </div>
      ) : null}
      <div className="advanced-tablist" role="tablist" aria-label={label || '选项卡'} onKeyDown={onKeyDown}>
        {parsed.tabs.map((tab, index) => {
          const selected = index === activeIndex;
          return (
            <button
              key={tab.key}
              ref={(element) => {
                buttonRefs.current[index] = element;
              }}
              id={`${node.id}-tab-${index}`}
              type="button"
              role="tab"
              className={`advanced-tab${selected ? ' is-selected' : ''}`}
              aria-selected={selected}
              aria-controls={`${node.id}-panel-${index}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                write(tab.value);
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {parsed.tabs.map((tab, index) => (
        <div
          key={tab.key}
          id={`${node.id}-panel-${index}`}
          className="advanced-tabpanel"
          role="tabpanel"
          aria-labelledby={`${node.id}-tab-${index}`}
          tabIndex={0}
          hidden={index !== activeIndex}
        >
          {renderChildren(tab.node.children ?? [])}
        </div>
      ))}
      <ErrorText error={error} />
    </section>
  );
}

function TabView({ node, renderChildren }: ComponentProps) {
  return (
    <div className="advanced-tabpanel" role="tabpanel">
      {renderChildren(node.children ?? [])}
    </div>
  );
}

function AccordionView({ node, renderChildren }: ComponentProps) {
  return (
    <div className="advanced-accordion" role="group" aria-label="折叠面板">
      {renderChildren(node.children ?? [])}
    </div>
  );
}

function DisclosureView({ node, renderChildren }: ComponentProps) {
  const { runtime, snapshot } = useViewer();
  const { write, error } = useBindingWriter(node);
  const [localOpen, setLocalOpen] = useState(() => evalBoolean(runtime, node, 'open', false));
  const headerId = useId();
  const panelId = useId();
  const label = labelOf(runtime, node, node.label ?? '折叠内容');

  const bound = node.binding ? snapshot.state[node.binding] : undefined;
  const open = node.binding ? bound === true : localOpen;

  const toggle = () => {
    if (node.binding) write(!open);
    else setLocalOpen(!open);
  };

  return (
    <div className="advanced-disclosure">
      <h3 className="advanced-disclosure-heading">
        <button
          id={headerId}
          type="button"
          className="advanced-disclosure-trigger"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
        >
          <span className={`advanced-chevron${open ? ' is-open' : ''}`} aria-hidden="true">
            ▸
          </span>
          <span>{label}</span>
        </button>
      </h3>
      <div
        id={panelId}
        className="advanced-disclosure-panel"
        role="region"
        aria-labelledby={headerId}
        hidden={!open}
      >
        {renderChildren(node.children ?? [])}
      </div>
      <ErrorText error={error} />
    </div>
  );
}

/* ------------------------------------------------------------------ forms */

interface AdvancedFormContextValue {
  pending: boolean;
  error: CtlError | null;
  setError: (error: CtlError | null) => void;
}

const AdvancedFormContext = createContext<AdvancedFormContextValue | null>(null);

const FORM_FIELD_NAMES = new Set([
  'input',
  'number',
  'select',
  'toggle',
  'slider',
  'textarea',
  'date',
  'checkbox',
  'radio-group',
  'choices',
  'checklist',
]);

function walkComponents(nodes: DocumentNode[], visit: (node: DocumentNode) => void): void {
  for (const node of nodes) {
    if (node.type === 'component') visit(node);
    if (node.children) walkComponents(node.children, visit);
  }
}

function hasSubmit(nodes: DocumentNode[]): boolean {
  let found = false;
  walkComponents(nodes, (node) => {
    if (node.name === 'submit') found = true;
  });
  return found;
}

function collectFormValues(
  runtime: Runtime,
  snapshot: RuntimeSnapshot,
  nodes: DocumentNode[],
): Record<string, Json> {
  const values: Record<string, Json> = Object.create(null);
  const visit = (list: DocumentNode[]) => {
    for (const node of list) {
      if (node.type === 'component') {
        // Nested forms are rejected by the compiler; never leak their fields.
        if (node.name === 'form') continue;
        if (node.name && FORM_FIELD_NAMES.has(node.name) && node.binding) {
          let name = node.binding;
          const nameSource = propOf(node, 'name');
          if (nameSource) {
            const result = evaluateSource(runtime, nameSource);
            if (result.ok && typeof result.value === 'string' && result.value.trim()) {
              name = result.value;
            }
          }
          const value = snapshot.state[node.binding];
          values[name] = value === undefined ? null : value;
        }
      }
      if (node.children) visit(node.children);
    }
  };
  visit(nodes);
  return values;
}

function findInvalidControl(form: HTMLFormElement): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null {
  const elements = Array.from(form.elements);
  for (const element of elements) {
    if (
      !(element instanceof HTMLInputElement) &&
      !(element instanceof HTMLTextAreaElement) &&
      !(element instanceof HTMLSelectElement)
    ) {
      continue;
    }
    if (element.disabled) continue;
    if (element instanceof HTMLInputElement && element.type === 'hidden') continue;
    // Fields inside a collapsed tab or disclosure do not belong to the
    // currently active form surface.
    if (element.closest('[hidden]')) continue;
    if (element instanceof HTMLTextAreaElement) {
      element.setCustomValidity('');
      const pattern = element.getAttribute('data-advanced-pattern');
      if (pattern && element.value !== '') {
        try {
          if (!new RegExp(`^(?:${pattern})$`, 'u').test(element.value)) {
            element.setCustomValidity('格式不符合要求');
          }
        } catch {
          // Invalid patterns are ignored, matching the native behaviour.
        }
      }
    }
    if (!element.checkValidity()) return element;
  }
  return null;
}

function FormView({ node, renderChildren }: ComponentProps) {
  const { runtime, snapshot, report } = useViewer();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<CtlError | null>(null);
  const request = useRef(0);
  const label = labelOf(runtime, node, node.label ?? '');
  const inlineSubmit = useMemo(() => hasSubmit(node.children ?? []), [node.children]);
  const contextValue = useMemo<AdvancedFormContextValue>(
    () => ({ pending, error, setError }),
    [pending, error],
  );

  const runSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const invalid = findInvalidControl(form);
    if (invalid) {
      invalid.reportValidity();
      invalid.focus();
      setError({ message: '请先修正表单中标记的字段' });
      return;
    }
    const actionName = node.events?.submit;
    if (!actionName) {
      setError({ message: 'form 缺少 on-submit 动作' });
      return;
    }
    const values = collectFormValues(runtime, snapshot, node.children ?? []);
    const token = ++request.current;
    setPending(true);
    setError(null);
    try {
      const result = await runtime.dispatchAsync(actionName, { event: { values } });
      if (token !== request.current) return;
      if (!result.ok) {
        const failure = errorFromDiagnostics(result.diagnostics);
        setError(failure);
        report(result.diagnostics);
      }
    } catch (cause) {
      if (token !== request.current) return;
      const message = cause instanceof Error ? cause.message : String(cause);
      const diagnostic = syntheticDiagnostic(node.range, message);
      setError({ message, diagnostic });
      report([diagnostic]);
    } finally {
      if (token === request.current) setPending(false);
    }
  };

  return (
    <AdvancedFormContext.Provider value={contextValue}>
      <form
        className="advanced-form"
        noValidate
        aria-label={label || '表单'}
        aria-busy={pending || undefined}
        onSubmit={(event) => {
          void runSubmit(event);
        }}
      >
        {renderChildren(node.children ?? [])}
        {pending && snapshot.resources[node.events?.submit ?? ''] ? <button type="button" className="md-button md-button-secondary" onClick={() => {
          request.current++;
          runtime.cancel(node.events!.submit);
          setPending(false);
          setError(null);
        }}>取消请求</button> : null}
        {inlineSubmit ? null : <ErrorText error={error} />}
      </form>
    </AdvancedFormContext.Provider>
  );
}

function SubmitView({ node }: ComponentProps) {
  const { runtime } = useViewer();
  const form = useContext(AdvancedFormContext);
  const [ownError, setOwnError] = useState<CtlError | null>(null);
  const label = labelOf(runtime, node, node.label ?? '提交');
  const variantRaw = evalString(runtime, node, 'variant', 'primary');
  const variant = variantRaw === 'secondary' || variantRaw === 'quiet' ? variantRaw : 'primary';
  const disabled = evalBoolean(runtime, node, 'disabled', false);
  const isPending = form?.pending === true;
  const error = form ? form.error : ownError;

  return (
    <>
      <button
        type="submit"
        className={`md-button advanced-submit md-button-${variant}`}
        disabled={disabled || isPending}
        aria-busy={isPending || undefined}
        onClick={(event) => {
          if (!form) {
            event.preventDefault();
            setOwnError({ message: 'submit 必须放在 form 内' });
          }
        }}
      >
        {isPending ? `${label}（提交中）` : label}
      </button>
      <ErrorText error={error} />
    </>
  );
}

function TextareaView({ node }: ComponentProps) {
  const { runtime, snapshot } = useViewer();
  const missing = missingBinding(node);
  const label = labelOf(runtime, node, node.label ?? '文本');
  const { write, error, setError } = useBindingWriter(node);
  const inputId = useId();
  const disabled = evalBoolean(runtime, node, 'disabled', false);
  const required = evalBoolean(runtime, node, 'required', false);
  const placeholder = evalString(runtime, node, 'placeholder', '');
  const commitMode = evalString(runtime, node, 'commit', 'input') === 'blur' ? 'blur' : 'input';
  const rows = Math.max(1, Math.min(40, Math.floor(evalNumber(runtime, node, 'rows', 4))));
  const minLength = propOf(node, 'min-length')
    ? Math.max(0, Math.floor(evalNumber(runtime, node, 'min-length', 0)))
    : undefined;
  const maxLength = propOf(node, 'max-length')
    ? Math.max(0, Math.floor(evalNumber(runtime, node, 'max-length', 0)))
    : undefined;
  const pattern = propOf(node, 'pattern') ? evalString(runtime, node, 'pattern', '') : '';
  const name = fieldNameOf(runtime, node);

  const bound = node.binding ? snapshot.state[node.binding] : '';
  const display = bound === undefined || bound === null ? '' : String(bound);

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

  if (missing) return <ErrorText error={missing} />;

  const commit = (value: string) => {
    write(value);
  };

  return (
    <div className="md-control advanced-textarea">
      <label className="md-label" htmlFor={inputId}>
        {label}
        {required ? <span className="advanced-required" aria-hidden="true"> *</span> : null}
      </label>
      <textarea
        id={inputId}
        className="md-text-input"
        name={name}
        rows={rows}
        value={draft}
        placeholder={placeholder || undefined}
        disabled={disabled}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        data-advanced-pattern={pattern || undefined}
        aria-invalid={error ? true : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (commitMode === 'blur') commit(draft);
        }}
        onChange={(event) => {
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
      <ErrorText error={error} />
    </div>
  );
}

function CheckboxView({ node }: ComponentProps) {
  const { runtime, snapshot } = useViewer();
  const missing = missingBinding(node);
  const label = labelOf(runtime, node, node.label ?? '勾选');
  const { write, error } = useBindingWriter(node);
  const disabled = evalBoolean(runtime, node, 'disabled', false);
  const name = fieldNameOf(runtime, node);
  const inputId = useId();
  const bound = node.binding ? snapshot.state[node.binding] : false;

  if (missing) return <ErrorText error={missing} />;

  return (
    <div className="md-control advanced-checkbox">
      <label className="md-toggle-label" htmlFor={inputId}>
        <input
          id={inputId}
          type="checkbox"
          name={name}
          checked={bound === true}
          disabled={disabled}
          onChange={(event) => write(event.target.checked)}
        />
        <span>{label}</span>
      </label>
      <ErrorText error={error} />
    </div>
  );
}

interface ChoiceOption {
  value: string;
  label: string;
  key: string;
}

function readChoiceOptions(
  runtime: Runtime,
  node: DocumentNode,
): { ok: true; options: ChoiceOption[] } | { ok: false; message: string } {
  const options: ChoiceOption[] = [];
  const seen = new Set<string>();
  for (const child of node.children ?? []) {
    if (child.type !== 'component' || child.name !== 'option') continue;
    const valueResult = evaluateSource(runtime, propOf(child, 'value'));
    if (!valueResult.ok || typeof valueResult.value !== 'string') {
      return { ok: false, message: 'option 缺少字符串 value' };
    }
    if (seen.has(valueResult.value)) {
      return { ok: false, message: `option 的 value 重复：“${valueResult.value}”` };
    }
    seen.add(valueResult.value);
    options.push({
      value: valueResult.value,
      label: child.label ?? valueResult.value,
      key: child.id,
    });
  }
  if (options.length === 0) return { ok: false, message: '缺少 option 子节点' };
  return { ok: true, options };
}

function RadioGroupView({ node }: ComponentProps) {
  const { runtime, snapshot } = useViewer();
  const missing = missingBinding(node);
  const label = labelOf(runtime, node, node.label ?? '选项');
  const { write, error } = useBindingWriter(node);
  const disabled = evalBoolean(runtime, node, 'disabled', false);
  const parsed = readChoiceOptions(runtime, node);
  const name = fieldNameOf(runtime, node) ?? node.id;
  const bound = node.binding ? snapshot.state[node.binding] : '';
  const current = typeof bound === 'string' ? bound : '';

  if (missing) return <ErrorText error={missing} />;
  if (!parsed.ok) return <span className="component-error">{parsed.message}</span>;

  return (
    <fieldset className="md-control advanced-radio-group" disabled={disabled}>
      <legend className="md-label">{label}</legend>
      {parsed.options.map((option) => (
        <label className="advanced-radio-option" key={option.key}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={current === option.value}
            onChange={() => write(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
      <ErrorText error={error} />
    </fieldset>
  );
}

function ChoicesView({ node }: ComponentProps) {
  const { runtime, snapshot } = useViewer();
  const missing = missingBinding(node);
  const label = labelOf(runtime, node, node.label ?? '选项');
  const { write, error } = useBindingWriter(node);
  const disabled = evalBoolean(runtime, node, 'disabled', false);
  const parsed = readChoiceOptions(runtime, node);
  const labelId = useId();
  const bound = node.binding ? snapshot.state[node.binding] : '';
  const current = typeof bound === 'string' ? bound : '';
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  if (missing) return <ErrorText error={missing} />;
  if (!parsed.ok) return <span className="component-error">{parsed.message}</span>;

  const options = parsed.options;
  const selectedIndex = options.findIndex((option) => option.value === current);
  const activeIndex = selectedIndex >= 0 ? selectedIndex : 0;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (index + 1) % options.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (index - 1 + options.length) % options.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = options.length - 1;
    }
    if (next < 0) return;
    event.preventDefault();
    write(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div className="md-control advanced-choices">
      <span className="md-label" id={labelId}>
        {label}
      </span>
      <div
        className="advanced-choice-list"
        role="radiogroup"
        aria-labelledby={labelId}
        aria-disabled={disabled || undefined}
      >
        {options.map((option, index) => {
          const selected = current === option.value;
          return (
            <button
              key={option.key}
              ref={(element) => {
                refs.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={index === activeIndex ? 0 : -1}
              disabled={disabled}
              className={`advanced-choice${selected ? ' is-selected' : ''}`}
              onClick={() => write(option.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <ErrorText error={error} />
    </div>
  );
}

function DateView({ node }: ComponentProps) {
  const { runtime, snapshot } = useViewer();
  const missing = missingBinding(node);
  const label = labelOf(runtime, node, node.label ?? '日期');
  const { write, error } = useBindingWriter(node);
  const disabled = evalBoolean(runtime, node, 'disabled', false);
  const required = evalBoolean(runtime, node, 'required', false);
  const min = propOf(node, 'min') ? evalString(runtime, node, 'min', '') : undefined;
  const max = propOf(node, 'max') ? evalString(runtime, node, 'max', '') : undefined;
  const name = fieldNameOf(runtime, node);
  const inputId = useId();
  const bound = node.binding ? snapshot.state[node.binding] : '';
  const value = typeof bound === 'string' ? bound : '';

  if (missing) return <ErrorText error={missing} />;

  return (
    <div className="md-control advanced-date">
      <label className="md-label" htmlFor={inputId}>
        {label}
        {required ? <span className="advanced-required" aria-hidden="true"> *</span> : null}
      </label>
      <input
        id={inputId}
        className="md-text-input"
        type="date"
        name={name}
        value={value}
        min={min || undefined}
        max={max || undefined}
        required={required}
        disabled={disabled}
        onChange={(event) => write(event.target.value)}
      />
      <ErrorText error={error} />
    </div>
  );
}

interface ChecklistItem {
  id: string;
  label: string;
}

function readChecklistItems(
  runtime: Runtime,
  node: DocumentNode,
): { ok: true; items: ChecklistItem[] } | { ok: false; message: string } {
  const source = propOf(node, 'items');
  if (!source) return { ok: false, message: 'checklist 缺少 items 属性' };
  const result = evaluateSource(runtime, source);
  if (!result.ok) return { ok: false, message: `items 求值失败：${result.message}` };
  if (!Array.isArray(result.value)) {
    return { ok: false, message: 'checklist 的 items 必须是 JSON 数组' };
  }
  const items: ChecklistItem[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < result.value.length; index += 1) {
    const entry = result.value[index];
    if (!isJsonObject(entry) || typeof entry.id !== 'string' || !entry.id) {
      return { ok: false, message: `checklist 的 items 第 ${index + 1} 项缺少字符串 id` };
    }
    if (seen.has(entry.id)) {
      return { ok: false, message: `checklist 的 items id 重复：“${entry.id}”` };
    }
    seen.add(entry.id);
    items.push({ id: entry.id, label: displayText(entry.label) || entry.id });
  }
  return { ok: true, items };
}

function ChecklistView({ node }: ComponentProps) {
  const { runtime, snapshot } = useViewer();
  const missing = missingBinding(node);
  const label = labelOf(runtime, node, node.label ?? '清单');
  const { write, error } = useBindingWriter(node);
  const disabled = evalBoolean(runtime, node, 'disabled', false);
  const parsed = readChecklistItems(runtime, node);
  const bound = node.binding ? snapshot.state[node.binding] : [];
  const selected = Array.isArray(bound) ? bound.filter((value): value is string => typeof value === 'string') : [];

  if (missing) return <ErrorText error={missing} />;
  if (!parsed.ok) return <span className="component-error">{parsed.message}</span>;

  const toggle = (id: string, checked: boolean) => {
    const next = checked
      ? selected.includes(id)
        ? selected
        : [...selected, id]
      : selected.filter((value) => value !== id);
    write(next);
  };

  return (
    <fieldset className="md-control advanced-checklist" disabled={disabled}>
      <legend className="md-label">{label}</legend>
      {parsed.items.map((item) => (
        <label className="advanced-check-option" key={item.id}>
          <input
            type="checkbox"
            value={item.id}
            checked={selected.includes(item.id)}
            onChange={(event) => toggle(item.id, event.target.checked)}
          />
          <span>{item.label}</span>
        </label>
      ))}
      <ErrorText error={error} />
    </fieldset>
  );
}

/* ------------------------------------------------------------- feedback */

function ProgressView({ node }: ComponentProps) {
  const { runtime } = useViewer();
  const label = labelOf(runtime, node, node.label ?? '');
  const max = evalNumber(runtime, node, 'max', 100);
  const valueResult = evaluateSource(runtime, propOf(node, 'value'));
  if (max <= 0) {
    return <span className="component-error">progress 的 max 必须大于 0</span>;
  }
  if (!valueResult.ok) {
    return <span className="component-error">value 求值失败：{valueResult.message}</span>;
  }
  if (typeof valueResult.value !== 'number' || !Number.isFinite(valueResult.value)) {
    return <span className="component-error">progress 的 value 必须是有限数字</span>;
  }
  const now = Math.min(max, Math.max(0, valueResult.value));
  const percent = Math.round((now / max) * 100);
  return (
    <div className="advanced-progress">
      {label ? (
        <div className="advanced-progress-head">
          <span className="md-label">{label}</span>
          <span className="advanced-progress-value">{percent}%</span>
        </div>
      ) : null}
      <div
        className="advanced-progress-track"
        role="progressbar"
        aria-label={label || '进度'}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={now}
      >
        <div className="advanced-progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function AlertView({ node, renderChildren }: ComponentProps) {
  const { runtime } = useViewer();
  const toneRaw = evalString(runtime, node, 'tone', 'info');
  const tone = toneRaw === 'success' || toneRaw === 'warning' || toneRaw === 'danger' ? toneRaw : 'info';
  const label = labelOf(runtime, node, node.label ?? '');
  const role = tone === 'warning' || tone === 'danger' ? 'alert' : 'status';
  return (
    <div className={`advanced-alert advanced-alert-${tone}`} role={role}>
      {label ? <div className="advanced-alert-title">{label}</div> : null}
      <div className="advanced-alert-body">{renderChildren(node.children ?? [])}</div>
    </div>
  );
}

function TooltipView({ node }: ComponentProps) {
  const { runtime } = useViewer();
  const label = labelOf(runtime, node, node.label ?? '提示');
  const text = evalString(runtime, node, 'text', '');
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span
      className="advanced-tooltip"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        className="advanced-tooltip-trigger"
        tabIndex={0}
        aria-describedby={id}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        {label}
      </span>
      <span
        id={id}
        role="tooltip"
        className={`advanced-tooltip-bubble${open ? ' is-visible' : ''}`}
      >
        {text}
      </span>
    </span>
  );
}

function ImageView({ node }: ComponentProps) {
  const { runtime } = useViewer();
  const src = evalString(runtime, node, 'src', '');
  const alt = evalString(runtime, node, 'alt', '');
  const caption = evalString(runtime, node, 'caption', '');
  const fitRaw = evalString(runtime, node, 'fit', 'contain');
  const fit = fitRaw === 'cover' ? 'cover' : 'contain';
  const [failed, setFailed] = useState(false);
  const safe = safeUrl(src, 'image');

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!safe) {
    return (
      <span className="advanced-image-rejected" role="img" aria-label={`图片已拒绝：${alt}`}>
        图片地址不受支持{alt ? `：${alt}` : ''}
      </span>
    );
  }
  if (failed) {
    return (
      <span className="advanced-image-rejected" role="img" aria-label={`图片加载失败：${alt}`}>
        图片无法加载{alt ? `：${alt}` : ''}
      </span>
    );
  }
  return (
    <figure className="advanced-image">
      <img
        src={safe}
        alt={alt}
        className={`advanced-image-media advanced-image-fit-${fit}`}
        onError={() => setFailed(true)}
        loading="lazy"
      />
      {caption ? <figcaption className="advanced-image-caption">{caption}</figcaption> : null}
    </figure>
  );
}

const ICON_SHAPES: Record<string, ReactNode> = {
  check: <path d="M4 12l5 5L20 6" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.5h.01" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3l10 18H2L12 3z" />
      <path d="M12 9v5" />
      <path d="M12 17.5h.01" />
    </>
  ),
  star: <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3z" />,
  heart: <path d="M12 20s-7-4.4-7-9a4 4 0 017-2.6A4 4 0 0119 11c0 4.6-7 9-7 9z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5L21 21" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  location: (
    <>
      <path d="M12 21s7-6.1 7-11a7 7 0 10-14 0c0 4.9 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  arrow: (
    <>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </>
  ),
};

function IconView({ node }: ComponentProps) {
  const { runtime } = useViewer();
  const nameResult = evaluateSource(runtime, propOf(node, 'name'));
  const name = nameResult.ok && typeof nameResult.value === 'string' ? nameResult.value : '';
  const label = labelOf(runtime, node, node.label ?? '');
  const shape = ICON_SHAPES[name];
  if (!name || !shape) {
    return <span className="component-error">未知图标“{name || '（缺少名称）'}”</span>;
  }
  return (
    <svg
      className="advanced-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {shape}
    </svg>
  );
}

function DividerView() {
  return <hr className="advanced-divider" />;
}

function SpacerView({ node }: ComponentProps) {
  const { runtime } = useViewer();
  const sizeRaw = evalString(runtime, node, 'size', 'md');
  const size = sizeRaw === 'sm' || sizeRaw === 'lg' ? sizeRaw : 'md';
  return <div className={`advanced-spacer advanced-spacer-${size}`} aria-hidden="true" />;
}

function SpinnerView({ node }: ComponentProps) {
  const { runtime } = useViewer();
  const label = evalString(runtime, node, 'label', '加载中');
  return (
    <span className="advanced-spinner" role="status" aria-live="polite">
      <span className="advanced-spinner-ring" aria-hidden="true" />
      <span className="advanced-spinner-label">{label}</span>
    </span>
  );
}

function StatView({ node }: ComponentProps) {
  const { runtime } = useViewer();
  const label = labelOf(runtime, node, node.label ?? '');
  const hint = evalString(runtime, node, 'hint', '');
  const format = evalString(runtime, node, 'format', 'text');
  const currency = evalString(runtime, node, 'currency', 'CNY');
  const valueResult = evaluateSource(runtime, propOf(node, 'value'));
  if (!valueResult.ok) {
    return <span className="component-error">value 求值失败：{valueResult.message}</span>;
  }
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
  return (
    <div className="advanced-stat">
      {label ? <span className="advanced-stat-label">{label}</span> : null}
      <span className="advanced-stat-value">{text || '—'}</span>
      {hint ? <span className="advanced-stat-hint">{hint}</span> : null}
    </div>
  );
}

function LinkButtonView({ node }: ComponentProps) {
  const { runtime } = useViewer();
  const label = labelOf(runtime, node, node.label ?? '打开');
  const href = evalString(runtime, node, 'href', '');
  const variantRaw = evalString(runtime, node, 'variant', 'primary');
  const variant = variantRaw === 'secondary' || variantRaw === 'quiet' ? variantRaw : 'primary';
  const safe = safeUrl(href, 'link');
  if (!safe) {
    return (
      <span
        className={`advanced-link-button advanced-link-button-${variant} is-disabled`}
        role="link"
        aria-disabled="true"
        title="已拒绝不安全的链接地址"
      >
        {label}
      </span>
    );
  }
  const external = /^https?:/i.test(safe);
  return (
    <a
      className={`advanced-link-button advanced-link-button-${variant}`}
      href={safe}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
    >
      {label}
    </a>
  );
}

/* ----------------------------------------------------------------- tables */

interface TableColumn {
  key: string;
  label: string;
}

function parseTableColumns(value: Json): { ok: true; columns: TableColumn[] } | { ok: false; message: string } {
  if (!Array.isArray(value)) return { ok: false, message: 'table 的 columns 必须是 JSON 数组' };
  const columns: TableColumn[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!isJsonObject(entry) || typeof entry.key !== 'string' || !entry.key) {
      return { ok: false, message: `table 的 columns 第 ${index + 1} 项缺少字符串 key` };
    }
    if (seen.has(entry.key)) {
      return { ok: false, message: `table 的 columns key 重复：“${entry.key}”` };
    }
    seen.add(entry.key);
    columns.push({ key: entry.key, label: displayText(entry.label) || entry.key });
  }
  return { ok: true, columns };
}

function inferColumns(rows: Array<Record<string, Json>>): TableColumn[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
        if (keys.length >= 60) return keys.map((item) => ({ key: item, label: item }));
      }
    }
  }
  return keys.map((key) => ({ key, label: key }));
}

function compareCells(left: Json | undefined, right: Json | undefined): number {
  const leftMissing = left === null || left === undefined;
  const rightMissing = right === null || right === undefined;
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return displayText(left).localeCompare(displayText(right), 'zh-CN', { numeric: true });
}

function TableView({ node }: ComponentProps) {
  const { runtime } = useViewer();
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const searchId = useId();

  const label = labelOf(runtime, node, node.label ?? '');
  const searchable = evalBoolean(runtime, node, 'searchable', true);
  const sortable = evalBoolean(runtime, node, 'sortable', true);
  const pageSize = Math.max(1, Math.min(100, Math.floor(evalNumber(runtime, node, 'page-size', 5))));

  let dataError: string | null = null;
  let rows: Array<Record<string, Json>> = [];
  const dataSource = propOf(node, 'data');
  if (!dataSource) {
    dataError = 'table 缺少 data 属性';
  } else {
    const result = evaluateSource(runtime, dataSource);
    if (!result.ok) {
      dataError = `data 求值失败：${result.message}`;
    } else if (!Array.isArray(result.value)) {
      dataError = 'table 的 data 必须是 JSON 数组';
    } else {
      for (let index = 0; index < result.value.length; index += 1) {
        const row = result.value[index];
        if (!isJsonObject(row)) {
          dataError = `table 的 data 第 ${index + 1} 项必须是对象`;
          break;
        }
        rows.push(row);
      }
    }
  }

  let columnError: string | null = null;
  let columns: TableColumn[] = [];
  const columnsSource = propOf(node, 'columns');
  if (!dataError) {
    if (columnsSource) {
      const result = evaluateSource(runtime, columnsSource);
      if (!result.ok) {
        columnError = `columns 求值失败：${result.message}`;
      } else {
        const parsed = parseTableColumns(result.value);
        if (!parsed.ok) columnError = parsed.message;
        else columns = parsed.columns.length ? parsed.columns : inferColumns(rows);
      }
    } else {
      columns = inferColumns(rows);
    }
  }

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      columns.some((column) => displayText(row[column.key]).toLowerCase().includes(term)),
    );
  }, [rows, columns, query]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const copy = [...filtered];
    copy.sort((left, right) => {
      const leftValue = left[sortKey];
      const rightValue = right[sortKey];
      // Missing cells stay at the end regardless of direction.
      const leftMissing = leftValue === null || leftValue === undefined;
      const rightMissing = rightValue === null || rightValue === undefined;
      if (leftMissing || rightMissing) {
        if (leftMissing && rightMissing) return 0;
        return leftMissing ? 1 : -1;
      }
      const comparison = compareCells(leftValue, rightValue);
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return copy;
  }, [filtered, sortKey, sortDirection]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [query, pageSize, sortKey, sortDirection, rows.length]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  if (dataError) return <span className="component-error">{dataError}</span>;
  if (columnError) return <span className="component-error">{columnError}</span>;

  const toggleSort = (key: string) => {
    if (!sortable) return;
    if (sortKey === key) setSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const ariaSort = (key: string): 'ascending' | 'descending' | 'none' => {
    if (sortKey !== key) return 'none';
    return sortDirection === 'asc' ? 'ascending' : 'descending';
  };

  return (
    <div className="advanced-table">
      {label ? <div className="advanced-table-label">{label}</div> : null}
      {searchable ? (
        <div className="advanced-table-toolbar">
          <label className="advanced-table-search-label" htmlFor={searchId}>
            搜索
          </label>
          <input
            id={searchId}
            type="search"
            className="advanced-table-search"
            value={query}
            placeholder="筛选表格内容"
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="advanced-table-count" role="status" aria-live="polite">
            {sorted.length} 条
          </span>
        </div>
      ) : null}
      <div className="advanced-table-scroll">
        <table className="advanced-table-grid" aria-label={label || '数据表格'}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" aria-sort={sortable ? ariaSort(column.key) : undefined}>
                  {sortable ? (
                    <button
                      type="button"
                      className="advanced-table-sort"
                      onClick={() => toggleSort(column.key)}
                    >
                      <span>{column.label}</span>
                      <span className="advanced-sort-indicator" aria-hidden="true">
                        {sortKey === column.key ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td className="advanced-table-empty" colSpan={Math.max(1, columns.length)}>
                  {rows.length === 0 ? '暂无数据' : '没有匹配的结果'}
                </td>
              </tr>
            ) : (
              pageRows.map((row, index) => (
                <tr key={`${safePage}-${index}`}>
                  {columns.map((column) => (
                    <td key={column.key}>{displayText(row[column.key])}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pageCount > 1 ? (
        <div className="advanced-table-pager">
          <button
            type="button"
            className="advanced-pager-button"
            onClick={() => setPage((previous) => Math.max(1, previous - 1))}
            disabled={safePage <= 1}
          >
            上一页
          </button>
          <span className="advanced-pager-status" role="status" aria-live="polite">
            第 {safePage} / {pageCount} 页
          </span>
          <button
            type="button"
            className="advanced-pager-button"
            onClick={() => setPage((previous) => Math.min(pageCount, previous + 1))}
            disabled={safePage >= pageCount}
          >
            下一页
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------- list */

interface ListItem {
  id: string | number;
  title: string;
  description: string;
}

function readListItems(
  runtime: Runtime,
  node: DocumentNode,
): { ok: true; items: ListItem[] } | { ok: false; message: string } {
  const source = propOf(node, 'items');
  if (!source) return { ok: false, message: 'list 缺少 items 属性' };
  const result = evaluateSource(runtime, source);
  if (!result.ok) return { ok: false, message: `items 求值失败：${result.message}` };
  if (!Array.isArray(result.value)) return { ok: false, message: 'list 的 items 必须是 JSON 数组' };
  const items: ListItem[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < result.value.length; index += 1) {
    const entry = result.value[index];
    if (!isJsonObject(entry)) {
      return { ok: false, message: `list 的 items 第 ${index + 1} 项必须是对象` };
    }
    const id = entry.id;
    if ((typeof id !== 'string' && typeof id !== 'number') || id === '') {
      return { ok: false, message: `list 的 items 第 ${index + 1} 项缺少有效 id` };
    }
    const key = String(id);
    if (seen.has(key)) return { ok: false, message: `list 的 items id 重复：“${key}”` };
    seen.add(key);
    items.push({
      id,
      title: displayText(entry.title) || key,
      description: displayText(entry.description),
    });
  }
  return { ok: true, items };
}

function ListView({ node }: ComponentProps) {
  const { runtime } = useViewer();
  const parsed = readListItems(runtime, node);
  const label = labelOf(runtime, node, node.label ?? '');
  const { run, error, pending } = useAsyncAction(node);
  const [selected, setSelected] = useState<string | null>(null);
  const labelId = useId();

  if (!parsed.ok) return <span className="component-error">{parsed.message}</span>;

  const choose = (item: ListItem, index: number) => {
    setSelected(String(item.id));
    if (node.events?.select) {
      void run(node.events.select, {
        event: {
          item: item as unknown as Json,
          index,
          value: item.id,
        },
      });
    }
  };

  return (
    <div className="advanced-list" aria-busy={pending || undefined}>
      {label ? (
        <div className="advanced-list-label" id={labelId}>
          {label}
        </div>
      ) : null}
      <ul
        className="advanced-list-items"
        aria-labelledby={label ? labelId : undefined}
        aria-label={label ? undefined : '列表'}
      >
        {parsed.items.map((item, index) => {
          const isSelected = selected === String(item.id);
          return (
            <li key={String(item.id)}>
              <button
                type="button"
                className={`advanced-list-item${isSelected ? ' is-selected' : ''}`}
                aria-pressed={isSelected}
                onClick={() => choose(item, index)}
              >
                <span className="advanced-list-title">{item.title}</span>
                {item.description ? (
                  <span className="advanced-list-description">{item.description}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      {parsed.items.length === 0 ? <p className="advanced-list-empty">暂无条目</p> : null}
      <ErrorText error={error} />
    </div>
  );
}

/* ------------------------------------------------------------------- each */

function readAlias(runtime: Runtime, node: DocumentNode, prop: string, fallback: string): string | null {
  const source = propOf(node, prop);
  if (!source) return fallback;
  const result = evaluateSource(runtime, source);
  if (!result.ok) return null;
  return typeof result.value === 'string' ? result.value : null;
}

function EachView({ node, renderChildren }: ComponentProps) {
  const { runtime } = useViewer();
  const itemsSource = propOf(node, 'items');
  if (!itemsSource) {
    return <span className="component-error">each 缺少 items 属性</span>;
  }
  const itemsResult = evaluateSource(runtime, itemsSource);
  if (!itemsResult.ok) {
    return <span className="component-error">each 的 items 求值失败：{itemsResult.message}</span>;
  }
  if (!Array.isArray(itemsResult.value)) {
    return <span className="component-error">each 的 items 必须是 JSON 数组</span>;
  }
  const keySource = propOf(node, 'key');
  if (!keySource) {
    return <span className="component-error">each 缺少 key 属性（字段名，或 “index”）</span>;
  }
  const keyResult = evaluateSource(runtime, keySource);
  if (!keyResult.ok || typeof keyResult.value !== 'string' || !keyResult.value) {
    return <span className="component-error">each 的 key 必须是字符串字段名</span>;
  }
  const keyName = keyResult.value;
  const alias = readAlias(runtime, node, 'as', 'item');
  const indexName = readAlias(runtime, node, 'index', 'index');
  const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
  const reserved = new Set(['__proto__', 'prototype', 'constructor']);
  if (!alias || !identifier.test(alias) || reserved.has(alias)) {
    return <span className="component-error">each 的 as 必须是合法的局部变量名</span>;
  }
  if (!indexName || !identifier.test(indexName) || reserved.has(indexName)) {
    return <span className="component-error">each 的 index 必须是合法的局部变量名</span>;
  }
  if (alias === indexName) {
    return <span className="component-error">each 的 as 与 index 不能使用同一个名字</span>;
  }
  const aliasName: string = alias;
  const indexVariable: string = indexName;

  const items = itemsResult.value;
  const seen = new Map<string, number>();
  const entries: Array<{ key: string; index: number; item: Record<string, Json> }> = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!isJsonObject(item)) {
      return <span className="component-error">each 的 items 第 {index + 1} 项必须是对象</span>;
    }
    let rawKey: Json | undefined;
    if (keyName === 'index') rawKey = index;
    else rawKey = item[keyName];
    if (typeof rawKey !== 'string' && typeof rawKey !== 'number') {
      return (
        <span className="component-error">
          each 的 items 第 {index + 1} 项缺少字段 “{keyName}” 作为 key
        </span>
      );
    }
    if (typeof rawKey === 'string' && rawKey === '') {
      return <span className="component-error">each 的 items 第 {index + 1} 项的 key 不能为空字符串</span>;
    }
    const key = String(rawKey);
    const previous = seen.get(key);
    if (previous !== undefined) {
      return (
        <span className="component-error">
          each 的 items 存在重复 key “{key}”（第 {previous + 1} 项与第 {index + 1} 项）
        </span>
      );
    }
    seen.set(key, index);
    entries.push({ key, index, item });
  }

  return (
    <>
      {entries.map((entry) => {
        const values: Record<string, Json> = {
          [aliasName]: entry.item,
          [indexVariable]: entry.index,
        };
        return (
          <ScopedViewer key={entry.key} values={values}>
            {renderChildren(node.children ?? [])}
          </ScopedViewer>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ timer */

function TimerView({ node }: ComponentProps) {
  const { runtime, snapshot } = useViewer();
  const missing = missingBinding(node);
  const label = labelOf(runtime, node, node.label ?? '计时器');
  const { write, error } = useBindingWriter(node);
  const duration = evalNumber(runtime, node, 'duration', 0);
  const bound = node.binding ? snapshot.state[node.binding] : undefined;
  const boundNumber =
    typeof bound === 'number' && Number.isFinite(bound) ? Math.max(0, Math.floor(bound)) : null;
  const initial = boundNumber ?? (duration > 0 ? Math.floor(duration) : 0);

  const [remaining, setRemaining] = useState(initial);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const remainingRef = useRef(initial);
  const runningRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!runningRef.current && boundNumber !== null) {
      remainingRef.current = boundNumber;
      setRemaining(boundNumber);
    }
  }, [boundNumber]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      runningRef.current = false;
    };
  }, []);

  if (missing) return <ErrorText error={missing} />;
  if (!Number.isFinite(duration) || duration <= 0) {
    return <span className="component-error">timer 的 duration 必须是大于 0 的秒数</span>;
  }

  const stop = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    runningRef.current = false;
    setRunning(false);
  };

  const apply = (value: number) => {
    remainingRef.current = value;
    setRemaining(value);
  };

  const start = () => {
    if (runningRef.current) return;
    setCompleted(false);
    if (remainingRef.current <= 0) apply(Math.floor(duration));
    runningRef.current = true;
    setRunning(true);
    timerRef.current = window.setInterval(() => {
      const next = Math.max(0, remainingRef.current - 1);
      apply(next);
      write(next);
      if (next <= 0) {
        stop();
        setCompleted(true);
      }
    }, 1000);
  };

  const pause = () => {
    stop();
  };

  const reset = () => {
    stop();
    setCompleted(false);
    apply(Math.floor(duration));
    write(Math.floor(duration));
  };

  return (
    <div className="advanced-timer">
      <div className="advanced-timer-head">
        <span className="md-label">{label}</span>
        <span className="advanced-timer-value" role="timer" aria-label={`剩余 ${remaining} 秒`}>
          {remaining}s
        </span>
      </div>
      <div className="advanced-timer-controls">
        <button type="button" className="md-button md-button-primary" onClick={start} disabled={running}>
          开始
        </button>
        <button type="button" className="md-button md-button-secondary" onClick={pause} disabled={!running}>
          暂停
        </button>
        <button type="button" className="md-button md-button-quiet" onClick={reset}>
          重置
        </button>
      </div>
      <span className="advanced-timer-status" role="status" aria-live="polite">
        {completed ? '计时完成' : running ? '计时中' : '已暂停'}
      </span>
      <ErrorText error={error} />
    </div>
  );
}

export const ADVANCED_COMPONENTS: Record<string, ComponentType<ComponentProps>> = {
  grid: GridView,
  tabs: TabsView,
  tab: TabView,
  accordion: AccordionView,
  disclosure: DisclosureView,
  form: FormView,
  submit: SubmitView,
  textarea: TextareaView,
  checkbox: CheckboxView,
  'radio-group': RadioGroupView,
  choices: ChoicesView,
  date: DateView,
  checklist: ChecklistView,
  progress: ProgressView,
  alert: AlertView,
  tooltip: TooltipView,
  image: ImageView,
  icon: IconView,
  divider: DividerView,
  spacer: SpacerView,
  spinner: SpinnerView,
  stat: StatView,
  'link-button': LinkButtonView,
  table: TableView,
  list: ListView,
  each: EachView,
  timer: TimerView,
};
